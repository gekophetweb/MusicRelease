import Link from "next/link";
import { getFollowedArtists, type ArtistSort, type FollowedArtist } from "@/artists/queries";
import { AppHeader } from "@/components/AppHeader";
import { Button, TextInput } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Artists · MusicReleases" };

const SERVICE = { spotify: "Spotify", tidal: "TIDAL" } as const;
const SORTS: { key: ArtistSort; label: string }[] = [
  { key: "name", label: "A–Z" },
  { key: "latest", label: "Latest release" },
];

function ArtistCard({ a }: { a: FollowedArtist }) {
  return (
    <li className="flex items-center gap-4 rounded-lg border border-line bg-surface p-3 transition hover:border-plum">
      <Link href={`/releases?since=all&artist=${encodeURIComponent(a.id)}`} className="group flex min-w-0 flex-1 items-center gap-4">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-line">
          {a.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- artist photos come from Spotify/TIDAL CDNs
            <img src={a.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center font-display text-xl font-semibold text-muted" aria-hidden>
              {a.name.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-0.5">
          <p className="truncate font-semibold group-hover:underline">{a.name}</p>
          <p className="text-xs text-muted">
            {SERVICE[a.provider]} · {a.releaseCount} release{a.releaseCount === 1 ? "" : "s"}
          </p>
          <p className="truncate text-xs text-muted">
            {a.latest ? (
              <>
                Latest: {a.latest.title} ·{" "}
                <time dateTime={a.latest.releaseDate.toISOString().slice(0, 10)}>{a.latest.dateLabel}</time>
              </>
            ) : (
              "No releases found yet"
            )}
          </p>
        </div>
      </Link>
      <a
        href={a.url}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 rounded-md px-2 py-1 text-xs text-muted hover:text-ink hover:underline"
        aria-label={`Open ${a.name} in ${SERVICE[a.provider]}`}
      >
        {SERVICE[a.provider]} ↗
      </a>
    </li>
  );
}

export default async function ArtistsPage({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const sort: ArtistSort = params.sort === "latest" ? "latest" : "name";

  const [artists, site, total] = await Promise.all([
    getFollowedArtists(user.id, { q, sort }),
    getSetting("site"),
    q ? getFollowedArtists(user.id).then((l) => l.length) : Promise.resolve(null),
  ]);
  const count = total ?? artists.length;
  const href = (s: ArtistSort) => `/artists?${new URLSearchParams({ ...(q ? { q } : {}), sort: s })}`;

  return (
    <>
      <AppHeader siteName={site?.siteName ?? "MusicReleases"} isAdmin={user.role === "admin"} current="artists" />
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-display text-4xl font-bold tracking-tight">Artists you follow</h1>
            <p className="text-sm text-muted">
              {count} artist{count === 1 ? "" : "s"}, from your Spotify follows and TIDAL collection. Updated with every sync.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <form action="/artists" className="flex gap-2" role="search">
              <input type="hidden" name="sort" value={sort} />
              <label htmlFor="artist-q" className="sr-only">
                Search artists
              </label>
              <TextInput id="artist-q" name="q" type="search" defaultValue={q} placeholder="Search artists" className="w-48" />
              <Button type="submit" variant="secondary">
                Search
              </Button>
            </form>
            <nav aria-label="Sort" className="flex rounded-md border border-line bg-surface p-0.5 text-sm">
              {SORTS.map((s) => (
                <Link
                  key={s.key}
                  href={href(s.key)}
                  aria-current={s.key === sort ? "true" : undefined}
                  className={`rounded px-3 py-1 ${s.key === sort ? "bg-plum text-paper" : "text-muted hover:text-ink"}`}
                >
                  {s.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>

        {artists.length === 0 ? (
          <p className="max-w-prose text-muted">
            {q ? (
              <>
                No artists match “{q}”.{" "}
                <Link href={`/artists?sort=${sort}`} className="text-plum underline underline-offset-2">
                  Show all
                </Link>
              </>
            ) : (
              "No followed artists yet. They appear after the first sync; follow a few artists on Spotify or add them to your TIDAL collection, then press Sync now on the Releases page."
            )}
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {artists.map((a) => (
              <ArtistCard key={a.id} a={a} />
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
