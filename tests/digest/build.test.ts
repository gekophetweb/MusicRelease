import { prisma } from "@/lib/db";
import { setSetting } from "@/lib/settings";
import { buildWeeklyDigest, renderDigest } from "@/digest/build";
import { resetDb } from "../helpers/db";
import { createUser, site } from "../helpers/factories";
import { artist, follow, release } from "../helpers/releases";

beforeEach(async () => {
  await resetDb();
  await setSetting("site", site);
  await setSetting("schedule", { syncCron: "0 6 * * *", digestCron: "0 18 * * 5", timezone: "Europe/Amsterdam" });
});

// Friday 13 Nov 2026, 18:00 in Amsterdam
const now = new Date("2026-11-13T17:00:00Z");

async function fan(email: string | null = "fan@example.com", enabled = true) {
  const u = await createUser({ email: email ?? undefined });
  await prisma.userSettings.create({ data: { userId: u.id, digestEmail: email, digestEnabled: enabled } });
  const a = await artist("spotify", "A", "Ada");
  await follow(u.id, a.id);
  return { u, a };
}

test("includes only day-precision releases from the last 7 days", async () => {
  const { u, a } = await fan();
  await release("spotify", "fresh", [a.id], { title: "Fresh", releaseDate: "2026-11-11" });
  await release("spotify", "today", [a.id], { title: "Today", type: "album", releaseDate: "2026-11-13" });
  await release("spotify", "old", [a.id], { title: "Old", releaseDate: "2026-11-04" });
  await release("spotify", "year", [a.id], { title: "Yearly", releaseDate: "2026-01-01", datePrecision: "year" });
  await release("spotify", "month", [a.id], { title: "Monthly", releaseDate: "2026-11-01", datePrecision: "month" });
  const d = await buildWeeklyDigest(u.id, now);
  expect(d).not.toBeNull();
  expect(d!.singles.map((r) => r.title)).toEqual(["Fresh"]);
  expect(d!.albums.map((r) => r.title)).toEqual(["Today"]);
  expect(d!.to).toBe("fan@example.com");
  expect(d!.unsubscribeUrl).toMatch(/^https:\/\/releases\.example\.com\/unsubscribe\?token=/);
  expect(d!.weekStart.toISOString().slice(0, 10)).toBe("2026-11-07");
});

test("the window starts 6 days before today, inclusive", async () => {
  const { u, a } = await fan();
  await release("spotify", "edge", [a.id], { title: "Edge", releaseDate: "2026-11-07" });
  await release("spotify", "before", [a.id], { title: "Before", releaseDate: "2026-11-06" });
  const d = await buildWeeklyDigest(u.id, now);
  expect(d!.singles.map((r) => r.title)).toEqual(["Edge"]);
});

test("returns null with no releases", async () => {
  const { u } = await fan();
  expect(await buildWeeklyDigest(u.id, now)).toBeNull();
});

test("returns null without an email address", async () => {
  const { u, a } = await fan(null);
  await release("spotify", "fresh", [a.id], { releaseDate: "2026-11-11" });
  expect(await buildWeeklyDigest(u.id, now)).toBeNull();
});

test("returns null when the digest is turned off", async () => {
  const { u, a } = await fan("fan@example.com", false);
  await release("spotify", "fresh", [a.id], { releaseDate: "2026-11-11" });
  expect(await buildWeeklyDigest(u.id, now)).toBeNull();
});

test("email lists Albums before Singles, with subject and plain text", async () => {
  const { u, a } = await fan();
  await release("spotify", "s1", [a.id], { title: "A Single", releaseDate: "2026-11-11" });
  await release("spotify", "a1", [a.id], { title: "An Album", type: "album", releaseDate: "2026-11-12" });
  const msg = await renderDigest((await buildWeeklyDigest(u.id, now))!);
  expect(msg.subject).toBe("🎵 2 new releases this week (7 Nov – 13 Nov)");
  expect(msg.html.indexOf("Albums")).toBeGreaterThan(-1);
  expect(msg.html.indexOf("Albums")).toBeLessThan(msg.html.indexOf("Singles"));
  expect(msg.html).toContain("https://open.spotify.com/album/a1");
  expect(msg.text).toContain("An Album");
  expect(msg.text).toContain("Ada");
  expect(msg.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/releases\.example\.com\/unsubscribe\?token=.+>$/);
  expect(msg.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
});

test("one release uses the singular in the subject", async () => {
  const { u, a } = await fan();
  await release("spotify", "s1", [a.id], { releaseDate: "2026-11-11" });
  const msg = await renderDigest((await buildWeeklyDigest(u.id, now))!);
  expect(msg.subject).toBe("🎵 1 new release this week (7 Nov – 13 Nov)");
});
