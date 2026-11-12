import { http, HttpResponse } from "msw";
import { createMailgunTransport } from "@/mail/mailgun";
import { MailError } from "@/mail/errors";
import sendOk from "../fixtures/mailgun/send-ok.json";
import domainUnverified from "../fixtures/mailgun/domain-unverified.json";
import { setupMsw } from "../helpers/msw";

const server = setupMsw();
const settings = {
  provider: "mailgun" as const,
  from: { email: "music@mg.example.com", name: "Music" },
  domain: "mg.example.com",
  apiKey: "key-123",
  region: "eu" as const,
};
const msg = { to: { email: "fan@example.com" }, subject: "Hi", html: "<b>Hi</b>", text: "Hi", headers: { "List-Unsubscribe": "<u>" } };

test("sends to the EU endpoint with basic auth and form fields", async () => {
  let seen: { auth: string | null; form: FormData } | undefined;
  server.use(
    http.post("https://api.eu.mailgun.net/v3/mg.example.com/messages", async ({ request }) => {
      seen = { auth: request.headers.get("authorization"), form: await request.formData() };
      return HttpResponse.json(sendOk);
    }),
  );
  const res = await createMailgunTransport(settings).send(msg);
  expect(seen!.auth).toBe(`Basic ${Buffer.from("api:key-123").toString("base64")}`);
  expect(seen!.form.get("from")).toBe("Music <music@mg.example.com>");
  expect(seen!.form.get("to")).toBe("fan@example.com");
  expect(seen!.form.get("subject")).toBe("Hi");
  expect(seen!.form.get("html")).toBe("<b>Hi</b>");
  expect(seen!.form.get("text")).toBe("Hi");
  expect(seen!.form.get("h:List-Unsubscribe")).toBe("<u>");
  expect(res.id).toBe(sendOk.id);
});

test("uses the US endpoint for region us", async () => {
  server.use(http.post("https://api.mailgun.net/v3/mg.example.com/messages", () => HttpResponse.json(sendOk)));
  await expect(createMailgunTransport({ ...settings, region: "us" }).send(msg)).resolves.toEqual({ id: sendOk.id });
});

test("401 becomes a readable MailError", async () => {
  server.use(http.post("https://api.eu.mailgun.net/v3/mg.example.com/messages", () => new HttpResponse("Forbidden", { status: 401 })));
  const err = await createMailgunTransport(settings).send(msg).catch((e) => e);
  expect(err).toBeInstanceOf(MailError);
  expect(err.message).toBe("Mailgun API key was rejected");
  expect(err.status).toBe(401);
});

test("verify fails for an unverified domain", async () => {
  server.use(http.get("https://api.eu.mailgun.net/v4/domains/mg.example.com", () => HttpResponse.json(domainUnverified)));
  await expect(createMailgunTransport(settings).verify()).rejects.toThrow("Mailgun domain mg.example.com is not verified yet");
});

test("verify passes for an active domain", async () => {
  server.use(
    http.get("https://api.eu.mailgun.net/v4/domains/mg.example.com", () =>
      HttpResponse.json({ domain: { name: "mg.example.com", state: "active" } }),
    ),
  );
  await expect(createMailgunTransport(settings).verify()).resolves.toBeUndefined();
});

test("verify 404 says the domain is unknown", async () => {
  server.use(http.get("https://api.eu.mailgun.net/v4/domains/mg.example.com", () => HttpResponse.json({ message: "Domain not found" }, { status: 404 })));
  await expect(createMailgunTransport(settings).verify()).rejects.toThrow(
    "Mailgun domain mg.example.com was not found in this account/region",
  );
});

test("403 shows Mailgun's own message (sandbox recipient, domain not allowed)", async () => {
  server.use(
    http.post("https://api.eu.mailgun.net/v3/mg.example.com/messages", () =>
      HttpResponse.json({ message: "Domain mg.example.com is not allowed to send: recipient not authorized" }, { status: 403 }),
    ),
  );
  await expect(createMailgunTransport(settings).send(msg)).rejects.toThrow(
    "Mailgun refused the request: Domain mg.example.com is not allowed to send: recipient not authorized",
  );
});
