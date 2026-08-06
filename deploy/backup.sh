#!/usr/bin/env bash
# Snapshot ikid's data (all profile databases + account/session/analytics
# files) from the Docker volume into a timestamped, compressed archive.
#
# Usage:
#   deploy/backup.sh                      # writes to ./ikid-backups
#   BACKUP_DIR=/mnt/backups deploy/backup.sh
#   RETAIN=30 deploy/backup.sh            # keep the newest 30 archives
#
# Cron (daily at 02:30):
#   30 2 * * *  cd /path/to/ikid && BACKUP_DIR=/mnt/backups deploy/backup.sh >> /var/log/ikid-backup.log 2>&1
#
# NOTE: these archives contain real financial data and password hashes —
# store them somewhere encrypted and access-controlled.

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.prod.yml}"
SERVICE="${SERVICE:-ikid}"
DATA_PATH="${DATA_PATH:-/app/database}"
BACKUP_DIR="${BACKUP_DIR:-./ikid-backups}"
RETAIN="${RETAIN:-14}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/ikid-$STAMP.tar.gz"

echo "Backing up $SERVICE:$DATA_PATH → $OUT"
# Stream a tar of the data dir out of the running container (consistent enough
# for SQLite between writes; for a fully quiesced copy, stop ikid first).
docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" \
  tar czf - -C "$DATA_PATH" . > "$OUT"

echo "Wrote $(du -h "$OUT" | cut -f1) → $OUT"

# Retention: keep the newest $RETAIN archives.
ls -1t "$BACKUP_DIR"/ikid-*.tar.gz 2>/dev/null | tail -n +$((RETAIN + 1)) | while read -r old; do
  echo "Pruning old backup: $old"
  rm -f "$old"
done

echo "Done. $(ls -1 "$BACKUP_DIR"/ikid-*.tar.gz 2>/dev/null | wc -l | tr -d ' ') archive(s) retained."
