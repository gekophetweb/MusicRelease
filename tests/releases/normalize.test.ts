import type { NormalizedRelease } from "@/providers/types";
import {
  classifyRelease,
  dedupeReleases,
  formatReleaseDate,
  normalizeTitle,
  parseReleaseDate,
  sortReleases,
} from "@/releases/normalize";

const rel = (over: Partial<NormalizedRelease>): NormalizedRelease => ({
  providerId: "id",
  title: "Song",
  rawType: "single",
  releaseDate: "2026-11-07",
  url: "https://x",
  artistProviderIds: ["x"],
  ...over,
});

describe("parseReleaseDate", () => {
  test("day, month and year precision", () => {
    expect(parseReleaseDate("2026-11-07")).toEqual({ date: new Date("2026-11-07T00:00:00Z"), precision: "day" });
    expect(parseReleaseDate("2019-06")).toEqual({ date: new Date("2019-06-01T00:00:00Z"), precision: "month" });
    expect(parseReleaseDate("2019")).toEqual({ date: new Date("2019-01-01T00:00:00Z"), precision: "year" });
  });

  test("Spotify's 0000 placeholder and garbage are rejected", () => {
    expect(parseReleaseDate("0000")).toBeNull();
    expect(parseReleaseDate("")).toBeNull();
    expect(parseReleaseDate("soon")).toBeNull();
    expect(parseReleaseDate("2019-13-01")).toBeNull();
  });
});

describe("classifyRelease", () => {
  test("Spotify types", () => {
    expect(classifyRelease("spotify", "album")).toBe("album");
    expect(classifyRelease("spotify", "single")).toBe("single");
    expect(classifyRelease("spotify", "compilation")).toBeNull();
    expect(classifyRelease("spotify", "appears_on")).toBeNull();
  });

  test("TIDAL types: EP counts as single", () => {
    expect(classifyRelease("tidal", "ALBUM")).toBe("album");
    expect(classifyRelease("tidal", "EP")).toBe("single");
    expect(classifyRelease("tidal", "SINGLE")).toBe("single");
    expect(classifyRelease("tidal", "SOMETHING_NEW")).toBeNull();
  });
});

describe("dedupeReleases", () => {
  test("explicit and clean editions collapse into one", () => {
    const a = rel({ providerId: "a", title: "Night Drive", totalTracks: 1 });
    const aClean = rel({ providerId: "b", title: "Night Drive (Clean)", totalTracks: 1 });
    expect(dedupeReleases("spotify", [a, aClean])).toHaveLength(1);
  });

  test("a collaboration keeps both artists", () => {
    const fromX = rel({ providerId: "c1", title: "Together", artistProviderIds: ["x"] });
    const fromY = rel({ providerId: "c2", title: "Together", artistProviderIds: ["y", "x"] });
    const out = dedupeReleases("spotify", [fromX, fromY]);
    expect(out).toHaveLength(1);
    expect([...out[0].artistProviderIds].sort()).toEqual(["x", "y"]);
  });

  test("keeps the edition with the most tracks (deluxe over standard)", () => {
    const std = rel({ providerId: "s", title: "Big Record", rawType: "album", totalTracks: 10 });
    const more = rel({ providerId: "d", title: "Big Record", rawType: "album", totalTracks: 12 });
    expect(dedupeReleases("spotify", [std, more])[0].providerId).toBe("d");
  });

  test("same title on different dates or types stays separate", () => {
    const single = rel({ providerId: "1", title: "Home", rawType: "single" });
    const album = rel({ providerId: "2", title: "Home", rawType: "album" });
    const later = rel({ providerId: "3", title: "Home", rawType: "single", releaseDate: "2027-01-01" });
    expect(dedupeReleases("spotify", [single, album, later])).toHaveLength(3);
  });

  test("drops releases that are skipped by classification or have no valid date", () => {
    expect(dedupeReleases("spotify", [rel({ rawType: "compilation" }), rel({ releaseDate: "0000" })])).toEqual([]);
  });
});

test("normalizeTitle strips edition markers and case", () => {
  expect(normalizeTitle("Night Drive (Explicit)")).toBe("night drive");
  expect(normalizeTitle("  Night Drive - Single ")).toBe("night drive");
  expect(normalizeTitle("Night Drive [Clean]")).toBe("night drive");
});

test("sortReleases: newest first, title as tiebreak", () => {
  const d = (s: string) => new Date(s);
  const out = sortReleases([
    { title: "Old", releaseDate: d("2020-01-01") },
    { title: "B", releaseDate: d("2026-11-07") },
    { title: "A", releaseDate: d("2026-11-07") },
  ]);
  expect(out.map((r) => r.title)).toEqual(["A", "B", "Old"]);
});

test("formatReleaseDate per precision", () => {
  expect(formatReleaseDate(new Date("2026-11-07T00:00:00Z"), "day")).toBe("7 Nov 2026");
  expect(formatReleaseDate(new Date("2019-06-01T00:00:00Z"), "month")).toBe("Jun 2019");
  expect(formatReleaseDate(new Date("2019-01-01T00:00:00Z"), "year")).toBe("2019");
});
