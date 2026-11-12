import { http, HttpResponse } from "msw";
import { spotifyProvider } from "@/providers/spotify";
import following1 from "../fixtures/spotify/following-page1.json";
import following2 from "../fixtures/spotify/following-page2.json";
import albums1 from "../fixtures/spotify/artist-albums.json";
import albums2 from "../fixtures/spotify/artist-albums-page2.json";
import { setupMsw } from "../helpers/msw";

const server = setupMsw();

function followingHandler(seen?: string[]) {
  return http.get("https://api.spotify.com/v1/me/following", ({ request }) => {
    seen?.push(request.headers.get("authorization") ?? "");
    const after = new URL(request.url).searchParams.get("after");
    return HttpResponse.json(after ? following2 : following1);
  });
}

function albumsHandler(calls: string[]) {
  return http.get("https://api.spotify.com/v1/artists/ar1/albums", ({ request }) => {
    const url = new URL(request.url);
    calls.push(url.search);
    const group = url.searchParams.get("include_groups");
    const page = url.searchParams.get("offset") === "50" ? albums2 : albums1;
    // Spotify groups results by type: serve only the matching items, like the real API.
    const items = page.items.filter((i) => i.album_type === group);
    const next = page === albums1 && group === "single" ? albums1.next!.replace("album,single", "single") : null;
    return HttpResponse.json({ ...page, items, next });
  });
}

test("follows cursor pagination across pages", async () => {
  server.use(followingHandler());
  const artists = await spotifyProvider.getFollowedArtists("t");
  expect(artists).toHaveLength(53);
  expect(artists[0]).toEqual({ providerId: "ar0", name: "Artist 0", imageUrl: "https://i.scdn.co/image/ar0" });
  expect(artists[52].providerId).toBe("ar52");
});

test("sends Bearer token", async () => {
  const seen: string[] = [];
  server.use(followingHandler(seen));
  await spotifyProvider.getFollowedArtists("t");
  expect(seen[0]).toBe("Bearer t");
});

test("maps album fields to NormalizedRelease", async () => {
  const calls: string[] = [];
  server.use(albumsHandler(calls));
  const releases = await spotifyProvider.getArtistReleases("t", "ar1");
  expect(releases).toHaveLength(4);
  expect(releases.find((r) => r.providerId === "al2")).toEqual({
    providerId: "al2",
    title: "Long Player",
    rawType: "album",
    releaseDate: "2026-10-17",
    coverUrl: "https://i.scdn.co/image/al2-300",
    url: "https://open.spotify.com/album/al2",
    totalTracks: 12,
    artistProviderIds: ["ar1", "ar7"],
  });
  expect(releases.find((r) => r.providerId === "al4")).toMatchObject({ rawType: "single", releaseDate: "2008-06" });
  expect(new URLSearchParams(calls[0]).get("market")).toBe("from_token");
});

test("albums and singles are fetched separately so a long album list cannot hide new singles", async () => {
  const calls: string[] = [];
  server.use(albumsHandler(calls));
  const releases = await spotifyProvider.getArtistReleases("t", "ar1", { maxPages: 1 });
  const groups = calls.map((c) => new URLSearchParams(c).get("include_groups"));
  expect(groups.sort()).toEqual(["album", "single"]);
  expect(releases.map((r) => r.providerId).sort()).toEqual(["al1", "al2", "al3"]);
});
