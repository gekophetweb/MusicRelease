import { AppHeader } from "@/components/AppHeader";
import { ConnectButtons } from "@/components/ConnectButtons";
import { getEnabledProviders } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getSetting } from "@/lib/settings";
import { getUserSettings } from "@/lib/user-settings";
import { DigestForm } from "./DigestForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · MusicReleases" };

const NAME = { spotify: "Spotify", tidal: "TIDAL" } as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { error } = await searchParams;
  const [settings, site, mail, accounts, enabled] = await Promise.all([
    getUserSettings(user.id),
    getSetting("site"),
    getSetting("mail"),
    prisma.account.findMany({ where: { userId: user.id }, select: { providerId: true, needsReconnect: true, createdAt: true } }),
    getEnabledProviders(),
  ]);
  const connected = new Set(accounts.map((a) => a.providerId));
  const toConnect = enabled.filter((p) => !connected.has(p));
  const broken = accounts.filter((a) => a.needsReconnect).map((a) => a.providerId as "spotify" | "tidal");

  return (
    <>
      <AppHeader siteName={site?.siteName ?? "MusicReleases"} isAdmin={user.role === "admin"} current="settings" />
      <main className="mx-auto max-w-xl space-y-14 px-4 py-10">
        <h1 className="font-display text-4xl font-bold tracking-tight">Settings</h1>

        <section aria-labelledby="digest-title" className="space-y-5">
          <h2 id="digest-title" className="font-display text-2xl font-semibold">
            Weekly email
          </h2>
          <DigestForm email={settings.digestEmail ?? ""} enabled={settings.digestEnabled} mailConfigured={!!mail} />
        </section>

        <section aria-labelledby="services-title" className="space-y-5">
          <h2 id="services-title" className="font-display text-2xl font-semibold">
            Music services
          </h2>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {accounts.map((a) => (
              <li key={a.providerId} className="flex items-center justify-between px-4 py-3">
                <span className="font-medium">{NAME[a.providerId as keyof typeof NAME] ?? a.providerId}</span>
                <span className={`text-sm ${a.needsReconnect ? "text-danger" : "text-muted"}`}>
                  {a.needsReconnect ? "Needs reconnecting" : `Connected ${a.createdAt.toLocaleDateString("en-GB")}`}
                </span>
              </li>
            ))}
          </ul>
          {error === "link" && (
            <p role="alert" className="rounded-md border border-danger/40 px-4 py-3 text-sm text-danger">
              Connecting did not finish. If that music account is already used by someone else on this site, sign in with it
              there instead.
            </p>
          )}
          {broken.length > 0 && <ConnectButtons providers={broken} callbackURL="/settings" />}
          {toConnect.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted">Also follow artists on another service? Connect it to see those releases too.</p>
              <ConnectButtons providers={toConnect} callbackURL="/settings" mode="link" />
            </div>
          )}
        </section>
      </main>
    </>
  );
}
