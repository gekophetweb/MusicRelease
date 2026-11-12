import { prisma } from "@/lib/db";

type P = "spotify" | "tidal";

export async function artist(provider: P, providerId: string, name = `Artist ${providerId}`) {
  return prisma.artist.create({ data: { provider, providerId, name } });
}

export async function follow(userId: string, artistId: string) {
  await prisma.userArtist.create({ data: { userId, artistId } });
}

export async function release(
  provider: P,
  providerId: string,
  artistIds: string[],
  over: {
    title?: string;
    type?: "album" | "single";
    releaseDate?: string;
    datePrecision?: "day" | "month" | "year";
    firstSeenAt?: Date;
  } = {},
) {
  return prisma.release.create({
    data: {
      provider,
      providerId,
      title: over.title ?? `Release ${providerId}`,
      type: over.type ?? "single",
      releaseDate: new Date(`${over.releaseDate ?? "2026-11-07"}T00:00:00Z`),
      datePrecision: over.datePrecision ?? "day",
      url: provider === "spotify" ? `https://open.spotify.com/album/${providerId}` : `https://tidal.com/album/${providerId}`,
      firstSeenAt: over.firstSeenAt ?? new Date("2026-11-08T06:00:00Z"),
      artists: { create: artistIds.map((artistId) => ({ artistId })) },
    },
  });
}
