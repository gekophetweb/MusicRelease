import { http, HttpResponse } from "msw";
import { MailNotConfiguredError, sendMail, sendTestMail } from "@/mail";
import { setSetting } from "@/lib/settings";
import sendOk from "../fixtures/sender/send-ok.json";
import { resetDb } from "../helpers/db";
import { useMsw } from "../helpers/msw";

const server = useMsw();
beforeEach(resetDb);

const sender = { provider: "sender" as const, from: { email: "music@example.com", name: "Music" }, apiToken: "tok" };
const msg = { to: { email: "fan@example.com" }, subject: "Hi", html: "<b>Hi</b>", text: "Hi" };

test("sendMail throws MailNotConfiguredError without mail settings", async () => {
  await expect(sendMail(msg)).rejects.toBeInstanceOf(MailNotConfiguredError);
});

test("sendMail uses the stored provider", async () => {
  await setSetting("mail", sender);
  server.use(http.post("https://api.sender.net/v2/message/send", () => HttpResponse.json(sendOk)));
  await expect(sendMail(msg)).resolves.toEqual({ id: sendOk.emailId });
});

test("sendTestMail verifies before sending", async () => {
  const calls: string[] = [];
  server.use(
    http.get("https://api.sender.net/v2/groups", () => {
      calls.push("verify");
      return HttpResponse.json({ data: [] });
    }),
    http.post("https://api.sender.net/v2/message/send", async ({ request }) => {
      const body = (await request.json()) as { subject: string; to: { email: string } };
      calls.push(`send:${body.to.email}:${body.subject}`);
      return HttpResponse.json(sendOk);
    }),
  );
  await sendTestMail(sender, "me@example.com");
  expect(calls).toEqual(["verify", "send:me@example.com:MusicReleases test email"]);
});

test("sendTestMail does not send when verify fails", async () => {
  let sent = false;
  server.use(
    http.get("https://api.sender.net/v2/groups", () => new HttpResponse(null, { status: 401 })),
    http.post("https://api.sender.net/v2/message/send", () => {
      sent = true;
      return HttpResponse.json(sendOk);
    }),
  );
  await expect(sendTestMail(sender, "me@example.com")).rejects.toThrow("Sender API token was rejected");
  expect(sent).toBe(false);
});
