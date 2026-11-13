import { z } from "zod";
import { isPlaceholderEmail } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { isMailConfigured, sendMail } from "@/mail";

export type SuggestionKind = "idea" | "problem";
export const STATUSES = ["new", "planned", "in_progress", "done", "wont_do"] as const;
export type SuggestionStatus = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<SuggestionStatus, string> = {
  new: "New",
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
  wont_do: "Won't do",
};
const OPEN: SuggestionStatus[] = ["new", "planned", "in_progress"];
const CLOSED: SuggestionStatus[] = ["done", "wont_do"];

/** Who is looking at / acting on a suggestion. */
export interface Viewer {
  id: string;
  role: string;
}
const isAdmin = (v: Viewer) => v.role === "admin";

export interface SuggestionRow {
  id: string;
  kind: SuggestionKind;
  message: string;
  page: string | null;
  status: SuggestionStatus;
  createdAt: Date;
  closedAt: Date | null;
  awaitingAdmin: boolean;
  awaitingUser: boolean;
  replyCount: number;
  /** Who sent it: name, else a real email, else "Someone" */
  from: string;
}

export interface ReplyRow {
  id: string;
  message: string;
  createdAt: Date;
  from: string;
  fromAdmin: boolean;
  /** Written by the viewer */
  mine: boolean;
}

const MAX_MESSAGE = 2000;
const MAX_PAGE = 200;
const LIMIT_PER_HOUR = 10;
const REPLY_LIMIT_PER_HOUR = 30;
const HOUR = 60 * 60 * 1000;
const NOT_FOUND = "Suggestion not found";

/** Runs a notification. Server actions pass Next's `after()` so the user never waits on mail. */
export type Schedule = (task: () => Promise<void>) => unknown;
const runNow: Schedule = (task) => task();

/** Keep only a path on this site (e.g. "/releases?since=30"); anything else becomes null. */
export function safePagePath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const p = input.trim();
  if (!p.startsWith("/") || p.startsWith("//") || p.startsWith("/\\") || p.length > MAX_PAGE) return null;
  return p;
}

const Message = z.string({ error: "Write a message" }).trim().min(1, "Write a message").max(MAX_MESSAGE, "Keep it under 2000 characters");
const Input = z.object({ kind: z.enum(["idea", "problem"], { error: "Choose idea or problem" }), message: Message });

const displayName = (u: { name: string; email: string }) => u.name || (isPlaceholderEmail(u.email) ? "Someone" : u.email);
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Mail errors are logged, never thrown: the database is the source of truth. */
async function notify(label: string, send: () => Promise<void>, schedule: Schedule): Promise<void> {
  await schedule(async () => {
    try {
      await send();
    } catch (err) {
      console.warn(`[suggestions] could not send ${label}: ${(err as Error).message}`);
    }
  });
}

async function mailContext(): Promise<{ baseUrl: string } | null> {
  const [mail, site] = await Promise.all([getSetting("mail"), getSetting("site")]);
  return isMailConfigured(mail) ? { baseUrl: site?.publicUrl ?? "" } : null;
}

/** One mail per admin with a real address; one failing address doesn't stop the rest. */
async function mailAdmins(subject: string, text: string, html: string): Promise<void> {
  const admins = await prisma.user.findMany({ where: { role: "admin" }, select: { email: true } });
  for (const a of admins) {
    if (isPlaceholderEmail(a.email)) continue;
    try {
      await sendMail({ to: { email: a.email }, subject, text, html });
    } catch (err) {
      console.warn(`[suggestions] could not email an admin: ${(err as Error).message}`);
    }
  }
}

async function mailOwner(suggestionId: string, subject: string, intro: string, body?: string): Promise<void> {
  const ctx = await mailContext();
  if (!ctx) return;
  const s = await prisma.suggestion.findUnique({ where: { id: suggestionId }, select: { user: { select: { email: true } } } });
  if (!s || isPlaceholderEmail(s.user.email)) return;
  const link = `${ctx.baseUrl}/suggestions/${suggestionId}`;
  const text = `${intro}${body ? `\n\n${body}` : ""}\n\nOpen the conversation: ${link}`;
  const html = `<p>${esc(intro)}</p>${body ? `<blockquote style="white-space:pre-wrap">${esc(body)}</blockquote>` : ""}<p><a href="${esc(link)}">Open the conversation</a></p>`;
  await sendMail({ to: { email: s.user.email }, subject, text, html });
}

// ---------- create ----------

export async function createSuggestion(
  userId: string,
  input: { kind: unknown; message: unknown; page?: unknown },
  now: Date = new Date(),
  schedule: Schedule = runNow,
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
  const fromName = displayName(saved.user);
  await notify("suggestion mail", () => notifyAdmins({ id: saved.id, kind: parsed.data.kind, message: parsed.data.message, page, fromName }), schedule);
  return { ok: true };
}

export async function notifyAdmins(s: { id: string; kind: SuggestionKind; message: string; page: string | null; fromName: string }): Promise<void> {
  const ctx = await mailContext();
  if (!ctx) return;
  const link = `${ctx.baseUrl}/admin/suggestions/${s.id}`;
  const label = s.kind === "idea" ? "idea" : "problem";
  const text = `${s.fromName} sent a new ${label}:\n\n${s.message}\n\n${s.page ? `Page: ${s.page}\n` : ""}Open the suggestion: ${link}`;
  const html = `<p>${esc(s.fromName)} sent a new ${label}:</p><blockquote style="white-space:pre-wrap">${esc(s.message)}</blockquote>${
    s.page ? `<p>Page: ${esc(s.page)}</p>` : ""
  }<p><a href="${esc(link)}">Open the suggestion</a></p>`;
  await mailAdmins(`New ${label} from ${s.fromName}`, text, html);
}

// ---------- read ----------

const rowSelect = {
  id: true,
  kind: true,
  message: true,
  page: true,
  status: true,
  createdAt: true,
  closedAt: true,
  awaitingAdmin: true,
  awaitingUser: true,
  user: { select: { name: true, email: true } },
  _count: { select: { replies: true } },
} as const;

type Raw = Omit<SuggestionRow, "kind" | "status" | "from" | "replyCount"> & {
  kind: string;
  status: string;
  user: { name: string; email: string };
  _count: { replies: number };
};
const toRow = ({ user, _count, ...r }: Raw): SuggestionRow => ({
  ...r,
  kind: r.kind as SuggestionKind,
  status: r.status as SuggestionStatus,
  replyCount: _count.replies,
  from: displayName(user),
});

/** Admin overview: open ones (needing attention first, then newest) and the latest 50 closed ones. */
export async function listSuggestions(): Promise<{ open: SuggestionRow[]; closed: SuggestionRow[] }> {
  const [open, closed] = await Promise.all([
    prisma.suggestion.findMany({
      where: { status: { in: OPEN } },
      orderBy: [{ awaitingAdmin: "desc" }, { createdAt: "desc" }],
      select: rowSelect,
    }),
    prisma.suggestion.findMany({ where: { status: { in: CLOSED } }, orderBy: { closedAt: "desc" }, take: 50, select: rowSelect }),
  ]);
  return { open: open.map(toRow), closed: closed.map(toRow) };
}

export async function listMySuggestions(userId: string): Promise<SuggestionRow[]> {
  const rows = await prisma.suggestion.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: rowSelect });
  return rows.map(toRow);
}

/**
 * The suggestion with its conversation, for its sender or an admin (null for anyone else). Viewing it clears that
 * side's "something new" flag.
 */
export async function getThread(id: string, viewer: Viewer): Promise<{ suggestion: SuggestionRow; replies: ReplyRow[] } | null> {
  const s = await prisma.suggestion.findUnique({
    where: { id },
    select: {
      ...rowSelect,
      userId: true,
      replies: {
        orderBy: { createdAt: "asc" },
        select: { id: true, message: true, createdAt: true, authorId: true, author: { select: { name: true, email: true, role: true } } },
      },
    },
  });
  if (!s) return null;
  const { replies, userId: ownerId, ...row } = s;
  if (ownerId !== viewer.id && !isAdmin(viewer)) return null;

  const flag = isAdmin(viewer) ? { awaitingAdmin: false } : { awaitingUser: false };
  if ((isAdmin(viewer) && s.awaitingAdmin) || (!isAdmin(viewer) && s.awaitingUser)) {
    await prisma.suggestion.update({ where: { id }, data: flag });
  }
  return {
    suggestion: toRow(row),
    replies: replies.map((r) => ({
      id: r.id,
      message: r.message,
      createdAt: r.createdAt,
      from: displayName(r.author),
      fromAdmin: r.author.role === "admin",
      mine: r.authorId === viewer.id,
    })),
  };
}

/** Suggestions with something new for the admin (new ones and replies from senders). */
export const countAdminAttention = (): Promise<number> => prisma.suggestion.count({ where: { awaitingAdmin: true } });

/** The user's suggestions with an admin reply or status change they haven't seen. */
export const countUnreadForUser = (userId: string): Promise<number> =>
  prisma.suggestion.count({ where: { userId, awaitingUser: true } });

// ---------- change ----------

export async function addReply(
  suggestionId: string,
  author: Viewer,
  input: unknown,
  now: Date = new Date(),
  schedule: Schedule = runNow,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await prisma.suggestion.findUnique({ where: { id: suggestionId }, select: { userId: true } });
  if (!s || (s.userId !== author.id && !isAdmin(author))) return { ok: false, error: NOT_FOUND };
  const parsed = Message.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const recent = await prisma.suggestionReply.count({ where: { authorId: author.id, createdAt: { gt: new Date(now.getTime() - HOUR) } } });
  if (recent >= REPLY_LIMIT_PER_HOUR) return { ok: false, error: "You've sent a lot of replies in the last hour. Try again later." };

  const byAdmin = isAdmin(author);
  const [reply] = await prisma.$transaction([
    prisma.suggestionReply.create({
      data: { suggestionId, authorId: author.id, message: parsed.data, createdAt: now },
      select: { author: { select: { name: true, email: true } } },
    }),
    prisma.suggestion.update({
      where: { id: suggestionId },
      data: byAdmin ? { awaitingUser: true, awaitingAdmin: false } : { awaitingAdmin: true, awaitingUser: false },
    }),
  ]);

  if (byAdmin) {
    await notify("reply mail", () => mailOwner(suggestionId, "Reply to your suggestion", "The admin replied to your suggestion:", parsed.data), schedule);
  } else {
    const fromName = displayName(reply.author);
    await notify(
      "reply mail",
      async () => {
        const ctx = await mailContext();
        if (!ctx) return;
        const link = `${ctx.baseUrl}/admin/suggestions/${suggestionId}`;
        await mailAdmins(
          `New reply from ${fromName}`,
          `${fromName} replied to their suggestion:\n\n${parsed.data}\n\nOpen the conversation: ${link}`,
          `<p>${esc(fromName)} replied to their suggestion:</p><blockquote style="white-space:pre-wrap">${esc(parsed.data)}</blockquote><p><a href="${esc(link)}">Open the conversation</a></p>`,
        );
      },
      schedule,
    );
  }
  return { ok: true };
}

/** Admin changes the status; the sender sees it as new and gets an email. Unknown ids are ignored. */
export async function setSuggestionStatus(
  id: string,
  status: SuggestionStatus,
  now: Date = new Date(),
  schedule: Schedule = runNow,
): Promise<void> {
  const updated = await prisma.suggestion.updateMany({
    where: { id, status: { not: status } },
    data: { status, closedAt: CLOSED.includes(status) ? now : null, awaitingAdmin: false, awaitingUser: true },
  });
  if (updated.count === 0) return;
  const label = STATUS_LABELS[status];
  await notify("status mail", () => mailOwner(id, `Your suggestion is now: ${label}`, `The admin changed the status of your suggestion to "${label}".`), schedule);
}

/** Only the sender can delete their suggestion; its conversation goes with it. */
export async function deleteSuggestion(id: string, viewer: Viewer): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await prisma.suggestion.deleteMany({ where: { id, userId: viewer.id } });
  return res.count === 1 ? { ok: true } : { ok: false, error: NOT_FOUND };
}
