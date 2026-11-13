import type { ProviderName } from "@/providers/types";

/**
 * OAuth scopes each music service needs, with a plain-language reason.
 * Shared by sign-in (src/lib/auth.ts) and the setup / admin form, so the two can't drift apart.
 * Kept free of server imports so client components can use it.
 */
export interface ScopeInfo {
  scope: string;
  reason: string;
}

export const PROVIDER_SCOPES: Record<ProviderName, readonly ScopeInfo[]> = {
  spotify: [
    { scope: "user-follow-read", reason: "read the artists you follow" },
    { scope: "user-read-email", reason: "read your account email, used as the weekly digest address" },
  ],
  tidal: [
    { scope: "user.read", reason: "read your TIDAL account (user id and, if shared, email)" },
    { scope: "collection.read", reason: "read the artists in your collection" },
  ],
};

export const scopeNames = (provider: ProviderName): string[] => PROVIDER_SCOPES[provider].map((s) => s.scope);
