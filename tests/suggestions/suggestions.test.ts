import { http, HttpResponse } from "msw";
import { PLACEHOLDER_EMAIL_DOMAIN } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { setSetting } from "@/lib/settings";
import { createSuggestion, listSuggestions, safePagePath, setSuggestionStatus } from "@/suggestions/suggestions";
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
  expect(row).toMatchObject({ userId: u.id, kind: "idea", message: "More filters", page: "/releases?since=30", status: "open", doneAt: null });
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

test("lists open newest first and done latest 50", async () => {
  const u = await createUser({ email: "fan@example.com" });
  const t = (m: number) => new Date(Date.UTC(2026, 10, 13, 12, m));
  await prisma.suggestion.create({ data: { userId: u.id, kind: "idea", message: "old", createdAt: t(1) } });
  await prisma.suggestion.create({ data: { userId: u.id, kind: "idea", message: "new", createdAt: t(2) } });
  for (let i = 0; i < 55; i++) {
    await prisma.suggestion.create({ data: { userId: u.id, kind: "problem", message: `d${i}`, status: "done", doneAt: t(10 + i), createdAt: t(0) } });
  }
  const { open, done } = await listSuggestions();
  expect(open.map((s) => s.message)).toEqual(["new", "old"]);
  expect(open[0].from).toBe((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).name);
  expect(done).toHaveLength(50);
  expect(done[0].message).toBe("d54");
});

test("setSuggestionStatus marks done and reopens only that id", async () => {
  const u = await createUser();
  const a = await prisma.suggestion.create({ data: { userId: u.id, kind: "idea", message: "a" } });
  const b = await prisma.suggestion.create({ data: { userId: u.id, kind: "idea", message: "b" } });
  const now = new Date("2026-11-13T12:00:00Z");
  await setSuggestionStatus(a.id, "done", now);
  expect(await prisma.suggestion.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "done", doneAt: now });
  expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("open");
  await setSuggestionStatus(a.id, "open");
  expect(await prisma.suggestion.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "open", doneAt: null });
});
