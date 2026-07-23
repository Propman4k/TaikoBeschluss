#!/bin/bash
# TaikoBeschluss Deploy (Muster TaikoEat/TaikoTasks): GitHub Actions hat das
# Image nach GHCR gepusht — dieses Skript macht Pre-Deploy-Backup, zieht das
# Image auf der NAS und startet den Container neu. Das Daten-Volume bleibt
# unangetastet.
#
#   ./deploy/deploy.sh

set -e

SYNOLOGY_HOST="mf@100.90.56.21"
DOCKER="sudo /usr/local/bin/docker"
IMAGE="ghcr.io/propman4k/taikobeschluss:latest"
CONTAINER="taikobeschluss"
PORT=3010
DATA_VOL="/volume1/docker/taikobeschluss-data"
DEPLOY_DIR="/volume1/docker/taikobeschluss/deploy"

echo "TaikoBeschluss Deploy"
echo "====================="

if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  echo "WARNUNG: uncommittete Aenderungen — deployed wird der Stand von GHCR (main)."
fi

echo "1/4 Pre-Deploy-Backup..."
ssh -t "$SYNOLOGY_HOST" "/bin/sh ${DEPLOY_DIR}/backup.sh" \
  || { echo "ABBRUCH: Pre-Deploy-Backup fehlgeschlagen."; exit 1; }

echo "2/4 Image ziehen..."
ssh -t "$SYNOLOGY_HOST" "
  if [ -f ${DATA_VOL}/.ghcr-token ]; then
    cat ${DATA_VOL}/.ghcr-token | $DOCKER login ghcr.io -u propman4k --password-stdin
  fi
  $DOCKER pull $IMAGE
"

echo "3/4 Container neu starten..."
ssh -t "$SYNOLOGY_HOST" "
  $DOCKER stop $CONTAINER 2>/dev/null || true
  $DOCKER rm $CONTAINER 2>/dev/null || true
  $DOCKER run -d --name $CONTAINER --restart unless-stopped \
    -p 127.0.0.1:${PORT}:${PORT} \
    -v ${DATA_VOL}:/app/data \
    -v ${DATA_VOL}/.env:/app/.env:ro \
    $IMAGE
  $DOCKER image prune -f
"

echo "4/4 Health-Check..."
sleep 3
if ssh "$SYNOLOGY_HOST" "wget -q -O - http://127.0.0.1:${PORT}/api/health" | grep -q '"ok":true'; then
  echo "OK: TaikoBeschluss laeuft auf NAS:${PORT}"
else
  echo "FEHLER: Health-Check fehlgeschlagen — Logs pruefen:"
  echo "  ssh -t $SYNOLOGY_HOST \"$DOCKER logs --tail 50 $CONTAINER\""
  exit 1
fi
