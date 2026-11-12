import { http, HttpResponse } from "msw";
import { getProvider } from "@/providers";
import { spotifyProvider } from "@/providers/spotify";
import { resetTidalCountryCache, tidalProvider } from "@/providers/tidal";
import col1 from "../fixtures/tidal/collection-artists-page1.json";
import col2 from "../fixtures/tidal/collection-artists-page2.json";
import alb1 from "../fixtures/tidal/artist-albums.json";
import alb2 from "../fixtures/tidal/artist-albums-page2.json";
import me from "../fixtures/tidal/users-me.json";
import { useMsw } from "../helpers/msw";

const server = useMsw();
const API = "https://openapi.tidal.com/v2";
beforeEach(() => resetTidalCountryCache());

function handlers(seen: { url: URL; accept: string | null; auth: string | null }[] = []) {
  const record = (request: Request) =>
    seen.push({ url: new URL(request.url), accept: request.headers.get("accept"), auth: request.headers.get("authorization") });
  return [
    http.get(`${API}/users/me`, ({ request }) => {
      record(request);
      return HttpResponse.json(me);
    }),
    http.get(`${API}/userCollectionArtists/me/relationships/items`, ({ request }) => {
      record(request);
      return HttpResponse.json(new URL(request.url).searchParams.get("page[cursor]") ? col2 : col1);
    }),
    http.get(`${API}/artists/101/relationships/albums`, ({ request }) => {
      record(request);
      return HttpResponse.json(new URL(request.url).searchParams.get("page[cursor]") ? alb2 : alb1);
    }),
  ];
}

test("follows links.next pagination for followed artists", async () => {
  server.use(...handlers());
  const artists = await tidalProvider.getFollowedArtists("t");
  expect(artists.map((a) => a.providerId)).toEqual(["101", "102", "103"]);
  expect(artists[0]).toEqual({
    providerId: "101",
    name: "Tidal Artist 101",
    imageUrl: "https://resources.tidal.com/images/p101/320x320.jpg",
  });
  expect(artists[2].imageUrl).toBeUndefined();
});

test("maps album fields to NormalizedRelease", async () => {
  server.use(...handlers());
  const releases = await tidalProvider.getArtistReleases("t", "101");
  expect(releases).toHaveLength(3);
  expect(releases[0]).toEqual({
    providerId: "5001",
    title: "Northern Lights",
    rawType: "EP",
    releaseDate: "2026-11-06",
    coverUrl: "https://resources.tidal.com/images/c5001/320x320.jpg",
    url: "https://tidal.com/browse/album/5001",
    totalTracks: 5,
    artistProviderIds: ["101"],
  });
  expect(releases[1].artistProviderIds).toEqual(["101", "102"]);
  // no share link and no artists relationship: fall back to the album URL and the requested artist
  expect(releases[2]).toMatchObject({ url: "https://tidal.com/album/5003", artistProviderIds: ["101"], rawType: "SINGLE" });
});

test("uses the user's country for catalogue requests", async () => {
  const seen: { url: URL; accept: string | null; auth: string | null }[] = [];
  server.use(...handlers(seen));
  await tidalProvider.getArtistReleases("t", "101", { maxPages: 1 });
  const albumCall = seen.find((s) => s.url.pathname.endsWith("/albums"))!;
  expect(albumCall.url.searchParams.get("countryCode")).toBe("DE");
  expect(albumCall.url.searchParams.get("include")).toBe("albums,albums.coverArt,albums.artists");
});

test("respects maxPages", async () => {
  const seen: { url: URL; accept: string | null; auth: string | null }[] = [];
  server.use(...handlers(seen));
  const releases = await tidalProvider.getArtistReleases("t", "101", { maxPages: 1 });
  expect(releases).toHaveLength(2);
  expect(seen.filter((s) => s.url.pathname.endsWith("/albums"))).toHaveLength(1);
});

test("sends JSON:API Accept header and bearer token", async () => {
  const seen: { url: URL; accept: string | null; auth: string | null }[] = [];
  server.use(...handlers(seen));
  await tidalProvider.getFollowedArtists("t");
  expect(seen[0].accept).toBe("application/vnd.api+json");
  expect(seen[0].auth).toBe("Bearer t");
});

test("falls back to NL when the profile has no country", async () => {
  const seen: { url: URL; accept: string | null; auth: string | null }[] = [];
  server.use(
    http.get(`${API}/users/me`, () => HttpResponse.json({ data: { id: "x", type: "users", attributes: {} } })),
    http.get(`${API}/artists/101/relationships/albums`, ({ request }) => {
      seen.push({ url: new URL(request.url), accept: null, auth: null });
      return HttpResponse.json(alb2);
    }),
  );
  await tidalProvider.getArtistReleases("t", "101");
  expect(seen[0].url.searchParams.get("countryCode")).toBe("NL");
});

test("getProvider returns the provider by name", () => {
  expect(getProvider("tidal")).toBe(tidalProvider);
  expect(getProvider("spotify")).toBe(spotifyProvider);
});
