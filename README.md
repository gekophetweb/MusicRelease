# MusicReleases

A self-hosted site that shows the newest albums and singles from the artists you follow on **Spotify** or **TIDAL**, newest first, with albums and singles kept apart. A worker checks for new releases every day and sends a weekly email (through Sender, Mailgun or your own SMTP server).

Everything is configured in a web installer on first start. Only three secrets live in `.env`.

## What runs

| Container | What it does |
|---|---|
| `db` | PostgreSQL 17 with its own volume, only reachable on the internal Docker network |
| `app` | The website, installer and Spotify/TIDAL sign-in (Next.js). Applies database migrations on start |
| `worker` | The daily release sync and the weekly email (same image, `node dist/worker.mjs`) |
| `cloudflared` | Cloudflare Tunnel: publishes `app` on your hostname over HTTPS without opening any port |
| `mailpit` | Dev only (`--profile dev`): catches outgoing mail at http://127.0.0.1:8025 |

## First run

### 1. Create the Cloudflare Tunnel

1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel** → type **Cloudflared**, name it `music-releases`.
2. Copy the token from the `cloudflared ... run --token <TOKEN>` command shown. You do not need to install anything; the `cloudflared` container uses it.
3. Under **Public hostname** add `releases.<your-domain>` → service type **HTTP** → URL **`app:3000`** (the compose service name).

### 2. Configure and start

```bash
cp .env.example .env
```

Fill in `POSTGRES_PASSWORD` (letters and digits only, e.g. `openssl rand -hex 32`; characters such as / @ # % and the dollar sign break the database URL), `APP_SECRET` (`openssl rand -base64 48`) and `TUNNEL_TOKEN`, then:

```bash
docker compose up -d --build
```

### 3. Open the installer

Get the setup token from the app log:

```bash
docker compose logs app | grep -A1 "MusicReleases setup"
```

Open `https://releases.<your-domain>` from anywhere; it sends you to the installer. The installer is public until setup is finished, which is why it starts with this token (wrong tokens are rate limited). The steps:

1. **Setup token** from the log.
2. **Site**: the public URL (prefilled) and whether other people may sign up.
3. **Music services**: Spotify and/or TIDAL client ID and secret. The installer shows the exact redirect URIs to paste into the developer dashboards:
   - Spotify: `https://releases.<your-domain>/api/auth/callback/spotify`
   - TIDAL: `https://releases.<your-domain>/api/auth/callback/tidal`
4. **Mail**: Sender, Mailgun or custom SMTP. "Send test email" must succeed before you can continue (or choose "Set up mail later").
5. **Schedule**: daily sync time, weekly email day/time and timezone (defaults: 06:00 daily, Friday 18:00).
6. **Your account**: connect Spotify or TIDAL. That account becomes the admin and the installer is locked for good (`/install` returns 404).

All of this can be changed later under **Admin → Settings**.

## Music service apps

**Spotify** — https://developer.spotify.com/dashboard → Create app → Web API. Add the redirect URI above. While the app is in *Development Mode*, only users you add under **User Management** (by their Spotify email) can connect; that is fine for personal or family use.

**TIDAL** — https://developer.tidal.com/dashboard → create an app, add the redirect URI above, and enable the `user.read` and `collection.read` scopes.

## Mail providers

- **Sender** (sender.net): API token from Settings → API access tokens. The from address must be a verified sender.
- **Mailgun**: sending domain, API key and region (EU or US). The domain must be verified in Mailgun.
- **Custom SMTP**: host, port, encryption (STARTTLS 587 / TLS 465 / none) and optional username and password.

## How releases are handled

- Followed artists are read from your Spotify follows or your TIDAL collection.
- **Albums** = albums. **Singles** = singles and EPs. Compilations and "appears on" are left out.
- An artist followed by several people is stored and fetched once per day; unfollowing only removes your link.
- Explicit and clean editions, and the same release on both Spotify and TIDAL, are shown once.
- The weekly email lists releases dated in the past 7 days (day-exact dates only) and is skipped when there are none.

## Backups

```bash
docker compose exec db pg_dump -U music music > backup.sql
```

Keep `APP_SECRET` with the backup; settings and tokens are encrypted with it.

## Development

Requirements: Node 22+, Docker.

```bash
npm install
```

```bash
npm run test:db
```

```bash
npm test
```

`npm run test:db` starts a throwaway Postgres on `127.0.0.1:54329` for the tests. For the dev server, point `DATABASE_URL` in `.env` at a database, set `APP_SECRET`, run `npx prisma migrate deploy`, then `npm run dev` (website) and `npm run dev:worker` (scheduler). Note that Spotify only accepts `http://127.0.0.1:<port>` (not `localhost`) as a local redirect URI.

Git flow: `main` holds releases, `develop` integrates; work happens on `feature/*` branches.
