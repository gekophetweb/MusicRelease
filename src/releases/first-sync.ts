/** Starts a sync in the background right after someone connects Spotify or TIDAL, so the page fills quickly. */
export function onFirstSignIn(userId: string): void {
  // Imported lazily: sync → tokens → auth would otherwise be a cycle (auth calls this hook).
  void import("@/releases/sync")
    .then(({ syncUser }) => syncUser(userId))
    .then(({ newReleases }) => console.log(`[sync] first sync for ${userId}: ${newReleases} releases`))
    .catch((err) => console.warn(`[sync] first sync for ${userId} failed: ${(err as Error).message}`));
}
