"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { legacySignIn } from "@/lib/auth-client";

const NAME = { spotify: "Spotify", tidal: "TIDAL" } as const;

/** Shown only while an installed site has no working sign-in method (e.g. right after upgrading without mail). */
export function LegacySignIn({ providers }: { providers: Array<"spotify" | "tidal"> }) {
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <div className="max-w-sm space-y-4">
      <p className="text-sm text-muted">
        Sign-in with Google or an email code isn&apos;t set up yet. Until the admin sets it up under Admin → Settings → Sign-in,
        existing users can still sign in with the music service they used before.
      </p>
      <div className="flex flex-wrap gap-3">
        {providers.map((p) => (
          <Button
            key={p}
            type="button"
            variant="secondary"
            disabled={busy !== null}
            onClick={async () => {
              setBusy(p);
              await legacySignIn(p);
            }}
          >
            {busy === p ? "Redirecting…" : `Sign in with ${NAME[p]}`}
          </Button>
        ))}
      </div>
    </div>
  );
}
