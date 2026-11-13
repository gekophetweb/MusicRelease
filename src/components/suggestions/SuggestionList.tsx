import Link from "next/link";
import type { SuggestionRow } from "@/suggestions/suggestions";
import { fmtDate, KindBadge, StatusBadge } from "./StatusBadge";

/** Linked rows; `unread` decides which flag shows the "new" dot for this viewer. */
export function SuggestionList({ items, hrefBase, unread, showFrom }: { items: SuggestionRow[]; hrefBase: string; unread: "awaitingAdmin" | "awaitingUser"; showFrom: boolean }) {
  return (
    <ul className="space-y-2">
      {items.map((s) => (
        <li key={s.id}>
          <Link href={`${hrefBase}/${s.id}`} className="block space-y-1 rounded-lg border border-line bg-surface p-4 transition hover:border-plum">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              {s[unread] && <span className="h-2 w-2 rounded-full bg-marigold" aria-label="New activity" />}
              <KindBadge kind={s.kind} />
              <StatusBadge status={s.status} />
              {showFrom && <span className="font-medium">{s.from}</span>}
              <span className="text-muted">
                · <time dateTime={s.createdAt.toISOString()}>{fmtDate(s.createdAt)}</time>
                {s.replyCount > 0 && <> · {s.replyCount} repl{s.replyCount === 1 ? "y" : "ies"}</>}
              </span>
            </p>
            <p className="line-clamp-2 break-words">{s.message}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
