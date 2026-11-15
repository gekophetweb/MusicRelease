import { deleteAccount, LAST_ADMIN_ERROR, listUsers, setUserEmail } from "@/admin/users";
import { PLACEHOLDER_EMAIL_DOMAIN } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resetDb } from "../helpers/db";
import { createAccount, createUser } from "../helpers/factories";
import { artist, follow, release } from "../helpers/releases";

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

describe("deleteAccount", () => {
  async function counts(userId: string) {
    const [user, account, session, settings, followed, syncRuns, suggestions] = await Promise.all([
      prisma.user.count({ where: { id: userId } }),
      prisma.account.count({ where: { userId } }),
      prisma.session.count({ where: { userId } }),
      prisma.userSettings.count({ where: { userId } }),
      prisma.userArtist.count({ where: { userId } }),
      prisma.syncRun.count({ where: { userId } }),
      prisma.suggestion.count({ where: { userId } }),
    ]);
    return { user, account, session, settings, followed, syncRuns, suggestions };
  }

  test("removes the user and all their personal data", async () => {
    await createUser({ role: "admin" });
    const u = await createUser();
    const other = await createUser();
    await createAccount(u.id, "spotify");
    await prisma.session.create({ data: { id: "s1", token: "t1", userId: u.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    await prisma.userSettings.create({ data: { userId: u.id, digestEmail: "u@example.com" } });
    await prisma.syncRun.create({ data: { userId: u.id } });
    const a = await artist("spotify", "a1");
    await follow(u.id, a.id);
    const s = await prisma.suggestion.create({ data: { userId: u.id, kind: "idea", message: "x" } });
    await prisma.suggestionReply.create({ data: { suggestionId: s.id, authorId: other.id, message: "reply" } });

    expect(await deleteAccount(u.id)).toEqual({ ok: true });
    expect(await counts(u.id)).toEqual({ user: 0, account: 0, session: 0, settings: 0, followed: 0, syncRuns: 0, suggestions: 0 });
    expect(await prisma.suggestionReply.count()).toBe(0);
    expect(await prisma.user.count({ where: { id: other.id } })).toBe(1);
  });

  test("keeps their replies in other threads, author cleared", async () => {
    const owner = await createUser();
    const u = await createUser();
    const s = await prisma.suggestion.create({ data: { userId: owner.id, kind: "idea", message: "x" } });
    await prisma.suggestionReply.create({ data: { suggestionId: s.id, authorId: u.id, message: "me too" } });
    expect(await deleteAccount(u.id)).toEqual({ ok: true });
    expect(await prisma.suggestionReply.findFirstOrThrow()).toMatchObject({ message: "me too", authorId: null });
  });

  test("prunes artists nobody follows, keeps shared ones", async () => {
    const u = await createUser();
    const other = await createUser();
    const only = await artist("spotify", "only");
    const shared = await artist("spotify", "shared");
    await follow(u.id, only.id);
    await follow(u.id, shared.id);
    await follow(other.id, shared.id);
    const r1 = await release("spotify", "r1", [only.id]);
    const r2 = await release("spotify", "r2", [only.id, shared.id]);

    const unrelated = await artist("spotify", "mid-sync"); // e.g. created by someone else's running sync

    expect(await deleteAccount(u.id)).toEqual({ ok: true });
    expect((await prisma.artist.findMany({ select: { id: true }, orderBy: { name: "asc" } })).map((a) => a.id).sort()).toEqual(
      [shared.id, unrelated.id].sort(),
    );
    expect(await prisma.release.count({ where: { id: r1.id } })).toBe(0);
    expect(await prisma.release.count({ where: { id: r2.id } })).toBe(1);
  });

  test("refuses the last admin", async () => {
    const admin = await createUser({ role: "admin" });
    await createUser();
    expect(await deleteAccount(admin.id)).toEqual({ ok: false, error: LAST_ADMIN_ERROR });
    expect(await prisma.user.count({ where: { id: admin.id } })).toBe(1);
  });

  test("allows deleting an admin when another admin exists", async () => {
    const a1 = await createUser({ role: "admin" });
    await createUser({ role: "admin" });
    expect(await deleteAccount(a1.id)).toEqual({ ok: true });
  });

  test("on an unknown id returns an error", async () => {
    expect(await deleteAccount("nope")).toEqual({ ok: false, error: "User not found" });
  });
});
