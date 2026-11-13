import { prisma } from "@/lib/db";
import { getUserSettings, saveUserSettings } from "@/lib/user-settings";
import { resetDb } from "../helpers/db";
import { createUser } from "../helpers/factories";

beforeEach(resetDb);

test("saves digest email and on/off", async () => {
  const u = await createUser();
  expect(await saveUserSettings(u.id, { digestEmail: " fan@example.com ", digestEnabled: false })).toEqual({ ok: true });
  expect(await prisma.userSettings.findUniqueOrThrow({ where: { userId: u.id } })).toMatchObject({
    digestEmail: "fan@example.com",
    digestEnabled: false,
  });
});

test("rejects an invalid email", async () => {
  const u = await createUser();
  const res = await saveUserSettings(u.id, { digestEmail: "nope", digestEnabled: true });
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.errors.digestEmail).toBeDefined();
});

test("an empty email is allowed and stored as null", async () => {
  const u = await createUser();
  await saveUserSettings(u.id, { digestEmail: "", digestEnabled: true });
  expect((await getUserSettings(u.id)).digestEmail).toBeNull();
});

test("getUserSettings creates defaults for users without a row", async () => {
  const u = await createUser();
  expect(await getUserSettings(u.id)).toMatchObject({ digestEnabled: true, digestEmail: null });
});
