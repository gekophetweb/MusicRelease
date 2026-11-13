"use client";

import { useState } from "react";
import { connect } from "@/lib/auth-client";

const LABEL = { spotify: "Connect Spotify", tidal: "Connect TIDAL" } as const;
const STYLE = {
  spotify: "bg-[#1DB954] text-black hover:bg-[#1ed760]",
  tidal: "bg-black text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200",
} as const;

export function ConnectButtons({
  providers,
  callbackURL,
  mode = "signin",
}: {
  providers: Array<"spotify" | "tidal">;
  callbackURL?: string;
  mode?: "signin" | "link";
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (providers.length === 0) {
    return <p className="text-sm text-neutral-500">No music service is configured yet.</p>;
  }
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      {providers.map((p) => (
        <button
          key={p}
          type="button"
          disabled={busy !== null}
          onClick={async () => {
            setBusy(p);
            await connect(p, callbackURL, mode);
          }}
          className={`rounded-full px-6 py-3 font-semibold transition disabled:opacity-60 ${STYLE[p]}`}
        >
          {busy === p ? "Redirecting…" : LABEL[p]}
        </button>
      ))}
    </div>
  );
}
