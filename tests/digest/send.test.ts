import { prisma } from "@/lib/db";
import { setSetting } from "@/lib/settings";
import { sendWeeklyDigests } from "@/digest/send";
import { MailError } from "@/mail/errors";
import { GET as unsubscribeGET, POST as unsubscribePOST } from "@/app/unsubscribe/route";
import { resetDb } from "../helpers/db";
import { createUser, site } from "../helpers/factories";
import { artist, follow, release } from "../helpers/releases";

const now = new Date("2026-11-13T17:00:00Z");
const mail = { provider: "smtp" as const, from: { email: "m@example.com" }, host: "mailpit", port: 1025, security: "none" as const };

beforeEach(async () => {
  await resetDb();
  await setSetting("site", site);
  await setSetting("mail", mail);
});

async function fanWithRelease(email: string) {
  const u = await createUser({ email });
  await prisma.userSettings.create({ data: { userId: u.id, digestEmail: email } });
  const a = await artist("spotify", `A-${email}`, "Ada");
  await follow(u.id, a.id);
  await release("spotify", `r-${email}`, [a.id], { releaseDate: "2026-11-11" });
  return u;
}

test("sends once and records lastDigestSentAt", async () => {
  const u = await fanWithRelease("fan@example.com");
  const send = vi.fn().mockResolvedValue({ id: "1" });
  expect(await sendWeeklyDigests(now, { send })).toEqual({ sent: 1, skipped: 0, failed: 0 });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: { email: "fan@example.com", name: u.name } }));
  expect((await prisma.userSettings.findUniqueOrThrow({ where: { userId: u.id } })).lastDigestSentAt).toEqual(now);
  expect(await sendWeeklyDigests(new Date(now.getTime() + 3600_000), { send })).toEqual({ sent: 0, skipped: 1, failed: 0 });
  expect(send).toHaveBeenCalledTimes(1);
});

test("a failed send does not set lastDigestSentAt and others still get theirs", async () => {
  const bad = await fanWithRelease("bad@example.com");
  await fanWithRelease("good@example.com");
  const send = vi.fn(async (msg: { to: { email: string } }) => {
    if (msg.to.email === "bad@example.com") throw new MailError("smtp", "SMTP error: mailbox unavailable");
    return { id: "ok" };
  });
  expect(await sendWeeklyDigests(now, { send })).toEqual({ sent: 1, skipped: 0, failed: 1 });
  expect((await prisma.userSettings.findUniqueOrThrow({ where: { userId: bad.id } })).lastDigestSentAt).toBeNull();
});

test("users without releases this week are skipped", async () => {
  const u = await createUser();
  await prisma.userSettings.create({ data: { userId: u.id, digestEmail: "quiet@example.com" } });
  const send = vi.fn();
  expect(await sendWeeklyDigests(now, { send })).toEqual({ sent: 0, skipped: 1, failed: 0 });
  expect(send).not.toHaveBeenCalled();
});

test("mail not configured skips everyone without throwing", async () => {
  await prisma.appSetting.delete({ where: { key: "mail" } });
  await fanWithRelease("fan@example.com");
  const send = vi.fn();
  expect(await sendWeeklyDigests(now, { send })).toEqual({ sent: 0, skipped: 1, failed: 0 });
  expect(send).not.toHaveBeenCalled();
});

test("unsubscribe link disables the digest", async () => {
  const u = await fanWithRelease("fan@example.com");
  const { unsubscribeToken } = await prisma.userSettings.findUniqueOrThrow({ where: { userId: u.id } });
  const res = await unsubscribeGET(new Request(`https://releases.example.com/unsubscribe?token=${unsubscribeToken}`));
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("You will not get the weekly email any more");
  expect((await prisma.userSettings.findUniqueOrThrow({ where: { userId: u.id } })).digestEnabled).toBe(false);
});

test("one-click unsubscribe (POST) works too", async () => {
  const u = await fanWithRelease("fan@example.com");
  const { unsubscribeToken } = await prisma.userSettings.findUniqueOrThrow({ where: { userId: u.id } });
  const res = await unsubscribePOST(new Request(`https://releases.example.com/unsubscribe?token=${unsubscribeToken}`, { method: "POST" }));
  expect(res.status).toBe(200);
  expect((await prisma.userSettings.findUniqueOrThrow({ where: { userId: u.id } })).digestEnabled).toBe(false);
});

test("unknown unsubscribe token answers 404", async () => {
  const res = await unsubscribeGET(new Request("https://releases.example.com/unsubscribe?token=nope"));
  expect(res.status).toBe(404);
});
