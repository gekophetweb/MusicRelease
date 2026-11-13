import { listUsers, setUserEmail } from "@/admin/users";
import { PLACEHOLDER_EMAIL_DOMAIN } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resetDb } from "../helpers/db";
import { createAccount, createUser } from "../helpers/factories";

beforeEach(resetDb);

const placeholder = (id: string) => `tidal-${id}@${PLACEHOLDER_EMAIL_DOMAIN}`;

test("lists placeholder-email users first with their services", async () => {
  const a = await createUser({ email: "a@example.com" });
  const p = await createUser({ email: placeholder("1") });
  await createAccount(p.id, "tidal");
  await createAccount(a.id, "spotify");
  const rows = await listUsers();
  expect(rows.map((r) => r.id)).toEqual([p.id, a.id]);
  expect(rows[0]).toMatchObject({ email: null, services: ["tidal"] });
  expect(rows[1]).toMatchObject({ email: "a@example.com", services: ["spotify"] });
});

test("setUserEmail stores lowercase and unverified", async () => {
  const u = await createUser({ email: placeholder("2") });
  await prisma.user.update({ where: { id: u.id }, data: { emailVerified: true } });
  expect(await setUserEmail(u.id, "  New@Example.com ")).toEqual({ ok: true });
  const saved = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
  expect(saved.email).toBe("new@example.com");
  expect(saved.emailVerified).toBe(false);
});

test("setUserEmail refuses an email another user has, ignoring case", async () => {
  await createUser({ email: "taken@example.com" });
  const u = await createUser({ email: placeholder("3") });
  expect(await setUserEmail(u.id, "Taken@Example.com")).toEqual({ ok: false, error: "Another account already uses this email" });
});

test("setUserEmail refuses an invalid email", async () => {
  const u = await createUser();
  expect(await setUserEmail(u.id, "not-an-email")).toEqual({ ok: false, error: "Enter a valid email" });
});

test("setUserEmail fills an empty or placeholder digest address but keeps a custom one", async () => {
  const empty = await createUser({ email: placeholder("4") });
  await prisma.userSettings.create({ data: { userId: empty.id, digestEmail: null } });
  const custom = await createUser({ email: placeholder("5") });
  await prisma.userSettings.create({ data: { userId: custom.id, digestEmail: "inbox@example.com" } });
  await setUserEmail(empty.id, "e@example.com");
  await setUserEmail(custom.id, "c@example.com");
  expect((await prisma.userSettings.findUniqueOrThrow({ where: { userId: empty.id } })).digestEmail).toBe("e@example.com");
  expect((await prisma.userSettings.findUniqueOrThrow({ where: { userId: custom.id } })).digestEmail).toBe("inbox@example.com");
});
