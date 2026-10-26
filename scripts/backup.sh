#!/usr/bin/env bash
# Plain pg_dump of the database, gzipped, uploaded with rclone, old copies pruned.
# Run from the repo root (cron example in docs/DEPLOY.md). Needs: docker compose, rclone, .env.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; . ./.env; set +a
: "${BACKUP_TARGET:?set BACKUP_TARGET in .env (an rclone remote path)}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="life-game-${stamp}.sql.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner | gzip -9 > "$tmp/$file"
# Refuse to upload an obviously empty dump.
[ "$(wc -c < "$tmp/$file")" -gt 200 ] || { echo "dump looks empty, aborting" >&2; exit 1; }

rclone copy "$tmp/$file" "$BACKUP_TARGET"
rclone delete "$BACKUP_TARGET" --min-age "${KEEP_DAYS}d" --include 'life-game-*.sql.gz'
echo "backup uploaded: $BACKUP_TARGET/$file"
