import { http, HttpResponse } from "msw";
import { createSenderTransport } from "@/mail/sender";
import { MailError } from "@/mail/errors";
import sendOk from "../fixtures/sender/send-ok.json";
import { useMsw } from "../helpers/msw";

const server = useMsw();
const settings = { provider: "sender" as const, from: { email: "music@example.com", name: "Music" }, apiToken: "tok-1" };
const msg = { to: { email: "fan@example.com", name: "Fan" }, subject: "Hi", html: "<b>Hi</b>", text: "Hi", headers: { "List-Unsubscribe": "<u>" } };

test("sends bearer token and the expected JSON body", async () => {
  let seen: { auth: string | null; body: unknown } | undefined;
  server.use(
    http.post("https://api.sender.net/v2/message/send", async ({ request }) => {
      seen = { auth: request.headers.get("authorization"), body: await request.json() };
      return HttpResponse.json(sendOk);
    }),
  );
  const res = await createSenderTransport(settings).send(msg);
  expect(seen!.auth).toBe("Bearer tok-1");
  expect(seen!.body).toEqual({
    from: { email: "music@example.com", name: "Music" },
    to: { email: "fan@example.com", name: "Fan" },
    subject: "Hi",
    html: "<b>Hi</b>",
    text: "Hi",
    headers: { "List-Unsubscribe": "<u>" },
  });
  expect(res.id).toBe(sendOk.emailId);
});

test("from name falls back to the email address (Sender requires a name)", async () => {
  let body: { from: { name: string } } | undefined;
  server.use(
    http.post("https://api.sender.net/v2/message/send", async ({ request }) => {
      body = (await request.json()) as typeof body;
      return HttpResponse.json(sendOk);
    }),
  );
  await createSenderTransport({ ...settings, from: { email: "music@example.com" } }).send(msg);
  expect(body!.from.name).toBe("music@example.com");
});

test("401 becomes 'Sender API token was rejected'", async () => {
  server.use(http.post("https://api.sender.net/v2/message/send", () => new HttpResponse(null, { status: 401 })));
  const err = await createSenderTransport(settings).send(msg).catch((e) => e);
  expect(err).toBeInstanceOf(MailError);
  expect(err.message).toBe("Sender API token was rejected");
});

test("other 4xx errors carry Sender's message", async () => {
  server.use(
    http.post("https://api.sender.net/v2/message/send", () =>
      HttpResponse.json({ message: "The given data was invalid.", errors: { "from.email": ["Sender not verified"] } }, { status: 422 }),
    ),
  );
  await expect(createSenderTransport(settings).send(msg)).rejects.toThrow(
    "Sender rejected the email: The given data was invalid. (from.email: Sender not verified)",
  );
});

test("a 200 with success:false is an error", async () => {
  server.use(http.post("https://api.sender.net/v2/message/send", () => HttpResponse.json({ success: false, message: "Nope" })));
  await expect(createSenderTransport(settings).send(msg)).rejects.toThrow("Sender rejected the email: Nope");
});

test("verify calls a read-only endpoint with the token", async () => {
  let auth: string | null = null;
  server.use(
    http.get("https://api.sender.net/v2/groups", ({ request }) => {
      auth = request.headers.get("authorization");
      return HttpResponse.json({ data: [] });
    }),
  );
  await createSenderTransport(settings).verify();
  expect(auth).toBe("Bearer tok-1");
});

test("verify with a bad token throws", async () => {
  server.use(http.get("https://api.sender.net/v2/groups", () => new HttpResponse(null, { status: 401 })));
  await expect(createSenderTransport(settings).verify()).rejects.toThrow("Sender API token was rejected");
});
