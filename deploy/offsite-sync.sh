#!/bin/sh
# TaikoBeschluss Offsite-Sync: kopiert die Backups per rclone in einen eigenen
# Google-Drive-Ordner (Remote gdrive-taikobeschluss). Taeglich 03:50 via
# crontab, nach dem Backup-Lauf von 03:20. Die Passphrase-Datei geht NIE mit.

set -u

BACKUP_DIR="/volume1/docker/taikobeschluss-backups"
REMOTE="gdrive-taikobeschluss:TaikoBeschluss-Backups/"
KEEP_DAYS=30
LOG_FILE="${BACKUP_DIR}/offsite.log"
HC_URL_FILE="${BACKUP_DIR}/.healthcheck-offsite-url"
RCLONE="$HOME/bin/rclone"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S'): $*" >> "$LOG_FILE"; }
ping_hc() {
  [ -f "$HC_URL_FILE" ] || return 0
  wget -q -O /dev/null "$(cat "$HC_URL_FILE")$1" 2>/dev/null || true
}

[ -x "$RCLONE" ] || RCLONE=$(command -v rclone) || { log "FAIL: rclone fehlt"; ping_hc "/fail"; exit 1; }

if ! "$RCLONE" copy "$BACKUP_DIR" "$REMOTE" \
  --include "taikobeschluss_*.gz" --include "taikobeschluss_*.gz.enc" \
  --max-age 2d 2>> "$LOG_FILE"; then
  log "FAIL: rclone copy fehlgeschlagen"
  ping_hc "/fail"
  exit 1
fi

# Remote-Retention (gleicher Horizont wie lokal)
"$RCLONE" delete "$REMOTE" --min-age "${KEEP_DAYS}d" 2>> "$LOG_FILE" || true

log "OK: offsite-sync"
ping_hc ""
