"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SyncNowButton() {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; message?: string; error?: boolean }>({ busy: false });
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={state.busy}
        onClick={async () => {
          setState({ busy: true });
          const res = await fetch("/api/sync", { method: "POST" });
          const body = (await res.json().catch(() => ({}))) as { newReleases?: number; error?: string };
          if (res.ok) {
            const n = body.newReleases ?? 0;
            setState({ busy: false, message: n === 0 ? "Up to date" : `${n} new release${n === 1 ? "" : "s"}` });
            router.refresh();
          } else {
            setState({ busy: false, error: true, message: body.error ?? "Sync failed" });
          }
        }}
        className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-plum disabled:opacity-60"
      >
        {state.busy ? "Syncing…" : "Sync now"}
      </button>
      {state.message && (
        <span role="status" className={`text-sm ${state.error ? "text-danger" : "text-muted"}`}>
          {state.message}
        </span>
      )}
    </div>
  );
}
