import { prisma } from "@/lib/db";
import { getReleasesForUser } from "@/releases/queries";
import { resetDb } from "../helpers/db";
import { createAccount, createUser } from "../helpers/factories";
import { artist, follow, release } from "../helpers/releases";

beforeEach(resetDb);
const now = new Date("2026-11-12T12:00:00Z");

test("splits albums and singles, newest first", async () => {
  const u = await createUser();
  const a = await artist("spotify", "A");
  await follow(u.id, a.id);
  await release("spotify", "s-old", [a.id], { title: "Old single", releaseDate: "2026-10-01" });
  await release("spotify", "s-new", [a.id], { title: "New single", releaseDate: "2026-11-07" });
  await release("spotify", "a-old", [a.id], { title: "Old album", type: "album", releaseDate: "2026-09-01" });
  await release("spotify", "a-new", [a.id], { title: "New album", type: "album", releaseDate: "2026-11-01" });
  const { albums, singles } = await getReleasesForUser(u.id, { now });
  expect(albums.map((r) => r.title)).toEqual(["New album", "Old album"]);
  expect(singles.map((r) => r.title)).toEqual(["New single", "Old single"]);
  expect(singles[0]).toMatchObject({ type: "single", dateLabel: "7 Nov 2026", artists: ["Artist A"], provider: "spotify" });
});

test("only includes releases of followed artists", async () => {
  const u = await createUser();
  const a = await artist("spotify", "A");
  const other = await artist("spotify", "Z");
  await follow(u.id, a.id);
  await release("spotify", "mine", [a.id]);
  await release("spotify", "theirs", [other.id]);
  const { singles } = await getReleasesForUser(u.id, { now });
  expect(singles.map((r) => r.id)).toHaveLength(1);
  expect(singles[0].url).toContain("mine");
});

test("sinceDays filters by release date (default 90, 0 = all)", async () => {
  const u = await createUser();
  const a = await artist("spotify", "A");
  await follow(u.id, a.id);
  await release("spotify", "recent", [a.id], { releaseDate: "2026-11-01" });
  await release("spotify", "ancient", [a.id], { releaseDate: "2026-08-01" });
  expect((await getReleasesForUser(u.id, { now })).singles).toHaveLength(1);
  expect((await getReleasesForUser(u.id, { now, sinceDays: 0 })).singles).toHaveLength(2);
  expect((await getReleasesForUser(u.id, { now, sinceDays: 365 })).singles).toHaveLength(2);
});

test("collaboration of two followed artists is shown once with both names", async () => {
  const u = await createUser();
  const a = await artist("spotify", "A", "Ada");
  const b = await artist("spotify", "B", "Bo");
  await follow(u.id, a.id);
  await follow(u.id, b.id);
  await release("spotify", "collab", [a.id, b.id], { title: "Together" });
  const { singles } = await getReleasesForUser(u.id, { now });
  expect(singles).toHaveLength(1);
  expect(singles[0].artists).toEqual(["Ada", "Bo"]);
});

test("same release from Spotify and TIDAL is shown once, linking to the service connected first", async () => {
  const u = await createUser();
  await createAccount(u.id, "tidal");
  await new Promise((r) => setTimeout(r, 10));
  await createAccount(u.id, "spotify");
  const sa = await artist("spotify", "A", "Ada");
  const ta = await artist("tidal", "101", "Ada");
  await follow(u.id, sa.id);
  await follow(u.id, ta.id);
  await release("spotify", "sp1", [sa.id], { title: "Night Drive", releaseDate: "2026-11-06" });
  await release("tidal", "td1", [ta.id], { title: "Night Drive (Explicit)", releaseDate: "2026-11-06" });
  const { singles } = await getReleasesForUser(u.id, { now });
  expect(singles).toHaveLength(1);
  expect(singles[0].provider).toBe("tidal");
  expect(singles[0].artists).toEqual(["Ada"]);
});

test("isNew marks releases first seen in the last 7 days", async () => {
  const u = await createUser();
  const a = await artist("spotify", "A");
  await follow(u.id, a.id);
  await release("spotify", "fresh", [a.id], { firstSeenAt: new Date("2026-11-10T00:00:00Z") });
  await release("spotify", "seen", [a.id], { title: "Seen", firstSeenAt: new Date("2026-10-01T00:00:00Z") });
  const { singles } = await getReleasesForUser(u.id, { now });
  expect(Object.fromEntries(singles.map((r) => [r.url.split("/").pop(), r.isNew]))).toEqual({ fresh: true, seen: false });
});

test("year-precision releases sort by their year and show only the year", async () => {
  const u = await createUser();
  const a = await artist("spotify", "A");
  await follow(u.id, a.id);
  await release("spotify", "y", [a.id], { type: "album", releaseDate: "2009-01-01", datePrecision: "year" });
  const { albums } = await getReleasesForUser(u.id, { now, sinceDays: 0 });
  expect(albums[0].dateLabel).toBe("2009");
  expect(await prisma.release.count()).toBe(1);
});

test("artistId limits releases to that followed artist, including collaborations", async () => {
  const u = await createUser();
  const a = await artist("spotify", "A");
  const b = await artist("spotify", "B");
  await follow(u.id, a.id);
  await follow(u.id, b.id);
  await release("spotify", "only-a", [a.id], { title: "Only A" });
  await release("spotify", "only-b", [b.id], { title: "Only B" });
  await release("spotify", "a-and-b", [a.id, b.id], { title: "A and B" });
  const { singles } = await getReleasesForUser(u.id, { now, artistId: a.id });
  expect(singles.map((r) => r.title).sort()).toEqual(["A and B", "Only A"]);
});

test("artistId of an artist the user does not follow returns nothing", async () => {
  const u = await createUser();
  const mine = await artist("spotify", "A");
  const theirs = await artist("spotify", "Z");
  await follow(u.id, mine.id);
  await release("spotify", "z-solo", [theirs.id]);
  const { albums, singles } = await getReleasesForUser(u.id, { now, artistId: theirs.id });
  expect(albums.length + singles.length).toBe(0);
});
