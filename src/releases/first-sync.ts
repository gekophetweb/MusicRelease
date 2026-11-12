/**
 * Starts a user's first sync in the background after they connect.
 * The sync service is wired in by Task 10; until then this is a no-op hook.
 */
export function onFirstSignIn(userId: string): void {
  void userId;
}
