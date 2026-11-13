import { setSetting } from "@/lib/settings";
import { availableMethods, getSignInMethods } from "@/lib/signin";
import { resetDb } from "../helpers/db";
import { site } from "../helpers/factories";

const google = (enabled: boolean, clientId = "g-id") => ({ enabled, clientId, clientSecret: "g-secret" });

test.each([
  ["google on with a client id", { google: google(true), emailCode: { enabled: false } }, false, { google: true, emailCode: false }],
  ["google on without a client id", { google: google(true, ""), emailCode: { enabled: false } }, false, { google: false, emailCode: false }],
  ["email codes on, no mail", { google: google(false), emailCode: { enabled: true } }, false, { google: false, emailCode: false }],
  ["email codes on, mail configured", { google: google(false), emailCode: { enabled: true } }, true, { google: false, emailCode: true }],
  ["no sign-in settings", null, true, { google: false, emailCode: false }],
] as const)("availableMethods: %s", (_name, signin, mailConfigured, expected) => {
  expect(availableMethods(signin, mailConfigured)).toEqual(expected);
});

describe("getSignInMethods on a database", () => {
  beforeEach(resetDb);
  const resend = { provider: "resend" as const, from: { email: "music@example.com" }, apiKey: "re_test" };

  test("an installed site from before sign-in settings existed defaults to email codes", async () => {
    await setSetting("site", site);
    await setSetting("install", { status: "complete", completedStep: 6 });
    await setSetting("mail", resend);
    expect(await getSignInMethods()).toEqual({ google: false, emailCode: true });
  });

  test("mail settings for a removed provider don't count as configured mail", async () => {
    await setSetting("install", { status: "complete", completedStep: 6 });
    await setSetting("mail", { provider: "sender", from: { email: "m@example.com" }, apiToken: "t" } as never);
    expect(await getSignInMethods()).toEqual({ google: false, emailCode: false });
  });

  test("during setup there is no default", async () => {
    await setSetting("mail", resend);
    expect(await getSignInMethods()).toEqual({ google: false, emailCode: false });
  });
});
