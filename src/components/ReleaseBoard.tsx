"use client";

import { useState, type ReactNode } from "react";

/** Albums and singles side by side on wide screens; tabs on phones. */
export function ReleaseBoard({
  albums,
  singles,
  albumCount,
  singleCount,
}: {
  albums: ReactNode;
  singles: ReactNode;
  albumCount: number;
  singleCount: number;
}) {
  const [tab, setTab] = useState<"albums" | "singles">("albums");
  const tabBtn = (key: typeof tab, label: string, count: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      aria-controls={`panel-${key}`}
      onClick={() => setTab(key)}
      className={`flex-1 border-b-2 px-3 py-2 font-display text-lg font-semibold ${
        tab === key ? "border-marigold text-ink" : "border-transparent text-muted"
      }`}
    >
      {label} <span className="text-sm font-normal text-muted">{count}</span>
    </button>
  );

  return (
    <div>
      <div role="tablist" aria-label="Release type" className="mb-6 flex lg:hidden">
        {tabBtn("albums", "Albums", albumCount)}
        {tabBtn("singles", "Singles", singleCount)}
      </div>
      <div className="grid gap-12 lg:grid-cols-2">
        <section id="panel-albums" role="tabpanel" aria-labelledby="albums-title" className={tab === "albums" ? "" : "hidden lg:block"}>
          <h2 id="albums-title" className="mb-5 hidden font-display text-2xl font-semibold lg:block">
            Albums <span className="text-base font-normal text-muted">{albumCount}</span>
          </h2>
          {albums}
        </section>
        <section id="panel-singles" role="tabpanel" aria-labelledby="singles-title" className={tab === "singles" ? "" : "hidden lg:block"}>
          <h2 id="singles-title" className="mb-5 hidden font-display text-2xl font-semibold lg:block">
            Singles &amp; EPs <span className="text-base font-normal text-muted">{singleCount}</span>
          </h2>
          {singles}
        </section>
      </div>
    </div>
  );
}
