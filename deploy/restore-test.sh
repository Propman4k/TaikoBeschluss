#!/bin/sh
# TaikoBeschluss Restore-Test (monatlich, 1. um 04:20 via crontab): beweist,
# dass das juengste Backup wirklich wiederherstellbar ist. Nur Temp-Kopien
# unter /tmp — die Live-Daten werden nie angefasst.

set -u

BACKUP_DIR="/volume1/docker/taikobeschluss-backups"
LOG_FILE="${BACKUP_DIR}/restore-test.log"
PASS_FILE="${BACKUP_DIR}/.backup-passphrase"
HC_URL_FILE="${BACKUP_DIR}/.healthcheck-restore-url"
TMP=$(mktemp -d /tmp/taikobeschluss-restore.XXXXXX)
trap 'rm -rf "$TMP"' EXIT

log() { echo "$(date '+%Y-%m-%d %H:%M:%S'): $*" >> "$LOG_FILE"; }
ping_hc() {
  [ -f "$HC_URL_FILE" ] || return 0
  wget -q -O /dev/null "$(cat "$HC_URL_FILE")$1" 2>/dev/null || true
}
fail() { log "FAIL: $*"; ping_hc "/fail"; exit 1; }

latest() { ls "$BACKUP_DIR"/$1 2>/dev/null | sort -r | head -1; }

DB_BAK=$(latest "taikobeschluss_*.db.gz*")
FILES_BAK=$(latest "taikobeschluss_files_*.tar.gz*")
[ -n "$DB_BAK" ] || fail "kein DB-Backup gefunden"
[ -n "$FILES_BAK" ] || fail "kein Datei-Backup gefunden"

# Frische-Check: still gestorbener Backup-Cron faellt hier auf
[ -n "$(find "$DB_BAK" -mtime -2 2>/dev/null)" ] || fail "juengstes Backup aelter als 2 Tage"

decrypt() {
  # $1 = Quelle, $2 = Ziel (entschluesselt/kopiert je nach Endung)
  case "$1" in
    *.enc)
      [ -f "$PASS_FILE" ] || fail "Backup verschluesselt, aber keine Passphrase"
      openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$1" -out "$2" \
        -pass "file:$PASS_FILE" || fail "Entschluesselung fehlgeschlagen: $1"
      ;;
    *) cp "$1" "$2" ;;
  esac
}

# DB: entschluesseln -> entpacken -> integrity + Kerntabellen
decrypt "$DB_BAK" "$TMP/db.gz"
gunzip -f "$TMP/db.gz" || fail "gunzip fehlgeschlagen"
INTEGRITY=$(sqlite3 "$TMP/db" "PRAGMA integrity_check;" 2>&1)
[ "$INTEGRITY" = "ok" ] || fail "integrity_check='$INTEGRITY'"
FK=$(sqlite3 "$TMP/db" "PRAGMA foreign_key_check;" 2>&1)
[ -z "$FK" ] || fail "foreign_key_check: $FK"
RESOLUTIONS=$(sqlite3 "$TMP/db" "SELECT COUNT(*) FROM resolutions;")
USERS=$(sqlite3 "$TMP/db" "SELECT COUNT(*) FROM users;")
[ "$USERS" -gt 0 ] || fail "users-Tabelle leer"

# Dateien: entschluesseln -> Tarball lesbar
decrypt "$FILES_BAK" "$TMP/files.tar.gz"
tar -tzf "$TMP/files.tar.gz" > /dev/null || fail "Datei-Tarball unlesbar"

log "OK: $(basename "$DB_BAK") resolutions=$RESOLUTIONS users=$USERS, files=$(basename "$FILES_BAK")"
ping_hc ""
