import { MailSettingsSchema } from "@/mail";

const from = { email: "music@example.com", name: "Music" };

test("accepts a valid shape for each provider", () => {
  expect(
    MailSettingsSchema.safeParse({ provider: "smtp", from, host: "smtp.example.com", port: 587, security: "starttls" }).success,
  ).toBe(true);
  expect(
    MailSettingsSchema.safeParse({ provider: "mailgun", from, domain: "mg.example.com", apiKey: "key", region: "eu" }).success,
  ).toBe(true);
  expect(MailSettingsSchema.safeParse({ provider: "sender", from, apiToken: "tok" }).success).toBe(true);
});

test("rejects smtp without host", () => {
  expect(MailSettingsSchema.safeParse({ provider: "smtp", from, port: 587, security: "tls" }).success).toBe(false);
});

test("rejects a bad from email", () => {
  expect(
    MailSettingsSchema.safeParse({ provider: "sender", from: { email: "not-an-email" }, apiToken: "tok" }).success,
  ).toBe(false);
});

test("rejects an unknown provider", () => {
  expect(MailSettingsSchema.safeParse({ provider: "carrier-pigeon", from }).success).toBe(false);
});
