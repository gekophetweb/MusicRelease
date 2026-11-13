import { isStreamingProvider } from "@/providers/scopes";

test("only Spotify and TIDAL count as connected music services", () => {
  expect(["google", "spotify", "email-otp", "tidal"].filter(isStreamingProvider)).toEqual(["spotify", "tidal"]);
});
