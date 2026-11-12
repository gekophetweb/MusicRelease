import { fetchWithRetry } from "@/providers/http";
import type { MusicProvider, NormalizedArtist, NormalizedRelease } from "@/providers/types";

const API = "https://api.spotify.com/v1";
const PAGE_SIZE = 50;

interface SpotifyImage {
  url: string;
  width?: number | null;
}
interface SpotifyArtist {
  id: string;
  name: string;
  images?: SpotifyImage[];
}
interface SpotifyAlbum {
  id: string;
  name: string;
  album_type: string;
  release_date: string;
  total_tracks?: number;
  images?: SpotifyImage[];
  external_urls?: { spotify?: string };
  artists: { id: string }[];
}
interface Page<T> {
  items: T[];
  next: string | null;
}

/** The image closest to 300 px wide: sharp in a grid without downloading 640 px covers. */
function pickImage(images: SpotifyImage[] | undefined): string | undefined {
  if (!images?.length) return undefined;
  const sized = images.filter((i) => i.width);
  if (!sized.length) return images[0].url;
  return sized.reduce((best, i) => (Math.abs((i.width ?? 0) - 300) < Math.abs((best.width ?? 0) - 300) ? i : best)).url;
}

async function getJson<T>(url: string, token: string): Promise<T> {
  const res = await fetchWithRetry(url, { headers: { authorization: `Bearer ${token}` } });
  return (await res.json()) as T;
}

export const spotifyProvider: MusicProvider = {
  name: "spotify",

  async getFollowedArtists(token) {
    const out: NormalizedArtist[] = [];
    let url: string | null = `${API}/me/following?type=artist&limit=${PAGE_SIZE}`;
    while (url) {
      const body: { artists: Page<SpotifyArtist> } = await getJson(url, token);
      for (const a of body.artists.items) out.push({ providerId: a.id, name: a.name, imageUrl: pickImage(a.images) });
      url = body.artists.next;
    }
    return out;
  },

  async getArtistReleases(token, artistId, opts = {}) {
    // Spotify returns results grouped by type (all albums, then all singles). Fetch each group on its own so
    // that, with maxPages: 1, an artist with 50+ albums still has their newest singles checked.
    const out: NormalizedRelease[] = [];
    for (const group of ["album", "single"] as const) {
      const params = new URLSearchParams({ include_groups: group, market: "from_token", limit: String(PAGE_SIZE) });
      let url: string | null = `${API}/artists/${encodeURIComponent(artistId)}/albums?${params}`;
      let pages = 0;
      while (url && (opts.maxPages === undefined || pages < opts.maxPages)) {
        const body: Page<SpotifyAlbum> = await getJson(url, token);
        pages++;
        for (const a of body.items) {
          out.push({
            providerId: a.id,
            title: a.name,
            rawType: a.album_type,
            releaseDate: a.release_date,
            coverUrl: pickImage(a.images),
            url: a.external_urls?.spotify ?? `https://open.spotify.com/album/${a.id}`,
            totalTracks: a.total_tracks,
            artistProviderIds: a.artists.map((x) => x.id),
          });
        }
        url = body.next;
      }
    }
    return out;
  },
};
