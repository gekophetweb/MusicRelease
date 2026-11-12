# Music Releases Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hosted website, set up through a first-run web installer, where a user connects Spotify or Tidal and sees the latest releases of the artists they follow (newest first, split into Albums and Singles). A daily scheduled job refreshes the releases, and a weekly email digest goes out through Sender, Mailgun or custom SMTP.

**Architecture:** Separate Docker containers: `db` (PostgreSQL, its own container and volume), `app` (Next.js website, installer and OAuth), `worker` (node-cron scheduler running the daily sync and weekly digest) and `cloudflared` (tunnel). `app` and `worker` are built from one TypeScript codebase and one image, and both reach the `db` container over the internal Docker network through Prisma. The database is never exposed outside that network. Configuration made in the installer (public URL, Spotify/Tidal credentials, mail provider, schedules) is stored encrypted in the database, not in env files. Only bootstrap secrets stay in `.env`. Each streaming service sits behind one `MusicProvider` interface, and each mail service sits behind one `MailTransport` interface. A `cloudflared` container publishes `app` over a Cloudflare Tunnel, so no ports are opened on the host.

**Tech Stack:** Node.js 22 LTS, TypeScript (strict), Next.js 16 (App Router, server components, middleware), Better Auth (Spotify social provider + Generic OAuth plugin for Tidal), Prisma ORM, PostgreSQL 17, node-cron, Nodemailer (SMTP) + Mailgun HTTP API + Sender HTTP API, React Email, Zod, Tailwind CSS, Vitest + MSW (HTTP mocks), Docker + Docker Compose, Cloudflare Tunnel (`cloudflare/cloudflared`), Mailpit (dev only).

**Spec:** No separate spec document. The spec is the user's requests of 2026-11-12, restated in "Requirements" below.

---

## Requirements (from the requests)

1. User connects with **Spotify or Tidal** (OAuth; the user does the connecting).
2. Retrieve the **latest releases of artists the user follows**.
3. Order **newest release first**; **separate singles from albums**.
4. **Display them on a website.**
5. **Cron job runs daily** to check for and store new releases.
6. **Email once a week** with the releases of that week.
7. Recommend frameworks/platform (see next section).
8. **Dockerized**, with **Cloudflare Tunnel** configured in `docker-compose.yml`.
9. **First-run installer**: on first start the app opens an installer that can be reached from any location (in practice by the person setting it up, usually over the tunnel).
10. **Mail settings** for sending the digest, with a choice of **Sender**, **Mailgun** or **custom SMTP**.

## Recommended frameworks & platform (and why)

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript on Node 22 LTS | One language for UI, API, worker and email templates; both music APIs are plain JSON over HTTPS. |
| Web framework | **Next.js 16** (App Router) | Server components read the DB directly. Route handlers cover OAuth callbacks, installer steps and "sync now". Middleware gates every route until installation is done. |
| Auth / OAuth | **Better Auth** | Built-in Spotify provider, Generic OAuth plugin for Tidal (PKCE), stores and refreshes access/refresh tokens, Prisma adapter. Its config is built at runtime from installer settings. (Auth.js is now maintained under Better Auth, so this is the forward path.) |
| Database | **PostgreSQL 17** + **Prisma** | Relational data (users ↔ artists ↔ releases) plus the settings store, typed queries, migrations; `pg_advisory_lock` prevents two syncs at once. |
| Settings store | `AppSetting` table, AES-256-GCM encrypted with `APP_SECRET` from env | Lets the installer and admin page change credentials without editing files or restarting containers. |
| Validation | **Zod** | One schema per installer step, shared by the form and the API route. |
| Scheduler | **node-cron** in a dedicated `worker` container | Same code and image as the app. It reads cron expressions and timezone from settings and reloads them when they change. No host crontab. |
| Email | **`MailTransport` interface** with 3 adapters: Nodemailer (custom SMTP), Mailgun HTTP API, Sender HTTP API. Templates in **React Email** | Pick the provider in the installer and switch it later in admin settings. A "Send test email" button checks it before saving. |
| Styling | Tailwind CSS | Fast to build the installer wizard and the release grid. |
| Tests | Vitest + MSW | MSW replays recorded Spotify/Tidal/Mailgun/Sender JSON, so clients are tested without network access. |
| Hosting | Docker Compose on any always-on box (home server, NAS, VPS) + **Cloudflare Tunnel** | HTTPS public hostname without port forwarding. Spotify requires an `https` redirect URI for non-loopback hosts. |

**Platform caveats to verify before starting (APIs change):**
- **Spotify:** apps in Development Mode only allow a small allowlist of users (added by email in the developer dashboard). Fine for personal/family use; wider use needs an extended-quota application. Endpoints used: `GET /v1/me/following?type=artist` (scope `user-follow-read`, cursor paging), `GET /v1/artists/{id}/albums?include_groups=album,single` (offset paging), `GET /v1/me` (scope `user-read-email`). Check the current max page size and rate-limit guidance in the docs.
- **Tidal:** developer.tidal.com, API v2 at `https://openapi.tidal.com/v2` (JSON:API format), OAuth 2.1 Authorization Code + PKCE. Followed artists come from the user's collection (`userCollections/{userId}/relationships/artists`), releases from `artists/{id}/relationships/albums`. Album attributes carry `type` (ALBUM / EP / SINGLE) and `releaseDate`. Confirm exact paths and scope names against the live OpenAPI spec in Task 8, and record fixtures from real responses.
- **Mailgun:** `POST https://api.mailgun.net/v3/{domain}/messages` (EU region: `https://api.eu.mailgun.net`), HTTP Basic auth `api:{apiKey}`, form fields `from`, `to`, `subject`, `html`, `text`. Domain verification check: `GET /v4/domains/{domain}`.
- **Sender (sender.net):** transactional email through its HTTP API with a Bearer API token. Confirm the exact send endpoint and payload in Task 3 against Sender's API docs, and record a fixture. Sender also offers SMTP credentials, so the SMTP adapter is a fallback if the API does not fit.

## Global Constraints

- Node.js `22` LTS; TypeScript `strict: true`; ESM.
- All timestamps stored in UTC; release dates stored as `DATE` plus a `datePrecision` of `day | month | year`.
- Bootstrap env only (`.env`, never committed): `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `APP_SECRET` (≥ 32 random bytes, base64; encrypts the settings store and derives the Better Auth secret), `TUNNEL_TOKEN`. Optional: `INSTALL_TOKEN` (preset setup token), `TZ` (default `Europe/Amsterdam`, used until the installer sets one).
- Everything else is configured in the installer and stored in `AppSetting`: public URL, Spotify/Tidal client ID + secret, mail provider settings, `syncCron` (default `0 6 * * *`), `digestCron` (default `0 18 * * 5`, Friday 18:00 since new music lands on Fridays), `timezone`, `allowSignups` (default `false`).
- Secret setting values (client secrets, SMTP password, API keys) are encrypted at rest and never sent back to the browser. Forms show `••••••` with a "replace" action.
- "Single" bucket = Spotify `single` (Spotify reports EPs as `single`) and Tidal `SINGLE` + `EP`. "Album" bucket = Spotify `album`, Tidal `ALBUM`. Compilations and "appears on" are excluded.
- OAuth redirect URIs (the installer shows them with copy buttons): `{publicUrl}/api/auth/callback/spotify` and `{publicUrl}/api/auth/oauth2/callback/tidal`.
- OAuth tokens encrypted at rest (enable Better Auth's OAuth-token encryption option; if the installed version lacks it, wrap the adapter with the same AES-256-GCM helper as the settings store).
- Sorting everywhere: `releaseDate` desc, then `title` asc as tiebreaker.
- Installer reachable from any network location, protected by a one-time **setup token** printed in the `app` container log. It is locked for good once installation completes.

## Review Focus

1. **Installer hijack or re-entry**: a stranger opens `/install` on the public hostname before the owner does → nothing works without the setup token from the container log (and wrong tokens are rate-limited). After completion, `/install` and `/api/install/*` return 404 for everyone. (Tests in Task 5.)
2. **Expired or revoked token**: refresh fails → that account is marked `needsReconnect`, the dashboard shows a "Reconnect Spotify/Tidal" banner, and the sync continues for other users. (Tests in Tasks 4 and 10.)
3. **Wrong mail settings**: bad SMTP password, unverified Mailgun domain or invalid Sender token → "Send test email" shows the provider's error in plain words and nothing is saved. A failed weekly send is logged per user and does not mark the digest as sent. (Tests in Tasks 3 and 12.)
4. **Year- or month-only release dates** (`"2019"`, `"2019-06"`): stored as the first day of the period along with its precision, sorted correctly, displayed as `2019` / `Jun 2019`. They never count as "this week" in the digest unless precision is `day`. (Tests in Tasks 9 and 12.)
5. **Duplicates**: the same release returned twice (explicit + clean edition, market variants), or a collaboration between two followed artists → shown once, credited to both artists. (Test in Task 9.)

---

## File Structure

```
.
├── Dockerfile                      # multi-stage build → one image for app + worker
├── docker-compose.yml              # db, app, worker, cloudflared, mailpit (profile: dev)
├── .env.example
├── README.md                       # setup: tunnel, first run / installer, Spotify & Tidal apps
├── prisma/schema.prisma
├── src/
│   ├── middleware.ts               # install gate
│   ├── lib/
│   │   ├── db.ts                   # Prisma client singleton
│   │   ├── crypto.ts               # encrypt/decrypt (AES-256-GCM, key from APP_SECRET)
│   │   ├── settings.ts             # typed, encrypted settings store + install state
│   │   ├── setup-token.ts          # create/print/verify setup token
│   │   ├── auth.ts                 # getAuth(): Better Auth built from settings
│   │   ├── auth-client.ts
│   │   └── tokens.ts               # getValidAccessToken()
│   ├── mail/
│   │   ├── types.ts                # MailTransport, MailMessage, MailSettings
│   │   ├── smtp.ts                 # Nodemailer
│   │   ├── mailgun.ts
│   │   ├── sender.ts
│   │   └── index.ts                # createTransport(settings), sendMail(), sendTestMail()
│   ├── install/
│   │   ├── schemas.ts              # Zod schema per step
│   │   └── steps.ts                # step order + completion logic
│   ├── providers/
│   │   ├── types.ts                # MusicProvider, NormalizedArtist, NormalizedRelease
│   │   ├── http.ts                 # fetchWithRetry() — 429/5xx handling
│   │   ├── spotify.ts
│   │   ├── tidal.ts
│   │   └── index.ts                # getProvider(name)
│   ├── releases/
│   │   ├── normalize.ts            # parseReleaseDate, classifyRelease, dedupeReleases, sortReleases
│   │   ├── sync.ts                 # syncUser, syncAll
│   │   └── queries.ts              # getReleasesForUser
│   ├── digest/
│   │   ├── build.ts                # buildWeeklyDigest
│   │   ├── send.ts                 # sendWeeklyDigests
│   │   └── WeeklyDigestEmail.tsx   # React Email template
│   ├── worker.ts                   # node-cron entrypoint
│   └── app/
│       ├── layout.tsx
│       ├── page.tsx                # landing: "Connect Spotify" / "Connect Tidal"
│       ├── install/                # wizard: token → site → music services → mail → schedule → admin
│       │   ├── page.tsx
│       │   └── components/*.tsx    # step forms, reused by admin settings
│       ├── admin/settings/page.tsx # same forms after install (admin only)
│       ├── releases/page.tsx       # dashboard: Albums | Singles
│       ├── settings/page.tsx       # user: digest email + on/off, connected accounts
│       ├── api/install/[step]/route.ts
│       ├── api/install/test-mail/route.ts
│       ├── api/admin/settings/route.ts
│       ├── api/auth/[...all]/route.ts
│       ├── api/sync/route.ts       # POST: sync now (current user)
│       ├── api/health/route.ts
│       └── unsubscribe/route.ts
└── tests/
    ├── fixtures/{spotify,tidal,mailgun,sender}/*.json
    ├── lib/{crypto,settings,setup-token,tokens}.test.ts
    ├── mail/{smtp,mailgun,sender,index}.test.ts
    ├── install/{gate,steps}.test.ts
    ├── providers/{http,spotify,tidal}.test.ts
    ├── releases/{normalize,sync,queries}.test.ts
    └── digest/{build,send}.test.ts
```

---

### Task 1: Project scaffold, database and health check

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `next.config.ts`, `src/app/layout.tsx`, `src/app/api/health/route.ts`, `src/lib/db.ts`, `prisma/schema.prisma`, `docker-compose.yml` (db service only for now), `.env.example`, `.gitignore`
- Test: `tests/health.test.ts`

**Interfaces:**
- Produces: `prisma` (PrismaClient singleton from `src/lib/db.ts`); `GET /api/health` → `200 {"status":"ok","db":"ok"}`.
- Prisma models (Better Auth adds `User`, `Session`, `Account`, `Verification` in Task 4 via its CLI; add these app models now):

```prisma
enum Provider { spotify tidal }
enum ReleaseType { album single }
enum DatePrecision { day month year }

model AppSetting {
  key       String   @id          // e.g. 'site', 'spotify', 'tidal', 'mail', 'schedule', 'install'
  value     String                // JSON; encrypted envelope when the key holds secrets
  encrypted Boolean  @default(false)
  updatedAt DateTime @updatedAt
}

model Artist {
  id           String   @id @default(cuid())
  provider     Provider
  providerId   String
  name         String
  imageUrl     String?
  lastSyncedAt DateTime?
  followers    UserArtist[]
  releases     ReleaseArtist[]
  @@unique([provider, providerId])
}

model UserArtist {
  userId   String
  artistId String
  artist   Artist @relation(fields: [artistId], references: [id], onDelete: Cascade)
  @@id([userId, artistId])
}

model Release {
  id            String        @id @default(cuid())
  provider      Provider
  providerId    String
  title         String
  type          ReleaseType
  releaseDate   DateTime      @db.Date
  datePrecision DatePrecision
  coverUrl      String?
  url           String
  totalTracks   Int?
  firstSeenAt   DateTime      @default(now())
  artists       ReleaseArtist[]
  @@unique([provider, providerId])
  @@index([releaseDate])
}

model ReleaseArtist {
  releaseId String
  artistId  String
  release   Release @relation(fields: [releaseId], references: [id], onDelete: Cascade)
  artist    Artist  @relation(fields: [artistId], references: [id], onDelete: Cascade)
  @@id([releaseId, artistId])
}

model UserSettings {
  userId           String   @id
  digestEmail      String?
  digestEnabled    Boolean  @default(true)
  unsubscribeToken String   @unique @default(cuid())
  lastDigestSentAt DateTime?
}

model SyncRun {
  id          String   @id @default(cuid())
  startedAt   DateTime @default(now())
  finishedAt  DateTime?
  userId      String?
  newReleases Int      @default(0)
  error       String?
}
```

- [ ] **Step 1:** `npx create-next-app@latest . --ts --app --tailwind --src-dir --eslint --use-npm`, then `npm i prisma @prisma/client zod` and `npm i -D vitest msw @vitejs/plugin-react`. Add scripts `test`, `db:migrate` (`prisma migrate deploy`), `worker` (`node dist/worker.js`).
- [ ] **Step 2:** Add `db` service (`postgres:17-alpine`, volume `pgdata`, healthcheck `pg_isready`) to `docker-compose.yml`; `docker compose up -d db`.
- [ ] **Step 3: Write the failing test** `tests/health.test.ts`:

```ts
import { GET } from '@/app/api/health/route';
test('health reports ok when db reachable', async () => {
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok', db: 'ok' });
});
```

- [ ] **Step 4:** Run `npx vitest run tests/health.test.ts` → FAIL (module not found).
- [ ] **Step 5:** Write schema, run `npx prisma migrate dev --name init`, implement `GET()` doing `prisma.$queryRaw\`SELECT 1\``; return `503 {"status":"error","db":"down"}` on failure.
- [ ] **Step 6:** Run test → PASS.
- [ ] **Step 7:** Commit on `feature/task-01-scaffold`: `chore: scaffold Next.js app, Prisma schema, health check`.

---

### Task 2: Encrypted settings store, install state and setup token

**Files:**
- Create: `src/lib/crypto.ts`, `src/lib/settings.ts`, `src/lib/setup-token.ts`
- Test: `tests/lib/crypto.test.ts`, `tests/lib/settings.test.ts`, `tests/lib/setup-token.test.ts`

**Interfaces:**
- Produces:

```ts
// crypto.ts — key = HKDF-SHA256(APP_SECRET, info 'settings'); envelope 'v1:<iv b64>:<tag b64>:<ciphertext b64>'
export function encrypt(plain: string): string;
export function decrypt(envelope: string): string;          // throws on tamper / wrong key
export function deriveSecret(purpose: string): string;      // e.g. deriveSecret('better-auth')

// settings.ts
export interface SiteSettings { publicUrl: string; siteName: string; allowSignups: boolean }
export interface OAuthAppSettings { enabled: boolean; clientId: string; clientSecret: string }
export interface ScheduleSettings { syncCron: string; digestCron: string; timezone: string }
export interface InstallState { status: 'pending' | 'complete'; completedStep: number; completedAt?: string }
export interface SettingsMap {
  site: SiteSettings; spotify: OAuthAppSettings; tidal: OAuthAppSettings;
  mail: MailSettings;            // defined in Task 3 (src/mail/types.ts)
  schedule: ScheduleSettings; install: InstallState;
}
export const SECRET_KEYS: Array<keyof SettingsMap>; // ['spotify','tidal','mail'] → stored encrypted
export async function getSetting<K extends keyof SettingsMap>(key: K): Promise<SettingsMap[K] | null>;
export async function setSetting<K extends keyof SettingsMap>(key: K, value: SettingsMap[K]): Promise<void>;
export async function getSettingsVersion(): Promise<string>; // max(updatedAt) — used for cache busting
export async function isInstalled(): Promise<boolean>;
export function redactSecrets<T>(value: T): T;                // replaces clientSecret/pass/apiKey/apiToken with '••••••'

// setup-token.ts
export async function ensureSetupToken(): Promise<string | null>; // null when installed; uses INSTALL_TOKEN if set, else random 24-char base32, stored encrypted
export async function verifySetupToken(candidate: string): Promise<boolean>; // constant-time compare
export function logSetupBanner(token: string, origin?: string): void;
```

- `logSetupBanner` prints to stdout on every app boot while install is pending:
  `=== MusicReleases setup ===  Open {origin|'<your public URL>'}/install and enter setup token: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`
- Called from Next.js `instrumentation.ts` `register()` at app startup.

- [ ] **Step 1: Write failing tests:**
  - `decrypt(encrypt(x)) === x`; `decrypt` throws when one ciphertext char is changed; two `encrypt('a')` calls differ (random IV).
  - `setSetting('mail', …)` stores `encrypted: true` and the raw DB `value` does not contain the password; `getSetting('mail')` returns it in plain form.
  - `setSetting('schedule', …)` stores `encrypted: false`.
  - `isInstalled()` is false with no `install` row; true after `{status:'complete'}`.
  - `redactSecrets({ clientId:'id', clientSecret:'s' })` → `{ clientId:'id', clientSecret:'••••••' }`.
  - `ensureSetupToken()` returns the same token on two calls; returns `INSTALL_TOKEN` when env set; returns `null` when installed.
  - `verifySetupToken` true for the token, false for a wrong one and for `''`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: encrypted settings store and setup token`.

---

### Task 3: Mail transports — Sender, Mailgun, custom SMTP

**Files:**
- Create: `src/mail/types.ts`, `src/mail/smtp.ts`, `src/mail/mailgun.ts`, `src/mail/sender.ts`, `src/mail/index.ts`, `tests/fixtures/mailgun/*.json`, `tests/fixtures/sender/*.json`
- Test: `tests/mail/smtp.test.ts`, `tests/mail/mailgun.test.ts`, `tests/mail/sender.test.ts`, `tests/mail/index.test.ts`

**Interfaces:**
- Consumes: `getSetting('mail')` (Task 2).
- Produces:

```ts
export interface MailAddress { email: string; name?: string }
export interface MailMessage { to: MailAddress; subject: string; html: string; text: string; headers?: Record<string, string> }
export type MailSettings =
  | { provider: 'smtp'; from: MailAddress; host: string; port: number;
      security: 'tls' | 'starttls' | 'none'; user?: string; pass?: string }
  | { provider: 'mailgun'; from: MailAddress; domain: string; apiKey: string; region: 'us' | 'eu' }
  | { provider: 'sender'; from: MailAddress; apiToken: string };
export interface MailTransport {
  send(msg: MailMessage): Promise<{ id?: string }>;
  verify(): Promise<void>;                       // throws MailError with a readable message
}
export class MailError extends Error { provider: MailSettings['provider']; status?: number; detail?: string }

export function createTransport(s: MailSettings): MailTransport;
export async function sendMail(msg: MailMessage): Promise<{ id?: string }>;     // reads settings, throws MailNotConfiguredError
export async function sendTestMail(s: MailSettings, to: string): Promise<void>; // verify() then send "MusicReleases test email"
export const MailSettingsSchema: z.ZodType<MailSettings>;                        // discriminated union on provider
```

- **SMTP:** `nodemailer.createTransport({ host, port, secure: security === 'tls', requireTLS: security === 'starttls', auth })`; `verify()` = `transporter.verify()`. Port defaults shown in UI: tls 465, starttls 587, none 25.
- **Mailgun:** base URL by region (see Caveats), `POST /v3/{domain}/messages` as `multipart/form-data`; `verify()` = `GET /v4/domains/{domain}` and requires `state === 'active'`, else `MailError('Mailgun domain {domain} is not verified yet')`. 401 → `MailError('Mailgun API key was rejected')`.
- **Sender:** Bearer `apiToken`, JSON body with from/to/subject/html/text per Sender's transactional API (confirm endpoint, Step 1). `verify()` = an authenticated read-only call (e.g. account/senders list); 401 → `MailError('Sender API token was rejected')`; from-address not verified at Sender → `MailError('Sender address {email} is not verified in Sender')`.
- `List-Unsubscribe` header is passed through on all three.

- [ ] **Step 1:** Read Sender's and Mailgun's current API docs, then record one success and one error fixture for each with a sandbox account (strip keys and addresses).
- [ ] **Step 2: Write failing tests:**
  - `MailSettingsSchema` rejects `{provider:'smtp'}` without host; rejects bad `from.email`; accepts each provider's valid shape.
  - SMTP: `send` passes from/to/subject/html/text/headers to Nodemailer (mock `createTransport`); `security: 'starttls'` → `secure:false, requireTLS:true`.
  - Mailgun: hits `https://api.eu.mailgun.net/v3/mg.example.com/messages` when `region:'eu'`; sends Basic `api:key`; 401 → `MailError` with message `Mailgun API key was rejected`; `verify` on an unverified domain fixture throws `…is not verified yet`.
  - Sender: sends Bearer token and the expected JSON body; 401 → `Sender API token was rejected`.
  - `sendMail` throws `MailNotConfiguredError` when no `mail` setting exists.
  - `sendTestMail` calls `verify` before `send` and does not send when `verify` throws.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** Run → PASS.
- [ ] **Step 6:** Commit: `feat: mail transports for Sender, Mailgun and SMTP`.

---

### Task 4: Connect with Spotify or Tidal (Better Auth from settings)

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/lib/tokens.ts`, `src/app/api/auth/[...all]/route.ts`, `src/app/page.tsx`
- Modify: `prisma/schema.prisma` (Better Auth tables via `npx @better-auth/cli generate`; add `role String @default("user")` to `User` and `needsReconnect Boolean @default(false)` to `Account`)
- Test: `tests/lib/auth.test.ts`, `tests/lib/tokens.test.ts`

**Interfaces:**
- Consumes: `getSetting`, `getSettingsVersion`, `deriveSecret` (Task 2).
- Produces:
  - `getAuth(): Promise<BetterAuthInstance>`: builds Better Auth from `site.publicUrl` (`baseURL`, `trustedOrigins`), `deriveSecret('better-auth')`, and the `spotify`/`tidal` settings. Only providers with `enabled && clientId` are registered. The instance is cached per `getSettingsVersion()`, so saving settings takes effect without a restart. Spotify scopes: `user-follow-read user-read-email`. Tidal via `genericOAuth` with `providerId: 'tidal'`, `pkce: true`, URLs and scopes from Tidal docs.
  - `databaseHooks.user.create.before`: when `install.status === 'complete'` and `site.allowSignups === false` and the user is not the first user → reject with `"Sign-ups are closed. Ask the admin to open them."`
  - `databaseHooks.user.create.after`: create `UserSettings { userId, digestEmail: user.email ?? null }`.
  - `getValidAccessToken(userId: string, provider: 'spotify' | 'tidal'): Promise<string>`: refreshes via `auth.api.getAccessToken` when expired. On refresh failure it sets `Account.needsReconnect = true` and throws `ReconnectRequiredError`.
  - `class ReconnectRequiredError extends Error { provider; userId }`.
  - `getEnabledProviders(): Promise<Array<'spotify'|'tidal'>>` for the landing page.
- Route handler: `export const GET/POST = async (req) => toNextJsHandler(await getAuth())[method](req)`.
- Landing page shows a "Connect Spotify" / "Connect Tidal" button for each enabled provider only. Signed-in users are redirected to `/releases`.

- [ ] **Step 1: Write failing tests:**
  - `getAuth registers only enabled providers` — spotify enabled, tidal disabled → providers list `['spotify']`.
  - `getAuth rebuilds after settings change` — two calls return the same instance; after `setSetting('spotify', …)` a new instance.
  - `sign-up rejected when allowSignups false after install`; `allowed for first user`.
  - Token tests (mock `auth.api.getAccessToken`):

```ts
test('returns token from Better Auth', async () => {
  mockGetAccessToken.mockResolvedValue({ accessToken: 'abc' });
  expect(await getValidAccessToken('u1', 'spotify')).toBe('abc');
});
test('refresh failure marks account needsReconnect and throws', async () => {
  mockGetAccessToken.mockRejectedValue(new Error('invalid_grant'));
  await expect(getValidAccessToken('u1', 'spotify')).rejects.toBeInstanceOf(ReconnectRequiredError);
  const acc = await prisma.account.findFirst({ where: { userId: 'u1', providerId: 'spotify' } });
  expect(acc?.needsReconnect).toBe(true);
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. A successful sign-in resets `needsReconnect = false`. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: Spotify/Tidal sign-in configured from settings`.

---

### Task 5: First-run installer and admin settings

**Files:**
- Create: `src/middleware.ts`, `src/instrumentation.ts`, `src/install/schemas.ts`, `src/install/steps.ts`, `src/app/install/page.tsx`, `src/app/install/components/{TokenStep,SiteStep,MusicServicesStep,MailStep,ScheduleStep,AdminStep}.tsx`, `src/app/api/install/[step]/route.ts`, `src/app/api/install/test-mail/route.ts`, `src/app/admin/settings/page.tsx`, `src/app/api/admin/settings/route.ts`
- Test: `tests/install/gate.test.ts`, `tests/install/steps.test.ts`

**Interfaces:**
- Consumes: Task 2 (settings, setup token), Task 3 (`MailSettingsSchema`, `sendTestMail`), Task 4 (`getAuth`).
- Produces:

```ts
export const INSTALL_STEPS = ['token', 'site', 'music', 'mail', 'schedule', 'admin'] as const;
export type InstallStep = typeof INSTALL_STEPS[number];
export async function saveInstallStep(step: InstallStep, input: unknown): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }>;
export async function completeInstall(userId: string): Promise<void>; // role='admin', install.status='complete', clears setup token
export function gateDecision(path: string, installed: boolean, hasInstallSession: boolean):
  'next' | 'redirect:/install' | 'notfound';
```

**Gate (middleware + `gateDecision`):**
- Not installed: every path except `/install`, `/api/install/*`, `/api/auth/*`, `/api/health`, `/_next/*` and static assets → redirect to `/install`. The installer is served on any host and IP; there is no localhost restriction, by design.
- Installed: `/install` and `/api/install/*` → 404.
- `/admin/*` and `/api/admin/*` → only for `role === 'admin'`, otherwise 404.

**Wizard steps** (one screen each, progress bar, back/next, progress saved after every step so a reload resumes):
1. **Setup token**: enter the token from `docker compose logs app`. On success it sets an HttpOnly, Secure, SameSite=Strict `install_session` cookie (random value, hash in `install` setting, 2 h expiry). Every later install API call requires this cookie. Wrong tokens are limited to 5 attempts per IP per 15 min (in-memory counter), and the 6th gets `429`.
2. **Site**: public URL (prefilled from `x-forwarded-proto` + `x-forwarded-host`, which Cloudflare sets), site name, "Allow other people to sign up" (default off).
3. **Music services**: Spotify and/or Tidal toggles, client ID + secret for each, the exact redirect URIs with copy buttons, and links to the developer dashboards. At least one service must be enabled.
4. **Mail**: provider picker **Sender / Mailgun / Custom SMTP**, showing that provider's fields (see `MailSettings`), plus "From name" and "From email". **"Send test email"** button (POST `/api/install/test-mail` with the unsaved form + recipient) shows ✅ or the `MailError` message. "Next" is disabled until a test with the current values has succeeded, or the user ticks "Skip — set up mail later" (the digest is then off until mail is configured).
5. **Schedule**: daily sync time, weekly digest day + time and timezone (dropdown). Stored as cron strings and validated with `cron.validate`. Shows a preview line: "Sync every day at 06:00, digest every Friday at 18:00 (Europe/Amsterdam)".
6. **Admin account**: "Connect Spotify" / "Connect Tidal" buttons for the enabled services. The OAuth callback with a valid `install_session` cookie calls `completeInstall(userId)`, then redirects to `/releases` with a "Setup complete" toast and starts the first `syncUser` in the background.

**Admin settings** (`/admin/settings`): the same step components (Site, Music services, Mail with test button, Schedule), loaded with `redactSecrets` values. Saving through `PUT /api/admin/settings` keeps an existing secret when the field still holds `••••••`.

- [ ] **Step 1: Write failing tests:**
  - `gateDecision('/releases', false, false) === 'redirect:/install'`; `('/api/health', false, false) === 'next'`; `('/install', true, false) === 'notfound'`; `('/api/install/site', true, true) === 'notfound'`.
  - `saveInstallStep('site', …)` without a valid install session → rejected; with session → stored.
  - `token step rate-limits` — 5 wrong tokens then the correct one → `429`.
  - `music step requires at least one enabled service` → `errors.services`.
  - `mail step rejects saving without successful test unless skip` → `errors.mail`.
  - `schedule step rejects invalid cron` → `errors.syncCron`.
  - `completeInstall` sets role admin, `install.status === 'complete'`, and `ensureSetupToken()` then returns `null`.
  - `admin PUT keeps secret when '••••••' submitted`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Manual check: empty DB → `npm run dev` → log shows setup banner → `/releases` redirects to `/install` → finish the wizard with Mailpit as SMTP (`localhost:1025`, security none) → test email arrives at `http://127.0.0.1:8025` → `/install` now 404.
- [ ] **Step 6:** Commit: `feat: first-run installer and admin settings`.

---

### Task 6: Provider contract and resilient HTTP

**Files:**
- Create: `src/providers/types.ts`, `src/providers/http.ts`
- Test: `tests/providers/http.test.ts`

**Interfaces:**
- Produces:

```ts
export type ProviderName = 'spotify' | 'tidal';
export interface NormalizedArtist { providerId: string; name: string; imageUrl?: string }
export interface NormalizedRelease {
  providerId: string; title: string;
  rawType: string;                 // provider's value, e.g. 'single', 'EP'
  releaseDate: string;             // as given: 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD'
  coverUrl?: string; url: string; totalTracks?: number;
  artistProviderIds: string[];
}
export interface MusicProvider {
  name: ProviderName;
  getFollowedArtists(token: string): Promise<NormalizedArtist[]>;   // all pages
  getArtistReleases(token: string, artistProviderId: string, opts?: { maxPages?: number }): Promise<NormalizedRelease[]>;
}
export async function fetchWithRetry(url: string, init: RequestInit, opts?: { maxRetries?: number }): Promise<Response>;
export class ProviderHttpError extends Error { status: number; url: string }
```

- `fetchWithRetry`: on `429` waits `Retry-After` seconds (default 1). On `5xx` it backs off exponentially: 0.5s, 1s, 2s. `maxRetries` defaults to 3, after which it throws `ProviderHttpError`. A `401` throws immediately (the caller handles reconnect).

- [ ] **Step 1: Write failing tests** (MSW + fake timers):
  - `retries after Retry-After on 429 then succeeds` — first response `429` with `Retry-After: 2`, second `200`; assert 2 calls and ≥2000ms advanced.
  - `throws ProviderHttpError after maxRetries 5xx` — always `503`; assert 4 calls, error `.status === 503`.
  - `does not retry 401` — assert 1 call.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: provider contract and retrying fetch`.

---

### Task 7: Spotify provider

**Files:**
- Create: `src/providers/spotify.ts`, `tests/fixtures/spotify/following-page1.json`, `following-page2.json`, `artist-albums.json`
- Test: `tests/providers/spotify.test.ts`

**Interfaces:**
- Consumes: `MusicProvider`, `fetchWithRetry` (Task 6).
- Produces: `spotifyProvider: MusicProvider`.
  - `getFollowedArtists`: `GET https://api.spotify.com/v1/me/following?type=artist&limit=50`, follow `artists.next` until null.
  - `getArtistReleases`: `GET /v1/artists/{id}/albums?include_groups=album,single&limit=<max>`, follow `next` up to `maxPages` (default: all; daily sync passes 1). Maps `album_type`→`rawType`, `release_date`→`releaseDate`, `images[0].url`, `external_urls.spotify`, `total_tracks`, `artists[].id`.

- [ ] **Step 1: Write failing tests:**
  - `follows cursor pagination across pages` — fixtures with 50 + 3 artists → length 53.
  - `maps album fields to NormalizedRelease` — assert one item equals `{ providerId, title, rawType: 'single', releaseDate: '2026-11-07', url: 'https://open.spotify.com/album/…', artistProviderIds: [...] }`.
  - `respects maxPages` — `maxPages: 1` → one request made.
  - `sends Bearer token` — MSW handler asserts `Authorization: Bearer t`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: Spotify provider`.

---

### Task 8: Tidal provider

**Files:**
- Create: `src/providers/tidal.ts`, `src/providers/index.ts`, `tests/fixtures/tidal/*.json`
- Test: `tests/providers/tidal.test.ts`

**Interfaces:**
- Consumes: Task 6.
- Produces: `tidalProvider: MusicProvider`; `getProvider(name: ProviderName): MusicProvider` in `index.ts`.
  - JSON:API: send `Accept: application/vnd.api+json`; follow `links.next`; read `included` for album attributes and cover artwork. `countryCode` query param from the user's profile (fallback `NL`).
  - Maps `attributes.type` (`ALBUM` | `EP` | `SINGLE`) → `rawType`, `attributes.releaseDate`, `attributes.numberOfItems` → `totalTracks`, share link → `url` (fallback `https://tidal.com/album/{id}`).

- [ ] **Step 1:** Record real fixtures with a test account (`curl` with a token from Task 4). Confirm the endpoint paths and scopes listed in the Caveats section, and strip personal data from the fixtures.
- [ ] **Step 2: Write failing tests:** the same four as Task 7 (`follows links.next pagination`, `maps album fields` with `rawType: 'EP'`, `respects maxPages`, `sends JSON:API Accept header`), plus `getProvider('tidal') === tidalProvider`.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** Run → PASS.
- [ ] **Step 6:** Commit: `feat: Tidal provider`.

---

### Task 9: Classification, dates, de-duplication, sorting

**Files:**
- Create: `src/releases/normalize.ts`
- Test: `tests/releases/normalize.test.ts`

**Interfaces:**
- Produces:

```ts
export function parseReleaseDate(raw: string): { date: Date; precision: 'day' | 'month' | 'year' };
export function classifyRelease(provider: ProviderName, rawType: string): 'album' | 'single' | null; // null = skip
export function dedupeReleases(rs: NormalizedRelease[]): NormalizedRelease[];
export function sortReleases<T extends { releaseDate: Date; title: string }>(rs: T[]): T[];
export function formatReleaseDate(date: Date, precision: 'day'|'month'|'year'): string; // '7 Nov 2026' | 'Jun 2019' | '2019'
```

- Dedupe key: `lower(trim(title stripped of " (Explicit)"/" (Clean)"/" - Single"))` + classified type + `releaseDate`. Merge `artistProviderIds` and keep the item with the most `totalTracks`.

- [ ] **Step 1: Write failing tests:**

```ts
expect(parseReleaseDate('2019')).toEqual({ date: new Date('2019-01-01T00:00:00Z'), precision: 'year' });
expect(parseReleaseDate('2019-06')).toEqual({ date: new Date('2019-06-01T00:00:00Z'), precision: 'month' });
expect(classifyRelease('spotify', 'single')).toBe('single');
expect(classifyRelease('spotify', 'compilation')).toBeNull();
expect(classifyRelease('tidal', 'EP')).toBe('single');
expect(classifyRelease('tidal', 'ALBUM')).toBe('album');
// explicit + clean editions collapse; collaboration keeps both artists
expect(dedupeReleases([a, aClean]).length).toBe(1);
expect(dedupeReleases([collabFromX, collabFromY])[0].artistProviderIds.sort()).toEqual(['x', 'y']);
// newest first, title tiebreak
expect(sortReleases([old, newB, newA]).map(r => r.title)).toEqual(['A', 'B', 'Old']);
expect(formatReleaseDate(new Date('2019-06-01'), 'month')).toBe('Jun 2019');
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: release classification, dedupe and sorting`.

---

### Task 10: Sync service

**Files:**
- Create: `src/releases/sync.ts`, `src/app/api/sync/route.ts`
- Test: `tests/releases/sync.test.ts` (real test DB, fake `MusicProvider`)

**Interfaces:**
- Consumes: `getValidAccessToken`, `ReconnectRequiredError` (Task 4); `getProvider` (Task 8); `classifyRelease`, `parseReleaseDate`, `dedupeReleases` (Task 9).
- Produces:

```ts
export async function syncUser(userId: string, deps?: { providerFor?: (p: ProviderName) => MusicProvider }): Promise<{ newReleases: number }>;
export async function syncAll(): Promise<{ users: number; newReleases: number; failures: number }>;
```

- `syncUser`, for each linked account:
  1. Refresh the followed artists: upsert `Artist`, then replace that user's `UserArtist` set so unfollowed artists disappear.
  2. For each artist, fetch the full history if `lastSyncedAt` is null, else only the first page (`maxPages: 1`).
  3. Classify (skip null), dedupe, then upsert `Release` + `ReleaseArtist`, linking only artists we already know.
  4. Set `lastSyncedAt`.

  **Shared artists:** an `Artist` row is unique per `(provider, providerId)`. When several accounts on the same platform follow the same artist, there is still one `Artist` row with one `UserArtist` link per user, and its releases are stored once. The first user whose sync reaches that artist on a given day fetches its releases (artist catalogs are public data, so any user's token works). Later users only get the link and skip the fetch (`lastSyncedAt` is already today). If that user's token fails, the artist stays un-synced and the next user's sync fetches it. Unfollowing removes only that user's link; the `Artist` and its releases stay while anyone else follows it. A nightly cleanup deletes artists with no followers left, and their releases cascade. At most 5 artists are fetched in parallel. Each run writes a `SyncRun`.
- `syncAll` takes `pg_try_advisory_lock(424242)`; if it can't get the lock, it logs and returns. It loops over users. A `ReconnectRequiredError` or any other per-user error is recorded in `SyncRun.error`, increments `failures`, and the loop continues. After the loop it deletes `Artist` rows with no `UserArtist` left (the shared-artist cleanup).
- `POST /api/sync`: authenticated user only → `syncUser(session.user.id)` → `200 {newReleases}`; `401` when signed out.

- [ ] **Step 1: Write failing tests:**
  - `first sync stores releases and links artists` — fake provider with 2 artists, 3 releases (one compilation) → `newReleases === 2`, compilation absent.
  - `second sync is idempotent` — run twice → `Release` count unchanged, `newReleases === 0`.
  - `unfollowed artist removed from user` — second run without artist B → no `UserArtist` for B.
  - `artist followed by two users is fetched once per day` — users 1 and 2 follow artist A → one `Artist` row, two `UserArtist` rows, `getArtistReleases('A')` called once, both users see A's releases.
  - `unfollow by one user keeps artist for the other` — user 1 unfollows A → user 2 still sees A's releases; when user 2 also unfollows, the cleanup removes A.
  - `failed token for first user falls back to next user` — user 1's provider throws 401 on A → user 2's sync fetches A the same day.
  - `reconnect error does not stop other users` — user1 throws `ReconnectRequiredError`, user2 fine → `{ users: 2, failures: 1 }`, user2 releases stored.
  - `concurrent syncAll runs once` — `Promise.all([syncAll(), syncAll()])` → provider `getFollowedArtists` called once per user.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: daily sync service`.

---

### Task 11: Releases website

**Files:**
- Create: `src/releases/queries.ts`, `src/app/releases/page.tsx`, `src/app/settings/page.tsx`, components `ReleaseCard.tsx`, `ReconnectBanner.tsx`
- Test: `tests/releases/queries.test.ts`

**Interfaces:**
- Consumes: `prisma`, `sortReleases`, `formatReleaseDate`.
- Produces:

```ts
export interface ReleaseView { id: string; title: string; type: 'album'|'single'; releaseDate: Date; dateLabel: string;
  coverUrl?: string; url: string; artists: string[]; isNew: boolean /* firstSeenAt within 7 days */ }
export async function getReleasesForUser(userId: string, opts?: { sinceDays?: number /* default 90; 0 = all */ }):
  Promise<{ albums: ReleaseView[]; singles: ReleaseView[] }>;
```

- `/releases` (server component, auth-guarded):
  - Two sections, **Albums** and **Singles**, each a cover-art grid sorted newest first. Tabs on mobile, side by side on desktop.
  - Period filter `30 / 90 / 365 days / all` via `?since=`.
  - "Sync now" button (POST `/api/sync`) and "Last synced …" from the latest `SyncRun`.
  - `ReconnectBanner` when any account has `needsReconnect`.
  - Each card links to the release in Spotify/Tidal.
  - Empty state: "No releases yet — first sync is running".
  - Admins get a link to `/admin/settings`, plus a warning banner when mail is not configured.
- `/settings`: digest email (prefilled), digest on/off, connected accounts (connect the other service too).

- [ ] **Step 1: Write failing tests:**
  - `splits albums and singles, newest first` — seed 2 albums + 2 singles with different dates → assert order of titles in both arrays.
  - `only includes releases of followed artists` — release of unfollowed artist absent.
  - `sinceDays filters by releaseDate` — 100-day-old release absent at default, present with `sinceDays: 0`.
  - `collaboration shown once with both artist names`.
  - `same release from Spotify and Tidal shown once` — a user who connected both services and follows the artist on both → one card (same normalized title + type + release date), linking to the provider they connected first.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement the query and pages.
- [ ] **Step 4:** Run → PASS; `npm run dev`, sign in, check both sections in browser at desktop and 375px width.
- [ ] **Step 5:** Commit: `feat: releases dashboard and user settings`.

---

### Task 12: Weekly email digest

**Files:**
- Create: `src/digest/build.ts`, `src/digest/send.ts`, `src/digest/WeeklyDigestEmail.tsx`, `src/app/unsubscribe/route.ts`
- Test: `tests/digest/build.test.ts`, `tests/digest/send.test.ts`

**Interfaces:**
- Consumes: `getReleasesForUser`-style query, `formatReleaseDate`, `sendMail` / `MailError` (Task 3), `getSetting('site'|'schedule')` (Task 2).
- Produces:

```ts
export interface WeeklyDigest { userId: string; to: string; weekStart: Date; weekEnd: Date;
  albums: ReleaseView[]; singles: ReleaseView[]; unsubscribeUrl: string }
export async function buildWeeklyDigest(userId: string, now: Date): Promise<WeeklyDigest | null>;
export async function sendWeeklyDigests(now: Date, deps?: { send?: typeof sendMail }): Promise<{ sent: number; skipped: number; failed: number }>;
```

- Window: `[now − 7 days, now]` in the configured timezone, matched on `releaseDate`, only for releases with `precision === 'day'`. Returns `null` when there is no email address, the digest is disabled, or there are zero releases.
- Email:
  - Subject: `"🎵 {n} new releases this week ({d MMM} – {d MMM})"`.
  - Body: an Albums section, then a Singles section. Each card has the cover, title, artists and a "Listen" link.
  - Footer: link to the site plus `unsubscribeUrl` (`{publicUrl}/unsubscribe?token=…`), also sent as a `List-Unsubscribe` header.
  - Rendered to HTML + text with React Email and sent through `sendMail`, so it goes through whichever provider the admin chose.
- Sets `lastDigestSentAt` only after a successful send. A user who already got a digest in the last 6 days is skipped, so a worker restart can't send it twice. A `MailError` for one user is logged and counted in `failed`, and the loop continues. If mail is not configured, it logs one warning and returns `{sent:0, skipped:n, failed:0}`.
- `GET /unsubscribe?token=` → sets `digestEnabled=false`, shows confirmation page.

- [ ] **Step 1: Write failing tests:**
  - `includes only day-precision releases from last 7 days` — seed releases 2 days, 9 days old and a year-precision one → only the 2-day one.
  - `returns null with no releases`; `returns null without email`; `returns null when disabled`.
  - `sends once and records lastDigestSentAt` — fake `send`; call twice → `sent` 1 then 0.
  - `failed send does not set lastDigestSentAt` — `send` throws `MailError` → `failed === 1`, `lastDigestSentAt` null, other users still sent.
  - `mail not configured skips everyone without throwing`.
  - `email html lists Albums before Singles` — `indexOf('Albums') < indexOf('Singles')`.
  - `unsubscribe disables digest` — GET with token → `digestEnabled === false`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: weekly email digest`.

---

### Task 13: Scheduler worker

**Files:**
- Create: `src/worker.ts`, `tsconfig.worker.json` (compiles `src/worker.ts` + deps to `dist/`)
- Test: `tests/worker.test.ts`

**Interfaces:**
- Consumes: `syncAll` (Task 10), `sendWeeklyDigests` (Task 12), `getSetting('schedule')`, `getSettingsVersion`, `isInstalled` (Task 2).
- Produces: `startScheduler(): Promise<{ stop(): void }>`.
  - While the app is not installed, it checks `isInstalled()` every 30 s and registers nothing.
  - Once installed, it registers `cron.schedule(syncCron, syncAll, { timezone })` and `cron.schedule(digestCron, () => sendWeeklyDigests(new Date()), { timezone })`. Missing schedule settings fall back to the defaults from Global Constraints.
  - Every 60 s it compares `getSettingsVersion()` with the last version it saw. When the schedule changed, it stops and re-registers both jobs, so admin changes apply without a restart.
  - `RUN_SYNC_ON_START=true` triggers one `syncAll()` once installed.
  - The main block calls it and handles `SIGTERM` (stop jobs, `prisma.$disconnect()`). Each run logs one structured line: job, duration, counts.

- [ ] **Step 1: Write failing tests** (mock `node-cron`, fake timers):
  - `registers nothing before install`.
  - `registers both jobs with defaults after install` — `0 6 * * *`, `0 18 * * 5`, timezone `Europe/Amsterdam`.
  - `re-registers when schedule setting changes` — update `schedule` → old tasks `stop()`ed, new expressions registered.
  - `skips invalid stored cron and keeps previous jobs` (logs error).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: cron worker for daily sync and weekly digest`.

---

### Task 14: Docker, Compose and Cloudflare Tunnel

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `README.md`
- Modify: `docker-compose.yml`, `.env.example`, `next.config.ts` (`output: 'standalone'`)

**Interfaces:**
- Consumes: everything above. Image entrypoints: app `node server.js` (after `prisma migrate deploy`), worker `node dist/worker.js`.

**`Dockerfile`** (multi-stage): `node:22-alpine` → `deps` (`npm ci`) → `build` (`prisma generate`, `next build`, `tsc -p tsconfig.worker.json`) → `runner` (non-root `node` user, copies `.next/standalone`, `.next/static`, `public`, `dist`, `prisma`, `node_modules/.prisma`; `ENV NODE_ENV=production`).

**`docker-compose.yml`:**

```yaml
name: music-releases

x-app-env: &app-env
  DATABASE_URL: postgresql://${POSTGRES_USER:-music}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-music}
  APP_SECRET: ${APP_SECRET:?set APP_SECRET}
  INSTALL_TOKEN: ${INSTALL_TOKEN:-}
  TZ: ${TZ:-Europe/Amsterdam}

services:
  db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-music}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB:-music}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-music}"]
      interval: 10s
      retries: 5
    networks: [internal]

  app:
    build: .
    image: music-releases:latest
    restart: unless-stopped
    command: sh -c "npx prisma migrate deploy && node server.js"
    environment:
      <<: *app-env
      HOSTNAME: 0.0.0.0
      PORT: 3000
    depends_on:
      db: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      retries: 3
    networks: [internal]
    # no "ports:" — reachable only through the tunnel.
    # Local install without a tunnel: add  ports: ["127.0.0.1:3000:3000"]

  worker:
    image: music-releases:latest
    restart: unless-stopped
    command: node dist/worker.js
    environment:
      <<: *app-env
      RUN_SYNC_ON_START: ${RUN_SYNC_ON_START:-false}
    depends_on:
      app: { condition: service_healthy }   # app runs migrations first
    networks: [internal]

  cloudflared:
    image: cloudflare/cloudflared:latest      # pin a dated tag in production, e.g. 2026.x.y
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN:?set TUNNEL_TOKEN}
    depends_on:
      app: { condition: service_healthy }
    networks: [internal]

  mailpit:                                    # dev only: docker compose --profile dev up
    image: axllent/mailpit:latest
    profiles: [dev]
    ports: ["127.0.0.1:8025:8025"]            # web UI; SMTP for the installer: host mailpit, port 1025, security none
    networks: [internal]

volumes:
  pgdata:

networks:
  internal:
```

**`.env.example`:** the bootstrap variables from Global Constraints only, with comments. Include `openssl rand -base64 48` as the way to generate `APP_SECRET`, and a warning that losing `APP_SECRET` makes stored settings unreadable, so back it up together with the database.

**README – first run:**
1. **Tunnel:** Cloudflare dashboard → Zero Trust → Networks → Tunnels → *Create tunnel* → **Cloudflared** → name `music-releases`. Copy the token into `.env` as `TUNNEL_TOKEN`. Then add a *Public hostname*, `releases.<yourdomain>` → service **HTTP** → URL **`app:3000`** (the compose service name, which cloudflared resolves on the `internal` network).
2. `cp .env.example .env`, fill in `POSTGRES_PASSWORD`, `APP_SECRET`, `TUNNEL_TOKEN` → `docker compose up -d`.
3. `docker compose logs app | grep -A1 "MusicReleases setup"` → copy the setup token.
4. Open `https://releases.<yourdomain>` from anywhere, which redirects to the installer. Enter the token and follow the steps. The installer shows the redirect URIs to paste into the Spotify/Tidal developer dashboards, and it tests the mail settings (Sender, Mailgun or SMTP).
5. Optional: put a Cloudflare Access policy in front of the hostname. Exclude `/api/auth/*` and `/unsubscribe`, so OAuth callbacks and email links still work.

- [ ] **Step 1:** Write `Dockerfile`, `.dockerignore`, compose file, `.env.example`.
- [ ] **Step 2:** `docker compose build` → succeeds; image size < 400 MB.
- [ ] **Step 3:** `docker compose --profile dev up -d` → `docker compose ps` shows `db` and `app` healthy, with `worker` and `cloudflared` running. `docker compose logs cloudflared` shows `Registered tunnel connection`, and `docker compose logs app` shows the setup banner.
- [ ] **Step 4:** Open `https://<public host>` → finish the installer with Mailpit SMTP → connect Spotify → "Sync now" → Albums/Singles shown. Trigger the digest with `docker compose exec worker node -e "import('./dist/digest/send.js').then(m => m.sendWeeklyDigests(new Date()))"` and see it in Mailpit at `http://127.0.0.1:8025`. Confirm `/install` now returns 404.
- [ ] **Step 5:** Write the README: prerequisites, the first-run steps above, Spotify app setup (including allowlisting users in Development Mode), Tidal app setup, and backups (`docker compose exec db pg_dump` + `APP_SECRET`).
- [ ] **Step 6:** Commit: `feat: Docker image, compose stack with Cloudflare Tunnel`.

---

## Git workflow (git flow)

- `main` = released code only; `develop` = integration branch.
- Each task: `git checkout -b feature/task-NN-<slug> develop` → commits → merge into `develop` with `--no-ff`.
- Release: `release/vX.Y.Z` from `develop` → merge to `main` + tag `vX.Y.Z` → merge back to `develop`.
- Urgent fixes: `hotfix/<slug>` from `main`, merged into both.

## Self-review notes

- Requirement coverage: 1→T4, 2→T7/T8/T10, 3→T9/T11, 4→T11, 5→T10/T13, 6→T12/T13, 7→"Recommended frameworks", 8→T14, 9→T2/T5/T14, 10→T3/T5.
- Review Focus items each have a test: 1→T5, 2→T4+T10, 3→T3+T12, 4→T9+T12, 5→T9+T11.
- Open items left to their tasks on purpose: the exact Tidal endpoint paths and scopes (Task 8), and the exact Sender send endpoint and payload (Task 3). Both get confirmed against the live API docs and recorded as fixtures.
