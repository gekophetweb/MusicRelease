import { redirect } from "next/navigation";
import { ConnectButtons } from "@/components/ConnectButtons";
import { getEnabledProviders } from "@/lib/auth";
import { getSessionUser } from "@/lib/session";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSessionUser()) redirect("/releases");
  const [providers, site, params] = await Promise.all([getEnabledProviders(), getSetting("site"), searchParams]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-4 py-16">
      <div className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight">{site?.siteName ?? "MusicReleases"}</h1>
        <p className="text-lg text-neutral-600 dark:text-neutral-400">
          New albums and singles from the artists you follow — newest first, checked every day, and a short email every
          week.
        </p>
      </div>
      {params.error && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          Connecting failed. If sign-ups are closed, ask the admin to let you in.
        </p>
      )}
      <ConnectButtons providers={providers} />
    </main>
  );
}
