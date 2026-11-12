import pg from "pg";
import { prisma } from "@/lib/db";
import { getValidAccessToken, ReconnectRequiredError } from "@/lib/tokens";
import { getProvider } from "@/providers";
import { ProviderHttpError } from "@/providers/http";
import type { MusicProvider, NormalizedArtist, ProviderName } from "@/providers/types";
import { classifyRelease, dedupeReleases, normalizeTitle, parseReleaseDate } from "@/releases/normalize";

export interface SyncDeps {
  providerFor?: (p: ProviderName) => MusicProvider;
  tokenFor?: (userId: string, p: ProviderName) => Promise<string>;
  now?: () => Date;
}

/** An artist fetched within this window counts as "synced today" and is shared by every follower. */
const FRESH_MS = 20 * 60 * 60 * 1000;
const ARTIST_CONCURRENCY = 5;
const SYNC_LOCK_ID = 424242;
const PROVIDERS: ProviderName[] = ["spotify", "tidal"];

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

async function upsertArtists(provider: ProviderName, artists: NormalizedArtist[]) {
  const rows = [];
  for (const a of artists) {
    rows.push(
      await prisma.artist.upsert({
        where: { provider_providerId: { provider, providerId: a.providerId } },
        create: { provider, providerId: a.providerId, name: a.name, imageUrl: a.imageUrl ?? null },
        update: { name: a.name, imageUrl: a.imageUrl ?? null },
      }),
    );
  }
  return rows;
}

/** Makes the user's followed-artist links for one provider match `artistIds` exactly. */
async function replaceFollows(userId: string, provider: ProviderName, artistIds: string[]) {
  await prisma.userArtist.deleteMany({ where: { userId, artist: { provider }, artistId: { notIn: artistIds } } });
  if (artistIds.length) {
    await prisma.userArtist.createMany({ data: artistIds.map((artistId) => ({ userId, artistId })), skipDuplicates: true });
  }
}

/** Fetches one artist's releases, stores the new ones and credits the artist on known ones. Returns how many were created. */
async function syncArtist(
  provider: MusicProvider,
  token: string,
  artist: { id: string; providerId: string; lastSyncedAt: Date | null },
  now: Date,
): Promise<number> {
  const p = provider.name;
  const fetched = await provider.getArtistReleases(token, artist.providerId, artist.lastSyncedAt ? { maxPages: 1 } : {});
  const releases = dedupeReleases(p, fetched);
  const keyOf = (title: string, type: string, date: Date) => `${normalizeTitle(title)}|${type}|${date.toISOString().slice(0, 10)}`;

  // Releases we already store: by id, and this artist's by title/type/date (a later "Clean" edition gets a new id).
  const existing = await prisma.release.findMany({
    where: { OR: [{ provider: p, providerId: { in: releases.map((r) => r.providerId) } }, { artists: { some: { artistId: artist.id } } }] },
    select: { id: true, provider: true, providerId: true, title: true, type: true, releaseDate: true },
  });
  const idByProviderId = new Map(existing.filter((r) => r.provider === p).map((r) => [r.providerId, r.id]));
  const idByKey = new Map(existing.map((r) => [keyOf(r.title, r.type, r.releaseDate), r.id]));

  const linkedIds = [...new Set(releases.flatMap((r) => r.artistProviderIds))];
  const known = await prisma.artist.findMany({ where: { provider: p, providerId: { in: linkedIds } }, select: { id: true, providerId: true } });
  const artistIdByProviderId = new Map(known.map((a) => [a.providerId, a.id]));

  let created = 0;
  for (const r of releases) {
    const kind = classifyRelease(p, r.rawType)!;
    const date = parseReleaseDate(r.releaseDate)!;
    const key = keyOf(r.title, kind, date.date);
    let releaseId = idByProviderId.get(r.providerId) ?? idByKey.get(key);
    if (!releaseId) {
      // createMany + skipDuplicates: a parallel sync may store the same release at the same moment.
      const res = await prisma.release.createMany({
        data: [
          {
            provider: p,
            providerId: r.providerId,
            title: r.title,
            type: kind,
            releaseDate: date.date,
            datePrecision: date.precision,
            coverUrl: r.coverUrl ?? null,
            url: r.url,
            totalTracks: r.totalTracks ?? null,
          },
        ],
        skipDuplicates: true,
      });
      created += res.count;
      releaseId = (await prisma.release.findUniqueOrThrow({
        where: { provider_providerId: { provider: p, providerId: r.providerId } },
        select: { id: true },
      })).id;
      idByProviderId.set(r.providerId, releaseId);
      idByKey.set(key, releaseId);
    }
    // Credit this artist (and any other known artist on it), also on releases stored earlier by someone else.
    const artistIds = new Set([artist.id, ...r.artistProviderIds.map((id) => artistIdByProviderId.get(id)).filter((x): x is string => !!x)]);
    await prisma.releaseArtist.createMany({
      data: [...artistIds].map((artistId) => ({ releaseId: releaseId!, artistId })),
      skipDuplicates: true,
    });
  }
  await prisma.artist.update({ where: { id: artist.id }, data: { lastSyncedAt: now } });
  return created;
}

const isAuthError = (err: unknown) => err instanceof ProviderHttpError && err.status === 401;

async function syncAccount(userId: string, p: ProviderName, deps: Required<SyncDeps>, warnings: string[]): Promise<number> {
  const provider = deps.providerFor(p);
  let token = await deps.tokenFor(userId, p);
  let refreshed = false;
  const markReconnect = async (err: unknown): Promise<never> => {
    await prisma.account.updateMany({ where: { userId, providerId: p }, data: { needsReconnect: true } });
    throw new ReconnectRequiredError(userId, p, err);
  };
  /** After a 401, get the token once more (it may have expired mid-sync). False when nothing changed. */
  const refreshToken = async (): Promise<boolean> => {
    if (refreshed) return false;
    refreshed = true;
    const next = await deps.tokenFor(userId, p);
    const changed = next !== token;
    token = next;
    return changed;
  };

  let followed: NormalizedArtist[];
  try {
    followed = await provider.getFollowedArtists(token);
  } catch (err) {
    if (!isAuthError(err)) throw err;
    if (!(await refreshToken())) return markReconnect(err);
    try {
      followed = await provider.getFollowedArtists(token);
    } catch (err2) {
      if (isAuthError(err2)) return markReconnect(err2);
      throw err2;
    }
  }
  const artists = await upsertArtists(p, followed);
  await replaceFollows(userId, p, artists.map((a) => a.id));

  const now = deps.now();
  const stale = artists.filter((a) => !a.lastSyncedAt || now.getTime() - a.lastSyncedAt.getTime() > FRESH_MS);
  let created = 0;
  const authFailed: typeof stale = [];
  const runArtist = async (artist: (typeof stale)[number]) => {
    try {
      const n = await syncArtist(provider, token, artist, now);
      created += n;
    } catch (err) {
      if (isAuthError(err)) authFailed.push(artist);
      else {
        const msg = `${p} artist ${artist.providerId} (${artist.name}): ${(err as Error).message}`;
        warnings.push(msg);
        console.warn(`[sync] ${msg}`);
      }
    }
  };
  await pool(stale, ARTIST_CONCURRENCY, runArtist);
  if (authFailed.length) {
    const retry = authFailed.splice(0);
    if (!(await refreshToken())) return markReconnect(new Error("401 from provider"));
    await pool(retry, ARTIST_CONCURRENCY, runArtist);
    if (authFailed.length) return markReconnect(new Error("401 from provider after a fresh token"));
  }
  return created;
}

function withDefaults(deps: SyncDeps = {}): Required<SyncDeps> {
  return {
    providerFor: deps.providerFor ?? getProvider,
    tokenFor: deps.tokenFor ?? getValidAccessToken,
    now: deps.now ?? (() => new Date()),
  };
}

/** Syncs every connected service of one user. Throws the first account error after trying all accounts. */
export async function syncUser(userId: string, deps?: SyncDeps): Promise<{ newReleases: number }> {
  const d = withDefaults(deps);
  const run = await prisma.syncRun.create({ data: { userId } });
  const accounts = await prisma.account.findMany({
    where: { userId, providerId: { in: PROVIDERS }, needsReconnect: false },
    select: { providerId: true },
  });
  let newReleases = 0;
  const errors: unknown[] = [];
  const warnings: string[] = [];
  for (const { providerId } of accounts) {
    try {
      newReleases += await syncAccount(userId, providerId as ProviderName, d, warnings);
    } catch (err) {
      errors.push(err);
    }
  }
  await prisma.syncRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), newReleases, error: [...errors.map((e) => (e as Error).message), ...warnings].join("; ").slice(0, 2000) || null },
  });
  if (errors.length) throw errors[0];
  return { newReleases };
}

/** Deletes artists nobody follows any more (their releases cascade). */
async function cleanupOrphans(): Promise<void> {
  // Rows younger than an hour may belong to a sync that is still running (first sync, "Sync now").
  const before = new Date(Date.now() - 60 * 60 * 1000);
  await prisma.artist.deleteMany({ where: { followers: { none: {} }, createdAt: { lt: before } } });
  await prisma.release.deleteMany({ where: { artists: { none: {} }, firstSeenAt: { lt: before } } });
}

export interface SyncAllResult {
  users: number;
  newReleases: number;
  failures: number;
  skipped: boolean;
}

/** Syncs all users. Only one run at a time across app and worker (Postgres advisory lock). */
export async function syncAll(deps?: SyncDeps): Promise<SyncAllResult> {
  const lock = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await lock.connect();
  try {
    const got = await lock.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [SYNC_LOCK_ID]);
    if (!got.rows[0].ok) {
      console.log("[sync] another sync is running; skipping");
      return { users: 0, newReleases: 0, failures: 0, skipped: true };
    }
    try {
      const users = await prisma.account.findMany({
        where: { providerId: { in: PROVIDERS }, needsReconnect: false },
        distinct: ["userId"],
        select: { userId: true },
      });
      let newReleases = 0;
      let failures = 0;
      for (const { userId } of users) {
        try {
          newReleases += (await syncUser(userId, deps)).newReleases;
        } catch (err) {
          failures++;
          console.warn(`[sync] user ${userId} failed: ${(err as Error).message}`);
        }
      }
      await cleanupOrphans();
      return { users: users.length, newReleases, failures, skipped: false };
    } finally {
      await lock.query("SELECT pg_advisory_unlock($1)", [SYNC_LOCK_ID]);
    }
  } finally {
    await lock.end();
  }
}
