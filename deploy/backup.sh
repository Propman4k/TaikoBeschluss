#!/bin/sh
# TaikoBeschluss Backup (Synology NAS, taeglich via /etc/crontab).
#
# Sichert DB UND Dateien (Signatur-PNGs — rechtlich relevant):
#   1. sqlite3 .backup auf Temp-Kopie (konsistent trotz offener Connections)
#   2. PRAGMA integrity_check auf der Kopie
#   3. JSON-Export der Kerntabellen (Format-Resilienz)
#   4. tar.gz von signatures/
#   5. optionale Verschluesselung (.backup-passphrase), gzip, Retention 30 Tage
#   6. optionaler Healthchecks-Ping (still gestorbener Cron faellt sonst nie auf)

set -u

DATA_DIR="/volume1/docker/taikobeschluss-data"
BACKUP_DIR="/volume1/docker/taikobeschluss-backups"
DB_FILE="${DATA_DIR}/taikobeschluss.db"
DATE=$(date +%Y-%m-%d_%H%M)
KEEP_DAYS=30
LOG_FILE="${BACKUP_DIR}/backup.log"
PASS_FILE="${BACKUP_DIR}/.backup-passphrase"
HC_URL_FILE="${BACKUP_DIR}/.healthcheck-url"

mkdir -p "$BACKUP_DIR"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S'): $*" >> "$LOG_FILE"; }

ping_hc() {
  # $1 = "" (ok) oder "/fail"
  [ -f "$HC_URL_FILE" ] || return 0
  wget -q -O /dev/null "$(cat "$HC_URL_FILE")$1" 2>/dev/null || true
}

fail() {
  log "FAIL: $*"
  ping_hc "/fail"
  exit 1
}

# Guard: Encryption verlangt, aber keine Passphrase -> lieber laut scheitern
# als still Klartext-Backups zu erzeugen (die offsite gehen).
if [ -f "${BACKUP_DIR}/.require-encryption" ] || [ "${REQUIRE_BACKUP_ENCRYPTION:-0}" = "1" ]; then
  [ -f "$PASS_FILE" ] || fail "Encryption verlangt, aber keine .backup-passphrase"
fi

[ -f "$DB_FILE" ] || fail "DB nicht gefunden ($DB_FILE)"

# ── 1+2. DB-Snapshot + Integrity ──
TMP_DB="${BACKUP_DIR}/.taikobeschluss_${DATE}.db.tmp"
sqlite3 "$DB_FILE" ".backup '$TMP_DB'" || fail "sqlite3 .backup fehlgeschlagen"
INTEGRITY=$(sqlite3 "$TMP_DB" "PRAGMA integrity_check;" 2>&1)
[ "$INTEGRITY" = "ok" ] || { rm -f "$TMP_DB"; fail "integrity_check='$INTEGRITY'"; }
rm -f "${TMP_DB}-shm" "${TMP_DB}-wal"

# ── 3. JSON-Export der Kerntabellen ──
TMP_JSON="${BACKUP_DIR}/.taikobeschluss_${DATE}.tables.json.tmp"
{
  echo '{"resolutions":'
  sqlite3 -json "$TMP_DB" "SELECT * FROM resolutions;" || echo '[]'
  echo ',"resolution_signatures":'
  sqlite3 -json "$TMP_DB" "SELECT * FROM resolution_signatures;" || echo '[]'
  echo ',"companies":'
  sqlite3 -json "$TMP_DB" "SELECT * FROM companies;" || echo '[]'
  echo ',"shareholders":'
  sqlite3 -json "$TMP_DB" "SELECT * FROM shareholders;" || echo '[]'
  echo ',"company_shareholders":'
  sqlite3 -json "$TMP_DB" "SELECT * FROM company_shareholders;" || echo '[]'
  # Chat traegt das Pruefdossier (Nachweis gegenueber dem Anwalt), Typen die Zuordnung
  echo ',"chat_messages":'
  sqlite3 -json "$TMP_DB" "SELECT * FROM chat_messages;" || echo '[]'
  echo ',"resolution_types":'
  sqlite3 -json "$TMP_DB" "SELECT * FROM resolution_types;" || echo '[]'
  echo ',"users":'
  sqlite3 -json "$TMP_DB" "SELECT id, email, name FROM users;" || echo '[]'
  echo '}'
} > "$TMP_JSON" 2>/dev/null

# ── 4. Datei-Tarball ──
TMP_TAR="${BACKUP_DIR}/.taikobeschluss_files_${DATE}.tar.gz.tmp"
tar -czf "$TMP_TAR" -C "$DATA_DIR" signatures 2>/dev/null \
  || fail "Datei-Tarball fehlgeschlagen"

# ── 5. gzip + optionale Verschluesselung + Finalisieren ──
gzip -f "$TMP_DB"
gzip -f "$TMP_JSON"

finalize() {
  # $1 = tmp-Datei, $2 = Zielname (ohne .enc)
  if [ -f "$PASS_FILE" ]; then
    openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -in "$1" -out "${2}.enc" \
      -pass "file:$PASS_FILE" || fail "Verschluesselung fehlgeschlagen fuer $2"
    rm -f "$1"
  else
    mv -f "$1" "$2"
  fi
}

finalize "${TMP_DB}.gz" "${BACKUP_DIR}/taikobeschluss_${DATE}.db.gz"
finalize "${TMP_JSON}.gz" "${BACKUP_DIR}/taikobeschluss_${DATE}.tables.json.gz"
finalize "$TMP_TAR" "${BACKUP_DIR}/taikobeschluss_files_${DATE}.tar.gz"

# ── Retention ──
find "$BACKUP_DIR" -name 'taikobeschluss_*.gz' -mtime +$KEEP_DAYS -delete 2>/dev/null
find "$BACKUP_DIR" -name 'taikobeschluss_*.gz.enc' -mtime +$KEEP_DAYS -delete 2>/dev/null

log "OK: taikobeschluss_${DATE} (db + tables.json + files), integrity=ok"
ping_hc ""
