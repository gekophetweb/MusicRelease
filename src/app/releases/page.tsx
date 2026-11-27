import Link from "next/link";
import { getFollowedArtists } from "@/artists/queries";
import { AppHeader } from "@/components/AppHeader";
import { ConnectButtons } from "@/components/ConnectButtons";
import { ReleaseBoard } from "@/components/ReleaseBoard";
import { ReleaseCard } from "@/components/ReleaseCard";
import { SyncNowButton } from "@/components/SyncNowButton";
import { Button, Select } from "@/components/ui";
import { getEnabledProviders } from "@/lib/auth";
import { connectErrorMessage } from "@/lib/connect-errors";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getSetting } from "@/lib/settings";
import type { ProviderName } from "@/providers/types";
import { getReleasesForUser, type ReleaseView } from "@/releases/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Releases · MusicReleases" };

const SERVICE: Record<ProviderName, string> = { spotify: "Spotify", tidal: "TIDAL" };

const PERIODS = [
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "365", label: "1 year", days: 365 },
  { key: "all", label: "All", days: 0 },
] as const;

function Grid({ items, empty }: { items: ReleaseView[]; empty: string }) {
  if (items.length === 0) return <p className="text-muted">{empty}</p>;
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3">
      {items.map((r) => (
        <ReleaseCard key={r.id} r={r} />
      ))}
    </ul>
  );
}

function timeAgo(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export default async function ReleasesPage({
  searchParams,
}: {
  searchParams: Promise<{ since?: string; welcome?: string; artist?: string; service?: string; error?: string | string[] }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const period = PERIODS.find((p) => p.key === params.since) ?? PERIODS[0];

  const [accounts, followed] = await Promise.all([
    // Music services only: a Google sign-in is an account row too.
    prisma.account.findMany({
      where: { userId: user.id, providerId: { in: ["spotify", "tidal"] } },
      orderBy: { createdAt: "asc" },
      select: { providerId: true, needsReconnect: true },
    }),
    getFollowedArtists(user.id),
  ]);
  // The service filter only exists with two or more services connected.
  const connected = [...new Set(accounts.map((a) => a.providerId as ProviderName))];
  const service = connected.length > 1 ? connected.find((p) => p === params.service) : undefined;
  const shownArtists = service ? followed.filter((a) => a.provider === service) : followed;
  // An artist from the other service would only ever show an empty page: drop it.
  const artist = params.artist ? shownArtists.find((a) => a.id === params.artist) : undefined;

  const [{ albums, singles }, site, mail, lastRun, services] = await Promise.all([
    getReleasesForUser(user.id, { sinceDays: period.days, artistId: artist?.id, provider: service }),
    getSetting("site"),
    getSetting("mail"),
    prisma.syncRun.findFirst({ where: { userId: user.id, finishedAt: { not: null } }, orderBy: { startedAt: "desc" } }),
    getEnabledProviders(),
  ]);
  const noService = accounts.length === 0;
  const follows = shownArtists.length;
  // Same name on Spotify and TIDAL: tell the two apart in the picker.
  const dupNames = new Set(shownArtists.map((a) => a.name.toLowerCase()).filter((n, i, all) => all.indexOf(n) !== i));
  const href = (o: { since?: string; artist?: string; service?: string }) =>
    `/releases?${new URLSearchParams({
      since: o.since ?? period.key,
      ...(o.artist ? { artist: o.artist } : {}),
      ...(o.service ? { service: o.service } : {}),
    })}`;
  const onService = service ? ` on ${SERVICE[service]}` : "";
  const emptyFor = (kind: string) =>
    `No ${artist ? `${kind} by ${artist.name}` : `new ${kind}`}${onService} in the last ${period.label.toLowerCase()}.`;
  const reconnect = accounts.filter((a) => a.needsReconnect).map((a) => a.providerId as "spotify" | "tidal");
  const isAdmin = user.role === "admin";
  const nothing = albums.length + singles.length === 0;

  return (
    <>
      <AppHeader siteName={site?.siteName ?? "MusicReleases"} isAdmin={isAdmin} userId={user.id} current="releases" />
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-10">
        {connectErrorMessage(params.error) && (
          <p role="alert" className="rounded-md border border-danger/40 px-4 py-3 text-sm text-danger">
            {connectErrorMessage(params.error)}
          </p>
        )}
        {params.welcome && (
          <p role="status" className="rounded-md border border-ok/40 px-4 py-3 text-sm text-ok">
            Setup complete. Your followed artists are being synced now; refresh in a minute.
          </p>
        )}
        {reconnect.length > 0 && (
          <div role="alert" className="space-y-3 rounded-md border border-danger/40 px-4 py-4">
            <p className="text-sm">
              Your {reconnect.map((p) => (p === "tidal" ? "TIDAL" : "Spotify")).join(" and ")} connection stopped working, so new
              releases are not being checked. Connect again to continue.
            </p>
            <ConnectButtons providers={reconnect} callbackURL="/releases" />
          </div>
        )}
        {isAdmin && !mail && (
          <p className="rounded-md border border-line px-4 py-3 text-sm text-muted">
            The weekly email is off because mail is not set up.{" "}
            <Link href="/admin/settings#mail" className="text-plum underline underline-offset-2">
              Set up mail
            </Link>
          </p>
        )}

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-display text-4xl font-bold tracking-tight">{artist ? artist.name : "New releases"}</h1>
            <p className="text-sm text-muted">
              {artist ? (
                <>
                  Releases by {artist.name}{onService}.{" "}
                  <Link href={href({ service })} className="text-plum underline underline-offset-2">
                    Show all artists
                  </Link>
                  .
                </>
              ) : (
                <>
                  From {follows} artist{follows === 1 ? "" : "s"} you follow{onService}.
                </>
              )} {lastRun?.finishedAt ? `Last checked ${timeAgo(lastRun.finishedAt)}.` : "Not checked yet."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {connected.length > 1 && (
              <nav aria-label="Streaming service" className="flex rounded-md border border-line bg-surface p-0.5 text-sm">
                {[undefined, ...connected].map((p) => (
                  <Link
                    key={p ?? "all"}
                    href={href({ artist: artist?.id, service: p })}
                    aria-current={p === service ? "true" : undefined}
                    className={`rounded px-3 py-1 ${p === service ? "bg-plum text-paper" : "text-muted hover:text-ink"}`}
                  >
                    {p ? SERVICE[p] : "All services"}
                  </Link>
                ))}
              </nav>
            )}
            <nav aria-label="Period" className="flex rounded-md border border-line bg-surface p-0.5 text-sm">
              {PERIODS.map((p) => (
                <Link
                  key={p.key}
                  href={href({ since: p.key, artist: artist?.id, service })}
                  aria-current={p.key === period.key ? "true" : undefined}
                  className={`rounded px-3 py-1 ${p.key === period.key ? "bg-plum text-paper" : "text-muted hover:text-ink"}`}
                >
                  {p.label}
                </Link>
              ))}
            </nav>
            {follows > 0 && (
              <form action="/releases" className="flex gap-2">
                <input type="hidden" name="since" value={period.key} />
                {service && <input type="hidden" name="service" value={service} />}
                <label htmlFor="artist-filter" className="sr-only">
                  Filter by artist
                </label>
                <Select id="artist-filter" name="artist" defaultValue={artist?.id ?? ""} className="w-52">
                  <option value="">All artists</option>
                  {shownArtists.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {dupNames.has(a.name.toLowerCase()) ? ` (${SERVICE[a.provider]})` : ""}
                    </option>
                  ))}
                </Select>
                <Button type="submit" variant="secondary">
                  Filter
                </Button>
              </form>
            )}
            <SyncNowButton />
          </div>
        </div>

        {noService ? (
          <div className="max-w-prose space-y-4 rounded-md border border-line bg-surface px-5 py-5">
            <p>Connect a music service to see releases from the artists you follow.</p>
            <ConnectButtons providers={services} callbackURL="/releases" />
          </div>
        ) : nothing && followed.length === 0 ? (
          <p className="max-w-prose text-muted">
            No releases yet. The first check runs right after you connect; press Sync now if it has been a few minutes. If you
            follow no artists on your music service, follow a few there first.
          </p>
        ) : (
          <ReleaseBoard
            albumCount={albums.length}
            singleCount={singles.length}
            albums={<Grid items={albums} empty={emptyFor("albums")} />}
            singles={<Grid items={singles} empty={emptyFor("singles")} />}
          />
        )}
      </main>
    </>
  );
}
