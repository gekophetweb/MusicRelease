/**
 * Message for a failed Spotify/TIDAL connect. better-auth sends the browser back with `?error=<code>` appended to
 * the error URL; when the param repeats, Next passes an array and the last value is better-auth's code.
 */
const MESSAGES: Record<string, string> = {
  account_already_linked_to_different_user:
    "That music account is already connected to another user on this site. Sign in as that user, or ask the admin to remove it there.",
  access_denied: "Connecting was cancelled. Try again when you're ready.",
  unable_to_link_account: "Connecting didn't finish because your sign-in expired. Sign in again and retry.",
  link: "Connecting didn't finish. Try again.",
};

export function connectErrorMessage(param: string | string[] | undefined): string | null {
  const code = Array.isArray(param) ? param.at(-1) : param;
  if (!code) return null;
  return MESSAGES[code] ?? `Connecting didn't finish (${code}). Try again.`;
}
