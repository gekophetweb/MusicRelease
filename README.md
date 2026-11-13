# MusicReleases

A self-hosted site that shows the newest albums and singles from the artists you follow on **Spotify** or **TIDAL**, newest first, with albums and singles kept apart. A worker checks for new releases every day and sends a weekly email (through Resend, Mailgun or your own SMTP server).

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
4. **Mail**: Resend, Mailgun or custom SMTP. "Send test email" must succeed before you can continue (or choose "Set up mail later").
5. **Schedule**: daily sync time, weekly email day/time and timezone (defaults: 06:00 daily, Friday 18:00).
6. **Your account**: connect Spotify or TIDAL. That account becomes the admin and the installer is locked for good (`/install` returns 404).

All of this can be changed later under **Admin → Settings**.

## Music service apps

**Spotify** — needs a **Spotify Premium** account: since February 2026 Spotify only runs *Development Mode* apps while the app owner has Premium (if it lapses, sign-in and syncing stop until you resubscribe). https://developer.spotify.com/dashboard → Create app → Web API. Add the redirect URI above. In Development Mode up to **5 users** can connect, each added under **User Management** by their Spotify email; that is fine for personal or family use.

**TIDAL** — sign in to https://developer.tidal.com/dashboard with your TIDAL account → create an app, add the redirect URI above, and enable the `user.read` and `collection.read` scopes.

## Mail providers

- **Resend** (resend.com, the free plan is enough): API key from API Keys (a "Sending access" key is enough). The from address's domain must be verified under Domains; with a "Full access" key the test email also checks that for you.
- **Mailgun**: sending domain, API key and region (EU or US). The domain must be verified in Mailgun.
- **Custom SMTP**: host, port, encryption (STARTTLS 587 / TLS 465 / none) and optional username and password.

## How releases are handled

- Followed artists are read from your Spotify follows or your TIDAL collection.
- **Albums** = albums. **Singles** = singles and EPs. Compilations and "appears on" are left out.
- An artist followed by several people is stored and fetched once per day; unfollowing only removes your link.
- Explicit and clean editions, and the same release on both Spotify and TIDAL, are shown once.
- The weekly email lists releases dated in the past 7 days (day-exact dates only) and is skipped when there are none.

## Updating

Releases are published on the `main` branch. To update a running install:

1. Make a backup first (see [Backups](#backups)).
2. Get the new code:

   ```bash
   git pull origin main
   ```

3. Rebuild the image and restart the containers:

   ```bash
   docker compose up -d --build
   ```

   `app` and `worker` share one image, so this one build updates both. On start, `app` applies any new database migrations before serving the site, and `worker` waits until `app` is healthy. Your settings, accounts and releases stay in the `pgdata` volume.

4. Check that it came up:

   ```bash
   docker compose ps
   ```

   ```bash
   docker compose logs app --tail 50
   ```

5. Optionally remove the old, now unused image layers:

   ```bash
   docker image prune -f
   ```

If `.env.example` gained new variables in the release, copy them into your `.env` before step 3.

### Automatic updates (cron)

[`scripts/update.sh`](scripts/update.sh) does all of the above in one go and is made to run from cron:

- It does nothing when `origin/main` has no new commit.
- Before updating it writes a gzipped database backup to `backups/` and keeps the newest 14.
- It refuses to run when the checkout has local changes or another update is still running.
- It warns in the log about settings in `.env.example` that are missing from `.env`.
- It waits until the app is healthy (migrations done) and exits with an error if it isn't, so cron can mail you.

Run it once by hand to check it works:

```bash
./scripts/update.sh
```

Then add it to the crontab of a user that can run `docker` (`crontab -e`), for example daily at 04:30:

```cron
30 4 * * * /opt/music-releases/scripts/update.sh >> /opt/music-releases/update.log 2>&1
```

Replace `/opt/music-releases` with where you cloned the repository. `./scripts/update.sh --force` backs up and rebuilds even when there is nothing new. Optional environment variables: `UPDATE_BRANCH` (default `main`), `BACKUP_DIR` (default `backups/`), `KEEP_BACKUPS` (default `14`) and `HEALTH_TIMEOUT` in seconds (default `180`).

A failed build leaves the old version running. If the new version starts but is unhealthy, look at `docker compose logs app`; to go back, check out the previous commit, run `docker compose up -d --build`, and if needed restore the backup the script made:

```bash
gunzip -c backups/<file>.sql.gz | docker compose exec -T db psql -U music music
```

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
