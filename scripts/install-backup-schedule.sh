#!/usr/bin/env bash
# Installer fuer den TaikoBeschluss-Backup-LaunchAgent (macOS).
# Muster aus TaikoTrack (scripts/install-backup-schedule.sh).
#
# Usage:
#   ./scripts/install-backup-schedule.sh          # installiert + laedt
#   ./scripts/install-backup-schedule.sh --dry    # zeigt was gemacht wuerde
#   ./scripts/install-backup-schedule.sh --uninstall

set -euo pipefail

APP_HOME="${TAIKOBESCHLUSS_HOME:-$HOME/Projects/TaikoBeschluss}"
LABEL="com.taikonauten.taikobeschluss.backup"
PLIST_SRC="$APP_HOME/scripts/$LABEL.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs"

DRY=0
UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --dry) DRY=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) echo "Usage: $0 [--dry] [--uninstall]"; exit 0 ;;
  esac
done

log() { echo "[install-backup-schedule] $*"; }

if [[ $UNINSTALL -eq 1 ]]; then
  if [[ -f "$PLIST_DST" ]]; then
    launchctl bootout "gui/$(id -u)" "$PLIST_DST" 2>/dev/null || true
    rm -f "$PLIST_DST"
    log "entfernt: $PLIST_DST"
  else
    log "kein LaunchAgent installiert"
  fi
  exit 0
fi

[[ -f "$PLIST_SRC" ]] || { log "FEHLER: Template fehlt: $PLIST_SRC"; exit 1; }
[[ -f "$APP_HOME/server/scripts/backup.mjs" ]] || { log "FEHLER: backup.mjs fehlt"; exit 1; }

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

TMP="$(mktemp)"
sed -e "s|APP_HOME|$APP_HOME|g" -e "s|LOG_DIR|$LOG_DIR|g" "$PLIST_SRC" > "$TMP"

if [[ $DRY -eq 1 ]]; then
  log "DRY-RUN. Plist:"
  cat "$TMP"
  rm -f "$TMP"
  exit 0
fi

launchctl bootout "gui/$(id -u)" "$PLIST_DST" 2>/dev/null || true
mv "$TMP" "$PLIST_DST"
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl enable "gui/$(id -u)/$LABEL"
log "installiert + geladen: $PLIST_DST"
log "Status:  launchctl print gui/\$(id -u)/$LABEL"
log "Trigger: launchctl start $LABEL"
log "Log:     $LOG_DIR/taikobeschluss-backup.log"
