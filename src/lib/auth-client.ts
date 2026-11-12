"use client";

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

/**
 * "signin": sign in (or sign up) with the service — landing page, installer, reconnecting.
 * "link": add the service to the signed-in account — Settings → connect another service.
 */
export function connect(provider: "spotify" | "tidal", callbackURL = "/releases", mode: "signin" | "link" = "signin") {
  if (mode === "link") return authClient.linkSocial({ provider, callbackURL, errorCallbackURL: `${callbackURL}?error=link` });
  return authClient.signIn.social({ provider, callbackURL, errorCallbackURL: "/?error=connect" });
}
