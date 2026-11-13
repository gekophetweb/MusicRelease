import Link from "next/link";
import { Button } from "@/components/ui";
import { requireAdmin } from "@/lib/session";
import { listSuggestions, type SuggestionRow } from "@/suggestions/suggestions";
import { markSuggestion } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suggestions · Admin · MusicReleases" };

const fmt = (d: Date) =>
  d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Item({ s }: { s: SuggestionRow }) {
  return (
    <li className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span
            className={`mr-2 rounded-full px-2 py-0.5 text-xs font-semibold ${s.kind === "problem" ? "bg-danger/15 text-danger" : "bg-plum/15 text-plum"}`}
          >
            {s.kind === "problem" ? "Problem" : "Idea"}
          </span>
          <span className="font-medium">{s.from}</span>
          <span className="text-muted">
            {" "}
            · <time dateTime={s.createdAt.toISOString()}>{fmt(s.createdAt)}</time>
            {s.page && <> · from {s.page}</>}
          </span>
        </p>
        <form action={markSuggestion}>
          <input type="hidden" name="id" value={s.id} />
          <input type="hidden" name="status" value={s.status === "open" ? "done" : "open"} />
          <Button type="submit" variant="secondary">
            {s.status === "open" ? "Done" : "Reopen"}
          </Button>
        </form>
      </div>
      <p className="whitespace-pre-wrap break-words">{s.message}</p>
      {s.doneAt && <p className="text-xs text-muted">Done {fmt(s.doneAt)}</p>}
    </li>
  );
}

export default async function AdminSuggestionsPage() {
  await requireAdmin();
  const { open, done } = await listSuggestions();
  return (
    <main className="mx-auto max-w-4xl space-y-10 px-4 py-12">
      <div className="space-y-3">
        <nav className="flex gap-4 text-sm text-muted">
          <Link href="/releases" className="hover:text-ink">
            Back to releases
          </Link>
          <Link href="/admin/settings" className="hover:text-ink">
            Admin settings
          </Link>
          <Link href="/admin/users" className="hover:text-ink">
            Users
          </Link>
        </nav>
        <h1 className="font-display text-4xl font-bold tracking-tight">Suggestions</h1>
        <p className="text-sm text-muted">Ideas and problems people sent from the Suggestions page.</p>
      </div>
      <section aria-labelledby="open-title" className="space-y-3">
        <h2 id="open-title" className="font-display text-xl font-semibold">
          Open <span className="text-muted">{open.length}</span>
        </h2>
        {open.length === 0 ? (
          <p className="text-muted">Nothing open. Nice.</p>
        ) : (
          <ul className="space-y-3">
            {open.map((s) => (
              <Item key={s.id} s={s} />
            ))}
          </ul>
        )}
      </section>
      {done.length > 0 && (
        <section aria-labelledby="done-title" className="space-y-3">
          <h2 id="done-title" className="font-display text-xl font-semibold">
            Done
          </h2>
          <ul className="space-y-3 opacity-80">
            {done.map((s) => (
              <Item key={s.id} s={s} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
