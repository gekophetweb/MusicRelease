import { prisma } from "@/lib/db";
import type { ProviderName } from "@/providers/types";
import { formatReleaseDate, normalizeTitle, sortReleases, type DatePrecision } from "@/releases/normalize";

export interface ReleaseView {
  id: string;
  title: string;
  type: "album" | "single";
  releaseDate: Date;
  datePrecision: DatePrecision;
  dateLabel: string;
  coverUrl?: string;
  url: string;
  provider: ProviderName;
  artists: string[];
  /** Released in the last 2 weeks (exact release day known) */
  isNew: boolean;
}

const DAY = 24 * 60 * 60 * 1000;
/** Releases on or after the date this many days ago get the "New" label. */
const NEW_FOR_DAYS = 14;

export interface ReleaseQuery {
  /** Only releases from the last N days (by release date). Default 90; 0 = all. */
  sinceDays?: number;
  /** Only releases on or after this date (overrides sinceDays). */
  from?: Date;
  /** Only releases with this date precision. */
  precision?: DatePrecision;
  /** Only releases by this artist (Artist.id); ignored unless the user follows them. */
  artistId?: string;
  now?: Date;
}

export async function getReleaseViews(userId: string, q: ReleaseQuery = {}): Promise<ReleaseView[]> {
  const now = q.now ?? new Date();
  const sinceDays = q.sinceDays ?? 90;
  const from = q.from ?? (sinceDays > 0 ? new Date(now.getTime() - sinceDays * DAY) : undefined);

  const [rows, accounts] = await Promise.all([
    prisma.release.findMany({
      where: {
        AND: [
          { artists: { some: { artist: { followers: { some: { userId } } } } } },
          ...(q.artistId ? [{ artists: { some: { artistId: q.artistId, artist: { followers: { some: { userId } } } } } }] : []),
        ],
        ...(from ? { releaseDate: { gte: from, lte: now } } : {}),
        ...(q.precision ? { datePrecision: q.precision } : {}),
      },
      include: { artists: { include: { artist: { select: { name: true } } } } },
      orderBy: [{ releaseDate: "desc" }, { title: "asc" }],
    }),
    prisma.account.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { providerId: true } }),
  ]);

  // Release dates are stored as UTC midnight: compare against UTC midnight of the day two weeks ago.
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const newSince = today - NEW_FOR_DAYS * DAY;
  const isNew = (date: Date, precision: DatePrecision) =>
    precision === "day" && date.getTime() >= newSince && date.getTime() <= now.getTime();

  const preferred = accounts.map((a) => a.providerId);
  const rank = (p: string) => (preferred.indexOf(p) === -1 ? 99 : preferred.indexOf(p));

  // One card per release even when it exists on both Spotify and TIDAL.
  const byKey = new Map<string, ReleaseView>();
  for (const r of rows) {
    const view: ReleaseView = {
      id: r.id,
      title: r.title,
      type: r.type,
      releaseDate: r.releaseDate,
      datePrecision: r.datePrecision,
      dateLabel: formatReleaseDate(r.releaseDate, r.datePrecision),
      coverUrl: r.coverUrl ?? undefined,
      url: r.url,
      provider: r.provider,
      artists: [...new Set(r.artists.map((a) => a.artist.name))].sort((a, b) => a.localeCompare(b)),
      isNew: isNew(r.releaseDate, r.datePrecision),
    };
    const key = `${normalizeTitle(r.title)}|${r.type}|${r.releaseDate.toISOString().slice(0, 10)}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, view);
      continue;
    }
    const keep = rank(view.provider) < rank(prev.provider) ? view : prev;
    byKey.set(key, {
      ...keep,
      artists: [...new Set([...prev.artists, ...view.artists])].sort((a, b) => a.localeCompare(b)),
      isNew: prev.isNew || view.isNew,
    });
  }
  return sortReleases([...byKey.values()]);
}

export async function getReleasesForUser(
  userId: string,
  q: ReleaseQuery = {},
): Promise<{ albums: ReleaseView[]; singles: ReleaseView[] }> {
  const views = await getReleaseViews(userId, q);
  return { albums: views.filter((v) => v.type === "album"), singles: views.filter((v) => v.type === "single") };
}
