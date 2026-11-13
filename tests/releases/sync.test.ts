import { prisma } from "@/lib/db";
import { ReconnectRequiredError } from "@/lib/tokens";
import { ProviderHttpError } from "@/providers/http";
import type { MusicProvider, NormalizedArtist, NormalizedRelease } from "@/providers/types";
import { syncAll, syncUser, type SyncDeps } from "@/releases/sync";
import { resetDb } from "../helpers/db";
import { createAccount, createUser } from "../helpers/factories";

beforeEach(resetDb);

const rel = (id: string, over: Partial<NormalizedRelease> = {}): NormalizedRelease => ({
  providerId: id,
  title: `Title ${id}`,
  rawType: "single",
  releaseDate: "2026-11-07",
  url: `https://open.spotify.com/album/${id}`,
  artistProviderIds: [],
  ...over,
});

/** A provider whose followed artists and catalogue are set per test. */
function fakeProvider(opts: {
  follows: Record<string, NormalizedArtist[]>; // by token
  catalogue: Record<string, NormalizedRelease[]>; // by artist id
  failFor?: (token: string, artistId: string) => Error | undefined;
}) {
  const calls = { followed: [] as string[], releases: [] as string[] };
  const provider: MusicProvider = {
    name: "spotify",
    async getFollowedArtists(token) {
      calls.followed.push(token);
      return opts.follows[token] ?? [];
    },
    async getArtistReleases(token, artistId) {
      calls.releases.push(`${token}:${artistId}`);
      const err = opts.failFor?.(token, artistId);
      if (err) throw err;
      return (opts.catalogue[artistId] ?? []).map((r) => ({ ...r, artistProviderIds: r.artistProviderIds.length ? r.artistProviderIds : [artistId] }));
    },
  };
  return { provider, calls };
}

const A = { providerId: "A", name: "Artist A" };
const B = { providerId: "B", name: "Artist B" };

function deps(provider: MusicProvider, extra: Partial<SyncDeps> = {}): SyncDeps {
  return { providerFor: () => provider, tokenFor: async (userId) => `tok-${userId}`, ...extra };
}

async function userWithSpotify(id: string) {
  const u = await createUser({ id });
  await createAccount(u.id, "spotify");
  return u;
}

test("first sync stores releases and links artists; compilations are skipped", async () => {
  await userWithSpotify("u1");
  const { provider } = fakeProvider({
    follows: { "tok-u1": [A, B] },
    catalogue: { A: [rel("r1"), rel("r2", { rawType: "album" })], B: [rel("r3", { rawType: "compilation" })] },
  });
  const res = await syncUser("u1", deps(provider));
  const run = await prisma.syncRun.findFirstOrThrow({ where: { userId: "u1" } });
  expect({ ...res, error: run.error }).toEqual({ newReleases: 2, error: null });
  expect(await prisma.release.count()).toBe(2);
  expect(await prisma.userArtist.count({ where: { userId: "u1" } })).toBe(2);
  const r2 = await prisma.release.findFirstOrThrow({ where: { providerId: "r2" }, include: { artists: { include: { artist: true } } } });
  expect(r2.type).toBe("album");
  expect(r2.datePrecision).toBe("day");
  expect(r2.artists.map((x) => x.artist.providerId)).toEqual(["A"]);
});

test("second sync is idempotent", async () => {
  await userWithSpotify("u1");
  const { provider } = fakeProvider({ follows: { "tok-u1": [A] }, catalogue: { A: [rel("r1")] } });
  await syncUser("u1", deps(provider));
  await prisma.artist.updateMany({ data: { lastSyncedAt: null } });
  expect(await syncUser("u1", deps(provider))).toEqual({ newReleases: 0 });
  expect(await prisma.release.count()).toBe(1);
});

test("an edition stored earlier is not added again under a new id", async () => {
  await userWithSpotify("u1");
  const first = fakeProvider({ follows: { "tok-u1": [A] }, catalogue: { A: [rel("r1", { title: "Night Drive" })] } });
  await syncUser("u1", deps(first.provider));
  await prisma.artist.updateMany({ data: { lastSyncedAt: null } });
  const second = fakeProvider({ follows: { "tok-u1": [A] }, catalogue: { A: [rel("r1-clean", { title: "Night Drive (Clean)" })] } });
  expect(await syncUser("u1", deps(second.provider))).toEqual({ newReleases: 0 });
  expect(await prisma.release.count()).toBe(1);
});

test("unfollowed artist is removed from the user", async () => {
  await userWithSpotify("u1");
  const one = fakeProvider({ follows: { "tok-u1": [A, B] }, catalogue: {} });
  await syncUser("u1", deps(one.provider));
  const two = fakeProvider({ follows: { "tok-u1": [A] }, catalogue: {} });
  await syncUser("u1", deps(two.provider));
  const links = await prisma.userArtist.findMany({ where: { userId: "u1" }, include: { artist: true } });
  expect(links.map((l) => l.artist.providerId)).toEqual(["A"]);
});

test("artist followed by two users is fetched once per day", async () => {
  await userWithSpotify("u1");
  await userWithSpotify("u2");
  const { provider, calls } = fakeProvider({ follows: { "tok-u1": [A], "tok-u2": [A] }, catalogue: { A: [rel("r1")] } });
  await syncUser("u1", deps(provider));
  await syncUser("u2", deps(provider));
  expect(await prisma.artist.count()).toBe(1);
  expect(await prisma.userArtist.count()).toBe(2);
  expect(calls.releases).toEqual(["tok-u1:A"]);
});

test("unfollow by one user keeps the artist for the other; cleanup removes it when nobody follows", async () => {
  await userWithSpotify("u1");
  await userWithSpotify("u2");
  const both = fakeProvider({ follows: { "tok-u1": [A], "tok-u2": [A] }, catalogue: { A: [rel("r1")] } });
  await syncAll(deps(both.provider));
  const u1Left = fakeProvider({ follows: { "tok-u1": [], "tok-u2": [A] }, catalogue: { A: [rel("r1")] } });
  await syncAll(deps(u1Left.provider));
  expect(await prisma.artist.count()).toBe(1);
  expect(await prisma.release.count()).toBe(1);
  // cleanup only removes rows older than an hour, so age them first
  await prisma.artist.updateMany({ data: { createdAt: new Date(Date.now() - 2 * 3600_000) } });
  await prisma.release.updateMany({ data: { firstSeenAt: new Date(Date.now() - 2 * 3600_000) } });
  const nobody = fakeProvider({ follows: {}, catalogue: {} });
  await syncAll(deps(nobody.provider));
  expect(await prisma.artist.count()).toBe(0);
  expect(await prisma.release.count()).toBe(0);
});

test("failed token for the first user falls back to the next user the same day", async () => {
  await userWithSpotify("u1");
  await userWithSpotify("u2");
  const { provider, calls } = fakeProvider({
    follows: { "tok-u1": [A], "tok-u2": [A] },
    catalogue: { A: [rel("r1")] },
    failFor: (token) => (token === "tok-u1" ? new ProviderHttpError(401, "https://api.spotify.com") : undefined),
  });
  await expect(syncUser("u1", deps(provider))).rejects.toBeInstanceOf(ReconnectRequiredError);
  expect((await prisma.account.findFirstOrThrow({ where: { userId: "u1" } })).needsReconnect).toBe(true);
  await syncUser("u2", deps(provider));
  expect(calls.releases).toEqual(["tok-u1:A", "tok-u2:A"]);
  expect(await prisma.release.count()).toBe(1);
});

test("a temporary error for one artist does not stop the others", async () => {
  await userWithSpotify("u1");
  const { provider } = fakeProvider({
    follows: { "tok-u1": [A, B] },
    catalogue: { B: [rel("rb")] },
    failFor: (_t, artistId) => (artistId === "A" ? new ProviderHttpError(503, "https://api.spotify.com") : undefined),
  });
  expect(await syncUser("u1", deps(provider))).toEqual({ newReleases: 1 });
  expect((await prisma.artist.findFirstOrThrow({ where: { providerId: "A" } })).lastSyncedAt).toBeNull();
});

test("reconnect error does not stop other users", async () => {
  await userWithSpotify("u1");
  await userWithSpotify("u2");
  const { provider } = fakeProvider({ follows: { "tok-u2": [A] }, catalogue: { A: [rel("r1")] } });
  const res = await syncAll(
    deps(provider, {
      tokenFor: async (userId) => {
        if (userId === "u1") throw new ReconnectRequiredError("u1", "spotify");
        return `tok-${userId}`;
      },
    }),
  );
  expect(res).toEqual({ users: 2, newReleases: 1, failures: 1, skipped: false });
  expect(await prisma.release.count()).toBe(1);
  const runs = await prisma.syncRun.findMany({ where: { userId: "u1" } });
  expect(runs[0].error).toMatch(/reconnect/i);
});

test("accounts that need reconnecting are not synced", async () => {
  const u = await createUser({ id: "u1" });
  await createAccount(u.id, "spotify", { needsReconnect: true });
  const { provider, calls } = fakeProvider({ follows: {}, catalogue: {} });
  expect(await syncAll(deps(provider))).toMatchObject({ users: 0 });
  expect(calls.followed).toEqual([]);
});

test("concurrent syncAll runs once", async () => {
  await userWithSpotify("u1");
  await userWithSpotify("u2");
  const { provider, calls } = fakeProvider({ follows: { "tok-u1": [A], "tok-u2": [B] }, catalogue: {} });
  const [a, b] = await Promise.all([syncAll(deps(provider)), syncAll(deps(provider))]);
  expect([a.skipped, b.skipped].sort()).toEqual([false, true]);
  expect(calls.followed.sort()).toEqual(["tok-u1", "tok-u2"]);
});

// ---- review fixes ----

test("new-release count is right when a slower artist creates nothing (no lost update)", async () => {
  await userWithSpotify("u1");
  const { provider } = fakeProvider({
    follows: { "tok-u1": [A, B] },
    catalogue: { A: [rel("r1"), rel("r2", { rawType: "album" })], B: [] },
  });
  const slowB: MusicProvider = {
    ...provider,
    async getArtistReleases(token, artistId, opts) {
      if (artistId === "B") await new Promise((r) => setTimeout(r, 300));
      return provider.getArtistReleases(token, artistId, opts);
    },
  };
  expect(await syncUser("u1", deps(slowB))).toEqual({ newReleases: 2 });
});

test("a collaboration stored earlier is credited to an artist synced later", async () => {
  await userWithSpotify("u1");
  await userWithSpotify("u2");
  const collab = rel("rc", { title: "Together", artistProviderIds: ["A", "B"] });
  const { provider } = fakeProvider({ follows: { "tok-u1": [A], "tok-u2": [B] }, catalogue: { A: [collab], B: [collab] } });
  await syncUser("u1", deps(provider));
  await syncUser("u2", deps(provider));
  const links = await prisma.releaseArtist.findMany({ include: { artist: true } });
  expect(links.map((l) => l.artist.providerId).sort()).toEqual(["A", "B"]);
});

test("a collaboration between two followed artists synced in parallel is stored once without errors", async () => {
  await userWithSpotify("u1");
  const collab = rel("rc", { title: "Together", artistProviderIds: ["A", "B"] });
  const { provider } = fakeProvider({ follows: { "tok-u1": [A, B] }, catalogue: { A: [collab, rel("ra")], B: [collab, rel("rb")] } });
  await syncUser("u1", deps(provider));
  const run = await prisma.syncRun.findFirstOrThrow({ where: { userId: "u1" } });
  expect(run.error).toBeNull();
  expect(await prisma.release.count()).toBe(3);
  expect(await prisma.releaseArtist.count({ where: { release: { providerId: "rc" } } })).toBe(2);
});

test("cleanup leaves artists and releases created moments ago alone", async () => {
  await prisma.artist.create({ data: { provider: "spotify", providerId: "fresh", name: "Fresh" } });
  const { provider } = fakeProvider({ follows: {}, catalogue: {} });
  await syncAll(deps(provider));
  expect(await prisma.artist.count()).toBe(1);
});

test("a provider 401 mid-sync gets one fresh token before the account is marked", async () => {
  await userWithSpotify("u1");
  let n = 0;
  const { provider, calls } = fakeProvider({
    follows: { "tok-u1-1": [A], "tok-u1-2": [A] },
    catalogue: { A: [rel("r1")] },
    failFor: (token) => (token === "tok-u1-1" ? new ProviderHttpError(401, "https://api.spotify.com") : undefined),
  });
  const res = await syncUser("u1", deps(provider, { tokenFor: async () => `tok-u1-${++n}` }));
  expect(res).toEqual({ newReleases: 1 });
  expect(calls.releases).toEqual(["tok-u1-1:A", "tok-u1-2:A"]);
  expect((await prisma.account.findFirstOrThrow({ where: { userId: "u1" } })).needsReconnect).toBe(false);
});
