import { spotifyProvider } from "@/providers/spotify";
import { tidalProvider } from "@/providers/tidal";
import type { MusicProvider, ProviderName } from "@/providers/types";

export type { MusicProvider, NormalizedArtist, NormalizedRelease, ProviderName } from "@/providers/types";

const PROVIDERS: Record<ProviderName, MusicProvider> = { spotify: spotifyProvider, tidal: tidalProvider };

export function getProvider(name: ProviderName): MusicProvider {
  return PROVIDERS[name];
}
