import { http, HttpResponse } from "msw";
import { createResendTransport } from "@/mail/resend";
import { MailError } from "@/mail/errors";
import domains from "../fixtures/resend/domains.json";
import sendOk from "../fixtures/resend/send-ok.json";
import { setupMsw } from "../helpers/msw";

const server = setupMsw();
const SEND = "https://api.resend.com/emails";
const DOMAINS = "https://api.resend.com/domains";
const settings = { provider: "resend" as const, from: { email: "music@example.com", name: "Music" }, apiKey: "re_test" };
const msg = { to: { email: "fan@example.com", name: "Fan" }, subject: "Hi", html: "<b>Hi</b>", text: "Hi", headers: { "List-Unsubscribe": "<u>" } };

test("sends the bearer key and the expected JSON body", async () => {
  let seen: { auth: string | null; body: unknown } | undefined;
  server.use(
    http.post(SEND, async ({ request }) => {
      seen = { auth: request.headers.get("authorization"), body: await request.json() };
      return HttpResponse.json(sendOk);
    }),
  );
  const res = await createResendTransport(settings).send(msg);
  expect(seen!.auth).toBe("Bearer re_test");
  expect(seen!.body).toEqual({
    from: "Music <music@example.com>",
    to: ["Fan <fan@example.com>"],
    subject: "Hi",
    html: "<b>Hi</b>",
    text: "Hi",
    headers: { "List-Unsubscribe": "<u>" },
  });
  expect(res.id).toBe(sendOk.id);
});

test("addresses without a name are sent bare, names with special characters are quoted", async () => {
  let body: { from: string; to: string[] } | undefined;
  server.use(
    http.post(SEND, async ({ request }) => {
      body = (await request.json()) as typeof body;
      return HttpResponse.json(sendOk);
    }),
  );
  await createResendTransport({ ...settings, from: { email: "music@example.com", name: 'Music, "Weekly"' } }).send({
    ...msg,
    to: { email: "fan@example.com" },
  });
  expect(body!.from).toBe('"Music, \\"Weekly\\"" <music@example.com>');
  expect(body!.to).toEqual(["fan@example.com"]);
});

test("401 becomes 'Resend API key was rejected'", async () => {
  server.use(
    http.post(SEND, () => HttpResponse.json({ statusCode: 401, name: "validation_error", message: "API key is invalid" }, { status: 401 })),
  );
  const err = await createResendTransport(settings).send(msg).catch((e) => e);
  expect(err).toBeInstanceOf(MailError);
  expect(err.provider).toBe("resend");
  expect(err.message).toBe("Resend API key was rejected");
});

test("other errors carry Resend's message", async () => {
  server.use(
    http.post(SEND, () =>
      HttpResponse.json(
        { statusCode: 403, name: "validation_error", message: "The example.com domain is not verified." },
        { status: 403 },
      ),
    ),
  );
  await expect(createResendTransport(settings).send(msg)).rejects.toThrow(
    "Resend rejected the email: The example.com domain is not verified.",
  );
});

test("verify passes when the from domain is verified", async () => {
  let auth: string | null = null;
  server.use(
    http.get(DOMAINS, ({ request }) => {
      auth = request.headers.get("authorization");
      return HttpResponse.json(domains);
    }),
  );
  await createResendTransport(settings).verify();
  expect(auth).toBe("Bearer re_test");
});

test("verify fails when the from domain is not verified yet", async () => {
  server.use(http.get(DOMAINS, () => HttpResponse.json(domains)));
  await expect(
    createResendTransport({ ...settings, from: { email: "music@pending.example" } }).verify(),
  ).rejects.toThrow("Resend domain pending.example is not verified yet");
});

test("verify fails when the from domain was never added", async () => {
  server.use(http.get(DOMAINS, () => HttpResponse.json(domains)));
  await expect(createResendTransport({ ...settings, from: { email: "music@other.example" } }).verify()).rejects.toThrow(
    "Domain other.example has not been added to Resend",
  );
});

test("verify accepts a sending-only key", async () => {
  server.use(
    http.get(DOMAINS, () =>
      HttpResponse.json(
        { statusCode: 401, name: "restricted_api_key", message: "This API key is restricted to only send emails." },
        { status: 401 },
      ),
    ),
  );
  await expect(createResendTransport(settings).verify()).resolves.toBeUndefined();
});

test("verify with a bad key throws", async () => {
  server.use(
    http.get(DOMAINS, () => HttpResponse.json({ statusCode: 400, name: "validation_error", message: "API key is invalid" }, { status: 400 })),
  );
  await expect(createResendTransport(settings).verify()).rejects.toThrow("Resend API key was rejected");
});
