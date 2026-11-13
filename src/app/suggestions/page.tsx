import { AppHeader } from "@/components/AppHeader";
import { SuggestionList } from "@/components/suggestions/SuggestionList";
import { requireUser } from "@/lib/session";
import { getSetting } from "@/lib/settings";
import { listMySuggestions, safePagePath } from "@/suggestions/suggestions";
import { SuggestionForm } from "./SuggestionForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suggestions · MusicReleases" };

export default async function SuggestionsPage({ searchParams }: { searchParams: Promise<{ from?: string; deleted?: string }> }) {
  const user = await requireUser();
  const [site, params, mine] = await Promise.all([getSetting("site"), searchParams, listMySuggestions(user.id)]);
  return (
    <>
      <AppHeader siteName={site?.siteName ?? "MusicReleases"} isAdmin={user.role === "admin"} userId={user.id} current="suggestions" />
      <main className="mx-auto max-w-xl space-y-10 px-4 py-10">
        <div className="space-y-1">
          <h1 className="font-display text-4xl font-bold tracking-tight">Suggestions</h1>
          <p className="text-sm text-muted">Have an idea for the site, or did something not work? Tell the admin here.</p>
        </div>
        {params.deleted && (
          <p role="status" className="rounded-md border border-line px-4 py-3 text-sm text-muted">
            Your suggestion was deleted.
          </p>
        )}
        <SuggestionForm page={safePagePath(params.from)} />
        {mine.length > 0 && (
          <section aria-labelledby="mine-title" className="space-y-3">
            <h2 id="mine-title" className="font-display text-xl font-semibold">
              My suggestions
            </h2>
            <SuggestionList items={mine} hrefBase="/suggestions" unread="awaitingUser" showFrom={false} />
          </section>
        )}
      </main>
    </>
  );
}
