import { SuggestionList } from "@/components/suggestions/SuggestionList";
import { listSuggestions } from "@/suggestions/suggestions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suggestions · Admin · MusicReleases" };

export default async function AdminSuggestionsPage() {
  const { open, closed } = await listSuggestions();
  return (
    <main className="mx-auto max-w-4xl space-y-10 px-4 py-10">
      <div className="space-y-1">
        <h1 className="font-display text-4xl font-bold tracking-tight">Suggestions</h1>
        <p className="text-sm text-muted">Ideas and problems people sent. A yellow dot means something new: a new suggestion or a reply.</p>
      </div>
      <section aria-labelledby="open-title" className="space-y-3">
        <h2 id="open-title" className="font-display text-xl font-semibold">
          Open <span className="text-muted">{open.length}</span>
        </h2>
        {open.length === 0 ? <p className="text-muted">Nothing open. Nice.</p> : <SuggestionList items={open} hrefBase="/admin/suggestions" unread="awaitingAdmin" showFrom />}
      </section>
      {closed.length > 0 && (
        <section aria-labelledby="closed-title" className="space-y-3">
          <h2 id="closed-title" className="font-display text-xl font-semibold">
            Done and won&apos;t do
          </h2>
          <div className="opacity-80">
            <SuggestionList items={closed} hrefBase="/admin/suggestions" unread="awaitingAdmin" showFrom />
          </div>
        </section>
      )}
    </main>
  );
}
