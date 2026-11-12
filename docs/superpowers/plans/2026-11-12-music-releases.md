# Music Releases Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hosted website where a user connects Spotify or Tidal, sees the latest releases of the artists they follow (newest first, split into Albums and Singles), refreshed daily by a scheduled job, with a weekly email digest of that week's releases.

**Architecture:** One TypeScript codebase, built into one Docker image that runs as two containers: `app` (Next.js website + OAuth) and `worker` (node-cron scheduler running the daily sync and weekly digest). Both share a PostgreSQL database through Prisma. Each streaming service sits behind one `MusicProvider` interface, so sync, sorting and email logic know nothing about Spotify or Tidal. A `cloudflared` container publishes `app` over a Cloudflare Tunnel, so no ports are opened on the host.

**Tech Stack:** Node.js 22 LTS, TypeScript (strict), Next.js 16 (App Router, server components), Better Auth (Spotify social provider + Generic OAuth plugin for Tidal), Prisma ORM, PostgreSQL 17, node-cron, Nodemailer (SMTP) + React Email, Tailwind CSS, Vitest + MSW (HTTP mocks), Docker + Docker Compose, Cloudflare Tunnel (`cloudflare/cloudflared`), Mailpit (dev only).

**Spec:** No separate spec document; the spec is the user request of 2026-11-12, restated in "Requirements" below.

---

## Requirements (from the request)

1. User connects with **Spotify or Tidal** (OAuth; the user does the connecting).
2. Retrieve the **latest releases of artists the user follows**.
3. Order **newest release first**; **separate singles from albums**.
4. **Display them on a website.**
5. **Cron job runs daily** to check for and store new releases.
6. **Email once a week** with the releases of that week.
7. Recommend frameworks/platform (see next section).
8. **Dockerized**, with **Cloudflare Tunnel** configured in `docker-compose.yml`.

## Recommended frameworks & platform (and why)

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript on Node 22 LTS | One language for UI, API, worker and email templates; both APIs are plain JSON over HTTPS. |
| Web framework | **Next.js 16** (App Router) | Server components read the DB directly — no separate API layer needed for the dashboard; route handlers cover OAuth callbacks and "sync now". |
| Auth / OAuth | **Better Auth** | Built-in Spotify provider, Generic OAuth plugin for Tidal (PKCE), stores and refreshes access/refresh tokens, Prisma adapter. (Auth.js is now maintained under Better Auth, so this is the forward path.) |
| Database | **PostgreSQL 17** + **Prisma** | Relational data (users ↔ artists ↔ releases), typed queries, migrations; `pg_advisory_lock` prevents two syncs at once. SQLite would work for one user but Postgres is safer with two containers writing. |
| Scheduler | **node-cron** in a dedicated `worker` container | Same code and image as the app, cron expressions + timezone from env, no host crontab. Swap for BullMQ + Redis only if you ever need retries across restarts or many users. |
| Email | **Nodemailer (SMTP)** + **React Email** | Provider-neutral: any SMTP (Resend, Brevo, Postmark, Gmail app password). React Email renders HTML + plain-text from the same components as the site. |
| Styling | Tailwind CSS | Fast to build two-column release grid with cover art. |
| Tests | Vitest + MSW | MSW replays recorded Spotify/Tidal JSON so provider clients are tested without network. |
| Hosting | Docker Compose on any always-on box (home server, NAS, VPS) + **Cloudflare Tunnel** | HTTPS public hostname without port forwarding — Spotify requires an `https` redirect URI for non-loopback hosts. |

**Platform caveats to verify before starting (APIs change):**
- **Spotify:** apps in Development Mode only allow a small allowlist of users (added by email in the developer dashboard). Fine for personal/family use; wider use needs an extended-quota application. Endpoints used: `GET /v1/me/following?type=artist` (scope `user-follow-read`, cursor paging), `GET /v1/artists/{id}/albums?include_groups=album,single` (offset paging), `GET /v1/me` (scope `user-read-email`). Check the current max page size and rate-limit guidance in the docs.
- **Tidal:** developer.tidal.com, API v2 at `https://openapi.tidal.com/v2` (JSON:API format), OAuth 2.1 Authorization Code + PKCE. Followed artists come from the user's collection (`userCollections/{userId}/relationships/artists`), releases from `artists/{id}/relationships/albums`; album attributes carry `type` (ALBUM / EP / SINGLE) and `releaseDate`. Confirm exact paths and scope names (collection read, user read) against the live OpenAPI spec in Task 5 — record fixtures from real responses.

## Global Constraints

- Node.js `22` LTS; TypeScript `strict: true`; ESM.
- All timestamps stored in UTC; release dates stored as `DATE` plus a `datePrecision` of `day | month | year`.
- Schedules from env: `SYNC_CRON` default `0 6 * * *`, `DIGEST_CRON` default `0 18 * * 5` (Friday 18:00 — new music lands on Fridays), `TZ` default `Europe/Amsterdam`.
- "Single" bucket = Spotify `single` (Spotify reports EPs as `single`) and Tidal `SINGLE` + `EP`. "Album" bucket = Spotify `album`, Tidal `ALBUM`. Compilations and "appears on" are excluded.
- OAuth redirect URIs: `https://${PUBLIC_HOST}/api/auth/callback/spotify` and `https://${PUBLIC_HOST}/api/auth/oauth2/callback/tidal`.
- Secrets only via env (`.env`, never committed): `DATABASE_URL`, `BETTER_AUTH_SECRET`, `SPOTIFY_CLIENT_ID/SECRET`, `TIDAL_CLIENT_ID/SECRET`, `SMTP_URL`, `MAIL_FROM`, `TUNNEL_TOKEN`, `PUBLIC_HOST`.
- OAuth tokens encrypted at rest (enable Better Auth's OAuth-token encryption option; if unavailable in the installed version, wrap the adapter with AES-256-GCM keyed from `BETTER_AUTH_SECRET`).
- Sorting everywhere: `releaseDate` desc, then `title` asc as tiebreaker.

## Review Focus

1. **Expired or revoked token** — refresh fails → that account is marked `needsReconnect`, the dashboard shows a "Reconnect Spotify/Tidal" banner, and the sync continues for other users. (Test in Task 7.)
2. **Rate limit (HTTP 429 with `Retry-After`)** — client waits the given seconds and retries (max 3), never silently skips an artist. (Test in Task 4.)
3. **Year- or month-only release dates** (`"2019"`, `"2019-06"`) — stored as first day of period with precision, sorted correctly, displayed as `2019` / `Jun 2019`, and never counted as "this week" in the digest unless precision is `day`. (Tests in Tasks 6 and 9.)
4. **Duplicates** — same release returned twice (explicit + clean edition, market variants) or a collaboration between two followed artists → shown once, credited to both artists. (Test in Task 6.)
5. **No email address / nothing released this week** — Tidal profile without email → digest skipped until the user enters one in Settings; a week with zero releases → no email sent. (Tests in Task 9.)

---

## File Structure

```
.
├── Dockerfile                      # multi-stage build → one image for app + worker
├── docker-compose.yml              # db, app, worker, cloudflared, mailpit (profile: dev)
├── .env.example
├── README.md                       # setup: Spotify app, Tidal app, tunnel, first run
├── prisma/schema.prisma
├── src/
│   ├── lib/
│   │   ├── db.ts                   # Prisma client singleton
│   │   ├── auth.ts                 # Better Auth config (Spotify + Tidal)
│   │   ├── auth-client.ts          # Better Auth React client
│   │   └── tokens.ts               # getValidAccessToken()
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
│       ├── releases/page.tsx       # dashboard: Albums | Singles
│       ├── settings/page.tsx       # digest email + on/off
│       ├── api/auth/[...all]/route.ts
│       ├── api/sync/route.ts       # POST: sync now (current user)
│       ├── api/health/route.ts
│       └── unsubscribe/route.ts
└── tests/
    ├── fixtures/spotify/*.json, fixtures/tidal/*.json
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
- Prisma models (Better Auth adds `User`, `Session`, `Account`, `Verification` in Task 2 via its CLI; add these app models now):

```prisma
enum Provider { spotify tidal }
enum ReleaseType { album single }
enum DatePrecision { day month year }

model Artist {
  id          String   @id @default(cuid())
  provider    Provider
  providerId  String
  name        String
  imageUrl    String?
  lastSyncedAt DateTime?
  followers   UserArtist[]
  releases    ReleaseArtist[]
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
  userId          String   @id
  digestEmail     String?
  digestEnabled   Boolean  @default(true)
  unsubscribeToken String  @unique @default(cuid())
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

- [ ] **Step 1:** `npx create-next-app@latest . --ts --app --tailwind --src-dir --eslint --use-npm`, then `npm i prisma @prisma/client` and `npm i -D vitest msw @vitejs/plugin-react`. Add scripts `test`, `db:migrate` (`prisma migrate deploy`), `worker` (`node dist/worker.js`).
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
- [ ] **Step 7:** `git init` (if needed) and commit: `chore: scaffold Next.js app, Prisma schema, health check`.

---

### Task 2: Connect with Spotify or Tidal (Better Auth)

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/lib/tokens.ts`, `src/app/api/auth/[...all]/route.ts`, `src/app/page.tsx`
- Modify: `prisma/schema.prisma` (Better Auth tables via `npx @better-auth/cli generate`; add `needsReconnect Boolean @default(false)` to `Account`)
- Test: `tests/lib/tokens.test.ts`

**Interfaces:**
- Produces:
  - `auth` (Better Auth instance). Spotify scopes: `user-follow-read user-read-email`. Tidal via `genericOAuth` with `providerId: 'tidal'`, `pkce: true`, authorization/token URLs from Tidal docs, scopes for user + collection read.
  - On first sign-in (`databaseHooks.user.create.after`): create `UserSettings { userId, digestEmail: user.email ?? null }`.
  - `getValidAccessToken(userId: string, provider: 'spotify' | 'tidal'): Promise<string>` — returns a usable token, refreshing via Better Auth's `auth.api.getAccessToken` when expired; on refresh failure sets `Account.needsReconnect = true` and throws `ReconnectRequiredError`.
  - `class ReconnectRequiredError extends Error { provider; userId }`.
- Landing page: two buttons "Connect Spotify" / "Connect Tidal" calling `authClient.signIn.social({ provider: 'spotify' })` / `authClient.signIn.oauth2({ providerId: 'tidal' })`; signed-in users are redirected to `/releases`.

- [ ] **Step 1: Write the failing tests** (mock `auth.api.getAccessToken`):

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

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `auth.ts`, route handler (`toNextJsHandler(auth)`), `tokens.ts`, landing page. Successful sign-in resets `needsReconnect = false`.
- [ ] **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Manual check: create Spotify app (redirect `http://127.0.0.1:3000/api/auth/callback/spotify` for local dev), sign in, confirm `Account` row has access + refresh token (encrypted).
- [ ] **Step 6:** Commit: `feat: connect via Spotify or Tidal with Better Auth`.

---

### Task 3: Provider contract and resilient HTTP

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

- `fetchWithRetry`: on `429` waits `Retry-After` seconds (default 1), on `5xx` exponential backoff 0.5s/1s/2s; `maxRetries` default 3; then throws `ProviderHttpError`. `401` throws immediately (caller handles reconnect).

- [ ] **Step 1: Write failing tests** (MSW + fake timers):
  - `retries after Retry-After on 429 then succeeds` — first response `429` with `Retry-After: 2`, second `200`; assert 2 calls and ≥2000ms advanced.
  - `throws ProviderHttpError after maxRetries 5xx` — always `503`; assert 4 calls, error `.status === 503`.
  - `does not retry 401` — assert 1 call.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: provider contract and retrying fetch`.

---

### Task 4: Spotify provider

**Files:**
- Create: `src/providers/spotify.ts`, `tests/fixtures/spotify/following-page1.json`, `following-page2.json`, `artist-albums.json`
- Test: `tests/providers/spotify.test.ts`

**Interfaces:**
- Consumes: `MusicProvider`, `fetchWithRetry` (Task 3).
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

### Task 5: Tidal provider

**Files:**
- Create: `src/providers/tidal.ts`, `src/providers/index.ts`, `tests/fixtures/tidal/*.json`
- Test: `tests/providers/tidal.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces: `tidalProvider: MusicProvider`; `getProvider(name: ProviderName): MusicProvider` in `index.ts`.
  - JSON:API: send `Accept: application/vnd.api+json`; follow `links.next`; read `included` for album attributes and cover artwork. `countryCode` query param from the user's profile (fallback `NL`).
  - Maps `attributes.type` (`ALBUM` | `EP` | `SINGLE`) → `rawType`, `attributes.releaseDate`, `attributes.numberOfItems` → `totalTracks`, share link → `url` (fallback `https://tidal.com/album/{id}`).

- [ ] **Step 1:** Record real fixtures with a test account (`curl` with a token from Task 2) — confirm the endpoint paths and scopes from the Caveats section; strip personal data from fixtures.
- [ ] **Step 2: Write failing tests:** same four as Task 4 (`follows links.next pagination`, `maps album fields` with `rawType: 'EP'`, `respects maxPages`, `sends JSON:API Accept header`), plus `getProvider('tidal') === tidalProvider`.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** Run → PASS.
- [ ] **Step 6:** Commit: `feat: Tidal provider`.

---

### Task 6: Classification, dates, de-duplication, sorting

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

- Dedupe key: `lower(trim(title stripped of " (Explicit)"/" (Clean)"/" - Single"))` + classified type + `releaseDate`; merge `artistProviderIds`; keep the item with most `totalTracks`.

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

### Task 7: Sync service

**Files:**
- Create: `src/releases/sync.ts`, `src/app/api/sync/route.ts`
- Test: `tests/releases/sync.test.ts` (real test DB, fake `MusicProvider`)

**Interfaces:**
- Consumes: `getValidAccessToken`, `ReconnectRequiredError` (Task 2); `getProvider` (Task 5); `classifyRelease`, `parseReleaseDate`, `dedupeReleases` (Task 6).
- Produces:

```ts
export async function syncUser(userId: string, deps?: { providerFor?: (p: ProviderName) => MusicProvider }): Promise<{ newReleases: number }>;
export async function syncAll(): Promise<{ users: number; newReleases: number; failures: number }>;
```

- `syncUser`: for each linked account → refresh followed artists (upsert `Artist`, replace that user's `UserArtist` set so unfollows disappear) → for each artist: full history if `lastSyncedAt` is null, else `maxPages: 1` → classify (skip null), dedupe, upsert `Release` + `ReleaseArtist` (only link artists we know) → set `lastSyncedAt`. An artist already synced today by another user is skipped (shared cache). Concurrency: max 5 artists in parallel. Writes a `SyncRun`.
- `syncAll`: takes `pg_try_advisory_lock(424242)`; if not acquired, logs and returns. Loops users; `ReconnectRequiredError` or any per-user error → recorded in `SyncRun.error`, `failures++`, continue.
- `POST /api/sync`: authenticated user only → `syncUser(session.user.id)` → `200 {newReleases}`; `401` when signed out.

- [ ] **Step 1: Write failing tests:**
  - `first sync stores releases and links artists` — fake provider with 2 artists, 3 releases (one compilation) → `newReleases === 2`, compilation absent.
  - `second sync is idempotent` — run twice → `Release` count unchanged, `newReleases === 0`.
  - `unfollowed artist removed from user` — second run without artist B → no `UserArtist` for B.
  - `reconnect error does not stop other users` — user1 throws `ReconnectRequiredError`, user2 fine → `{ users: 2, failures: 1 }`, user2 releases stored.
  - `concurrent syncAll runs once` — `Promise.all([syncAll(), syncAll()])` → provider `getFollowedArtists` called once per user.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: daily sync service`.

---

### Task 8: Releases website

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

- `/releases` (server component, auth-guarded): two sections — **Albums** and **Singles** — each a cover-art grid sorted newest first; tabs on mobile, side-by-side on desktop. Period filter `30 / 90 / 365 days / all` via `?since=`. "Sync now" button (POST `/api/sync`), "Last synced …" from latest `SyncRun`, `ReconnectBanner` when any account has `needsReconnect`. Each card links to the release in Spotify/Tidal. Empty state: "No releases yet — first sync runs after you connect" and trigger `syncUser` right after first sign-in.
- `/settings`: digest email (prefilled), digest on/off, connected accounts (connect the other service too).

- [ ] **Step 1: Write failing tests:**
  - `splits albums and singles, newest first` — seed 2 albums + 2 singles with different dates → assert order of titles in both arrays.
  - `only includes releases of followed artists` — release of unfollowed artist absent.
  - `sinceDays filters by releaseDate` — 100-day-old release absent at default, present with `sinceDays: 0`.
  - `collaboration shown once with both artist names`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement query + pages.
- [ ] **Step 4:** Run → PASS; `npm run dev`, sign in, check both sections in browser at desktop and 375px width.
- [ ] **Step 5:** Commit: `feat: releases dashboard and settings`.

---

### Task 9: Weekly email digest

**Files:**
- Create: `src/digest/build.ts`, `src/digest/send.ts`, `src/digest/WeeklyDigestEmail.tsx`, `src/app/unsubscribe/route.ts`
- Test: `tests/digest/build.test.ts`, `tests/digest/send.test.ts`

**Interfaces:**
- Consumes: `getReleasesForUser`-style query, `formatReleaseDate`.
- Produces:

```ts
export interface WeeklyDigest { userId: string; to: string; weekStart: Date; weekEnd: Date;
  albums: ReleaseView[]; singles: ReleaseView[]; unsubscribeUrl: string }
export async function buildWeeklyDigest(userId: string, now: Date): Promise<WeeklyDigest | null>;
export async function sendWeeklyDigests(now: Date, transport?: Transporter): Promise<{ sent: number; skipped: number }>;
```

- Window: `[now − 7 days, now]` in `TZ`, on `releaseDate` with `precision === 'day'` only. Returns `null` when no email, digest disabled, or zero releases.
- Email: subject `"🎵 {n} new releases this week ({d MMM} – {d MMM})"`; Albums section then Singles section, each card cover + title + artists + "Listen" link; footer link to site + `unsubscribeUrl` (`https://${PUBLIC_HOST}/unsubscribe?token=…`). Rendered to HTML + text with React Email. Sets `lastDigestSentAt`; skips a user already sent within the last 6 days (protects against worker restarts double-sending).
- `GET /unsubscribe?token=` → sets `digestEnabled=false`, shows confirmation page.

- [ ] **Step 1: Write failing tests:**
  - `includes only day-precision releases from last 7 days` — seed releases 2 days, 9 days old and a year-precision one → only the 2-day one.
  - `returns null with no releases`; `returns null without email`; `returns null when disabled`.
  - `sendWeeklyDigests sends once and records lastDigestSentAt` — use Nodemailer `jsonTransport`; call twice → `sent` 1 then 0.
  - `email html lists Albums before Singles` — `indexOf('Albums') < indexOf('Singles')`.
  - `unsubscribe disables digest` — GET with token → `digestEnabled === false`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: weekly email digest`.

---

### Task 10: Scheduler worker

**Files:**
- Create: `src/worker.ts`, `tsconfig.worker.json` (compiles `src/worker.ts` + deps to `dist/`)
- Test: `tests/worker.test.ts`

**Interfaces:**
- Consumes: `syncAll` (Task 7), `sendWeeklyDigests` (Task 9).
- Produces: `startScheduler(env = process.env): { stop(): void }` — registers `cron.schedule(SYNC_CRON, syncAll, { timezone: TZ })` and `cron.schedule(DIGEST_CRON, () => sendWeeklyDigests(new Date()), { timezone: TZ })`; validates expressions with `cron.validate` and throws on invalid; `RUN_SYNC_ON_START=true` triggers one `syncAll()` at boot. Main block calls it and handles `SIGTERM` (stop jobs, `prisma.$disconnect()`). Structured log line per run: job, duration, counts.

- [ ] **Step 1: Write failing tests** (mock `node-cron`):
  - `registers both jobs with defaults` — expressions `0 6 * * *` and `0 18 * * 5`, timezone `Europe/Amsterdam`.
  - `uses env overrides`.
  - `throws on invalid cron expression`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: cron worker for daily sync and weekly digest`.

---

### Task 11: Docker, Compose and Cloudflare Tunnel

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `README.md`
- Modify: `docker-compose.yml`, `.env.example`, `next.config.ts` (`output: 'standalone'`)

**Interfaces:**
- Consumes: everything above. Image entrypoints: app `node server.js` (after `prisma migrate deploy`), worker `node dist/worker.js`.

**`Dockerfile`** (multi-stage): `node:22-alpine` → `deps` (`npm ci`) → `build` (`prisma generate`, `next build`, `tsc -p tsconfig.worker.json`) → `runner` (non-root `node` user, copies `.next/standalone`, `.next/static`, `public`, `dist`, `prisma`, `node_modules/.prisma`; `ENV NODE_ENV=production`).

**`docker-compose.yml`:**

```yaml
name: music-releases

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
    env_file: .env
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-music}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-music}
      BETTER_AUTH_URL: https://${PUBLIC_HOST}
      HOSTNAME: 0.0.0.0
      PORT: 3000
    depends_on:
      db: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      retries: 3
    networks: [internal]
    # no "ports:" — only reachable through the tunnel.
    # For local debugging: docker compose run --service-ports, or add "127.0.0.1:3000:3000"

  worker:
    image: music-releases:latest
    restart: unless-stopped
    command: node dist/worker.js
    env_file: .env
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-music}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-music}
      TZ: ${TZ:-Europe/Amsterdam}
      SYNC_CRON: ${SYNC_CRON:-0 6 * * *}
      DIGEST_CRON: ${DIGEST_CRON:-0 18 * * 5}
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
    ports: ["127.0.0.1:8025:8025"]
    networks: [internal]

volumes:
  pgdata:

networks:
  internal:
```

**`.env.example`:** every variable from Global Constraints plus `POSTGRES_USER/PASSWORD/DB`, `TZ`, `SYNC_CRON`, `DIGEST_CRON`, `RUN_SYNC_ON_START`, with comments; `SMTP_URL=smtp://mailpit:1025` as dev default.

**README – Cloudflare Tunnel setup (token mode, remotely managed):**
1. Cloudflare dashboard → Zero Trust → Networks → Tunnels → *Create tunnel* → type **Cloudflared** → name `music-releases`.
2. Copy the token from the shown `cloudflared ... run --token <TOKEN>` command into `.env` as `TUNNEL_TOKEN`.
3. *Public hostname*: `releases.<yourdomain>` → service **HTTP** → URL **`app:3000`** (the compose service name — cloudflared resolves it on the `internal` network).
4. Set `PUBLIC_HOST=releases.<yourdomain>` and register the redirect URIs from Global Constraints in the Spotify and Tidal developer dashboards.
5. Optional: put a Cloudflare Access policy in front of the hostname for extra protection — but exclude `/api/auth/*` and `/unsubscribe` so OAuth callbacks and email links still work.

- [ ] **Step 1:** Write `Dockerfile`, `.dockerignore`, compose file, `.env.example`.
- [ ] **Step 2:** `docker compose build` → succeeds; image size < 400 MB.
- [ ] **Step 3:** `docker compose --profile dev up -d` → `docker compose ps` shows `db`, `app` healthy, `worker` and `cloudflared` running; `docker compose logs cloudflared` shows `Registered tunnel connection`.
- [ ] **Step 4:** Open `https://${PUBLIC_HOST}`, connect Spotify, press "Sync now", see Albums/Singles. Run `docker compose exec worker node -e "require('./dist/digest/send.js').sendWeeklyDigests(new Date())"` and see the email in Mailpit at `http://127.0.0.1:8025`.
- [ ] **Step 5:** Write README (prerequisites, Spotify app setup incl. allowlisting users in Development Mode, Tidal app setup, tunnel steps, backups: `docker compose exec db pg_dump`).
- [ ] **Step 6:** Commit: `feat: Docker image, compose stack with Cloudflare Tunnel`.

---

## Self-review notes

- Requirement coverage: 1→T2, 2→T4/T5/T7, 3→T6/T8, 4→T8, 5→T7/T10, 6→T9/T10, 7→"Recommended frameworks", 8→T11.
- Review Focus items each have a test: 1→T2+T7, 2→T3, 3→T6+T9, 4→T6+T8, 5→T9.
- Open item deliberately left to Task 5: exact Tidal endpoint paths and scope names, to be confirmed against the live OpenAPI spec and recorded as fixtures.
