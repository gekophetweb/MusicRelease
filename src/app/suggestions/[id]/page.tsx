import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { DeleteSuggestionButton } from "@/components/suggestions/DeleteSuggestionButton";
import { ReplyForm } from "@/components/suggestions/ReplyForm";
import { Thread } from "@/components/suggestions/Thread";
import { requireUser } from "@/lib/session";
import { getSetting } from "@/lib/settings";
import { getThread } from "@/suggestions/suggestions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suggestion · MusicReleases" };

export default async function SuggestionThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  // Admins manage suggestions on the admin page; here only the sender's own view.
  const thread = await getThread(id, { id: user.id, role: "user" });
  if (!thread) notFound();
  const site = await getSetting("site");
  return (
    <>
      <AppHeader siteName={site?.siteName ?? "MusicReleases"} isAdmin={user.role === "admin"} userId={user.id} current="suggestions" />
      <main className="mx-auto max-w-xl space-y-8 px-4 py-10">
        <Link href="/suggestions" className="text-sm text-muted hover:text-ink">
          ← My suggestions
        </Link>
        <Thread suggestion={thread.suggestion} replies={thread.replies} viewerIsAdmin={false} />
        <ReplyForm suggestionId={id} />
        <div className="border-t border-line pt-4">
          <DeleteSuggestionButton id={id} />
        </div>
      </main>
    </>
  );
}
