# Umgebungsvariablen

Vollstaendige Referenz aller von TaikoBeschluss gelesenen Env-Variablen.
Quelle: Code-Audit 2026-07-24 (alle `process.env.*`-Stellen). Dev: `server/.env`
(via dotenv); Prod: `/volume1/docker/taikobeschluss-data/.env`, als `/app/.env`
in den Container gemountet. (`server/.env*` ist fuer Agent-Tools lesegesperrt —
deshalb liegt diese Referenz hier statt in `.env.example`.)

## Pflicht (Prod)

| Variable | Zweck |
|---|---|
| `SESSION_SECRET` | Session-Signierung — Server verweigert Prod-Start ohne (`index.js`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth Login |
| `ALLOWED_EMAILS` | Komma-Liste zugelassener Logins (zusaetzlich zu signer_emails) |
| `LLM_API_KEY` | Gemini-Key (OpenAI-kompatibler Endpoint) |
| `APP_URL` | Oeffentliche Basis-URL (OAuth-Redirect, Default sonst localhost) |

## LLM

| Variable | Default | Zweck |
|---|---|---|
| `LLM_MODELS` | — | Praeferenzliste, z.B. `gemini-3.1-pro,gemini-3.5-flash` |
| `LLM_BASE_URL` | Google-Gemini-Endpoint | optional auf LiteLLM-Gateway umstellen (Pfad mit `/v1`) |

## Server

| Variable | Default | Zweck |
|---|---|---|
| `NODE_ENV` | — | `production` aktiviert Static-Serving, Secure-Cookies, Prod-Guards |
| `SERVER_PORT` | `3010` | Express-Port |
| `BIND_ADDR` | `127.0.0.1` | Bind-Adresse (Docker: `0.0.0.0`, setzt das Dockerfile) |
| `DATA_DIR` | `server/data` | SQLite + Signaturen (Prod: `/app/data` = NAS-Volume) |
| `DEV_LOGIN` | aus | `1` = `/api/auth/dev?email=…` ohne OAuth (nur non-Prod) |
| `GOOGLE_REDIRECT_URI` | `${APP_URL}/api/auth/google/callback` | nur bei abweichendem Callback |

## Google Drive (Ablage fertiger PDFs)

| Variable | Zweck |
|---|---|
| `DRIVE_ROOT_FOLDER_ID` | Zielordner (Geteilte Ablage); fehlt sie, ist Drive deaktiviert |
| `GOOGLE_APPLICATION_CREDENTIALS` | Pfad zum Service-Account-Key (Alternative zu `GOOGLE_SA_KEY`) |
| `GOOGLE_SA_KEY` | SA-Key-JSON inline (Alternative zum Pfad) |

## Web-Push

| Variable | Zweck |
|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Schluesselpaar (`npx web-push generate-vapid-keys`); fehlen sie, ist Push deaktiviert |
| `VAPID_SUBJECT` | Kontakt, Default `mailto:mf@taikonauten.com` |

## Backup (Mac, `server/scripts/backup.mjs`)

| Variable | Default | Zweck |
|---|---|---|
| `BACKUP_DIR` | `~/Library/Application Support/TaikoBeschluss/backups` | lokales Snapshot-Ziel |
| `OFFSITE_DIR` | Google-Drive-Desktop-Mount (auto-erkannt) | Offsite-Mirror |
| `BACKUP_KEEP` | `14` | Anzahl behaltener Snapshots (Retention) |
| `BACKUP_NOTIFY` | an | `0` = keine macOS-Fehler-Notification (Tests setzen das) |

## Backup (NAS, `deploy/backup.sh`)

| Variable | Zweck |
|---|---|
| `REQUIRE_BACKUP_ENCRYPTION` | `1` = Abbruch, wenn keine `.backup-passphrase` liegt (statt Klartext-Backups) |

## Build (automatisch)

| Variable | Zweck |
|---|---|
| `VITE_BUILD_TIME` | wird von `vite.config.js` beim Build gesetzt (Sidebar-Anzeige) — nie manuell pflegen |
