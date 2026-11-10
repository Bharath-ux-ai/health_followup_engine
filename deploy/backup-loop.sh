#!/bin/sh
# Nightly compressed pg_dump with retention. Restore: see deploy/restore.sh
set -eu
while true; do
  ts=$(date +%Y%m%d-%H%M%S)
  pg_dump --format=custom --no-owner --file "/backups/tectha-$ts.dump" && echo "backup ok: tectha-$ts.dump"
  find /backups -name 'tectha-*.dump' -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
  sleep 86400
done
