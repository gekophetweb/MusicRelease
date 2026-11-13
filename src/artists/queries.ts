import { prisma } from "@/lib/db";
import type { ProviderName } from "@/providers/types";
import { formatReleaseDate } from "@/releases/normalize";

export interface FollowedArtist {
  id: string;
  name: string;
  provider: ProviderName;
  imageUrl?: string;
  /** The artist's page on Spotify / TIDAL */
  url: string;
  /** Releases the sync has found for this artist */
  releaseCount: number;
  latest: { title: string; releaseDate: Date; dateLabel: string } | null;
}

export type ArtistSort = "name" | "latest";

const ARTIST_PAGE: Record<ProviderName, (id: string) => string> = {
  spotify: (id) => `https://open.spotify.com/artist/${encodeURIComponent(id)}`,
  tidal: (id) => `https://tidal.com/artist/${encodeURIComponent(id)}`,
};

export const artistUrl = (provider: ProviderName, providerId: string) => ARTIST_PAGE[provider](providerId);

export async function getFollowedArtists(userId: string, opts: { q?: string; sort?: ArtistSort } = {}): Promise<FollowedArtist[]> {
  const q = opts.q?.trim();
  const rows = await prisma.artist.findMany({
    where: {
      followers: { some: { userId } },
      ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    },
    select: {
      id: true,
      name: true,
      provider: true,
      providerId: true,
      imageUrl: true,
      _count: { select: { releases: true } },
      releases: {
        select: { release: { select: { title: true, releaseDate: true, datePrecision: true } } },
        orderBy: { release: { releaseDate: "desc" } },
        take: 1,
      },
    },
  });

  const list: FollowedArtist[] = rows.map((r) => {
    const latest = r.releases[0]?.release;
    return {
      id: r.id,
      name: r.name,
      provider: r.provider,
      imageUrl: r.imageUrl ?? undefined,
      url: artistUrl(r.provider, r.providerId),
      releaseCount: r._count.releases,
      latest: latest
        ? { title: latest.title, releaseDate: latest.releaseDate, dateLabel: formatReleaseDate(latest.releaseDate, latest.datePrecision) }
        : null,
    };
  });

  const byName = (a: FollowedArtist, b: FollowedArtist) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  if (opts.sort === "latest") {
    return list.sort(
      (a, b) => (b.latest?.releaseDate.getTime() ?? -Infinity) - (a.latest?.releaseDate.getTime() ?? -Infinity) || byName(a, b),
    );
  }
  return list.sort(byName);
}
