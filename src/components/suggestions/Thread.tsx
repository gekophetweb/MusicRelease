import type { ReplyRow, SuggestionRow } from "@/suggestions/suggestions";
import { fmtDate, KindBadge, StatusBadge } from "./StatusBadge";

/** The original suggestion followed by the conversation, oldest first. */
export function Thread({ suggestion, replies, viewerIsAdmin }: { suggestion: SuggestionRow; replies: ReplyRow[]; viewerIsAdmin: boolean }) {
  return (
    <div className="space-y-4">
      <article className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <KindBadge kind={suggestion.kind} />
          <StatusBadge status={suggestion.status} />
          <span className="font-medium">{viewerIsAdmin ? suggestion.from : "You"}</span>
          <span className="text-muted">
            · <time dateTime={suggestion.createdAt.toISOString()}>{fmtDate(suggestion.createdAt)}</time>
            {suggestion.page && <> · from {suggestion.page}</>}
          </span>
        </p>
        <p className="whitespace-pre-wrap break-words">{suggestion.message}</p>
      </article>
      {replies.length > 0 && (
        <ol aria-label="Conversation" className="space-y-3">
          {replies.map((r) => (
            <li
              key={r.id}
              className={`space-y-1 rounded-lg border p-4 ${r.fromAdmin ? "ml-6 border-plum/40 bg-plum/5" : "mr-6 border-line bg-surface"}`}
            >
              <p className="text-sm">
                <span className="font-medium">{r.mine ? "You" : r.fromAdmin ? `${r.from} (admin)` : r.from}</span>
                <span className="text-muted">
                  {" "}
                  · <time dateTime={r.createdAt.toISOString()}>{fmtDate(r.createdAt)}</time>
                </span>
              </p>
              <p className="whitespace-pre-wrap break-words">{r.message}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
