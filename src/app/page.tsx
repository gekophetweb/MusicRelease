import { redirect } from "next/navigation";
import { LegacySignIn } from "@/components/LegacySignIn";
import { SignIn } from "@/components/SignIn";
import { getEnabledProviders } from "@/lib/auth";
import { getSessionUser } from "@/lib/session";
import { getSetting, isInstalled } from "@/lib/settings";
import { getSignInMethods } from "@/lib/signin";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSessionUser()) redirect("/releases");
  const [methods, site, params, installed, services] = await Promise.all([
    getSignInMethods(),
    getSetting("site"),
    searchParams,
    isInstalled(),
    getEnabledProviders(),
  ]);
  const legacy = installed && !methods.google && !methods.emailCode && services.length > 0;

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
          Signing in failed. If sign-ups are closed, ask the admin to let you in.
        </p>
      )}
      {legacy ? <LegacySignIn providers={services} /> : <SignIn methods={methods} callbackURL="/releases" />}
    </main>
  );
}
