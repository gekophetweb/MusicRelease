# Suggestion box — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in users send ideas/problems; admins read them on Admin → Suggestions, mark them done, and get an email per new one when mail works.

**Architecture:** One Prisma model plus a small domain module `src/suggestions/suggestions.ts` that owns validation, rate limiting, admin notification and status changes. Thin server actions and two pages sit on top; the header shows the link and an open-count badge for admins.

**Tech Stack:** Next.js 16 server components/actions, Prisma 7 / PostgreSQL, zod, vitest + msw.

**Spec:** `docs/superpowers/specs/2026-11-13-suggestion-box-design.md`

## Global Constraints

- `kind`: `"idea" | "problem"`; `message`: trimmed, 1–2000 chars; `page`: same-site path starting with `/` (not `//`), max 200, else dropped.
- `status`: `"open" | "done"` (default open), `doneAt` set when done, cleared on reopen.
- Limit: 10 per user per rolling hour → `You've sent a lot of suggestions in the last hour. Try again later.`
- Success copy: `Thanks! The admin will read this.`
- Admin email subject: `New idea from <name>` / `New problem from <name>` (name falls back to email); to every admin whose email is not a placeholder; mail errors never fail a submit.
- Admin page: Open newest first; Done latest 50. Admin-only (404 otherwise).
- Tests use the throwaway DB: `npm run test:db`, `DATABASE_URL=postgresql://test:test@127.0.0.1:54329/test npx prisma migrate deploy`, `npx vitest run`; `docker stop music-releases-testdb` after.

## Review Focus

1. **Mail is down or not configured** → suggestion still saved, user sees success. Test in Task 1.
2. **`?from=` with an external or protocol-relative URL** (`https://evil.example`, `//evil.example`) → page stored as null. Test in Task 1.
3. **Whitespace-only message** → rejected, nothing stored. Test in Task 1.
4. **Admin with a placeholder email** → gets no mail; other admins do. Test in Task 1.
5. **Non-admin calls the status action directly** → refused (404 via `requireAdmin`), status unchanged. Covered by `requireAdmin` in the action (Task 3); domain test asserts `setSuggestionStatus` only changes the given id.

---

### Task 1: Model, migration and domain module

**Files:**
- Modify: `prisma/schema.prisma` (model `Suggestion`, relation on `User`)
- Create: `prisma/migrations/<timestamp>_suggestions/migration.sql` (via `npx prisma migrate dev --name suggestions --create-only` against the test DB, then reviewed)
- Create: `src/suggestions/suggestions.ts`
- Test: `tests/suggestions/suggestions.test.ts`

**Interfaces:**
- Produces:
  - Prisma `Suggestion { id String @id @default(cuid()); userId String; user User @relation(onDelete: Cascade); kind String; message String; page String?; status String @default("open"); createdAt DateTime @default(now()); doneAt DateTime?; @@index([status, createdAt]) }`; `User.suggestions Suggestion[]`.
  - `type SuggestionKind = "idea" | "problem"`
  - `safePagePath(input: unknown): string | null`
  - `createSuggestion(userId: string, input: { kind: unknown; message: unknown; page?: unknown }, now?: Date): Promise<{ ok: true } | { ok: false; error: string }>` — validates, enforces the hourly limit, stores, then `notifyAdmins` (errors caught and logged).
  - `notifyAdmins(s: { kind: SuggestionKind; message: string; page: string | null; fromName: string }): Promise<void>` — skips when `isMailConfigured(getSetting("mail"))` is false; link uses `site.publicUrl + "/admin/suggestions"`.
  - `listSuggestions(): Promise<{ open: SuggestionRow[]; done: SuggestionRow[] }>` with `SuggestionRow { id; kind; message; page; status; createdAt; doneAt; from: string }` (`from` = user name, else non-placeholder email, else `"Someone"`).
  - `countOpenSuggestions(): Promise<number>`
  - `setSuggestionStatus(id: string, status: "open" | "done", now?: Date): Promise<void>`
  - Validation errors: kind → `Choose idea or problem`; empty → `Write a message`; too long → `Keep it under 2000 characters`.

- [ ] **Step 1: Write failing tests** (`tests/suggestions/suggestions.test.ts`, msw for Resend, `site` + Resend mail in `beforeEach`):
  - `"stores a trimmed idea with a safe page"` → `createSuggestion(u.id, { kind: "idea", message: "  More filters  ", page: "/releases?since=30" })` ok; row has `message "More filters"`, `page "/releases?since=30"`, `status "open"`.
  - `"drops unsafe pages"` → `safePagePath("https://evil.example")`, `("//evil.example")`, `("releases")`, `("/" + "a".repeat(250))` all `null`; `safePagePath("/artists")` is `"/artists"`.
  - `"rejects a whitespace-only message, a bad kind and a too-long message"` → the three error strings; `suggestion.count()` 0.
  - `"limits a user to 10 per hour"` → 10 ok, 11th returns the limit message; with `now` 61 minutes later ok again.
  - `"emails admins with real addresses only"` → admins `a@example.com` and a placeholder email, plus a normal user; captured Resend bodies: exactly one, `to ["a@example.com"]`, subject `New problem from <name>`, text contains message and `/admin/suggestions`.
  - `"saves even when mail fails"` → Resend handler returns 500; `createSuggestion` ok; count 1.
  - `"saves without mail configured and sends nothing"`.
  - `"lists open newest first and done latest 50"` and `"setSuggestionStatus marks done and reopens only that id"` (doneAt set, then null; another row untouched).
- [ ] **Step 2: Run** `npx vitest run tests/suggestions` → FAIL (module missing).
- [ ] **Step 3: Implement** schema change, generate the migration with `--create-only` against the test DB and check it only creates `Suggestion` (+ index, FK), run `npx prisma generate`, then the module.
- [ ] **Step 4: Run** `npx vitest run tests/suggestions` → PASS; full suite → PASS.
- [ ] **Step 5: Commit** — `feat(suggestions): model and domain logic for the suggestion box`

---

### Task 2: Suggestion form for users

**Files:**
- Create: `src/app/suggestions/page.tsx`, `src/app/suggestions/actions.ts`, `src/app/suggestions/SuggestionForm.tsx` (client, `useActionState`)
- Modify: `src/components/AppHeader.tsx` (link `Suggestions` → `/suggestions?from=<path of current>`; `current` gains `"suggestions"`)

**Interfaces:**
- Consumes: `createSuggestion`, `safePagePath` (Task 1); `requireUser`.
- Produces: server action `sendSuggestion(prev: SuggestionState, form: FormData): Promise<SuggestionState>` with `SuggestionState = { ok?: boolean; error?: string }`; page reads `searchParams.from` through `safePagePath` into a hidden `page` input.
- Header `from` paths per `current`: releases `/releases`, artists `/artists`, settings `/settings`, admin `/admin/settings`.

- [ ] **Step 1: Typecheck/lint gate** — `npx tsc --noEmit -p .` and `npx eslint src` clean.
- [ ] **Step 2: Browser check** — done together with Task 3 Step 2 (same seeded test DB).
- [ ] **Step 3: Commit** — `feat(suggestions): suggestion form for signed-in users`

---

### Task 3: Admin page, badge, docs

**Files:**
- Create: `src/app/admin/suggestions/page.tsx`, `src/app/admin/suggestions/actions.ts`
- Modify: `src/components/AppHeader.tsx` (async; for admins show `countOpenSuggestions()` as a small badge on the Admin link when > 0), `src/app/admin/settings/page.tsx` and `src/app/admin/users/page.tsx` (nav link `Suggestions`), `README.md` (one short "Suggestions" paragraph)

**Interfaces:**
- Consumes: `listSuggestions`, `countOpenSuggestions`, `setSuggestionStatus` (Task 1); `requireAdmin`.
- Produces: server action `markSuggestion(form: FormData): Promise<void>` reading `id` and `status`, calling `requireAdmin()` first, then `revalidatePath("/admin/suggestions")`.

- [ ] **Step 1: Typecheck/lint gate** → clean; full suite → PASS.
- [ ] **Step 2: Browser check** on a seeded test DB: user sends an idea from Releases (page `/releases` shown on the admin page), success message shows; admin sees badge `1`, marks Done (moves to Done, badge gone), Reopen works; signed-out `/admin/suggestions` → 404.
- [ ] **Step 3: Commit** — `feat(admin): Suggestions page with open count`
