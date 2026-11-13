import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { setSetting } from "@/lib/settings";
import { resetDb } from "../helpers/db";
import { createAccount, createUser, site } from "../helpers/factories";
import { artist, follow } from "../helpers/releases";

const sent: { to: string; code: string }[] = [];
vi.mock("@/mail/signin-code", () => ({
  sendSignInCode: async (to: string, code: string) => {
    sent.push({ to, code });
  },
}));

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
  await setSetting("site", site);
  await setSetting("install", { status: "complete", completedStep: 7 });
  await setSetting("signin", { google: { enabled: false, clientId: "", clientSecret: "" }, emailCode: { enabled: true } });
  await setSetting("mail", { provider: "resend", from: { email: "music@example.com" }, apiKey: "re_test" });
});

/** The email-otp endpoints; plugins are picked at runtime, so the generic Auth type doesn't list them. */
interface OtpApi {
  sendVerificationOTP(a: { body: { email: string; type: "sign-in" } }): Promise<unknown>;
  signInEmailOTP(a: { body: { email: string; otp: string } }): Promise<{ user: { id: string; email: string } }>;
}

async function requestCode(email: string) {
  const auth = (await getAuth()) as unknown as { api: OtpApi };
  await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
  return auth;
}

test("an email code signs in an existing user, case-insensitively", async () => {
  const u = await createUser({ email: "fan@example.com" });
  await follow(u.id, (await artist("spotify", "a")).id);
  const auth = await requestCode("Fan@Example.com");
  expect(sent).toHaveLength(1);
  const res = await auth.api.signInEmailOTP({ body: { email: "Fan@Example.com", otp: sent[0].code } });
  expect(res.user.id).toBe(u.id);
  expect(await prisma.userArtist.count({ where: { userId: u.id } })).toBe(1);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).emailVerified).toBe(true);
});

test("with sign-ups closed, an unknown email gets no code and no account", async () => {
  await createUser({ email: "admin@example.com" });
  const auth = await requestCode("new@example.com");
  expect(sent).toHaveLength(0);
  await expect(auth.api.signInEmailOTP({ body: { email: "new@example.com", otp: "000000" } })).rejects.toThrow();
  expect(await prisma.user.count()).toBe(1);
});

test("with sign-ups open, an unknown email gets a code and an account", async () => {
  await setSetting("site", { ...site, allowSignups: true });
  await createUser({ email: "admin@example.com" });
  const auth = await requestCode("new@example.com");
  expect(sent).toHaveLength(1);
  const res = await auth.api.signInEmailOTP({ body: { email: "new@example.com", otp: sent[0].code } });
  expect(res.user.email).toBe("new@example.com");
});

test("after five wrong codes the right one is rejected too", async () => {
  await createUser({ email: "fan@example.com" });
  const auth = await requestCode("fan@example.com");
  const wrong = sent[0].code === "111111" ? "222222" : "111111";
  for (let i = 0; i < 5; i++) {
    await expect(auth.api.signInEmailOTP({ body: { email: "fan@example.com", otp: wrong } })).rejects.toThrow();
  }
  await expect(auth.api.signInEmailOTP({ body: { email: "fan@example.com", otp: sent[0].code } })).rejects.toThrow();
});

test("first code sign-in of an unverified legacy account keeps its data but drops unproven connections", async () => {
  // better-auth strips links that predate proof of the email (they could belong to whoever typed that email into
  // Spotify). Followed artists and settings stay; the user reconnects Spotify once.
  const u = await createUser({ email: "fan@example.com" });
  await createAccount(u.id, "spotify");
  await follow(u.id, (await artist("spotify", "a")).id);
  const auth = await requestCode("fan@example.com");
  const res = await auth.api.signInEmailOTP({ body: { email: "fan@example.com", otp: sent[0].code } });
  expect(res.user.id).toBe(u.id);
  expect(await prisma.user.count()).toBe(1);
  expect(await prisma.userArtist.count({ where: { userId: u.id } })).toBe(1);
  expect(await prisma.account.count({ where: { userId: u.id, providerId: "spotify" } })).toBe(0);
});

test("a verified account keeps its Spotify connection on code sign-in", async () => {
  const u = await createUser({ email: "fan@example.com" });
  await prisma.user.update({ where: { id: u.id }, data: { emailVerified: true } });
  await createAccount(u.id, "spotify");
  const auth = await requestCode("fan@example.com");
  await auth.api.signInEmailOTP({ body: { email: "fan@example.com", otp: sent[0].code } });
  expect(await prisma.account.count({ where: { userId: u.id, providerId: "spotify" } })).toBe(1);
});
