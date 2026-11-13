import { http, HttpResponse } from "msw";
import { setSetting } from "@/lib/settings";
import { sendSignInCode } from "@/mail/signin-code";
import { resetDb } from "../helpers/db";
import { setupMsw } from "../helpers/msw";

const server = setupMsw();
beforeEach(resetDb);

test("sends the code with the fixed subject", async () => {
  await setSetting("mail", { provider: "resend", from: { email: "music@example.com", name: "Music" }, apiKey: "re_test" });
  let body: { subject: string; to: string[]; text: string; html: string } | undefined;
  server.use(
    http.post("https://api.resend.com/emails", async ({ request }) => {
      body = (await request.json()) as typeof body;
      return HttpResponse.json({ id: "1" });
    }),
  );
  await sendSignInCode("fan@example.com", "482913", "Family Releases");
  expect(body!.subject).toBe("Your MusicReleases sign-in code");
  expect(body!.to).toEqual(["fan@example.com"]);
  expect(body!.text).toContain("482913");
  expect(body!.text).toContain("10 minutes");
  expect(body!.text).toContain("Family Releases");
  expect(body!.html).toContain("482913");
});
