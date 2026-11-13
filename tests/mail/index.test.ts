import { http, HttpResponse } from "msw";
import { MailNotConfiguredError, sendMail, sendTestMail } from "@/mail";
import { setSetting } from "@/lib/settings";
import domains from "../fixtures/resend/domains.json";
import sendOk from "../fixtures/resend/send-ok.json";
import { resetDb } from "../helpers/db";
import { setupMsw } from "../helpers/msw";

const server = setupMsw();
beforeEach(resetDb);

const resend = { provider: "resend" as const, from: { email: "music@example.com", name: "Music" }, apiKey: "re_test" };
const msg = { to: { email: "fan@example.com" }, subject: "Hi", html: "<b>Hi</b>", text: "Hi" };

test("sendMail throws MailNotConfiguredError without mail settings", async () => {
  await expect(sendMail(msg)).rejects.toBeInstanceOf(MailNotConfiguredError);
});

test("sendMail treats settings for a removed provider as not configured", async () => {
  await setSetting("mail", { provider: "sender", from: { email: "m@example.com" }, apiToken: "tok" } as never);
  await expect(sendMail(msg)).rejects.toBeInstanceOf(MailNotConfiguredError);
});

test("sendMail uses the stored provider", async () => {
  await setSetting("mail", resend);
  server.use(http.post("https://api.resend.com/emails", () => HttpResponse.json(sendOk)));
  await expect(sendMail(msg)).resolves.toEqual({ id: sendOk.id });
});

test("sendTestMail verifies before sending", async () => {
  const calls: string[] = [];
  server.use(
    http.get("https://api.resend.com/domains", () => {
      calls.push("verify");
      return HttpResponse.json(domains);
    }),
    http.post("https://api.resend.com/emails", async ({ request }) => {
      const body = (await request.json()) as { subject: string; to: string[] };
      calls.push(`send:${body.to[0]}:${body.subject}`);
      return HttpResponse.json(sendOk);
    }),
  );
  await sendTestMail(resend, "me@example.com");
  expect(calls).toEqual(["verify", "send:me@example.com:MusicReleases test email"]);
});

test("sendTestMail does not send when verify fails", async () => {
  let sent = false;
  server.use(
    http.get("https://api.resend.com/domains", () => new HttpResponse(null, { status: 401 })),
    http.post("https://api.resend.com/emails", () => {
      sent = true;
      return HttpResponse.json(sendOk);
    }),
  );
  await expect(sendTestMail(resend, "me@example.com")).rejects.toThrow("Resend API key was rejected");
  expect(sent).toBe(false);
});
