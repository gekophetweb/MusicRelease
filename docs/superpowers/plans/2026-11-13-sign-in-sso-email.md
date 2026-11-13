# Sign-in with Google or email code — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People sign in with Google or a mailed 6-digit code; Spotify/TIDAL become connect-only services; setup gets a Sign-in step; admins can set emails on Admin → Users.

**Architecture:** better-auth's built-in Google social provider and `emailOTP` plugin are added to `buildAuthOptions`; Spotify/TIDAL keep their providers but with sign-up disabled and are only reached through `linkSocial`. A new encrypted `signin` setting drives which methods exist; a small `src/lib/signin.ts` module answers "which methods work right now" and guards against lock-out.

**Tech Stack:** Next.js 16 (App Router), better-auth (social providers, `generic-oauth`, `email-otp`), Prisma 7 / PostgreSQL, zod, vitest + msw.

**Spec:** `docs/superpowers/specs/2026-11-13-sign-in-sso-email-design.md`

## Global Constraints

- Email code: `otpLength: 6`, `expiresIn: 600` (10 minutes), `allowedAttempts: 5`.
- Code email subject: `Your MusicReleases sign-in code`.
- Google scopes: `openid email profile`; redirect URI `{publicUrl}/api/auth/callback/google`.
- Implicit account linking by email only for Google: `trustedProviders: ["google"]`. Spotify/TIDAL must never link or sign up implicitly.
- `fetchTidalUser` must return `emailVerified: false`.
- Spotify scopes become `["user-follow-read"]` (drop `user-read-email`).
- Installer order: `token → site → signin → music → mail → schedule → admin`.
- Setup and Admin → Settings must never end with no working sign-in method.
- Admin → Users: emails unique case-insensitively, stored lowercased, saved with `emailVerified: false`; admin-only, 404 otherwise.
- Tests run against the throwaway DB: `npm run test:db`, then `DATABASE_URL=postgresql://test:test@127.0.0.1:54329/test npx prisma migrate deploy`, then `npx vitest run`. Stop it after: `docker stop music-releases-testdb`.

## Review Focus

1. **Sign-ups closed + unknown email asks for a code** → no account, no code mailed, neutral message ("If this address can sign in, a code is on its way"). Test in Task 3.
2. **Email in different case** (`Fan@Example.com` vs stored `fan@example.com`) → same account, followed artists intact. Tests in Task 3 and Task 6.
3. **Masked Google secret** (`••••••`) saved back from the form → stored secret kept, not overwritten. Test in Task 1.
4. **Admin switches off the last working method** (Google off while email codes are on but mail is not configured; both methods off) → save refused with a readable error. Tests in Task 1. (Admin → Settings has no way to remove mail: its "skip" is a no-op in admin context, so only the Sign-in section needs the guard.)
5. **Existing Spotify-only user** keeps their Spotify connection after switching to email sign-in; reconnecting Spotify from Settings re-links, never creates a second user. Test in Task 3.

---

### Task 1: Sign-in settings, schema, installer step and lock-out guard

**Files:**
- Modify: `src/lib/settings.ts` (add `SignInSettings`, `SettingsMap.signin`, `"signin"` in `SECRET_KEYS`)
- Modify: `src/install/schemas.ts` (add `SignInSchema`)
- Create: `src/lib/signin.ts`
- Modify: `src/install/steps.ts` (`INSTALL_STEPS`, `SettingsSection`, `applySection`, `EditableSettings`, `getEditableSettings`, `redirectUris`)
- Modify: `src/app/api/install/[step]/route.ts` (`STEPS` adds `"signin"`), `src/app/api/admin/settings/route.ts` (enum adds `"signin"`)
- Test: `tests/lib/signin.test.ts`, `tests/install/steps.test.ts`

**Interfaces:**
- Produces:
  - `interface SignInSettings { google: OAuthAppSettings; emailCode: { enabled: boolean } }`
  - `SignInSchema` (zod): at least one method enabled (error path `["methods"]`, message `Turn on at least one way to sign in`); enabled Google needs `clientId` and `clientSecret` (paths `google.clientId`, `google.clientSecret`).
  - `src/lib/signin.ts`:
    - `type SignInMethods = { google: boolean; emailCode: boolean }`
    - `availableMethods(signin: SignInSettings | null, mailConfigured: boolean): SignInMethods` — google = enabled && clientId; emailCode = enabled && mailConfigured.
    - `getSignInMethods(): Promise<SignInMethods>` — reads `signin` and `mail` settings.
    - `LOCKOUT_ERROR = "This would leave no way to sign in. Keep Google on, or set up mail for email codes."`
  - `INSTALL_STEPS = ["token", "site", "signin", "music", "mail", "schedule", "admin"]`; `SettingsSection` adds `"signin"`.
  - `redirectUris(publicUrl)` returns `{ spotify, tidal, google }`.
  - `EditableSettings.signin: SignInSettings | null` (secrets redacted).

- [ ] **Step 1: Write failing tests**

`tests/lib/signin.test.ts`:
- `availableMethods` table: google on + id → `google: true`; google on, empty id → false; emailCode on + no mail → false; emailCode on + mail → true; null settings → both false.

`tests/install/steps.test.ts` (add):
- `"signin step requires at least one method"` → `saveInstallStep("signin", { google: off, emailCode: { enabled: false } })` returns `errors.methods`.
- `"signin step needs Google client id and secret when Google is on"` → errors `google.clientId`, `google.clientSecret`.
- `"saving signin with the masked secret keeps the stored secret"` → store `{ google: { enabled: true, clientId: "g", clientSecret: "real" } }`, save with `clientSecret: SECRET_MASK`, `getSetting("signin")` has `clientSecret: "real"`.
- `"mail can't be skipped when email codes are on"` → signin with `emailCode.enabled: true`, `saveInstallStep("mail", { skip: true })` → `errors.mail` contains `Email sign-in codes need mail`.
- `"mail can be skipped when only Google is on"` → ok.
- `"admin: turning Google off with email codes but no mail is refused"` → `updateAdminSettings("signin", …)` → `errors.form === LOCKOUT_ERROR`.
- `"admin: turning email codes off while Google is off is refused"` → `errors.form === LOCKOUT_ERROR`.
- Update existing step-index expectations for the new order (`completedStep` after `site` is 2, after `signin` is 3).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/lib/signin.test.ts tests/install/steps.test.ts`
Expected: FAIL (`availableMethods` / `"signin"` step unknown).

- [ ] **Step 3: Implement** the types, `SignInSchema`, `src/lib/signin.ts`, and the `"signin"` case in `applySection` (merge masked secret with `keepMaskedSecrets(raw.google, stored?.google)`, parse, then in `admin` context reject with `LOCKOUT_ERROR` when `availableMethods(new, mailConfigured)` has both false). In the `mail` case, install context only: `skip` while `signin.emailCode.enabled` → `{ mail: "Email sign-in codes need mail. Set up mail now, or turn off email codes in the Sign-in step." }`. The lock-out check in the install context is not needed (the schema requires one method, and mail can't be skipped when codes are the only one).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/lib/signin.test.ts tests/install/steps.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(signin): add sign-in settings, installer step and lock-out guard`

---

### Task 2: Sign-in code email

**Files:**
- Create: `src/mail/signin-code.ts`
- Test: `tests/mail/signin-code.test.ts`

**Interfaces:**
- Consumes: `sendMail(msg: MailMessage)` from `@/mail`.
- Produces: `sendSignInCode(to: string, code: string, siteName: string): Promise<void>`.

- [ ] **Step 1: Write failing test** `"sends the code with the fixed subject"`: Resend settings stored, msw captures `POST https://api.resend.com/emails`; assert `subject === "Your MusicReleases sign-in code"`, `to` is `[to]`, `text` contains the code and `10 minutes`, `html` contains the code.
- [ ] **Step 2: Run** `npx vitest run tests/mail/signin-code.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** with plain text + minimal inline-styled HTML (no react-email needed); `siteName` appears in the body.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(mail): add sign-in code email`

---

### Task 3: Auth options — Google, email codes, connect-only streaming services

**Files:**
- Modify: `src/lib/auth.ts` (`AuthConfigInput`, `buildAuthOptions`, `getAuth`, `fetchTidalUser`)
- Modify: `src/providers/scopes.ts` (Spotify scopes → `user-follow-read` only)
- Modify: `src/lib/auth-client.ts` (add `emailOTPClient()`; `connect(provider, callbackURL)` always `linkSocial`)
- Test: `tests/lib/auth.test.ts`, `tests/lib/auth-signin.test.ts` (new)

**Interfaces:**
- Consumes: `SignInSettings`, `availableMethods` (Task 1); `sendSignInCode` (Task 2).
- Produces:
  - `AuthConfigInput = { site; spotify; tidal; signin: SignInSettings | null; mailConfigured: boolean }`
  - `connect(provider: "spotify" | "tidal", callbackURL = "/settings"): Promise<…>` — link only; the `mode` parameter is removed.
  - `getEnabledProviders()` unchanged in meaning: connectable services.

- [ ] **Step 1: Write failing tests**

`tests/lib/auth.test.ts` (update/add):
- `"Google is registered only when sign-in settings enable it"` → `Object.keys(opts.socialProviders)` contains `"google"` with `scope` `["openid","email","profile"]`.
- `"email-otp plugin only when email codes are on and mail is configured"` → plugin ids contain `"email-otp"` iff both.
- `"Spotify and TIDAL cannot sign up"` → `socialProviders.spotify.disableSignUp === true` and `disableImplicitSignUp === true`; generic-oauth TIDAL config has `disableSignUp: true`.
- Replace the old linking test: `accountLinking` equals `{ enabled: true, trustedProviders: ["google"], allowDifferentEmails: true }`.
- Spotify scope test expects `["user-follow-read"]`.

`tests/lib/auth-signin.test.ts` (new; mock `@/mail/signin-code` with `vi.mock` to capture `(to, code)`; settings: site, signin emailCode on, Resend mail):
- `"an email code signs in an existing user, case-insensitively"` → user `fan@example.com` with a followed artist; `auth.api.sendVerificationOTP({ body: { email: "Fan@Example.com", type: "sign-in" } })`; captured code; `auth.api.signInEmailOTP({ body: { email: "Fan@Example.com", otp: code } })` returns that user's id; `userArtist.count` for it is 1; `user.emailVerified` is now true.
- `"with sign-ups closed, an unknown email gets no code and no account"` → `allowSignups: false`, one existing user; send for `new@example.com`; mock not called (or sign-in fails) and `user.count` unchanged.
- `"a wrong code six times is rejected"` → 5 wrong attempts then the right one fails (`allowedAttempts: 5`).
- `"existing Spotify connection survives email sign-in"` → user with `account` row `providerId: "spotify"`; after code sign-in, `account.count({ where: { userId, providerId: "spotify" } }) === 1`.

- [ ] **Step 2: Run** `npx vitest run tests/lib/auth.test.ts tests/lib/auth-signin.test.ts` → FAIL.
- [ ] **Step 3: Implement**
  - `emailOTP({ otpLength: 6, expiresIn: 600, allowedAttempts: 5, sendVerificationOTP })`. Account creation stays gated by the existing `user.create.before` hook. `sendVerificationOTP({ email, otp, type }, ctx)`: when no user has `email` (case-insensitive), call `assertSignupAllowed(cookie from ctx headers/request)`; on `SignupsClosedError` return without sending (the UI shows the same neutral message either way). Otherwise `sendSignInCode(email, otp, siteName)`. The install cookie still lets the admin sign up during setup, as today.
  - `getAuth` loads `signin` and `mail` and includes `!!mail` in the cache version input (settings version already covers it).
  - Remove `disableImplicitLinking`; set `trustedProviders: ["google"]`.
- [ ] **Step 4: Run** → PASS. Then full suite (see Global Constraints) → all PASS.
- [ ] **Step 5: Commit** — `feat(auth): sign in with Google or email code; streaming services connect-only`

---

### Task 4: Sign-in page, connect flows and releases empty state

**Files:**
- Create: `src/components/SignIn.tsx` (client)
- Modify: `src/app/page.tsx`, `src/components/ConnectButtons.tsx` (drop `mode`), `src/app/releases/page.tsx`, `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `getSignInMethods()` (Task 1); `authClient`, `connect` (Task 3).
- Produces: `<SignIn methods={SignInMethods} callbackURL={string} />` — Google button (`authClient.signIn.social({ provider: "google", callbackURL, errorCallbackURL: "/?error=signin" })`) and a two-stage email form (`authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" })` → code input → `authClient.signIn.emailOtp({ email, otp })` → `location.assign(callbackURL)`). Messages: sent → `If this address can sign in, a code is on its way. It expires in 10 minutes.`; wrong code → `That code is wrong or has expired.`; too many attempts → `Too many attempts. Request a new code.`
- Home page: `<SignIn methods callbackURL="/releases" />`; when both methods are false: `Sign-in isn't set up yet. Ask the admin.`
- Releases page: when the user has zero `account` rows, show a panel `Connect a music service to see releases from the artists you follow.` with `<ConnectButtons providers={await getEnabledProviders()} callbackURL="/releases" />` in place of the board.
- Settings page: the reconnect buttons use the link-only `ConnectButtons` (no `mode`).

- [ ] **Step 1: Typecheck/lint gate** — `npx tsc --noEmit -p .` and `npx eslint src/components src/app` → clean.
- [ ] **Step 2: Browser check** — dev server on the test DB with the mail catcher from Task 7 Step 2; signed out `/` shows only the enabled methods; requesting a code shows the neutral message; a signed-in user with no accounts sees the connect panel on `/releases`.
- [ ] **Step 3: Commit** — `feat(ui): sign-in page with Google and email code; connect panel`

---

### Task 5: Installer and admin Sign-in form

**Files:**
- Modify: `src/components/settings/forms.tsx` (add `SignInForm`; `MailForm` gets `allowSkip: boolean`; Music step copy says "connect")
- Modify: `src/app/install/InstallWizard.tsx` (STEPS adds `{ key: "signin", title: "Sign-in" }` at index 2; last step renders `<SignIn methods={state.signInMethods} callbackURL="/install/complete" />`)
- Modify: `src/install/state.ts` (adds `signin`, `signInMethods`)
- Modify: `src/app/admin/settings/AdminSettings.tsx` (Sign-in section before Music services)

**Interfaces:**
- Consumes: `SignInSettings`, `getSignInMethods`, `redirectUris(...).google` (Task 1); `SignIn` (Task 4).
- Produces: `SignInForm({ initial: SignInSettings | null; redirectUri: string; submit; submitLabel; onSaved? })`. Google fieldset copy: account needed `Any Google account. Create an OAuth client (type "Web application") in Google Cloud Console → APIs & Services → Credentials.`; dashboard link `https://console.cloud.google.com/apis/credentials`; redirect URI copy field; client ID/secret. Email-code toggle description: `People get a 6-digit code by email. Needs mail, which you set up in the Mail step.`
- `MailForm` hides "Set up mail later" when `allowSkip` is false and shows `Email sign-in codes are on, so mail is required.`

- [ ] **Step 1: Typecheck/lint gate** → clean.
- [ ] **Step 2: Browser check** — fresh test DB, walk setup: Sign-in step validates (no method → error; Google without secret → field errors); with email codes on the Mail step has no skip; the last step offers the configured method(s).
- [ ] **Step 3: Commit** — `feat(install): Sign-in step for Google and email codes`

---

### Task 6: Admin → Users

**Files:**
- Create: `src/admin/users.ts`, `src/app/admin/users/page.tsx`, `src/app/admin/users/actions.ts`, `src/app/admin/users/EmailForm.tsx` (client)
- Modify: `src/app/admin/settings/page.tsx` (link to Users), `src/components/AppHeader.tsx` (Admin link unchanged; Users reachable from admin pages)
- Test: `tests/admin/users.test.ts`

**Interfaces:**
- Consumes: `isPlaceholderEmail` (`@/lib/auth`), `requireAdmin` (`@/lib/session`).
- Produces:
  - `interface AdminUserRow { id: string; name: string; email: string | null; role: string; services: ProviderName[]; createdAt: Date }` (`email: null` for placeholders)
  - `listUsers(): Promise<AdminUserRow[]>` — placeholder-email users first, then by `createdAt`.
  - `setUserEmail(userId: string, email: string): Promise<{ ok: true } | { ok: false; error: string }>` — trims + lowercases; invalid → `Enter a valid email`; taken by another user (case-insensitive) → `Another account already uses this email`; saves `email`, `emailVerified: false`; sets `userSettings.digestEmail` when it is null or a placeholder.
  - Server action `updateUserEmail(formData)` calls `requireAdmin()` first.

- [ ] **Step 1: Write failing tests** in `tests/admin/users.test.ts`:
  - `"lists placeholder-email users first with their services"`.
  - `"setUserEmail stores lowercase and unverified"` → `"New@Example.com"` stored `new@example.com`, `emailVerified false`.
  - `"setUserEmail refuses an email another user has, ignoring case"`.
  - `"setUserEmail refuses an invalid email"`.
  - `"setUserEmail fills an empty or placeholder digest address but keeps a custom one"`.
- [ ] **Step 2: Run** `npx vitest run tests/admin/users.test.ts` → FAIL.
- [ ] **Step 3: Implement** `src/admin/users.ts`, then the page (table; flagged section `Can't sign in until you add an email`), form and action.
- [ ] **Step 4: Run** → PASS; typecheck/lint clean.
- [ ] **Step 5: Browser check** — non-admin gets 404 on `/admin/users`; admin can set an email for a placeholder user.
- [ ] **Step 6: Commit** — `feat(admin): Users page to set account emails`

---

### Task 7: Docs, full verification, cleanup

**Files:**
- Modify: `README.md` (setup steps list, "Sign-in" section: Google OAuth client + email codes; music services are connected after sign-in; existing users: email code to their address, or admin sets it on Admin → Users)
- Modify: `docs/superpowers/specs/2026-11-13-sign-in-sso-email-design.md` (status → implemented)

- [ ] **Step 1:** Full suite on the test DB → all PASS; `npx tsc --noEmit -p .` and `npx eslint .` clean.
- [ ] **Step 2:** Browser pass over: signed-out home, code sign-in, connect panel, setup walk-through, Admin → Users. For the code, run a local mail catcher (`docker run -d --rm --name mr-mailpit -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 axllent/mailpit`), set mail to Custom SMTP `127.0.0.1:1025`, security none, and read the code from `http://127.0.0.1:8025/api/v1/messages`. Stop it after (`docker stop mr-mailpit`).
- [ ] **Step 3:** Remove anything the dev server generated (`AGENTS.md`), stop the test DB and dev servers.
- [ ] **Step 4: Commit** — `docs: sign-in with Google or email code`
