import { artistUrl, getFollowedArtists } from "@/artists/queries";
import { resetDb } from "../helpers/db";
import { createUser } from "../helpers/factories";
import { artist, follow, release } from "../helpers/releases";

beforeEach(resetDb);

test("lists only the artists this user follows, sorted by name", async () => {
  const u = await createUser();
  const other = await createUser();
  const b = await artist("spotify", "b", "beta Band");
  const a = await artist("tidal", "a", "Alpha");
  const z = await artist("spotify", "z", "Zed");
  await follow(u.id, b.id);
  await follow(u.id, a.id);
  await follow(other.id, z.id);

  const list = await getFollowedArtists(u.id);
  expect(list.map((x) => x.name)).toEqual(["Alpha", "beta Band"]);
  expect(list[0]).toMatchObject({ provider: "tidal", url: "https://tidal.com/artist/a", releaseCount: 0, latest: null });
});

test("includes release count and the latest release", async () => {
  const u = await createUser();
  const a = await artist("spotify", "a", "Alpha");
  await follow(u.id, a.id);
  await release("spotify", "old", [a.id], { title: "Old", releaseDate: "2026-01-02" });
  await release("spotify", "new", [a.id], { title: "New", releaseDate: "2026-11-07" });

  const [x] = await getFollowedArtists(u.id);
  expect(x.releaseCount).toBe(2);
  expect(x.latest).toMatchObject({ title: "New", dateLabel: "7 Nov 2026" });
});

test("sort=latest puts the most recent release first and artists without releases last", async () => {
  const u = await createUser();
  const quiet = await artist("spotify", "q", "Aardvark");
  const busy = await artist("spotify", "b", "Busy");
  const older = await artist("spotify", "o", "Older");
  for (const x of [quiet, busy, older]) await follow(u.id, x.id);
  await release("spotify", "r1", [busy.id], { releaseDate: "2026-11-01" });
  await release("spotify", "r2", [older.id], { releaseDate: "2026-06-01" });

  const list = await getFollowedArtists(u.id, { sort: "latest" });
  expect(list.map((x) => x.name)).toEqual(["Busy", "Older", "Aardvark"]);
});

test("q filters by name, case-insensitively", async () => {
  const u = await createUser();
  for (const [id, name] of [["1", "Radiohead"], ["2", "Röyksopp"], ["3", "Portishead"]] as const) {
    await follow(u.id, (await artist("spotify", id, name)).id);
  }
  expect((await getFollowedArtists(u.id, { q: "HEAD" })).map((x) => x.name)).toEqual(["Portishead", "Radiohead"]);
  expect(await getFollowedArtists(u.id, { q: "  " })).toHaveLength(3);
});

test("artistUrl builds the service's artist page", () => {
  expect(artistUrl("spotify", "abc")).toBe("https://open.spotify.com/artist/abc");
  expect(artistUrl("tidal", "123")).toBe("https://tidal.com/artist/123");
});
