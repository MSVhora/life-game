#!/usr/bin/env bash
# Restore a gzipped pg_dump into the compose database. DESTROYS current data in that database.
# Usage: scripts/restore.sh path/to/life-game-XXXX.sql.gz
set -euo pipefail
cd "$(dirname "$0")/.."

dump="${1:?usage: scripts/restore.sh <dump.sql.gz>}"
[ -f "$dump" ] || { echo "no such file: $dump" >&2; exit 1; }
set -a; . ./.env; set +a

read -r -p "This replaces all data in database '$POSTGRES_DB'. Type 'restore' to continue: " answer
[ "$answer" = "restore" ] || { echo "aborted"; exit 1; }

docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE)" \
  -c "CREATE DATABASE \"$POSTGRES_DB\""
gunzip -c "$dump" | docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q
echo "restored from $dump"
