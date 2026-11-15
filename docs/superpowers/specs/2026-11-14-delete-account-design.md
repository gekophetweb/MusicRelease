# Delete account

Status: awaiting approval · 2026-11-14 · size: small change

## Intent

A person's account and everything that belongs to it can be removed, either by the person themselves or by an admin
(cleanup, test accounts, "please forget me" requests).

## Goals / non-goals / anti-goals

- Goals: "Delete my account" in Settings; a delete button per user in Admin → Users; both remove the user and all
  their personal data.
- Non-goals: soft delete / undo, a grace period, data export, email confirmation of the deletion.
- Anti-goals: the site ending up with no admin; other people's suggestion threads losing messages; personal rows
  left behind in tables that don't link to the user.

## Decided by the owner

- The **last admin cannot delete** their account (refused with a message: make someone else admin first).
- Replies by a deleted user **stay**, shown as **"[deleted user]"**.
- Both the user (Settings) and an admin (Admin → Users) can start it.

## Approaches

- **A. Database cleans up (chosen).** Add foreign keys with `onDelete: Cascade` from `UserArtist`, `UserSettings`
  and `SyncRun` to `User`; `SuggestionReply.authorId` becomes optional with `onDelete: SetNull`. Deleting the user
  row then removes everything, and future tables follow the same pattern.
- B. Delete each table in code: smaller migration, but a later table is easily forgotten. Rejected.
- C. Better Auth's built-in delete-user: only covers self-service, cleanup would live in hooks, two paths. Rejected.

## Design

- **Migration:** first delete orphan rows in `UserArtist`, `UserSettings`, `SyncRun` (userId without a user), then
  add the foreign keys. `SyncRun.userId` stays nullable (system runs have none) and cascades when set.
  `SuggestionReply.authorId` → nullable, `ON DELETE SET NULL`.
- **`deleteAccount(userId)`** in `src/admin/users.ts` (shared by both buttons), one transaction:
  1. if the user is an admin and the only admin → `{ ok: false, error }`;
  2. delete the user (sessions, accounts/tokens, followed artists, settings, sync runs, own suggestions with their
     whole threads all go; their replies elsewhere keep, author cleared);
  3. delete artists that nobody follows anymore (their releases cascade via `ReleaseArtist`; releases left without
     any artist are deleted too).
- **Replies display:** a reply with no author shows "[deleted user]", not marked admin, not "mine".
- **Settings page:** a "Delete account" section at the bottom, in the danger color. Explains what is removed; the
  person types `DELETE` to enable the button. On success their session is gone and they land on `/` signed out.
- **Admin → Users:** a red "Delete" button per row, behind a confirm dialog naming the user. Hidden on the admin's
  own row (they use Settings). Last-admin refusal shows inline.
- **Tests:** `deleteAccount` removes all personal rows, keeps others' data, anonymizes replies, cleans orphaned
  artists but keeps shared ones, and refuses the last admin.

## Left to the builder (my calls, owner can overrule)

- A user's own suggestions are deleted with their thread (admin replies included) — nobody is left to answer it.
- Confirmation by typing `DELETE` for self-service; a simple confirm for admins.
