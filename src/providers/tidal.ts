import { fetchWithRetry } from "@/providers/http";
import type { MusicProvider, NormalizedArtist, NormalizedRelease } from "@/providers/types";

/** TIDAL API v2 (JSON:API) — https://tidal-music.github.io/tidal-api-reference/ */
const API = "https://openapi.tidal.com/v2";
const DEFAULT_COUNTRY = "NL";

interface Identifier {
  id: string;
  type: string;
}
interface Resource extends Identifier {
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: Identifier[] | Identifier | null }>;
}
interface Doc {
  data: Identifier[] | Resource;
  included?: Resource[];
  links?: { next?: string };
}
interface ArtworkFile {
  href: string;
  meta?: { width?: number };
}

async function getDoc(path: string, token: string): Promise<Doc> {
  const url = path.startsWith("http") ? path : `${API}${path}`;
  const res = await fetchWithRetry(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.api+json" },
  });
  return (await res.json()) as Doc;
}

const index = (included: Resource[] = []) => new Map(included.map((r) => [`${r.type}:${r.id}`, r]));

const related = (r: Resource | undefined, rel: string): Identifier[] => {
  const d = r?.relationships?.[rel]?.data;
  return !d ? [] : Array.isArray(d) ? d : [d];
};

/** The artwork file closest to 320 px wide. */
function artworkUrl(r: Resource | undefined, rel: string, inc: Map<string, Resource>): string | undefined {
  const art = related(r, rel)[0];
  const files = (art && (inc.get(`artworks:${art.id}`)?.attributes?.files as ArtworkFile[] | undefined)) || [];
  if (!files.length) return undefined;
  return files.reduce((best, f) =>
    Math.abs((f.meta?.width ?? 0) - 320) < Math.abs((best.meta?.width ?? 0) - 320) ? f : best,
  ).href;
}

// The catalogue is per country; remember each token's country for the life of the process (tokens expire anyway).
const countryCache = new Map<string, string>();
export function resetTidalCountryCache(): void {
  countryCache.clear();
}

async function countryFor(token: string): Promise<string> {
  const cached = countryCache.get(token);
  if (cached) return cached;
  let country = DEFAULT_COUNTRY;
  try {
    const doc = await getDoc("/users/me", token);
    const c = (doc.data as Resource).attributes?.country;
    if (typeof c === "string" && /^[A-Z]{2}$/.test(c)) country = c;
  } catch {
    // keep the default; the catalogue call itself will surface real auth problems
  }
  countryCache.set(token, country);
  return country;
}

export const tidalProvider: MusicProvider = {
  name: "tidal",

  async getFollowedArtists(token) {
    const out: NormalizedArtist[] = [];
    let path: string | undefined = "/userCollectionArtists/me/relationships/items?include=items,items.profileArt";
    while (path) {
      const doc = await getDoc(path, token);
      const inc = index(doc.included);
      for (const ref of doc.data as Identifier[]) {
        if (ref.type !== "artists") continue;
        const artist = inc.get(`artists:${ref.id}`);
        out.push({
          providerId: ref.id,
          name: (artist?.attributes?.name as string | undefined) ?? "Unknown artist",
          imageUrl: artworkUrl(artist, "profileArt", inc),
        });
      }
      path = doc.links?.next;
    }
    return out;
  },

  async getArtistReleases(token, artistId, opts = {}) {
    const country = await countryFor(token);
    const out: NormalizedRelease[] = [];
    const params = new URLSearchParams({ countryCode: country, include: "albums,albums.coverArt,albums.artists" });
    let path: string | undefined = `/artists/${encodeURIComponent(artistId)}/relationships/albums?${params}`;
    let pages = 0;
    while (path && (opts.maxPages === undefined || pages < opts.maxPages)) {
      const doc = await getDoc(path, token);
      pages++;
      const inc = index(doc.included);
      for (const ref of doc.data as Identifier[]) {
        const album = inc.get(`albums:${ref.id}`);
        const a = album?.attributes ?? {};
        if (!album || typeof a.title !== "string" || typeof a.releaseDate !== "string") continue;
        const links = (a.externalLinks as { href: string; meta?: { type?: string } }[] | undefined) ?? [];
        const artists = related(album, "artists").map((x) => x.id);
        out.push({
          providerId: ref.id,
          title: a.title,
          rawType: String(a.albumType ?? a.type ?? "ALBUM"),
          releaseDate: a.releaseDate,
          coverUrl: artworkUrl(album, "coverArt", inc),
          url: links.find((l) => l.meta?.type === "TIDAL_SHARING")?.href ?? `https://tidal.com/album/${ref.id}`,
          totalTracks: typeof a.numberOfItems === "number" ? a.numberOfItems : undefined,
          artistProviderIds: artists.length ? artists : [artistId],
        });
      }
      path = doc.links?.next;
    }
    return out;
  },
};
