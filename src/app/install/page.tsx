import { headers } from "next/headers";
import { getInstallState } from "@/install/state";
import { InstallWizard, type InstallState } from "./InstallWizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up MusicReleases" };

export default async function InstallPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [{ error }, h] = await Promise.all([searchParams, headers()]);
  // Build a Request from the incoming headers so the same code serves the page and /api/install/state.
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const initial = (await getInstallState(new Request(`${proto}://${host}/install`, { headers: h }))) as InstallState;
  return (
    <main className="mx-auto max-w-4xl px-4 py-12 md:py-20">
      <header className="mb-10 max-w-xl space-y-2">
        <h1 className="font-display text-4xl font-bold tracking-tight">Set up MusicReleases</h1>
        <p className="text-muted">
          A few steps and the site is ready: where it lives, which music services to use, how to send mail, and when to check for
          new releases.
        </p>
      </header>
      <InstallWizard initial={initial} signinError={error === "signin"} />
    </main>
  );
}
