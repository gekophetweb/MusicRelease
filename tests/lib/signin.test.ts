import { availableMethods } from "@/lib/signin";

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
