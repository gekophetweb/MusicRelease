import { prisma } from "@/lib/db";
import { getValidAccessToken, ReconnectRequiredError } from "@/lib/tokens";
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

test("refresh failure marks account needsReconnect and throws", async () => {
  const u = await createUser({ id: "u1" });
  await createAccount(u.id, "spotify");
  mockGetAccessToken.mockRejectedValue(new Error("invalid_grant"));
  const err = await getValidAccessToken("u1", "spotify").catch((e) => e);
  expect(err).toBeInstanceOf(ReconnectRequiredError);
  expect(err.provider).toBe("spotify");
  expect(err.userId).toBe("u1");
  const acc = await prisma.account.findFirst({ where: { userId: "u1", providerId: "spotify" } });
  expect(acc?.needsReconnect).toBe(true);
});

test("missing account throws ReconnectRequiredError", async () => {
  await createUser({ id: "u1" });
  await expect(getValidAccessToken("u1", "tidal")).rejects.toBeInstanceOf(ReconnectRequiredError);
});

test("empty token from Better Auth counts as a failure", async () => {
  const u = await createUser({ id: "u1" });
  await createAccount(u.id, "spotify");
  mockGetAccessToken.mockResolvedValue({ accessToken: undefined });
  await expect(getValidAccessToken("u1", "spotify")).rejects.toBeInstanceOf(ReconnectRequiredError);
});
