# Delete Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user (from Settings) or an admin (from Admin → Users) delete an account and all its personal data.

**Architecture:** Foreign keys with cascade make the database remove every row tied to a user; replies get their
author cleared instead. One `deleteAccount(userId)` in `src/admin/users.ts` enforces the last-admin rule, deletes
the user and prunes artists nobody follows. Two server actions and two small client components call it.

**Tech Stack:** Next.js (app router, server actions), Prisma + PostgreSQL, Better Auth, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-14-delete-account-design.md`

## Global Constraints

- The last admin cannot delete their account. Error copy: `You're the only admin. Make someone else admin first.`
- A reply whose author is deleted shows as `[deleted user]`, `fromAdmin: false`, `mine: false`.
- Self-service confirmation: the person types `DELETE` (exact, case-sensitive) before the button enables.
- The admin's own row in Admin → Users has no Delete button.
- Danger UI uses the existing `text-danger` / `border-danger` tokens.

## Review Focus

- Deleting a user who follows an artist someone else also follows: the artist and its releases must stay (Task 2 test).
- Release with two artists where only one becomes orphaned: the release stays (Task 2 test).
- An admin deleting a *different* admin while two admins exist: allowed (Task 2 test).
- Deleting a user id that no longer exists (double click, stale admin page): returns `{ ok: false }`, no throw (Task 2 test).
- Existing orphan rows in production before the migration: the migration must not fail (Task 1 SQL deletes them first).

---

### Task 1: Schema — cascade links and nullable reply author

**Files:**
- Modify: `prisma/schema.prisma` (models `UserArtist`, `UserSettings`, `SyncRun`, `SuggestionReply`, `User`)
- Create: `prisma/migrations/<timestamp>_delete_account/migration.sql`
- Modify: `src/suggestions/suggestions.ts:213-235` (`getThread` reply mapping)
- Test: `tests/suggestions/suggestions.test.ts`

**Interfaces:**
- Produces: `User.userArtists`, `User.settings`, `User.syncRuns` relations (cascade); `SuggestionReply.authorId String?`, `author User?` with `onDelete: SetNull`.

- [ ] **Step 1: Write the failing test** in `tests/suggestions/suggestions.test.ts`:
  `test("a reply by a deleted user shows as [deleted user]")` — create owner + admin, suggestion by owner, reply by
  admin, `prisma.user.delete({ where: { id: admin.id } })`, then
  `getThread(id, owner)` → `replies[0]` toMatchObject `{ from: "[deleted user]", fromAdmin: false, mine: false }`.
- [ ] **Step 2: Run** `npx vitest run tests/suggestions/suggestions.test.ts` — expected FAIL (reply is cascade-deleted, `replies[0]` undefined).
- [ ] **Step 3: Schema.** Add relations with `onDelete: Cascade`: `UserArtist.user`, `UserSettings.user`,
  `SyncRun.user` (optional, field stays `String?`). `SuggestionReply.authorId String?`, `author User? ... onDelete: SetNull`.
  Back-relations on `User`. Generate with `npx prisma migrate dev --create-only --name delete_account`, then
  prepend to the SQL, before the constraints:
  ```sql
  DELETE FROM "UserArtist" WHERE "userId" NOT IN (SELECT id FROM "user");
  DELETE FROM "UserSettings" WHERE "userId" NOT IN (SELECT id FROM "user");
  DELETE FROM "SyncRun" WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT id FROM "user");
  ```
  Apply with `npx prisma migrate dev`.
- [ ] **Step 4: `getThread`**: when `r.author` is null → `from: "[deleted user]"`, `fromAdmin: false`; `mine` stays `r.authorId === viewer.id`. Fix any other type errors from the nullable author (`npm run typecheck`).
- [ ] **Step 5: Run** `npx vitest run tests/suggestions` and `npm run typecheck` — expected PASS.
- [ ] **Step 6: Commit** `feat(db): cascade user data on delete; keep replies of deleted users`

### Task 2: `deleteAccount`

**Files:**
- Modify: `src/admin/users.ts`
- Test: `tests/admin/users.test.ts`

**Interfaces:**
- Consumes: Task 1 cascades.
- Produces: `deleteAccount(userId: string): Promise<{ ok: true } | { ok: false; error: string }>`; exported const `LAST_ADMIN_ERROR`.

- [ ] **Step 1: Write the failing tests** in `tests/admin/users.test.ts`:
  - `"deleteAccount removes the user and all their personal data"` — user with account, `UserSettings`, `UserArtist`,
    `SyncRun`, session, own suggestion with a reply by someone else → `{ ok: true }`; counts for that userId in
    user/account/session/userSettings/userArtist/syncRun/suggestion all 0, and the other person's reply is gone with the suggestion.
  - `"deleteAccount keeps their replies in other threads, author cleared"` → reply exists with `authorId: null`.
  - `"deleteAccount prunes artists nobody follows, keeps shared ones"` — artist A followed only by the user (with a
    release R1 only by A), artist B followed by both users, release R2 by A and B → A and R1 gone; B and R2 remain.
  - `"deleteAccount refuses the last admin"` → `{ ok: false, error: LAST_ADMIN_ERROR }`, user still exists.
  - `"deleteAccount allows deleting an admin when another admin exists"` → `{ ok: true }`.
  - `"deleteAccount on an unknown id returns an error"` → `{ ok: false, error: "User not found" }`.
- [ ] **Step 2: Run** `npx vitest run tests/admin/users.test.ts` — expected FAIL (`deleteAccount` not exported).
- [ ] **Step 3: Implement** in one `prisma.$transaction`: find user (role); none → `User not found`; admin and
  `count({ role: "admin" }) === 1` → `LAST_ADMIN_ERROR`; `user.delete`; `artist.deleteMany({ where: { followers: { none: {} } } })`;
  `release.deleteMany({ where: { artists: { none: {} } } })`.
- [ ] **Step 4: Run** the test file — expected PASS.
- [ ] **Step 5: Commit** `feat(admin): deleteAccount with last-admin guard and orphan cleanup`

### Task 3: Delete from Settings

**Files:**
- Modify: `src/app/settings/actions.ts`, `src/app/settings/page.tsx`
- Create: `src/app/settings/DeleteAccountForm.tsx` (client)

**Interfaces:**
- Consumes: `deleteAccount`.
- Produces: server action `deleteMyAccount(_prev: DeleteState, form: FormData): Promise<DeleteState>`, `type DeleteState = { error?: string }`.

- [ ] **Step 1: Action** — `requireUser()`; refuse unless `form.get("confirm") === "DELETE"`; call `deleteAccount(user.id)`; on error return it; on success `redirect("/")` (the session row is cascade-deleted, so they're signed out).
- [ ] **Step 2: Form** — `useActionState`; text input `name="confirm"`, label `Type DELETE to confirm`; red button `Delete my account` disabled until the value is exactly `DELETE`; error in `role="alert"`.
- [ ] **Step 3: Page** — last section `Delete account` (heading in `text-danger`), copy: `This removes your account, connected music services, followed artists, weekly email settings and your suggestions. Replies you wrote in other threads stay, shown as [deleted user]. This can't be undone.`
- [ ] **Step 4: Verify** in the preview (`.claude/launch.json`): sign in as a non-admin test user, delete → lands on `/` signed out; as sole admin → error shown. `npm run typecheck && npm run lint` pass.
- [ ] **Step 5: Commit** `feat(settings): let people delete their account`

### Task 4: Delete from Admin → Users

**Files:**
- Modify: `src/app/admin/users/actions.ts`, `src/app/admin/users/page.tsx`
- Create: `src/app/admin/users/DeleteUserButton.tsx` (client)

**Interfaces:**
- Consumes: `deleteAccount`.
- Produces: server action `deleteUser(_prev: DeleteUserState, form: FormData): Promise<DeleteUserState>`, `type DeleteUserState = { error?: string }`.

- [ ] **Step 1: Action** — `requireAdmin()`; refuse when `userId === admin.id` (`Use Settings to delete your own account`); `deleteAccount`; `revalidatePath("/admin/users")`.
- [ ] **Step 2: Button** — red `Delete` button; `confirm(\`Delete ${name || "this user"} and all their data? This can't be undone.\`)` before submit; error shown inline.
- [ ] **Step 3: Page** — pass `adminId` into `UserRow`; render `DeleteUserButton` unless `u.id === adminId`.
- [ ] **Step 4: Verify** in the preview: delete a test user → row disappears; own row has no button. `npm run typecheck && npm run lint && npm test` pass.
- [ ] **Step 5: Commit** `feat(admin): delete users from the user list`
