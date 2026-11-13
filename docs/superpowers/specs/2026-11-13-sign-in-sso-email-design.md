# Sign in with Google or an email code; streaming services become connections

Status: approved, implemented · 2026-11-13

## Intent

Today Spotify and TIDAL *are* the login: the home page only offers "Connect Spotify / TIDAL", and the user account is
created from whatever profile the service returns. That no longer works well:

- Spotify stopped returning the user's email to Development Mode apps (February 2026), so Spotify sign-ups have no
  usable address for the weekly digest, and better-auth's Spotify provider expects one.
- TIDAL often returns no email either (hence the placeholder `@users.noreply.invalid` addresses).
- A person's identity on this site shouldn't depend on which streaming service they happen to use.

New model: **people sign in to MusicReleases with Google (SSO) or with an email one-time code. After signing in they
connect Spotify and/or TIDAL**, which are used only to read follows and releases.

## Goals

- Sign-in page offers: **Continue with Google** (when configured) and **Email me a code** (when enabled).
- Email code: enter email → 6-digit code mailed → enter code → signed in. New account if sign-ups allow it.
- Spotify and TIDAL can no longer create accounts or sign people in; they are connected from a signed-in session.
- The installer gets a **Sign-in** step where the admin configures the available SSO (Google only for now) and the
  email-code option. The same form appears in Admin → Settings.
- Every user has a real, verified email, which becomes the default digest address.
- Settings are shaped so a second SSO provider (GitHub, Microsoft, …) is one more entry, not a redesign.

## Non-goals

- SSO providers other than Google (structure allows them later).
- Passwords, passkeys, magic links.
- A generic OpenID Connect provider (considered, see Approaches).

## Anti-goals (failure even if it technically works)

- **Account takeover by email matching.** Spotify does not verify emails; a Spotify/TIDAL connection must never
  attach to, or create, an account because an email matches. Only Google (verified emails) and the email code itself
  may match an existing account by email.
- **Lock-out.** Setup must never finish in a state where nobody can sign in (e.g. email code chosen but mail skipped).
- Existing users losing their followed artists, releases or settings.

## Approaches

1. **better-auth built-ins (chosen).** better-auth's Google social provider plus its `emailOTP` plugin; Spotify and
   TIDAL get `disableSignUp` and are reachable only through `linkSocial`. Least code, fits the existing auth setup,
   setup stays simple (client ID + secret). Each future SSO provider is a small code addition.
2. **Generic OpenID Connect with a Google preset.** One configurable provider (issuer URL, client ID/secret) would also
   cover Authentik/Keycloak without code changes, but makes the common case fussier and provider quirks (e.g. how
   verified email is reported) harder to handle. Not worth it while Google is the only provider needed.
3. **Magic links instead of codes.** Dropped: the request is for codes, and codes work when the email is read on
   another device than the one signing in.

## Design

### Settings

New encrypted setting `signin` (add to `SECRET_KEYS`):

```ts
interface SignInSettings {
  google: OAuthAppSettings;            // { enabled, clientId, clientSecret }; clientSecret already masked
  emailCode: { enabled: boolean };
}
```

Valid when at least one method is enabled; an enabled Google entry needs client ID and secret.

### Installer

Steps become: `token → site → signin → music → mail → schedule → admin`.

- **Sign-in step** (new, after Site): Google toggle with dashboard link, the redirect URI to copy
  (`{publicUrl}/api/auth/callback/google`), client ID/secret, and "Account needed" line (any Google account; create
  an OAuth client in Google Cloud Console). Email-code toggle, with a note that it needs mail (configured two steps
  later).
- **Mail step:** if email codes are enabled, "Set up mail later" is not allowed (message explains why). If only Google
  is enabled, skipping stays allowed.
- **Music step:** wording changes from "sign in with" to "connect"; Spotify scopes drop `user-read-email` (no longer
  returned, no longer needed).
- **Your account (last step):** the admin signs in with Google or an email code (instead of a streaming service);
  success lands on `/install/complete` as today, which makes them admin and locks setup. After that the releases page
  prompts them to connect a streaming service.
- `completedStep` indexes shift by one. An install that is mid-way during the upgrade resumes one step early, which is
  harmless (it re-shows a saved step).

### Auth (`src/lib/auth.ts`)

- `socialProviders.google` when `signin.google` is on (scopes: `openid email profile`).
- `emailOTP` plugin when `signin.emailCode` is on and mail is configured: `otpLength: 6`, `expiresIn: 600` (10 min),
  `allowedAttempts: 5`; `sendVerificationOTP` sends a short email through `sendMail` (plain text + simple HTML,
  subject "Your MusicReleases sign-in code"). Sign-up via code is subject to the same `assertSignupAllowed` hook.
- Spotify (`socialProviders.spotify`) and TIDAL (`genericOAuth`) get `disableSignUp: true` /
  `disableImplicitSignUp: true`; the UI only ever calls `linkSocial` for them.
- Account linking: implicit linking by email is allowed **only for Google** (`trustedProviders: ["google"]`).
  Spotify/TIDAL user info must report `emailVerified: false` so they can never link implicitly; explicit linking keeps
  `allowDifferentEmails: true`.
- `getEnabledProviders()` splits into sign-in methods (google, emailCode) and connectable services (spotify, tidal).

### Pages

- **Home `/`:** Google button and/or email field → code field. Errors: sign-ups closed, wrong/expired code, too many
  attempts.
- **Releases:** when the user has no connected service, show a "Connect Spotify / TIDAL" panel instead of the empty
  board.
- **Settings:** connect/reconnect buttons stay (link mode). Digest address defaults to the account email.
- **Admin → Settings:** new Sign-in section using the same form as the installer.

- **Lock-out guard (builder's call, made here):** Admin → Settings refuses a save that would leave no working sign-in
  method, e.g. turning Google off while email codes are on but mail is not configured, or removing mail while email
  codes are the only method.

### Existing users

Existing accounts were created by Spotify/TIDAL sign-in. They keep their followed artists, releases and settings.
Accounts whose email was never verified (all Spotify sign-ups) lose their streaming connection the first time they
prove the email by code: better-auth deliberately strips links that predate that proof, since they could belong to
whoever typed that email into Spotify. Those users reconnect their service once; the Releases page prompts them.

- **Users with a real email** sign in with an email code to that address (better-auth's email-code sign-in finds the
  existing user by email and marks it verified) or with Google if it's the same address (implicit link, Google is
  trusted). No migration step needed.
- Spotify/TIDAL sign-in is removed entirely, so an account whose email came from an unverified Spotify profile can no
  longer be reached through Spotify; proving the email by code or Google becomes the only way in.
- `fetchTidalUser` currently sets `emailVerified: !!email`; this must become `false` (TIDAL is not a trusted source).
- **Users with a placeholder email** (TIDAL hid it) can't receive a code. The admin fixes these by hand on a new
  **Admin → Users** page (decided by the owner), after which the user signs in with a code to that address.

### Admin → Users (new page)

- Lists every user: name, email (placeholder shown as "No email"), role, connected services, created date. Accounts
  with a placeholder email are flagged at the top ("Can't sign in until you add an email").
- The admin can set or change a user's email. Saving stores it with `emailVerified: false` and also sets it as the
  user's digest address if they had none; the user's first code sign-in then verifies it.
- Emails must be unique (case-insensitive) and valid; saving another user's address is refused.
- Admin-only (`requireAdmin`, 404 for everyone else), linked from the admin header next to Settings.

### Tests

Settings/schema validation (at least one method; Google needs ID+secret; mail can't be skipped with email codes),
installer step order and gating, auth options (Spotify/TIDAL `disableSignUp`, trusted providers = google only,
emailOTP only when mail exists), OTP email sending (msw/fake transport), sign-up gate for Google and code sign-ups,
releases page empty-state with no connected service, Admin → Users email update (validation, uniqueness, admin-only,
digest address fallback).

## Left to the builder

- OTP email layout (react-email component or plain HTML), and copy text.
- Exact UI of the two-stage email form.
- Rate limiting on code requests beyond better-auth's defaults.
- Whether the Sign-in step's form shares code with `MusicForm` or is its own component.

## Decisions by the owner

- Approach 1 (better-auth built-ins); Google is the only SSO for now.
- Existing users with a placeholder email get their email set by the admin on Admin → Users.
