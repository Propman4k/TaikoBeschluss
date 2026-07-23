# TaikoBeschluss — Deploy & Data-Safety

Produktivbetrieb auf der Synology NAS hinter Cloudflare Tunnel. Image wird
von GitHub Actions gebaut und nach GHCR gepusht; die NAS zieht nur das
fertige Image (kein Build auf dem Synology).

**Alle Befehle hier laufen vom Mac aus** (Projekt-Root `~/Projects/TaikoBeschluss`).
Nichts muss auf der NAS getippt werden.

- NAS: `mf@100.90.56.21` (Tailscale), sudo passwortlos, Docker `/usr/local/bin/docker`
- Port: **3010** | Image: `ghcr.io/propman4k/taikobeschluss:latest` (public)
- Daten: `/volume1/docker/taikobeschluss-data` (DB + `signatures/` + Prod-`.env`)
- Backups (strikt separat!): `/volume1/docker/taikobeschluss-backups`
- Wichtig: NAS hat kein SFTP-Subsystem -> `scp` immer mit `-O`

---

## Deploy (Routine — das Einzige, was man regelmaessig braucht)

```bash
./deploy/deploy.sh
```

Macht alles selbst: Pre-Deploy-Backup -> Image ziehen -> Container-Restart ->
Health-Check. Voraussetzung: Push auf `main`, CI gruen.

Rollback: Image-Tag in `deploy.sh` von `:latest` auf `:<commit-sha>` aendern,
nochmal `./deploy/deploy.sh`.

---

## Tunnel-URL hat rotiert (passiert bei cloudflared-Neustart)

Der Quick-Tunnel (`*.trycloudflare.com`) bekommt bei jedem Neustart des
cloudflared-Containers eine NEUE URL. Dann:

```bash
# 1. Neue URL holen
NEW=$(ssh mf@100.90.56.21 "sudo /usr/local/bin/docker logs cloudflared-taikobeschluss 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1") && echo "$NEW"

# 2. .env auf der NAS anpassen + App-Container neu starten
ssh mf@100.90.56.21 "sed -i \"s|^APP_URL=.*|APP_URL=$NEW|; s|^GOOGLE_REDIRECT_URI=.*|GOOGLE_REDIRECT_URI=$NEW/api/auth/google/callback|\" /volume1/docker/taikobeschluss-data/.env && sudo /usr/local/bin/docker restart taikobeschluss"
```

3. In der [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   beim OAuth-Client die neue Redirect-URI eintragen:
   `<NEUE-URL>/api/auth/google/callback`

> Dauerhafte Loesung: benannter Cloudflare-Tunnel mit fester Subdomain
> (wie bei den anderen Tools) — dann entfaellt dieser ganze Abschnitt.

---

## Erst-Setup (am 2026-07-23 KOMPLETT erledigt — nur fuer Neuaufbau)

Jeder Block ist einzeln ins Mac-Terminal kopierbar.

### 1. Verzeichnisse + Skripte auf die NAS

```bash
ssh mf@100.90.56.21 "mkdir -p /volume1/docker/taikobeschluss-data /volume1/docker/taikobeschluss-backups /volume1/docker/taikobeschluss/deploy"
scp -O deploy/backup.sh deploy/offsite-sync.sh deploy/restore-test.sh mf@100.90.56.21:/volume1/docker/taikobeschluss/deploy/
ssh mf@100.90.56.21 "chmod +x /volume1/docker/taikobeschluss/deploy/*.sh"
```

### 2. Cloudflare-Tunnel starten + URL holen

```bash
ssh mf@100.90.56.21 "sudo /usr/local/bin/docker run -d --name cloudflared-taikobeschluss --restart unless-stopped --network host cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://127.0.0.1:3010"
sleep 8
ssh mf@100.90.56.21 "sudo /usr/local/bin/docker logs cloudflared-taikobeschluss 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | head -1"
```

### 3. Prod-`.env` anlegen (Secrets kommen automatisch aus der lokalen Dev-`.env`)

`TUNNEL=` unten durch die URL aus Schritt 2 ersetzen — der Rest laeuft von
selbst: `SESSION_SECRET` wird generiert, Google-Client + Gemini-Key werden
aus `server/.env` uebernommen.

```bash
TUNNEL=https://xxx.trycloudflare.com
ssh mf@100.90.56.21 "cat > /volume1/docker/taikobeschluss-data/.env <<EOF
NODE_ENV=production
SERVER_PORT=3010
BIND_ADDR=0.0.0.0
DATA_DIR=/app/data
APP_URL=$TUNNEL
SESSION_SECRET=\$(openssl rand -hex 32)
ALLOWED_EMAILS=mf@taikonauten.com,jl@taikonauten.com
GOOGLE_REDIRECT_URI=$TUNNEL/api/auth/google/callback
EOF
chmod 600 /volume1/docker/taikobeschluss-data/.env"
grep -E '^(GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|LLM_BASE_URL|LLM_API_KEY|LLM_MODELS)=' server/.env | ssh mf@100.90.56.21 "cat >> /volume1/docker/taikobeschluss-data/.env"
ssh mf@100.90.56.21 "grep -c TODO /volume1/docker/taikobeschluss-data/.env || echo 'OK: keine Platzhalter'"
```

### 4. Google OAuth Redirect-URI

In der [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
ergaenzen (Dev-URI drin lassen!): `<TUNNEL>/api/auth/google/callback`

### 5. Daten vom MacBook migrieren (WAL-sicher, Dev-Server darf laufen)

```bash
sqlite3 server/data/taikobeschluss.db "VACUUM INTO '/tmp/taikobeschluss-mig.db'"
scp -O /tmp/taikobeschluss-mig.db mf@100.90.56.21:/volume1/docker/taikobeschluss-data/taikobeschluss.db
scp -O -r server/data/signatures mf@100.90.56.21:/volume1/docker/taikobeschluss-data/
rm /tmp/taikobeschluss-mig.db
```

### 6. Erster Deploy

```bash
./deploy/deploy.sh
```

### 7. Backup-Crons (NOCH OFFEN — einziger Schritt, der ein NAS-Terminal braucht)

```bash
ssh -t mf@100.90.56.21 "sudo sh -c 'printf \"20\t3\t*\t*\t*\tMF\t/bin/sh /volume1/docker/taikobeschluss/deploy/backup.sh\n50\t3\t*\t*\t*\tMF\t/bin/sh /volume1/docker/taikobeschluss/deploy/offsite-sync.sh\n20\t4\t1\t*\t*\tMF\t/bin/sh /volume1/docker/taikobeschluss/deploy/restore-test.sh\n\" >> /etc/crontab && killall -HUP crond' && grep taikobeschluss /etc/crontab"
```

(03:20/03:50/04:20 — kollisionsfrei zu TaikoTasks 03:00 und TaikoEat 03:10.)

### 8. rclone-Offsite (NOCH OFFEN, optional aber empfohlen)

```bash
# Einmal lokal (Browser-Login oeffnet sich), Drive-Ordner "TaikoBeschluss-Backups":
rclone config create gdrive-taikobeschluss drive scope=drive
# Nur das neue Remote an die NAS-Config ANHAENGEN (nicht ueberschreiben!):
awk '/^\[gdrive-taikobeschluss\]/{f=1} f&&/^\[/&&!/gdrive-taikobeschluss/{f=0} f' ~/.config/rclone/rclone.conf | ssh mf@100.90.56.21 "cat >> ~/.config/rclone/rclone.conf"
```

---

## Backup-Architektur (Prod)

| Layer | Wann | Trigger |
|---|---|---|
| Pre-Deploy | bei jedem Deploy | `deploy.sh` Schritt 1 |
| Daily: DB + JSON-Export + Signaturen | taeglich 03:20 | crontab -> `backup.sh` |
| Offsite: Google Drive | taeglich 03:50 | crontab -> `offsite-sync.sh` |
| Restore-Test | monatlich, 1. um 04:20 | crontab -> `restore-test.sh` |

Retention 30 Tage. Backups liegen strikt AUSSERHALB des Daten-Volumes
(Lehre aus dem TaikoTrack-Vorfall 2026-04-22). Dazu die Dev-Schicht auf dem
MacBook: `server/scripts/backup.mjs` via LaunchAgent alle 4 h.

Optional (je eine Datei in `taikobeschluss-backups/`):
- Alerting: Healthchecks-URLs in `.healthcheck-url` / `.healthcheck-offsite-url` / `.healthcheck-restore-url`
- Verschluesselung: Passphrase in `.backup-passphrase` (chmod 600, in den
  Passwort-Manager!), danach Guard `echo 1 > .require-encryption`

---

## Restore (DB aus Backup zurueckspielen)

```bash
ssh mf@100.90.56.21 "ls -lt /volume1/docker/taikobeschluss-backups/taikobeschluss_*.db.gz* | head -5"
# <TS> aus der Liste einsetzen:
ssh mf@100.90.56.21 "
  gunzip -k /volume1/docker/taikobeschluss-backups/taikobeschluss_<TS>.db.gz
  sudo /usr/local/bin/docker stop taikobeschluss
  sudo cp /volume1/docker/taikobeschluss-backups/taikobeschluss_<TS>.db /volume1/docker/taikobeschluss-data/taikobeschluss.db
  sudo rm -f /volume1/docker/taikobeschluss-data/taikobeschluss.db-wal /volume1/docker/taikobeschluss-data/taikobeschluss.db-shm
  sudo /usr/local/bin/docker start taikobeschluss
"
# Signaturen (nur falls noetig):
ssh mf@100.90.56.21 "sudo tar -xzf /volume1/docker/taikobeschluss-backups/taikobeschluss_files_<TS>.tar.gz -C /volume1/docker/taikobeschluss-data"
# (Backup verschluesselt? Erst openssl enc -d wie in restore-test.sh.)
```
