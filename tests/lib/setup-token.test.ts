import { setSetting } from "@/lib/settings";
import { ensureSetupToken, verifySetupToken } from "@/lib/setup-token";
import { resetDb } from "../helpers/db";

beforeEach(async () => {
  await resetDb();
  delete process.env.INSTALL_TOKEN;
});

test("ensureSetupToken returns the same token on repeated calls", async () => {
  const a = await ensureSetupToken();
  const b = await ensureSetupToken();
  expect(a).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){5}$/);
  expect(b).toBe(a);
});

test("ensureSetupToken uses INSTALL_TOKEN when set", async () => {
  process.env.INSTALL_TOKEN = "my-own-token";
  expect(await ensureSetupToken()).toBe("my-own-token");
});

test("ensureSetupToken returns null once installed", async () => {
  await setSetting("install", { status: "complete", completedStep: 6 });
  expect(await ensureSetupToken()).toBeNull();
});

test("verifySetupToken accepts the token and rejects others", async () => {
  const token = (await ensureSetupToken())!;
  expect(await verifySetupToken(token)).toBe(true);
  expect(await verifySetupToken(token.toLowerCase())).toBe(true);
  expect(await verifySetupToken("WRONG-TOKEN")).toBe(false);
  expect(await verifySetupToken("")).toBe(false);
});

test("verifySetupToken is false when installed", async () => {
  const token = (await ensureSetupToken())!;
  await setSetting("install", { status: "complete", completedStep: 6 });
  expect(await verifySetupToken(token)).toBe(false);
});
