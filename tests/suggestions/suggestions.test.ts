import { http, HttpResponse } from "msw";
import { PLACEHOLDER_EMAIL_DOMAIN } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { setSetting } from "@/lib/settings";
import {
  addReply,
  countAdminAttention,
  countUnreadForUser,
  createSuggestion,
  deleteSuggestion,
  getThread,
  listMySuggestions,
  listSuggestions,
  safePagePath,
  setSuggestionStatus,
} from "@/suggestions/suggestions";
import { resetDb } from "../helpers/db";
import { createUser, site } from "../helpers/factories";
import { setupMsw } from "../helpers/msw";

const server = setupMsw();
const resend = { provider: "resend" as const, from: { email: "music@example.com" }, apiKey: "re_test" };
let mails: { to: string[]; subject: string; text: string }[] = [];

beforeEach(async () => {
  await resetDb();
  mails = [];
  await setSetting("site", site);
  await setSetting("mail", resend);
  server.use(
    http.post("https://api.resend.com/emails", async ({ request }) => {
      mails.push((await request.json()) as (typeof mails)[number]);
      return HttpResponse.json({ id: "1" });
    }),
  );
});

test("stores a trimmed idea with a safe page", async () => {
  const u = await createUser();
  expect(await createSuggestion(u.id, { kind: "idea", message: "  More filters  ", page: "/releases?since=30" })).toEqual({ ok: true });
  const row = await prisma.suggestion.findFirstOrThrow();
  expect(row).toMatchObject({ userId: u.id, kind: "idea", message: "More filters", page: "/releases?since=30", status: "new", closedAt: null, awaitingAdmin: true, awaitingUser: false });
});

test("drops unsafe pages", () => {
  expect(safePagePath("https://evil.example")).toBeNull();
  expect(safePagePath("//evil.example")).toBeNull();
  expect(safePagePath(String.raw`/\evil.example`)).toBeNull();
  expect(safePagePath("releases")).toBeNull();
  expect(safePagePath("/" + "a".repeat(250))).toBeNull();
  expect(safePagePath(undefined)).toBeNull();
  expect(safePagePath("/artists")).toBe("/artists");
});

test("rejects a whitespace-only message, a bad kind and a too-long message", async () => {
  const u = await createUser();
  expect(await createSuggestion(u.id, { kind: "idea", message: "   " })).toEqual({ ok: false, error: "Write a message" });
  expect(await createSuggestion(u.id, { kind: "rant", message: "hi" })).toEqual({ ok: false, error: "Choose idea or problem" });
  expect(await createSuggestion(u.id, { kind: "problem", message: "x".repeat(2001) })).toEqual({ ok: false, error: "Keep it under 2000 characters" });
  expect(await prisma.suggestion.count()).toBe(0);
});

test("limits a user to 10 per hour", async () => {
  const u = await createUser();
  const now = new Date("2026-11-13T12:00:00Z");
  for (let i = 0; i < 10; i++) {
    await prisma.suggestion.create({ data: { userId: u.id, kind: "idea", message: `m${i}`, createdAt: new Date(now.getTime() - i * 60_000) } });
  }
  expect(await createSuggestion(u.id, { kind: "idea", message: "one more" }, now)).toEqual({
    ok: false,
    error: "You've sent a lot of suggestions in the last hour. Try again later.",
  });
  expect((await createSuggestion(u.id, { kind: "idea", message: "later" }, new Date(now.getTime() + 61 * 60_000))).ok).toBe(true);
});

test("emails admins with real addresses only", async () => {
  await createUser({ email: "a@example.com", role: "admin" });
  await createUser({ email: `tidal-1@${PLACEHOLDER_EMAIL_DOMAIN}`, role: "admin" });
  const u = await createUser({ email: "fan@example.com" });
  await createSuggestion(u.id, { kind: "problem", message: "The sync button does nothing", page: "/releases" });
  expect(mails).toHaveLength(1);
  expect(mails[0].to).toEqual(["a@example.com"]);
  expect(mails[0].subject).toBe(`New problem from ${(await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).name}`);
  expect(mails[0].text).toContain("The sync button does nothing");
  expect(mails[0].text).toContain("https://releases.example.com/admin/suggestions");
});

test("saves even when mail fails", async () => {
  await createUser({ email: "a@example.com", role: "admin" });
  server.use(http.post("https://api.resend.com/emails", () => new HttpResponse(null, { status: 500 })));
  const u = await createUser();
  expect(await createSuggestion(u.id, { kind: "idea", message: "hi" })).toEqual({ ok: true });
  expect(await prisma.suggestion.count()).toBe(1);
});

test("saves without mail configured and sends nothing", async () => {
  await prisma.appSetting.delete({ where: { key: "mail" } });
  await createUser({ email: "a@example.com", role: "admin" });
  const u = await createUser();
  expect(await createSuggestion(u.id, { kind: "idea", message: "hi" })).toEqual({ ok: true });
  expect(mails).toHaveLength(0);
});

const admin = () => createUser({ email: "admin@example.com", role: "admin" });
const asViewer = (u: { id: string; role: string }) => ({ id: u.id, role: u.role });

test("admin list: open items needing attention first, closed latest 50", async () => {
  const u = await createUser({ email: "fan@example.com" });
  const t = (m: number) => new Date(Date.UTC(2026, 10, 13, 12, m));
  await prisma.suggestion.create({ data: { userId: u.id, kind: "idea", message: "seen", createdAt: t(3), awaitingAdmin: false, status: "planned" } });
  await prisma.suggestion.create({ data: { userId: u.id, kind: "idea", message: "old", createdAt: t(1) } });
  await prisma.suggestion.create({ data: { userId: u.id, kind: "idea", message: "new", createdAt: t(2) } });
  for (let i = 0; i < 55; i++) {
    await prisma.suggestion.create({
      data: { userId: u.id, kind: "problem", message: `d${i}`, status: i % 2 ? "done" : "wont_do", closedAt: t(10 + i), createdAt: t(0), awaitingAdmin: false },
    });
  }
  const { open, closed } = await listSuggestions();
  expect(open.map((s) => s.message)).toEqual(["new", "old", "seen"]);
  expect(open[0]).toMatchObject({ status: "new", awaitingAdmin: true, replyCount: 0 });
  expect(closed).toHaveLength(50);
  expect(closed[0].message).toBe("d54");
});

test("status change: closes for done/won't do, reopens otherwise, flags the sender and emails them", async () => {
  const u = await createUser({ email: "fan@example.com" });
  const s = await prisma.suggestion.create({ data: { userId: u.id, kind: "idea", message: "a" } });
  const other = await prisma.suggestion.create({ data: { userId: u.id, kind: "idea", message: "b" } });
  const now = new Date("2026-11-13T12:00:00Z");
  await setSuggestionStatus(s.id, "wont_do", now);
  expect(await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({
    status: "wont_do",
    closedAt: now,
    awaitingAdmin: false,
    awaitingUser: true,
  });
  expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("new");
  expect(mails.at(-1)).toMatchObject({ to: ["fan@example.com"], subject: "Your suggestion is now: Won't do" });
  expect(mails.at(-1)!.text).toContain(`/suggestions/${s.id}`);
  await setSuggestionStatus(s.id, "in_progress");
  expect(await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ status: "in_progress", closedAt: null });
});

test("sender replies: stored, admin flagged, admins emailed", async () => {
  await admin();
  const u = await createUser({ email: "fan@example.com" });
  const s = await prisma.suggestion.create({ data: { userId: u.id, kind: "idea", message: "a", awaitingAdmin: false, awaitingUser: true } });
  expect(await addReply(s.id, asViewer(u), "  More detail  ")).toEqual({ ok: true });
  expect(await prisma.suggestionReply.findFirstOrThrow()).toMatchObject({ authorId: u.id, message: "More detail" });
  expect(await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ awaitingAdmin: true, awaitingUser: false });
  expect(mails.at(-1)).toMatchObject({ to: ["admin@example.com"] });
  expect(mails.at(-1)!.subject).toMatch(/^New reply from /);
  expect(mails.at(-1)!.text).toContain(`/admin/suggestions/${s.id}`);
});

test("admin replies: sender flagged and emailed", async () => {
  const a = await admin();
  const u = await createUser({ email: "fan@example.com" });
  const s = await prisma.suggestion.create({ data: { userId: u.id, kind: "idea", message: "a" } });
  expect(await addReply(s.id, asViewer(a), "Thanks, planned!")).toEqual({ ok: true });
  expect(await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ awaitingAdmin: false, awaitingUser: true });
  expect(mails.at(-1)).toMatchObject({ to: ["fan@example.com"], subject: "Reply to your suggestion" });
});

test("nobody else can reply, read or delete", async () => {
  const owner = await createUser();
  const stranger = await createUser();
  const s = await prisma.suggestion.create({ data: { userId: owner.id, kind: "idea", message: "a" } });
  expect(await addReply(s.id, asViewer(stranger), "hi")).toEqual({ ok: false, error: "Suggestion not found" });
  expect(await getThread(s.id, asViewer(stranger))).toBeNull();
  expect(await deleteSuggestion(s.id, asViewer(stranger))).toEqual({ ok: false, error: "Suggestion not found" });
  expect(await prisma.suggestion.count()).toBe(1);
  expect(await prisma.suggestionReply.count()).toBe(0);
});

test("replies are validated and limited to 30 per hour", async () => {
  const u = await createUser();
  const s = await prisma.suggestion.create({ data: { userId: u.id, kind: "idea", message: "a" } });
  expect(await addReply(s.id, asViewer(u), "   ")).toEqual({ ok: false, error: "Write a message" });
  expect(await addReply(s.id, asViewer(u), "x".repeat(2001))).toEqual({ ok: false, error: "Keep it under 2000 characters" });
  const now = new Date("2026-11-13T12:00:00Z");
  for (let i = 0; i < 30; i++) {
    await prisma.suggestionReply.create({ data: { suggestionId: s.id, authorId: u.id, message: `r${i}`, createdAt: new Date(now.getTime() - i * 60_000) } });
  }
  expect(await addReply(s.id, asViewer(u), "one more", now)).toEqual({ ok: false, error: "You've sent a lot of replies in the last hour. Try again later." });
});

test("owner can delete; replies go with it", async () => {
  const u = await createUser();
  const s = await prisma.suggestion.create({ data: { userId: u.id, kind: "idea", message: "a" } });
  await prisma.suggestionReply.create({ data: { suggestionId: s.id, authorId: u.id, message: "r" } });
  expect(await deleteSuggestion(s.id, asViewer(u))).toEqual({ ok: true });
  expect(await prisma.suggestion.count()).toBe(0);
  expect(await prisma.suggestionReply.count()).toBe(0);
});

test("thread: owner and admin see replies in order with who wrote them; viewing clears that side's flag", async () => {
  const a = await admin();
  const u = await createUser({ email: "fan@example.com" });
  const s = await prisma.suggestion.create({ data: { userId: u.id, kind: "idea", message: "a", awaitingAdmin: true, awaitingUser: true } });
  const t = (m: number) => new Date(Date.UTC(2026, 10, 13, 12, m));
  await prisma.suggestionReply.create({ data: { suggestionId: s.id, authorId: a.id, message: "admin says", createdAt: t(1) } });
  await prisma.suggestionReply.create({ data: { suggestionId: s.id, authorId: u.id, message: "fan says", createdAt: t(2) } });

  const forOwner = await getThread(s.id, asViewer(u));
  expect(forOwner!.replies.map((r) => [r.message, r.fromAdmin, r.mine])).toEqual([
    ["admin says", true, false],
    ["fan says", false, true],
  ]);
  expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } })).awaitingUser).toBe(false);
  expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } })).awaitingAdmin).toBe(true);

  const forAdmin = await getThread(s.id, asViewer(a));
  expect(forAdmin!.suggestion.message).toBe("a");
  expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } })).awaitingAdmin).toBe(false);
});

test("my suggestions and the unread / attention counts", async () => {
  const u = await createUser();
  const other = await createUser();
  const t = (m: number) => new Date(Date.UTC(2026, 10, 13, 12, m));
  await prisma.suggestion.create({ data: { userId: u.id, kind: "idea", message: "first", createdAt: t(1), awaitingUser: true } });
  await prisma.suggestion.create({ data: { userId: u.id, kind: "problem", message: "second", createdAt: t(2), awaitingAdmin: false } });
  await prisma.suggestion.create({ data: { userId: other.id, kind: "idea", message: "theirs", createdAt: t(3) } });
  expect((await listMySuggestions(u.id)).map((s) => [s.message, s.awaitingUser])).toEqual([
    ["second", false],
    ["first", true],
  ]);
  expect(await countUnreadForUser(u.id)).toBe(1);
  expect(await countAdminAttention()).toBe(2);
});

test("with a deferred scheduler the submit returns before any mail is sent", async () => {
  await createUser({ email: "a@example.com", role: "admin" });
  const u = await createUser();
  const later: (() => Promise<void>)[] = [];
  const res = await createSuggestion(u.id, { kind: "idea", message: "hi" }, new Date(), (task) => later.push(task));
  expect(res).toEqual({ ok: true });
  expect(await prisma.suggestion.count()).toBe(1);
  expect(mails).toHaveLength(0);
  await later[0]();
  expect(mails).toHaveLength(1);
});

test("a deferred notification that fails doesn't throw", async () => {
  await createUser({ email: "a@example.com", role: "admin" });
  server.use(http.post("https://api.resend.com/emails", () => new HttpResponse(null, { status: 500 })));
  const u = await createUser();
  const later: (() => Promise<void>)[] = [];
  await createSuggestion(u.id, { kind: "idea", message: "hi" }, new Date(), (task) => later.push(task));
  await expect(later[0]()).resolves.toBeUndefined();
});
