"use client";

import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({ plugins: [emailOTPClient()] });

/**
 * Connect (or reconnect) a streaming service to the signed-in account. Spotify and TIDAL are never a way to
 * sign in: people sign in with Google or an email code first.
 */
/**
 * Only for the upgrade fallback (no Google/email sign-in set up yet): sign in with an already-linked service.
 * The server refuses this as soon as the admin has set up a sign-in method.
 */
export function legacySignIn(provider: "spotify" | "tidal") {
  return authClient.signIn.social({ provider, callbackURL: "/releases", errorCallbackURL: "/?error=signin" });
}

export function connect(provider: "spotify" | "tidal", callbackURL = "/settings") {
  return authClient.linkSocial({ provider, callbackURL, errorCallbackURL: callbackURL });
}
