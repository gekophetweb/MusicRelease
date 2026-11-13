import type { ReleaseView } from "@/releases/queries";

const SERVICE = { spotify: "Spotify", tidal: "TIDAL" } as const;

export function ReleaseCard({ r }: { r: ReleaseView }) {
  return (
    <li>
      <a
        href={r.url}
        target="_blank"
        rel="noreferrer"
        className="group block"
        aria-label={`${r.title} by ${r.artists.join(", ")}, ${r.dateLabel}. Open in ${SERVICE[r.provider]}`}
      >
        <div className="relative aspect-square overflow-hidden rounded-sm bg-line shadow-[0_1px_0_var(--line)]">
          {r.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- covers come from Spotify/TIDAL CDNs
            <img
              src={r.coverUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="grid h-full w-full place-items-center p-3 text-center font-display text-lg text-muted">{r.title}</div>
          )}
          {r.isNew && (
            <span className="absolute right-2 top-2 rotate-6 rounded-full bg-marigold px-2.5 py-1 text-xs font-bold text-[#241631] shadow">
              New
            </span>
          )}
        </div>
        <div className="mt-2 space-y-0.5">
          <p className="line-clamp-2 font-semibold leading-snug group-hover:underline">{r.title}</p>
          <p className="line-clamp-1 text-sm text-muted">{r.artists.join(", ")}</p>
          <p className="text-xs text-muted">
            <time dateTime={r.releaseDate.toISOString().slice(0, 10)}>{r.dateLabel}</time>
          </p>
        </div>
      </a>
    </li>
  );
}
