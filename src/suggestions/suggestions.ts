import { z } from "zod";
import { isPlaceholderEmail } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { isMailConfigured, sendMail } from "@/mail";

export type SuggestionKind = "idea" | "problem";
export type SuggestionStatus = "open" | "done";

export interface SuggestionRow {
  id: string;
  kind: SuggestionKind;
  message: string;
  page: string | null;
  status: SuggestionStatus;
  createdAt: Date;
  doneAt: Date | null;
  /** Who sent it: name, else a real email, else "Someone" */
  from: string;
}

const MAX_MESSAGE = 2000;
const MAX_PAGE = 200;
const LIMIT_PER_HOUR = 10;
const HOUR = 60 * 60 * 1000;

/** Keep only a path on this site (e.g. "/releases?since=30"); anything else becomes null. */
export function safePagePath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const p = input.trim();
  if (!p.startsWith("/") || p.startsWith("//") || p.startsWith("/\\") || p.length > MAX_PAGE) return null;
  return p;
}

const Input = z.object({
  kind: z.enum(["idea", "problem"], { error: "Choose idea or problem" }),
  message: z.string({ error: "Write a message" }).trim().min(1, "Write a message").max(MAX_MESSAGE, "Keep it under 2000 characters"),
});

const displayName = (u: { name: string; email: string }) => u.name || (isPlaceholderEmail(u.email) ? "Someone" : u.email);

export async function createSuggestion(
  userId: string,
  input: { kind: unknown; message: unknown; page?: unknown },
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const recent = await prisma.suggestion.count({ where: { userId, createdAt: { gt: new Date(now.getTime() - HOUR) } } });
  if (recent >= LIMIT_PER_HOUR) return { ok: false, error: "You've sent a lot of suggestions in the last hour. Try again later." };

  const page = safePagePath(input.page);
  const saved = await prisma.suggestion.create({
    data: { userId, kind: parsed.data.kind, message: parsed.data.message, page, createdAt: now },
    include: { user: { select: { name: true, email: true } } },
  });

  // The database is the source of truth: a mail problem must never fail the submit.
  try {
    await notifyAdmins({ kind: parsed.data.kind, message: parsed.data.message, page, fromName: displayName(saved.user) });
  } catch (err) {
    console.warn(`[suggestions] could not email admins: ${(err as Error).message}`);
  }
  return { ok: true };
}

export async function notifyAdmins(s: { kind: SuggestionKind; message: string; page: string | null; fromName: string }): Promise<void> {
  const [mail, site] = await Promise.all([getSetting("mail"), getSetting("site")]);
  if (!isMailConfigured(mail)) return;
  const admins = await prisma.user.findMany({ where: { role: "admin" }, select: { email: true } });
  const link = `${site?.publicUrl ?? ""}/admin/suggestions`;
  const label = s.kind === "idea" ? "idea" : "problem";
  const text = `${s.fromName} sent a new ${label}:\n\n${s.message}\n\n${s.page ? `Page: ${s.page}\n` : ""}Open the suggestions: ${link}`;
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<p>${esc(s.fromName)} sent a new ${label}:</p><blockquote style="white-space:pre-wrap">${esc(s.message)}</blockquote>${
    s.page ? `<p>Page: ${esc(s.page)}</p>` : ""
  }<p><a href="${esc(link)}">Open the suggestions</a></p>`;
  for (const a of admins) {
    if (isPlaceholderEmail(a.email)) continue;
    await sendMail({ to: { email: a.email }, subject: `New ${label} from ${s.fromName}`, text, html });
  }
}

const rowSelect = {
  id: true,
  kind: true,
  message: true,
  page: true,
  status: true,
  createdAt: true,
  doneAt: true,
  user: { select: { name: true, email: true } },
} as const;

type Raw = { id: string; kind: string; message: string; page: string | null; status: string; createdAt: Date; doneAt: Date | null; user: { name: string; email: string } };
const toRow = ({ user, ...r }: Raw): SuggestionRow => ({ ...r, kind: r.kind as SuggestionKind, status: r.status as SuggestionStatus, from: displayName(user) });

export async function listSuggestions(): Promise<{ open: SuggestionRow[]; done: SuggestionRow[] }> {
  const [open, done] = await Promise.all([
    prisma.suggestion.findMany({ where: { status: "open" }, orderBy: { createdAt: "desc" }, select: rowSelect }),
    prisma.suggestion.findMany({ where: { status: "done" }, orderBy: { doneAt: "desc" }, take: 50, select: rowSelect }),
  ]);
  return { open: open.map(toRow), done: done.map(toRow) };
}

export const countOpenSuggestions = (): Promise<number> => prisma.suggestion.count({ where: { status: "open" } });

export async function setSuggestionStatus(id: string, status: SuggestionStatus, now: Date = new Date()): Promise<void> {
  await prisma.suggestion.update({ where: { id }, data: { status, doneAt: status === "done" ? now : null } });
}
