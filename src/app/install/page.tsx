import { InstallWizard } from "./InstallWizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up MusicReleases" };

export default async function InstallPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto max-w-4xl px-4 py-12 md:py-20">
      <header className="mb-10 max-w-xl space-y-2">
        <h1 className="font-display text-4xl font-bold tracking-tight">Set up MusicReleases</h1>
        <p className="text-muted">A few steps and the site is ready: where it lives, which music services to use, how to send mail, and when to check for new releases.</p>
      </header>
      <InstallWizard signinError={error === "signin"} />
    </main>
  );
}
