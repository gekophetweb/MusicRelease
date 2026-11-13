export type ProviderName = "spotify" | "tidal";

export interface NormalizedArtist {
  providerId: string;
  name: string;
  imageUrl?: string;
}

export interface NormalizedRelease {
  providerId: string;
  title: string;
  /** The provider's own value, e.g. 'single', 'album', 'EP', 'SINGLE' */
  rawType: string;
  /** As given by the provider: 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD' */
  releaseDate: string;
  coverUrl?: string;
  url: string;
  totalTracks?: number;
  artistProviderIds: string[];
}

export interface MusicProvider {
  name: ProviderName;
  /** All artists the user follows (every page). */
  getFollowedArtists(token: string): Promise<NormalizedArtist[]>;
  getArtistReleases(token: string, artistProviderId: string, opts?: { maxPages?: number }): Promise<NormalizedRelease[]>;
}
