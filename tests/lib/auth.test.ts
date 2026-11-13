import { assertSignupAllowed, buildAuthOptions, getAuth, getEnabledProviders, SignupsClosedError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { setSetting } from "@/lib/settings";
import { resetDb } from "../helpers/db";
import { createUser, site, spotifyOn, tidalOn } from "../helpers/factories";

beforeEach(resetDb);

test("buildAuthOptions registers only enabled providers", () => {
  const opts = buildAuthOptions({ site, spotify: spotifyOn, tidal: { ...tidalOn, enabled: false } });
  expect(Object.keys(opts.socialProviders ?? {})).toEqual(["spotify"]);
  expect((opts.socialProviders?.spotify as { scope?: string[] }).scope).toEqual(["user-follow-read"]);
  expect(opts.plugins?.map((p) => p.id)).not.toContain("generic-oauth");
});

test("buildAuthOptions adds Tidal as generic OAuth with PKCE", () => {
  const opts = buildAuthOptions({ site, spotify: null, tidal: tidalOn });
  expect(Object.keys(opts.socialProviders ?? {})).toEqual([]);
  expect(opts.plugins?.map((p) => p.id)).toContain("generic-oauth");
});

test("buildAuthOptions uses the public URL and encrypts OAuth tokens", () => {
  const opts = buildAuthOptions({ site, spotify: spotifyOn, tidal: null });
  expect(opts.baseURL).toBe("https://releases.example.com");
  expect(opts.trustedOrigins).toEqual(["https://releases.example.com"]);
  expect(opts.account?.encryptOAuthTokens).toBe(true);
});

test("only Google may link to an existing account by email", () => {
  const opts = buildAuthOptions({ site, spotify: spotifyOn, tidal: tidalOn });
  expect(opts.account?.accountLinking).toEqual({ enabled: true, trustedProviders: ["google"], allowDifferentEmails: true });
});

const signin = (google: boolean, emailCode: boolean) => ({
  google: { enabled: google, clientId: "g-id", clientSecret: "g-secret" },
  emailCode: { enabled: emailCode },
});

test("Google is registered only when sign-in settings enable it", () => {
  const on = buildAuthOptions({ site, spotify: null, tidal: null, signin: signin(true, false) });
  expect((on.socialProviders?.google as { scope?: string[] }).scope).toEqual(["openid", "email", "profile"]);
  const off = buildAuthOptions({ site, spotify: null, tidal: null, signin: signin(false, true), mailConfigured: true });
  expect(Object.keys(off.socialProviders ?? {})).not.toContain("google");
});

test("email-otp plugin only when email codes are on and mail is configured", () => {
  const ids = (emailCode: boolean, mailConfigured: boolean) =>
    buildAuthOptions({ site, spotify: null, tidal: null, signin: signin(false, emailCode), mailConfigured }).plugins?.map((p) => p.id) ?? [];
  expect(ids(true, true)).toContain("email-otp");
  expect(ids(true, false)).not.toContain("email-otp");
  expect(ids(false, true)).not.toContain("email-otp");
});

test("Spotify and TIDAL cannot sign up", () => {
  const opts = buildAuthOptions({ site, spotify: spotifyOn, tidal: tidalOn });
  expect(opts.socialProviders?.spotify).toMatchObject({ disableSignUp: true, disableImplicitSignUp: true });
  const generic = opts.plugins?.find((p) => p.id === "generic-oauth") as unknown as { options?: { config: { disableSignUp?: boolean }[] } };
  expect(generic.options?.config[0]).toMatchObject({ disableSignUp: true, disableImplicitSignUp: true });
});

test("getEnabledProviders lists providers with a client id", async () => {
  await setSetting("spotify", spotifyOn);
  await setSetting("tidal", { ...tidalOn, clientId: "" });
  expect(await getEnabledProviders()).toEqual(["spotify"]);
});

test("getAuth returns a cached instance until settings change", async () => {
  await setSetting("site", site);
  await setSetting("spotify", spotifyOn);
  const a = await getAuth();
  expect(await getAuth()).toBe(a);
  await setSetting("tidal", tidalOn);
  expect(await getAuth()).not.toBe(a);
});

test("first user may sign up even when sign-ups are closed", async () => {
  await setSetting("site", site);
  await setSetting("install", { status: "complete", completedStep: 6 });
  await expect(assertSignupAllowed()).resolves.toBeUndefined();
});

test("sign-up rejected when allowSignups is false after install", async () => {
  await setSetting("site", site);
  await setSetting("install", { status: "complete", completedStep: 6 });
  await createUser();
  await expect(assertSignupAllowed()).rejects.toBeInstanceOf(SignupsClosedError);
  await expect(assertSignupAllowed()).rejects.toThrow("Sign-ups are closed. Ask the admin to open them.");
});

test("sign-up allowed when allowSignups is true", async () => {
  await setSetting("site", { ...site, allowSignups: true });
  await setSetting("install", { status: "complete", completedStep: 6 });
  await createUser();
  await expect(assertSignupAllowed()).resolves.toBeUndefined();
});

test("user.create.after hook creates UserSettings with the profile email", async () => {
  const opts = buildAuthOptions({ site, spotify: spotifyOn, tidal: null });
  const user = await createUser({ email: "fan@example.com" });
  await opts.databaseHooks!.user!.create!.after!(user as never, null);
  const s = await prisma.userSettings.findUniqueOrThrow({ where: { userId: user.id } });
  expect(s.digestEmail).toBe("fan@example.com");
  expect(s.digestEnabled).toBe(true);
});

test("placeholder emails from providers without email are not used for the digest", async () => {
  const opts = buildAuthOptions({ site, spotify: null, tidal: tidalOn });
  const user = await createUser({ email: "tidal-123@users.noreply.invalid" });
  await opts.databaseHooks!.user!.create!.after!(user as never, null);
  const s = await prisma.userSettings.findUniqueOrThrow({ where: { userId: user.id } });
  expect(s.digestEmail).toBeNull();
});
