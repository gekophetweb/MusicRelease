import { AppHeader } from "@/components/AppHeader";
import { requireUser } from "@/lib/session";
import { getSetting } from "@/lib/settings";
import { safePagePath } from "@/suggestions/suggestions";
import { SuggestionForm } from "./SuggestionForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suggestions · MusicReleases" };

export default async function SuggestionsPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const user = await requireUser();
  const [site, params] = await Promise.all([getSetting("site"), searchParams]);
  return (
    <>
      <AppHeader siteName={site?.siteName ?? "MusicReleases"} isAdmin={user.role === "admin"} current="suggestions" />
      <main className="mx-auto max-w-xl space-y-6 px-4 py-10">
        <div className="space-y-1">
          <h1 className="font-display text-4xl font-bold tracking-tight">Suggestions</h1>
          <p className="text-sm text-muted">Have an idea for the site, or did something not work? Tell the admin here.</p>
        </div>
        <SuggestionForm page={safePagePath(params.from)} />
      </main>
    </>
  );
}
