import { assertSignupAllowed, SignupsClosedError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSetting, SECRET_MASK, setSetting } from "@/lib/settings";
import { LOCKOUT_ERROR } from "@/lib/signin";
import { ensureSetupToken } from "@/lib/setup-token";
import {
  completeInstall,
  INSTALL_COOKIE,
  markMailTested,
  resetRateLimits,
  saveInstallStep,
  startInstallSession,
  updateAdminSettings,
  verifyInstallSession,
} from "@/install/steps";
import { resetDb } from "../helpers/db";
import { createUser, site } from "../helpers/factories";

const mail = {
  provider: "smtp" as const,
  from: { email: "music@example.com", name: "Music" },
  host: "mailpit",
  port: 1025,
  security: "none" as const,
};

async function session(): Promise<string> {
  const token = (await ensureSetupToken())!;
  const res = await startInstallSession(token, "1.2.3.4");
  if (!res.ok) throw new Error("no session");
  return res.session;
}

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  delete process.env.INSTALL_TOKEN;
});

test("correct setup token starts a verifiable installer session", async () => {
  const s = await session();
  expect(await verifyInstallSession(s)).toBe(true);
  expect(await verifyInstallSession("forged")).toBe(false);
  expect(await verifyInstallSession(undefined)).toBe(false);
});

test("wrong token is rejected with 401", async () => {
  await ensureSetupToken();
  expect(await startInstallSession("WRONG", "1.2.3.4")).toEqual({ ok: false, status: 401 });
});

test("token step rate-limits: after 5 wrong tokens even the right one gets 429", async () => {
  const token = (await ensureSetupToken())!;
  for (let i = 0; i < 5; i++) expect((await startInstallSession("WRONG", "9.9.9.9")).ok).toBe(false);
  expect(await startInstallSession(token, "9.9.9.9")).toEqual({ ok: false, status: 429 });
  // another IP is not affected
  expect((await startInstallSession(token, "8.8.8.8")).ok).toBe(true);
});

test("saving a step without a valid installer session is rejected", async () => {
  const res = await saveInstallStep("site", site, undefined);
  expect(res).toEqual({ ok: false, errors: { session: expect.any(String) } });
  expect(await getSetting("site")).toBeNull();
});

test("site step stores the site settings and records progress", async () => {
  const s = await session();
  expect(await saveInstallStep("site", { ...site, publicUrl: "https://releases.example.com/" }, s)).toEqual({ ok: true });
  expect((await getSetting("site"))?.publicUrl).toBe("https://releases.example.com");
  expect((await getSetting("install"))?.completedStep).toBe(2);
});

test("site step rejects a URL that is not http(s)", async () => {
  const s = await session();
  const res = await saveInstallStep("site", { ...site, publicUrl: "ftp://x" }, s);
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.errors.publicUrl).toBeDefined();
});

test("music step requires at least one enabled service", async () => {
  const s = await session();
  const off = { enabled: false, clientId: "", clientSecret: "" };
  const res = await saveInstallStep("music", { spotify: off, tidal: off }, s);
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.errors.services).toBeDefined();
});

test("music step requires client id and secret for an enabled service", async () => {
  const s = await session();
  const res = await saveInstallStep(
    "music",
    { spotify: { enabled: true, clientId: "", clientSecret: "" }, tidal: { enabled: false, clientId: "", clientSecret: "" } },
    s,
  );
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.errors["spotify.clientId"]).toBeDefined();
});

test("music step keeps an existing secret when the mask is submitted", async () => {
  const s = await session();
  const off = { enabled: false, clientId: "", clientSecret: "" };
  await saveInstallStep("music", { spotify: { enabled: true, clientId: "id", clientSecret: "real" }, tidal: off }, s);
  await saveInstallStep("music", { spotify: { enabled: true, clientId: "id2", clientSecret: SECRET_MASK }, tidal: off }, s);
  expect(await getSetting("spotify")).toEqual({ enabled: true, clientId: "id2", clientSecret: "real" });
});

test("mail step rejects saving without a successful test unless skipped", async () => {
  const s = await session();
  const res = await saveInstallStep("mail", { skip: false, settings: mail }, s);
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.errors.mail).toMatch(/test email/i);
});

test("mail step saves after a successful test with the same values", async () => {
  const s = await session();
  await markMailTested(mail);
  expect(await saveInstallStep("mail", { skip: false, settings: mail }, s)).toEqual({ ok: true });
  expect(await getSetting("mail")).toEqual(mail);
});

test("mail step rejects values changed after the test", async () => {
  const s = await session();
  await markMailTested(mail);
  const res = await saveInstallStep("mail", { skip: false, settings: { ...mail, port: 2525 } }, s);
  expect(res.ok).toBe(false);
});

test("mail step can be skipped", async () => {
  const s = await session();
  expect(await saveInstallStep("mail", { skip: true }, s)).toEqual({ ok: true });
  expect((await getSetting("install"))?.mailSkipped).toBe(true);
  expect(await getSetting("mail")).toBeNull();
});

test("schedule step rejects an invalid cron expression", async () => {
  const s = await session();
  const res = await saveInstallStep("schedule", { syncCron: "not cron", digestCron: "0 18 * * 5", timezone: "Europe/Amsterdam" }, s);
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.errors.syncCron).toBeDefined();
});

test("schedule step rejects an unknown timezone", async () => {
  const s = await session();
  const res = await saveInstallStep("schedule", { syncCron: "0 6 * * *", digestCron: "0 18 * * 5", timezone: "Mars/Olympus" }, s);
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.errors.timezone).toBeDefined();
});

test("schedule step stores valid cron strings", async () => {
  const s = await session();
  const schedule = { syncCron: "30 5 * * *", digestCron: "0 9 * * 1", timezone: "Europe/Amsterdam" };
  expect(await saveInstallStep("schedule", schedule, s)).toEqual({ ok: true });
  expect(await getSetting("schedule")).toEqual(schedule);
});

test("completeInstall makes the user admin, locks the installer and clears the setup token", async () => {
  await ensureSetupToken();
  const u = await createUser();
  await completeInstall(u.id);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe("admin");
  expect((await getSetting("install"))?.status).toBe("complete");
  expect(await ensureSetupToken()).toBeNull();
  expect((await getSetting("installSecrets"))?.setupToken).toBeUndefined();
});

test("during install a sign-up needs the installer session cookie", async () => {
  const s = await session();
  await expect(assertSignupAllowed(null)).rejects.toBeInstanceOf(SignupsClosedError);
  await expect(assertSignupAllowed(`foo=1; ${INSTALL_COOKIE}=${s}`)).resolves.toBeUndefined();
});

test("admin mail change needs a passing test first", async () => {
  await setSetting("mail", { provider: "resend", from: { email: "m@example.com" }, apiKey: "real-token" });
  const res = await updateAdminSettings("mail", {
    skip: false,
    settings: { provider: "resend", from: { email: "new@example.com" }, apiKey: SECRET_MASK },
  });
  expect(res.ok).toBe(false);
});

test("admin update keeps a secret when the mask is submitted", async () => {
  await setSetting("mail", { provider: "resend", from: { email: "m@example.com" }, apiKey: "real-token" });
  await markMailTested({ provider: "resend", from: { email: "new@example.com" }, apiKey: "real-token" });
  const res = await updateAdminSettings("mail", {
    skip: false,
    settings: { provider: "resend", from: { email: "new@example.com" }, apiKey: SECRET_MASK },
  });
  expect(res).toEqual({ ok: true });
  expect(await getSetting("mail")).toEqual({ provider: "resend", from: { email: "new@example.com" }, apiKey: "real-token" });
});

test("admin mail update does not require a new test when only the mask is sent back", async () => {
  await setSetting("mail", { provider: "resend", from: { email: "m@example.com" }, apiKey: "real-token" });
  await markMailTested({ provider: "resend", from: { email: "m@example.com" }, apiKey: "real-token" });
  const res = await updateAdminSettings("mail", {
    skip: false,
    settings: { provider: "resend", from: { email: "m@example.com" }, apiKey: SECRET_MASK },
  });
  expect(res).toEqual({ ok: true });
});

// ---------- sign-in step ----------

const googleOn = { enabled: true, clientId: "g-id", clientSecret: "g-secret" };
const googleOff = { enabled: false, clientId: "", clientSecret: "" };

test("signin step requires at least one method", async () => {
  const res = await saveInstallStep("signin", { google: googleOff, emailCode: { enabled: false } }, await session());
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.errors.methods).toBe("Turn on at least one way to sign in");
});

test("signin step needs Google client id and secret when Google is on", async () => {
  const res = await saveInstallStep("signin", { google: { enabled: true, clientId: "", clientSecret: "" }, emailCode: { enabled: false } }, await session());
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.errors["google.clientId"]).toBeDefined();
    expect(res.errors["google.clientSecret"]).toBeDefined();
  }
});

test("signin step records progress after the site step", async () => {
  const s = await session();
  await saveInstallStep("site", site, s);
  await saveInstallStep("signin", { google: googleOn, emailCode: { enabled: false } }, s);
  expect((await getSetting("install"))?.completedStep).toBe(3);
});

test("saving signin with the masked secret keeps the stored secret", async () => {
  await setSetting("signin", { google: { enabled: true, clientId: "g", clientSecret: "real" }, emailCode: { enabled: false } });
  const res = await saveInstallStep(
    "signin",
    { google: { enabled: true, clientId: "g", clientSecret: SECRET_MASK }, emailCode: { enabled: false } },
    await session(),
  );
  expect(res.ok).toBe(true);
  expect((await getSetting("signin"))?.google.clientSecret).toBe("real");
});

test("mail can't be skipped when email codes are on", async () => {
  await setSetting("signin", { google: googleOff, emailCode: { enabled: true } });
  const res = await saveInstallStep("mail", { skip: true }, await session());
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.errors.mail).toContain("Email sign-in codes need mail");
});

test("mail can be skipped when only Google is on", async () => {
  await setSetting("signin", { google: googleOn, emailCode: { enabled: false } });
  expect((await saveInstallStep("mail", { skip: true }, await session())).ok).toBe(true);
});

test("admin: turning Google off with email codes but no mail is refused", async () => {
  await setSetting("signin", { google: googleOn, emailCode: { enabled: true } });
  const res = await updateAdminSettings("signin", { google: googleOff, emailCode: { enabled: true } });
  expect(res).toEqual({ ok: false, errors: { form: LOCKOUT_ERROR } });
  expect((await getSetting("signin"))?.google.enabled).toBe(true);
});

test("admin: turning email codes off while Google is off is refused", async () => {
  await setSetting("mail", mail);
  await setSetting("signin", { google: googleOff, emailCode: { enabled: true } });
  const res = await updateAdminSettings("signin", { google: googleOff, emailCode: { enabled: false } });
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.errors.form ?? res.errors.methods).toBeDefined();
});

test("admin: email codes alone are fine when mail is configured", async () => {
  await setSetting("mail", mail);
  expect((await updateAdminSettings("signin", { google: googleOff, emailCode: { enabled: true } })).ok).toBe(true);
});
