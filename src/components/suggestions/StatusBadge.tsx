import { STATUS_LABELS, type SuggestionStatus } from "@/suggestions/suggestions";

const STYLE: Record<SuggestionStatus, string> = {
  new: "bg-marigold/20 text-marigold",
  planned: "bg-plum/15 text-plum",
  in_progress: "bg-plum/25 text-plum",
  done: "bg-ok/15 text-ok",
  wont_do: "bg-line text-muted",
};

export function StatusBadge({ status }: { status: SuggestionStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STYLE[status]}`}>{STATUS_LABELS[status]}</span>;
}

export function KindBadge({ kind }: { kind: "idea" | "problem" }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${kind === "problem" ? "bg-danger/15 text-danger" : "bg-plum/15 text-plum"}`}>
      {kind === "problem" ? "Problem" : "Idea"}
    </span>
  );
}

export const fmtDate = (d: Date) =>
  d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
