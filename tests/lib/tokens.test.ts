import { prisma } from "@/lib/db";
import { getValidAccessToken, ReconnectRequiredError, TokenUnavailableError } from "@/lib/tokens";
import { resetDb } from "../helpers/db";
import { createAccount, createUser } from "../helpers/factories";

const mockGetAccessToken = vi.fn();
vi.mock("@/lib/auth", () => ({
  getAuth: async () => ({ api: { getAccessToken: mockGetAccessToken } }),
}));

beforeEach(async () => {
  await resetDb();
  mockGetAccessToken.mockReset();
});

test("returns token from Better Auth for the user's account", async () => {
  const u = await createUser({ id: "u1" });
  const acc = await createAccount(u.id, "spotify");
  mockGetAccessToken.mockResolvedValue({ accessToken: "abc" });
  expect(await getValidAccessToken("u1", "spotify")).toBe("abc");
  expect(mockGetAccessToken).toHaveBeenCalledWith({ body: { accountId: acc.id, userId: "u1" } });
});

test("a single refresh failure is temporary: no reconnect flag", async () => {
  const u = await createUser({ id: "u1" });
  await createAccount(u.id, "spotify");
  mockGetAccessToken.mockRejectedValue(new Error("Failed to get a valid access token"));
  await expect(getValidAccessToken("u1", "spotify")).rejects.toBeInstanceOf(TokenUnavailableError);
  const acc = await prisma.account.findFirstOrThrow({ where: { userId: "u1" } });
  expect(acc.needsReconnect).toBe(false);
  expect(acc.tokenFailures).toBe(1);
});

test("repeated refresh failures over 12+ hours mark the account for reconnect", async () => {
  const u = await createUser({ id: "u1" });
  const acc = await createAccount(u.id, "spotify");
  await prisma.account.update({ where: { id: acc.id }, data: { tokenFailures: 2, tokenFailedSince: new Date(Date.now() - 13 * 3600_000) } });
  mockGetAccessToken.mockRejectedValue(new Error("invalid_grant"));
  const err = await getValidAccessToken("u1", "spotify").catch((e) => e);
  expect(err).toBeInstanceOf(ReconnectRequiredError);
  expect(err.provider).toBe("spotify");
  expect(err.userId).toBe("u1");
  expect((await prisma.account.findFirstOrThrow({ where: { userId: "u1" } })).needsReconnect).toBe(true);
});

test("many failures within a few minutes (an outage) do not mark the account", async () => {
  const u = await createUser({ id: "u1" });
  await createAccount(u.id, "spotify");
  mockGetAccessToken.mockRejectedValue(new Error("fetch failed"));
  for (let i = 0; i < 5; i++) await getValidAccessToken("u1", "spotify").catch(() => {});
  expect((await prisma.account.findFirstOrThrow({ where: { userId: "u1" } })).needsReconnect).toBe(false);
});

test("a success resets the failure count", async () => {
  const u = await createUser({ id: "u1" });
  const acc = await createAccount(u.id, "spotify");
  await prisma.account.update({ where: { id: acc.id }, data: { tokenFailures: 2, tokenFailedSince: new Date() } });
  mockGetAccessToken.mockResolvedValue({ accessToken: "ok" });
  await getValidAccessToken("u1", "spotify");
  const after = await prisma.account.findFirstOrThrow({ where: { userId: "u1" } });
  expect([after.tokenFailures, after.tokenFailedSince]).toEqual([0, null]);
});

test("missing account throws ReconnectRequiredError", async () => {
  await createUser({ id: "u1" });
  await expect(getValidAccessToken("u1", "tidal")).rejects.toBeInstanceOf(ReconnectRequiredError);
});

test("empty token from Better Auth counts as a failure", async () => {
  const u = await createUser({ id: "u1" });
  await createAccount(u.id, "spotify");
  mockGetAccessToken.mockResolvedValue({ accessToken: undefined });
  await expect(getValidAccessToken("u1", "spotify")).rejects.toBeInstanceOf(TokenUnavailableError);
});
