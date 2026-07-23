# TaikoBeschluss — Deploy & Data-Safety

Produktivbetrieb auf der Synology NAS hinter Cloudflare Tunnel. Muster
TaikoEat/TaikoTasks: Image wird von GitHub Actions gebaut und nach GHCR
gepusht; die NAS zieht nur das fertige Image (kein Build auf dem Synology).

- NAS: `mf@100.90.56.21` (Tailscale), Docker unter `/usr/local/bin/docker`
- Port: **3010** (3002 taikocast, 3003 be-infinity, 3004 zeratrack,
  3005 taikotask, 3006 taikoeat)
- Image: `ghcr.io/propman4k/taikobeschluss:latest`
- Daten-Volume: `/volume1/docker/taikobeschluss-data` -> `/app/data`
  (DB + `signatures/` + Prod-`.env`)
- Backups (separat!): `/volume1/docker/taikobeschluss-backups`

---

## Deploy (Routine)

```bash
./deploy/deploy.sh
```

Macht: Pre-Deploy-Backup -> GHCR-Login (falls Token) -> `docker pull` ->
Container-Restart -> Image-Prune -> Health-Check (`/api/health` auf NAS:3010).
Das Daten-Volume bleibt unangetastet.

Voraussetzung: Push auf `main` -> GitHub Actions "CI" (docker-Job) gruen.

Rollback (Image ist auch unter `:<sha>` getaggt): Image-Tag im `docker run`
von `deploy.sh` austauschen.

---

## Erst-Setup auf der NAS (einmalig)

### 1. Verzeichnisse + Prod-`.env`

```bash
ssh mf@100.90.56.21
mkdir -p /volume1/docker/taikobeschluss-data /volume1/docker/taikobeschluss-backups /volume1/docker/taikobeschluss/deploy
nano /volume1/docker/taikobeschluss-data/.env && chmod 600 /volume1/docker/taikobeschluss-data/.env
```

Prod-`.env` (NICHT committen — liegt nur auf der NAS):

```
NODE_ENV=production
SERVER_PORT=3010
BIND_ADDR=0.0.0.0
DATA_DIR=/app/data

# Oeffentliche URL (Tunnel) — secure-Cookies, OAuth-Redirect
APP_URL=https://<tunnel-url>
SESSION_SECRET=<openssl rand -hex 32>

# Login-Whitelist (zusaetzlich zaehlt jede signer_email eines Gesellschafters)
ALLOWED_EMAILS=mf@taikonauten.com,jl@taikonauten.com

# Google OAuth (gleicher Client wie Dev, Prod-Redirect-URI ergaenzen!)
GOOGLE_CLIENT_ID=<...>
GOOGLE_CLIENT_SECRET=<...>
GOOGLE_REDIRECT_URI=https://<tunnel-url>/api/auth/google/callback

# LLM (Gemini, OpenAI-kompatibler Endpoint)
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_API_KEY=<AQ....>
LLM_MODELS=<Praeferenzliste, z.B. gemini-3.5-flash>
```

### 2. GHCR-Image erreichbar machen

GHCR-Paket `taikobeschluss` auf public stellen ODER Classic-PAT mit
`read:packages`:

```bash
echo "<classic-pat>" > /volume1/docker/taikobeschluss-data/.ghcr-token
chmod 600 /volume1/docker/taikobeschluss-data/.ghcr-token
```

### 3. Cloudflare-Tunnel

```bash
ssh -t mf@100.90.56.21 "sudo /usr/local/bin/docker run -d \
  --name cloudflared-taikobeschluss --restart unless-stopped --network host \
  cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://127.0.0.1:3010"
ssh mf@100.90.56.21 "sudo /usr/local/bin/docker logs cloudflared-taikobeschluss 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | head -1"
```

> Ephemerer Tunnel: URL rotiert bei Container-Neustart -> `APP_URL` +
> `GOOGLE_REDIRECT_URI` in der `.env` aktualisieren, Redirect-URI in der
> Google Console ergaenzen, dann `./deploy/deploy.sh`. Fuer Dauerbetrieb
> auf benannten Tunnel + feste Subdomain umstellen.

### 4. Google OAuth Redirect-URI

In der Google Cloud Console ergaenzen:
`https://<tunnel-url>/api/auth/google/callback`

### 5. Skripte auf die NAS + Cron

```bash
scp deploy/backup.sh deploy/offsite-sync.sh deploy/restore-test.sh \
  mf@100.90.56.21:/volume1/docker/taikobeschluss/deploy/
ssh mf@100.90.56.21 "chmod +x /volume1/docker/taikobeschluss/deploy/*.sh"
ssh -t mf@100.90.56.21
sudo nano /etc/crontab
# Am Ende einfuegen (TABs zwischen den Feldern!):
20	3	*	*	*	MF	/bin/sh /volume1/docker/taikobeschluss/deploy/backup.sh
50	3	*	*	*	MF	/bin/sh /volume1/docker/taikobeschluss/deploy/offsite-sync.sh
20	4	1	*	*	MF	/bin/sh /volume1/docker/taikobeschluss/deploy/restore-test.sh
sudo killall -HUP crond
```

(03:20/03:50/04:20, damit es nicht mit den TaikoTask- (03:00) und
TaikoEat-Crons (03:10) kollidiert.)

### 6. rclone-Remote (Offsite)

```bash
# Lokal (Browser-Login), eigenen Drive-Ordner "TaikoBeschluss-Backups" anlegen:
rclone config create gdrive-taikobeschluss drive scope=drive root_folder_id=<FOLDER_ID>
# Neues Remote in die bestehende rclone.conf auf der NAS MERGEN (dort liegen
# schon Remotes fuer TaikoTasks/TaikoEat — NICHT blind ueberschreiben):
ssh mf@100.90.56.21 "cat >> ~/.config/rclone/rclone.conf" < <(awk '/\[gdrive-taikobeschluss\]/,/^$/' ~/.config/rclone/rclone.conf)
```

### 7. Daten-Migration vom MacBook (einmalig, vor dem ersten Login)

Die lokale Dev-DB enthaelt die echten Firmen/Gesellschafter/Beschluesse:

```bash
# Lokal frisches Backup ziehen, dann DB + Signaturen auf die NAS:
npm run backup --prefix server
scp server/data/taikobeschluss.db mf@100.90.56.21:/volume1/docker/taikobeschluss-data/
scp -r server/data/signatures mf@100.90.56.21:/volume1/docker/taikobeschluss-data/
# WAL/SHM NICHT mitkopieren; vorher lokalen Dev-Server stoppen.
```

### 8. Erster Deploy

```bash
./deploy/deploy.sh
```

---

## Backup-Architektur (Prod)

| Layer | Wo | Wann | Trigger |
|---|---|---|---|
| Pre-Deploy | `taikobeschluss-backups/` | bei jedem Deploy | `deploy.sh` Schritt 1 |
| Daily (DB + JSON + Signaturen) | `taikobeschluss-backups/taikobeschluss_*_HHMM.{db,tables.json}.gz` + `taikobeschluss_files_*.tar.gz` | taeglich 03:20 | crontab -> `backup.sh` |
| Offsite | Google Drive `TaikoBeschluss-Backups` | taeglich 03:50 | crontab -> `offsite-sync.sh` |
| Restore-Test | `taikobeschluss-backups/restore-test.log` | monatlich, 1. um 04:20 | crontab -> `restore-test.sh` |

Dazu die Dev-Schicht auf dem MacBook: `server/scripts/backup.mjs`
(LaunchAgent alle 4h, siehe `scripts/install-backup-schedule.sh`).

Retention: 30 Tage (Daily/Offsite). **Prinzip:** Backups
(`taikobeschluss-backups`) liegen strikt ausserhalb des Daten-Volumes
(`taikobeschluss-data`) — Lehre aus dem TaikoTrack-Vorfall 2026-04-22.

### Alerting (empfohlen)

```bash
echo "https://hc-ping.com/<uuid-backup>"  > /volume1/docker/taikobeschluss-backups/.healthcheck-url
echo "https://hc-ping.com/<uuid-offsite>" > /volume1/docker/taikobeschluss-backups/.healthcheck-offsite-url
echo "https://hc-ping.com/<uuid-restore>" > /volume1/docker/taikobeschluss-backups/.healthcheck-restore-url
```

### Verschluesselung (opt-in, wegen Unterschriften/Firmendaten empfohlen)

```bash
openssl rand -base64 32 > /volume1/docker/taikobeschluss-backups/.backup-passphrase
chmod 600 /volume1/docker/taikobeschluss-backups/.backup-passphrase
# -> Passphrase in den Passwort-Manager! Ohne sie sind .enc-Backups wertlos.
echo 1 > /volume1/docker/taikobeschluss-backups/.require-encryption   # Guard danach setzen
```

---

## Restore

```bash
ssh mf@100.90.56.21
ls -lt /volume1/docker/taikobeschluss-backups/taikobeschluss_*.db.gz* | head -5
# (verschluesselt? erst openssl enc -d ... wie in restore-test.sh)
gunzip -k /volume1/docker/taikobeschluss-backups/taikobeschluss_<TS>.db.gz
sudo /usr/local/bin/docker stop taikobeschluss
sudo cp /volume1/docker/taikobeschluss-backups/taikobeschluss_<TS>.db /volume1/docker/taikobeschluss-data/taikobeschluss.db
sudo rm -f /volume1/docker/taikobeschluss-data/taikobeschluss.db-wal /volume1/docker/taikobeschluss-data/taikobeschluss.db-shm
# Signaturen (falls noetig):
sudo tar -xzf /volume1/docker/taikobeschluss-backups/taikobeschluss_files_<TS>.tar.gz -C /volume1/docker/taikobeschluss-data
sudo /usr/local/bin/docker start taikobeschluss
```
