import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminChrome } from "@/components/admin/AdminChrome";
import { ReplyForm } from "@/components/suggestions/ReplyForm";
import { Thread } from "@/components/suggestions/Thread";
import { requireAdmin } from "@/lib/session";
import { getThread, STATUS_LABELS, STATUSES } from "@/suggestions/suggestions";
import { changeStatus } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suggestion · Admin · MusicReleases" };

export default async function AdminSuggestionPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const thread = await getThread(id, admin);
  if (!thread) notFound();
  const current = thread.suggestion.status;
  // AdminChrome renders after getThread marked this thread read, so its badges already exclude it.
  return (
    <>
      <AdminChrome adminId={admin.id} />
      <main className="mx-auto max-w-4xl space-y-8 px-4 py-10">
        <Link href="/admin/suggestions" className="text-sm text-muted hover:text-ink">
          ← All suggestions
        </Link>
        <div className="grid gap-8 md:grid-cols-[1fr_14rem]">
          <div className="space-y-6">
            <Thread suggestion={thread.suggestion} replies={thread.replies} viewerIsAdmin />
            <ReplyForm suggestionId={id} />
          </div>
          <aside aria-labelledby="status-title" className="space-y-3">
            <h2 id="status-title" className="text-sm font-semibold">
              Status
            </h2>
            <p className="text-xs text-muted">The sender sees the status and gets an email when you change it.</p>
            <ul className="space-y-1.5">
              {STATUSES.map((s) => (
                <li key={s}>
                  <form action={changeStatus}>
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="status" value={s} />
                    <button
                      type="submit"
                      disabled={s === current}
                      aria-pressed={s === current}
                      className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                        s === current ? "border-plum bg-plum/10 font-semibold text-ink" : "border-line bg-surface text-muted hover:border-plum hover:text-ink"
                      }`}
                    >
                      {STATUS_LABELS[s]}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </main>
    </>
  );
}
