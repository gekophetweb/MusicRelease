"use client";

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

export function connect(provider: "spotify" | "tidal", callbackURL = "/releases") {
  const errorCallbackURL = "/?error=connect";
  return authClient.signIn.social({ provider, callbackURL, errorCallbackURL });
}
