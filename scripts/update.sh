#!/bin/sh
# Updates a running MusicReleases install to the latest commit on the release branch.
# Safe to run from cron: does nothing when there is no new commit, backs up the database
# before updating, and only one run happens at a time.
#
#   scripts/update.sh            update if origin has new commits
#   scripts/update.sh --force    back up and rebuild even when already up to date
#
# Settings (environment variables, all optional):
#   UPDATE_BRANCH   branch to follow                       (default: main)
#   BACKUP_DIR      where database backups are written     (default: <repo>/backups)
#   KEEP_BACKUPS    number of backups to keep              (default: 14)
#   HEALTH_TIMEOUT  seconds to wait for the app to be healthy (default: 180)
#
# Example crontab line (daily at 04:30, log appended to update.log in the repo):
#   30 4 * * * /opt/music-releases/scripts/update.sh >> /opt/music-releases/update.log 2>&1

set -eu

# cron starts with a minimal PATH; make sure git and docker are found.
PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"
export PATH

REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$REPO_DIR"

UPDATE_BRANCH=${UPDATE_BRANCH:-main}
BACKUP_DIR=${BACKUP_DIR:-$REPO_DIR/backups}
KEEP_BACKUPS=${KEEP_BACKUPS:-14}
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-180}
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fail() { log "ERROR: $*"; exit 1; }

# --- One run at a time -------------------------------------------------------
LOCK_DIR="$REPO_DIR/.update.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log "Another update is running (remove $LOCK_DIR if that is not true). Skipping."
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT INT TERM

# --- Check for new commits ---------------------------------------------------
[ -f .env ] || fail ".env not found in $REPO_DIR"

current_branch=$(git rev-parse --abbrev-ref HEAD)
[ "$current_branch" = "$UPDATE_BRANCH" ] || fail "checked out branch is '$current_branch', expected '$UPDATE_BRANCH'"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  fail "there are local changes to tracked files; commit or discard them first"
fi

git fetch --quiet origin "$UPDATE_BRANCH"
local_rev=$(git rev-parse HEAD)
remote_rev=$(git rev-parse "origin/$UPDATE_BRANCH")

if [ "$local_rev" = "$remote_rev" ] && [ "$FORCE" -eq 0 ]; then
  log "Up to date ($(git rev-parse --short HEAD)). Nothing to do."
  exit 0
fi

log "Updating $(git rev-parse --short "$local_rev") -> $(git rev-parse --short "$remote_rev")"

# --- Back up the database ----------------------------------------------------
mkdir -p "$BACKUP_DIR"
backup_file="$BACKUP_DIR/music-$(date '+%Y%m%d-%H%M%S')-$(git rev-parse --short "$local_rev").sql.gz"
if [ -n "$(docker compose ps -q --status running db 2>/dev/null)" ]; then
  log "Backing up database to $backup_file"
  if ! docker compose exec -T db sh -c 'pg_dump --clean --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$backup_file"; then
    rm -f "$backup_file"
    fail "database backup failed; not updating"
  fi
else
  log "Database container is not running; skipping backup."
fi

# --- Pull the new code -------------------------------------------------------
git merge --ff-only --quiet "origin/$UPDATE_BRANCH" || fail "cannot fast-forward to origin/$UPDATE_BRANCH"

# Warn about settings that were added to .env.example but are missing from .env.
missing=$(grep -E '^[A-Z_][A-Z0-9_]*=' .env.example | cut -d= -f1 | while read -r key; do
  grep -qE "^${key}=" .env || echo "$key"
done)
if [ -n "$missing" ]; then
  log "WARNING: these settings from .env.example are not in .env:" $missing
fi

# --- Rebuild and restart -----------------------------------------------------
# The image is built before any container is replaced, so a failed build leaves the old version running.
log "Building and restarting containers"
docker compose up -d --build --remove-orphans

# --- Wait for the app (it runs database migrations on start) -----------------
app_id=$(docker compose ps -q app)
[ -n "$app_id" ] || fail "app container not found after restart"
log "Waiting up to ${HEALTH_TIMEOUT}s for the app to become healthy"
waited=0
while :; do
  status=$(docker inspect --format '{{.State.Health.Status}}' "$app_id" 2>/dev/null || echo unknown)
  [ "$status" = "healthy" ] && break
  if [ "$waited" -ge "$HEALTH_TIMEOUT" ]; then
    docker compose logs app --tail 50 || true
    fail "app is '$status' after ${HEALTH_TIMEOUT}s. Backup: $backup_file"
  fi
  sleep 5
  waited=$((waited + 5))
done
log "App is healthy"

# --- Clean up ----------------------------------------------------------------
docker image prune -f > /dev/null
# Keep only the newest $KEEP_BACKUPS backups.
ls -1t "$BACKUP_DIR"/music-*.sql.gz 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | while read -r old; do
  rm -f "$old"
done

log "Update finished: now at $(git rev-parse --short HEAD)"
