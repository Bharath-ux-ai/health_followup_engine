#!/bin/sh
# Usage: ./deploy/restore.sh backups/tectha-YYYYMMDD-HHMMSS.dump
# Stops the app containers, restores into the database, then restarts them.
set -eu
FILE="$1"
[ -f "$FILE" ] || { echo "Backup file not found: $FILE"; exit 1; }
docker compose stop api worker web
docker compose exec -T db sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$FILE"
docker compose start api worker web
echo "Restored $FILE"
