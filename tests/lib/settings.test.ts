import { prisma } from "@/lib/db";
import { getSetting, getSettingsVersion, isInstalled, redactSecrets, setSetting } from "@/lib/settings";
import type { MailSettings } from "@/mail/types";
import { resetDb } from "../helpers/db";

beforeEach(resetDb);

const smtp: MailSettings = {
  provider: "smtp",
  from: { email: "music@example.com", name: "Music" },
  host: "smtp.example.com",
  port: 587,
  security: "starttls",
  user: "u",
  pass: "super-secret-password",
};

test("mail settings are stored encrypted and read back in plain form", async () => {
  await setSetting("mail", smtp);
  const row = await prisma.appSetting.findUniqueOrThrow({ where: { key: "mail" } });
  expect(row.encrypted).toBe(true);
  expect(row.value).not.toContain("super-secret-password");
  expect(await getSetting("mail")).toEqual(smtp);
});

test("schedule settings are stored unencrypted", async () => {
  await setSetting("schedule", { syncCron: "0 6 * * *", digestCron: "0 18 * * 5", timezone: "Europe/Amsterdam" });
  const row = await prisma.appSetting.findUniqueOrThrow({ where: { key: "schedule" } });
  expect(row.encrypted).toBe(false);
  expect(JSON.parse(row.value).syncCron).toBe("0 6 * * *");
});

test("getSetting returns null for a missing key", async () => {
  expect(await getSetting("site")).toBeNull();
});

test("isInstalled is false without install row and true once complete", async () => {
  expect(await isInstalled()).toBe(false);
  await setSetting("install", { status: "pending", completedStep: 2 });
  expect(await isInstalled()).toBe(false);
  await setSetting("install", { status: "complete", completedStep: 6, completedAt: new Date().toISOString() });
  expect(await isInstalled()).toBe(true);
});

test("settings version changes after a write", async () => {
  const before = await getSettingsVersion();
  await setSetting("site", { publicUrl: "https://r.example.com", siteName: "M", allowSignups: false });
  expect(await getSettingsVersion()).not.toBe(before);
});

test("redactSecrets masks secret fields and keeps the rest", () => {
  expect(redactSecrets({ clientId: "id", clientSecret: "s", enabled: true })).toEqual({
    clientId: "id",
    clientSecret: "••••••",
    enabled: true,
  });
  expect(redactSecrets({ provider: "mailgun", apiKey: "k", domain: "d" })).toEqual({
    provider: "mailgun",
    apiKey: "••••••",
    domain: "d",
  });
  expect(redactSecrets({ pass: "p", apiToken: "t", user: "u" })).toEqual({ pass: "••••••", apiToken: "••••••", user: "u" });
});

test("redactSecrets leaves empty secrets empty", () => {
  expect(redactSecrets({ clientSecret: "" })).toEqual({ clientSecret: "" });
});
