# PROJECT_HANDOFF – TaikoBeschluss

> Stand: 2026-07-23. Vollständiger Kontext-Transfer für eine neue Session.
> Sprache im Chat: Deutsch. Code/Commits: Umlaute vermeiden (ae/oe/ue/ss) — ABER user-facing
> UI-Texte und generierter Beschlusstext nutzen echte Umlaute (ä/ö/ü/ß).

---

## Projekt-Übersicht

**TaikoBeschluss** ist ein internes Tool zum Erstellen, Freigeben und Unterschreiben von
**Gesellschafterbeschlüssen** deutscher Gesellschaften (GmbH, UG, AG, GbR). Der Nutzer (Maik
Fahldieck) verwaltet mehrere Firmen; für jede können Beschlüsse gemeinsam mit einer KI im Chat
ausformuliert, rechtlich geprüft, als A4-PDF exportiert und von allen Gesellschaftern digital
unterschrieben werden. Zusätzlich visualisiert ein Organigramm die Beteiligungsstruktur.

- **Ziel/Vision:** Beschlüsse ohne Anwalt schnell, rechtssicher und vollständig digital abwickeln.
- **Zielgruppe:** Maik Fahldieck + Mitgesellschafter (z.B. Jonas Lempa). Jeder mit eigenem Login.
- **Reifegrad:** MVP, funktional fertig, lokal im Einsatz. **Noch nicht deployed — das ist der
  nächste Schritt.**
- **Privates internes Projekt** (Taikonauten). GitHub: https://github.com/Propman4k/TaikoBeschluss
  (main, CI via GitHub Actions grün).

---

## Tech Stack & Setup

Stack bewusst 1:1 gespiegelt von **TaikoEat** (`../TaikoEat`) und **TaikoTasks/TaskManager**
(`../TaskManager`) — bei Unsicherheit dort schauen. ~4.700 LOC in 30 Dateien.

### Kern-Technologien
- **React 19** + **Vite 7** (Client, Port **3009**) — Hash-Routing (eigenes `useHashRoute`, kein Router-Lib).
- **Tailwind CSS v4** (`@tailwindcss/vite`, Tokens via `@theme` in `src/index.css`).
- **lucide-react** — Icons. **Express 5** + **better-sqlite3** (Server, Port **3010**).
- **express-session** + **better-sqlite3-session-store**; **google-auth-library** (OAuth Code-Flow);
  **helmet** + **express-rate-limit**; **pdf-lib** (PDF); **vitest** + **supertest** + **jsdom** (Tests).
- **ESLint 9** (flat config, `eslint.config.js`): recommended + rules-of-hooks/exhaustive-deps +
  `react/jsx-no-leaked-render` (fängt die `0 && …`-Falle). `npm run lint`.

### Infrastruktur
- **DB:** SQLite `server/data/taikobeschluss.db` (WAL, foreign_keys ON). Signaturen als PNGs in
  `server/data/signatures/`. **NIE `rm -rf` auf `server/data/`** (Safety-README liegt dort).
- **Backup (läuft!):** `server/scripts/backup.mjs` — `VACUUM INTO`-Snapshot (Millisekunden-Stempel!)
  + Integrity-Check + Signaturen-Copy nach `~/Library/Application Support/TaikoBeschluss/backups/`,
  Retention 14, Offsite-rsync nach Google Drive „Meine Ablage/TaikoBeschluss-Backups"
  (`--inplace`, KEIN `--delete`). LaunchAgent `com.taikonauten.taikobeschluss.backup` (RunAtLoad +
  alle 4 h), Log: `~/Library/Logs/taikobeschluss-backup.log`. Installer:
  `scripts/install-backup-schedule.sh`. Restore-Drill ist als Test automatisiert (backup.test.js).
- **Auth:** Google OAuth + Server-Session (30 Tage, httpOnly, sameSite=lax, secure in Prod).
  Zugang: ENV-Whitelist `ALLOWED_EMAILS` ODER als `signer_email` eines Gesellschafters
  (`server/auth.js` `isAllowed`). Dev-Login prüft ebenfalls `isAllowed`.
- **LLM:** Direkter **Gemini-Key** über Googles OpenAI-kompatiblen Endpoint (KEIN LiteLLM —
  Nutzer hat kein Gateway). `server/services/ai.js` (aus TaikoEat). Key-Format `AQ.…`.
- **CI:** `.github/workflows/ci.yml` — npm ci (Root+Server), lint, `vitest --coverage`
  (Ratchet: 90 % Lines / 68 % Branches in vite.config.js), build. Läuft bei jedem Push.
- **Hosting:** offen — **nächste Aufgabe: Synology NAS** (siehe Prioritäten).

### Befehle
```
Dev (Client+Server):  npm run dev             # 3009 (Client) + 3010 (Server)
Build:                npm run build
Tests:                npx vitest run          # vom Projekt-Root! 56 Tests
Coverage:             npx vitest run --coverage
Lint:                 npm run lint
Backup manuell:       npm run backup --prefix server
```
Nach `server/.env`-Änderung Server neu starten (`touch server/index.js` triggert `node --watch`).
**Dev-Login:** `DEV_LOGin=1` in `server/.env`, dann `/api/auth/dev?email=...` (nur non-Prod,
E-Mail muss `isAllowed` bestehen).

### Umgebungsvariablen (`server/.env`, Vorlage `.env.example`)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — OAuth (Redirect Dev: `http://localhost:3009/api/auth/google/callback`).
- `ALLOWED_EMAILS` — kommagetrennte Login-Whitelist.
- `LLM_API_KEY` (Gemini), `LLM_MODELS` (Präferenzliste), `LLM_BASE_URL` (optional).
- `DEV_LOGIN` — `1` aktiviert Dev-Login.
- Prod: `SESSION_SECRET` (Pflicht, Server wirft sonst), `APP_URL`, `NODE_ENV=production`,
  optional `BIND_ADDR`, `SERVER_PORT`, `DATA_DIR`, `BACKUP_DIR`, `OFFSITE_DIR`, `BACKUP_KEEP`.

---

## Projektstruktur

```
TaikoBeschluss/
├── .github/workflows/ci.yml   ← CI: lint + coverage-gated Tests + Build
├── vite.config.js              ← Proxy 3009→3010, vitest + Coverage-Ratchet 90/68
├── eslint.config.js            ← ESLint 9 flat config
├── scripts/                    ← Backup-LaunchAgent (plist + Installer)
├── src/
│   ├── App.jsx                 ← Hash-Routing, Sidebar-Counts
│   ├── api.js                  ← fetch-Wrapper, fmtDate, isPersonengesellschaft
│   ├── usePagination.js        ← A4-Pagination-Hook (extrahiert, getestet)
│   ├── organigram.js           ← buildGraph: Ebenen-Logik fuers Organigramm (pure, getestet)
│   ├── components/
│   │   ├── Sidebar.jsx             ← Nav (Beschluesse-Gruppe klappbar per Klick auf Titel)
│   │   ├── CompanyModal.jsx        ← Gesellschaft-Modal (geteilt: Companies + Organigramm)
│   │   ├── ShareholderModal.jsx    ← Gesellschafter-Modal inkl. Standard-Unterschrift (geteilt)
│   │   ├── SignatureModal.jsx      ← Canvas-Unterschrift
│   │   └── Toast.jsx
│   └── pages/
│       ├── Login.jsx / Resolutions.jsx / Editor.jsx / Trash.jsx
│       ├── Companies.jsx           ← Liste mit Drag&Drop-Sortierung
│       ├── Shareholders.jsx        ← Liste, Kategorien, Drag&Drop je Kategorie
│       └── Organigram.jsx          ← Beteiligungs-Diagramm (Klick oeffnet Modals in-place)
└── server/
    ├── index.js                ← Express, OAuth, Session, Error-Middleware, Prod-Static
    ├── db.js                   ← Schema + Mini-Migrationen (try/catch-ALTERs)
    ├── auth.js                 ← isAllowed(), requireAuth()
    ├── routes/                 ← companies (+reorder,+shares), shareholders (+reorder,
    │                              +signature), resolutions (Lifecycle, Chat, PDF, Trash)
    ├── services/               ← ai.js (Gemini), beschluss.js (buildFrame), pdf.js, png.js (Magic-Bytes)
    ├── scripts/backup.mjs      ← Backup (siehe oben)
    └── test/                   ← setup.js (DATA_DIR-Isolation!) + 5 Test-Dateien
```

### Schlüssel-Dateien (Must-Read)
1. `server/db.js` — Schema + Migrationen (position-Spalten, shares, UNIQUE-Index Nummern).
2. `server/routes/resolutions.js` — Beschluss-Lifecycle, Chat mit System-Prompt, Rate-Limit,
   Papierkorb-Guards (`activeResolution`), Nummern via MAX.
3. `server/routes/companies.js` — CRUD + `POST /reorder` + Anteile (`shareholders:[{id,shares}]`).
4. `server/routes/shareholders.js` — CRUD + `POST /reorder` + Signatur-Endpoints.
5. `server/services/beschluss.js` — `buildFrame()` rechtsform-abhängig + `normalizeContent()`.
6. `server/services/ai.js` — LLM-Client (Discovery, Fallback, isRetryableModelError).
7. `server/scripts/backup.mjs` — Backup-Logik (bei Deployment anpassen: Pfade!).
8. `src/pages/Organigram.jsx` — Barycenter-Layout, SVG-Kanten, Klick→Modal.
9. `src/organigram.js` — Ebenen-Regeln (Personen = Anker, GbR darüber, Zyklus-Schutz).
10. `src/components/CompanyModal.jsx` / `ShareholderModal.jsx` — geteilte Bearbeiten-Modals.
11. `src/pages/Editor.jsx` — 3-spaltiger Editor, nutzt `usePagination`.
12. `server/test/api.test.js` — Integrations-Durchstich; zeigt alle API-Patterns.
13. `.github/workflows/ci.yml` + `vite.config.js` — CI + Coverage-Gate.

---

## Architektur & Datenfluss

React SPA (Vite) → `/api` (Express, Vite-Proxy in Dev) → SQLite (synchron). Kein State-Store;
Server ist Source of Truth, Pages laden via `useState`/`useEffect`. In Prod servt Express das
gebaute `dist/` (SPA-Fallback für Nicht-API-Routen ist in index.js schon drin!).

**Chat-Lifecycle:** POST `/api/resolutions/:id/chat` → System-Prompt (Firmendaten, Rechtsform,
aktueller Text, Verhaltensregeln, Umlaut-Zwang) → `chatCompletionWithFallback` (Gemini,
json_schema `{reply, writeContent, content, title}`) → bei `writeContent=true` wird
`resolutions.content` gesetzt (leerer String = bewusstes Leeren). 3 Versuche gegen transiente
Fehler + kaputtes JSON. Rate-Limit 60/15min.

**Beschluss-Rahmen:** Nur `content` ist variabel; Kopf/Gesellschafterliste/Schlussformel/
Unterschriftszeilen erzeugt `buildFrame()` rechtsform-abhängig — eine Quelle für Vorschau UND PDF.

**Organigramm:** `buildGraph(companies)` merged Gesellschafter+Firmen per Name zu Knoten,
Ebenen: [Gesellschaften ohne Töchter, die nur Personen gehören (GbR)] → [Personen + externe
Halter] → [Beteiligungen nach Tiefe]. Seite misst Karten-Breiten, Barycenter-Iteration
positioniert Knoten unterm Schwerpunkt ihrer Nachbarn, SVG zeichnet Winkel-Linien mit
Sammelschiene je Ziel, Pfeilspitzen, Prozent-Kästchen am Eigentümer-Abgang.

---

## Datenmodell (SQLite, `server/db.js`)

- **users** — id, email UNIQUE, name.
- **shareholders** — id, name, type ('company'|'person'), signer_name, signer_email,
  default_signature_path (NIE ans Frontend), **position** (Drag&Drop).
- **companies** — id, name, legal_form ('gmbh'|'ug'|'ag'|'gbr'|'other'), registry_court, hrb,
  address, zip, city, **position** (Drag&Drop).
- **company_shareholders** — M:N company_id+shareholder_id, position (Reihenfolge im Beschluss!),
  **shares REAL** (Beteiligungs-% , NULL = nicht erfasst).
- **resolutions** — id, company_id, number ('2026-01' je Firma+Jahr, **MAX-vergeben,
  UNIQUE-Index**), title, content, date, status ('entwurf'|'freigegeben'), deleted_at (Soft-Delete).
- **resolution_signatures** — je (resolution, shareholder), signature_path gesetzt = unterschrieben,
  signed_at, signed_by.
- **chat_messages** — resolution_id, role, content, wrote (0/1).

**Migrationen:** try/catch-`ALTER TABLE` am Ende von db.js. **JSX-Falle:** SQLite-Boolean-Ausdrücke
liefern 0/1 → immer `{!!x && …}` (ESLint-Regel erzwingt das jetzt).

## API (alle unter `/api`, requireAuth außer auth/health)

- **auth:** GET /auth/google, /auth/google/callback, /auth/logout, /auth/me, /auth/dev (Dev), /health.
- **companies:** GET (position-sortiert, inkl. shareholders mit type+shares), POST, PUT/:id
  (Body: Felder + `shareholders:[{id,shares}]` ODER legacy `shareholder_ids`), DELETE/:id (409 bei
  Beschlüssen), **POST /reorder {ids}**.
- **shareholders:** GET (sichere Spalten, position-sortiert), POST, PUT/:id, DELETE/:id (409 wenn
  zugeordnet), **POST /reorder {ids}**, POST|GET|DELETE /:id/signature (PNG, Magic-Bytes-geprüft).
- **resolutions:** GET / (+toSign), GET /trash (VOR /:id!), POST, GET/:id, PATCH/:id, DELETE/:id
  (Soft), POST /:id/restore, DELETE /:id/permanent, POST /:id/release, POST|GET /:id/sign/:shId
  (PNG-Body, leer = entfernen), GET /:id/pdf, GET|POST /:id/chat. Schreibende Aktionen + PDF
  verweigern Papierkorb-Beschlüsse (404).

---

## Feature-Map

| Feature | Status |
|---|---|
| Google-Login + Whitelist, Dev-Login (isAllowed-geprüft) | fertig |
| Gesellschaften CRUD + Rechtsform + **Anteile (%)** + **Drag&Drop-Reihenfolge** | fertig |
| Gesellschafter CRUD (Firmen/Personen-Kategorien) + Standard-Unterschriften + **Drag&Drop je Kategorie** | fertig |
| 3-spaltiger Chat-Editor, KI-Rechtsprüfung, A4-Vorschau (usePagination) | fertig |
| Freigabe + Unterschreiben + PDF-Export | fertig |
| Listen-Views (Entwürfe/Zu unterschreiben/Abgeschlossen) + Papierkorb | fertig |
| **Organigramm** (Beteiligungsstruktur, Klick öffnet Bearbeiten-Modal in-place) | fertig |
| Geteilte Modals (CompanyModal/ShareholderModal), Backdrop-Klick = Abbrechen (alle 6 Modals) | fertig |
| Backup (lokal + Offsite + LaunchAgent + Restore-Drill-Test) | fertig |
| CI (GitHub Actions) + Coverage-Ratchet | fertig |
| **Deployment Synology NAS** | **OFFEN — nächster Schritt** |
| E-Mail-Benachrichtigung bei Freigabe (nodemailer, Muster TaikoEat) | offen |
| Live-Web-Recherche für Rechtsprüfung | offen (optional) |

## Design System & UI

- Tokens in `src/index.css` `@theme`: Brand `#1100ff`, Nav-Aktiv `#0014FF`, surface/border/text-
  Familie, `shadow-card`/`shadow-elevated`. Font Inter. `.input-base`/`.input-select`.
- **Regel: Seiten/Listen volle Breite (`w-full`), keine `max-w-*` auf Content.** Modals max-w-md/xl.
- Icon-Kacheln: Kapitalgesellschaften blau (`bg-blue-50 text-brand`), **Personengesellschaften/GbR
  orange** (`isPersonengesellschaft` in api.js), Personen grün (`bg-emerald-50 text-emerald-600`).
- Listen-Rows: `text-sm font-medium` Titel, Grip-Handle, Aktions-Icons vertikal zentriert.
- Modals: `rounded-2xl overflow-hidden shadow-elevated animate-modal-in`, Backdrop-Klick schließt.
- A4: `PAGE={w:794,h:1123,pad:90}` (src/usePagination.js), Fließtext 14px.

## Testing

**56 Tests, alle grün. Coverage 93,9 % Lines / 73 % Branches, Ratchet 90/68 blockt in CI.**
- `server/test/setup.js` — DATA_DIR nach tmp, NODE_ENV=test. **Nie entfernen** (Live-DB-Schutz).
- api.test.js (Integration: Durchstich, CRUD, Reorder, Anteile, Papierkorb-Guards, Nummern),
  chat.test.js (LLM gemockt via vi.mock: writeContent-Semantik!), ai.test.js (fetch-Stub),
  auth.test.js, backup.test.js (Restore-Drill als Child-Prozess, Retention),
  beschluss.test.js (buildFrame je Rechtsform).
- Frontend: src/usePagination.test.jsx (jsdom via `// @vitest-environment jsdom` — global ist
  environment 'node'!), src/api.test.js, src/organigram.test.js.
- Bewusste Lücken: OAuth-Callback/index.js, Page-Komponenten, E2E (dokumentiert in TESTING_AUDIT.md).
- Einmalig flakte ein Test (nicht reproduzierbar, 3× grün) — falls es in CI wieder auftritt: Backup-Drill härten.

## Nutzer-Präferenzen & Arbeitsweise (WICHTIG)

- **Deutsch, knapp, pragmatisch.** Tabellen + kurze Punktlisten. Ponytail-Mode aktiv.
- **Umlaute:** Code/Commits ae/oe/ue/ss; UI + Beschlusstexte echte Umlaute.
- **Keine Emojis** in Commits/Code. **Commits autonom, Push nur auf Anfrage** (in dieser Session
  hatte der User Push pauschal freigegeben — im Zweifel neu fragen).
- **Destruktives nur mit Rückfrage.** Kein `rm -rf` auf Datenverzeichnisse (globale Regel).
- Der Nutzer testet **selbst im Browser** und gibt Screenshot-Feedback — er hat explizit gesagt,
  dass Claude NICHT jedes Mal im eigenen Browser testen muss (nur bei riskanten Umbauten kurz).
  Achtung: Wenn seine Session den Dev-Server auf 3009 hält, eigenen Client via launch.json-Eintrag
  `taiko-beschluss-client-alt` (Port 3019) starten.
- Er baut auch selbst UI-Referenzen (z.B. das Organigramm-Layout) — solche Vorlagen ernst nehmen
  und algorithmisch übernehmen statt eigene Ideen zu verteidigen.

## Konventionen & Fallstricke

- Komponenten PascalCase, DB snake_case, Routen lowercase. ESM überall.
- **`0 && …`-Falle** → `{!!x && …}` (ESLint erzwingt). **Route-Reihenfolge:** /trash vor /:id.
- **Inline-Komponenten in Render-Funktionen brechen natives Drag&Drop** (Remount beim dragstart
  → Browser bricht Drag ab). Deshalb `renderItem`-Funktionen statt lokaler Komponenten.
- usePagination: Mess- und Render-Container MÜSSEN gleiche Breite (614px) + Schriftgröße (14px) haben.
- Standard-Unterschrift folgt der Person (signer_email), nicht der Firma (`template_shareholder_id`).
- express-session-Store hält den Prozess am Leben (Interval) — bei Skripten, die index.js
  importieren, Prozess explizit beenden.
- Anteile: Frontend toleriert Komma ("33,3"), Backend NULL bei Ungültigem. Keine 0-100-Validierung
  (bewusst offen — bei Bedarf nachrüsten).

## Kontext aus bisherigen Sessions

1. **Session 1 (2026-07-22, Scaffold):** Komplettes MVP gebaut (siehe Feature-Map). LiteLLM
   verworfen → direkter Gemini-Key. Listen-UI-Umbau, Rechtsform-Rahmen, Soft-Delete.
2. **Session 2 (2026-07-22/23, diese):**
   - **Code-Audit** (`CODE_HEALTH_REPORT.md`): Score 24/100 wegen Datenrisiko → alles behoben.
   - **Git + GitHub** eingerichtet (`.gitignore` zuerst!), CI aufgesetzt.
   - **Backup komplett** (siehe Infrastruktur) — fand dabei echten Bug (Sekunden-Timestamp-Kollision).
   - **Fixes:** Nummern-Vergabe MAX+UNIQUE, PNG-Magic-Bytes, Chat-Rate-Limit, Papierkorb-Guards,
     Error-Middleware, Dev-Login-Whitelist.
   - **Testing-Ausbau** (`TESTING_AUDIT.md` + Nachtrag): 13→56 Tests, Coverage 69→94 %, Ratchet, CI.
   - **Features:** Drag&Drop-Sortierung (Firmen + Gesellschafter), Anteile (%) im Firmen-Modal,
     Organigramm (3 Layout-Iterationen bis zum User-Muster: Personen mittig, GbR oben),
     Klick-to-Edit im Organigramm mit geteilten Modals, Backdrop-Klick schließt Modals.
   - **Gescheitert/gelernt:** Organigramm mit justify-evenly/Flex war unleserlich → echtes
     Graph-Layout noetig. Deep-Link-Ansatz (?edit=) fuer Organigramm-Klick verworfen — User wollte
     Modal in-place. `git add -A` hatte einmal ungeprüfte Datei committet — Lehre: explizit stagen.

## Aktuelle Prioritäten & Nächste Schritte

### Unmittelbar: Deployment auf Synology NAS

**Referenz-Implementierungen liegen in den Schwester-Projekten** — Muster 1:1 übernehmen:
- `~/Projects/TaikoEat/Dockerfile` — Multi-Stage (Vite-Build → node:20-slim, better-sqlite3-
  Prebuilds, Build-Tools nur als Fallback), GHCR-Image, **kein Build auf der NAS**.
- `~/Projects/TaikoEat/.github/workflows/build.yml` — Test-Gate → Docker-Build auf GitHub-Runnern
  (linux/amd64) → Push nach GHCR.
- `~/Projects/TaikoEat/deploy/` — deploy.sh, backup.sh, offsite-sync.sh, restore-test.sh, README.
- TaskManager hat dasselbe Setup (zweite Referenz).

Zu klären/tun:
1. Dockerfile + build.yml adaptieren (Ports 3009/3010; Prod servt Express alles auf einem Port —
   `SERVER_PORT`, Static aus dist/ ist implementiert).
2. `DATA_DIR` aufs NAS-Volume mappen; **Backup-Strategie fürs NAS** (backup.mjs ist macOS-zentrisch:
   LaunchAgent + Google-Drive-Mount — auf der NAS stattdessen deploy/backup.sh-Muster von TaikoEat).
3. Google-OAuth-Client: Prod-Redirect-URI ergänzen; `APP_URL`, `SESSION_SECRET`, `NODE_ENV=production`.
4. Cloudflare (Tunnel/DNS) wie bei den anderen Tools.
5. `ALLOWED_EMAILS` + Gemini-Key in NAS-Env.
6. Beachten: engineering:coolify-deploy-readiness-Skill existiert — der User deployt die anderen
   Tools evtl. gerade Richtung Coolify (tools.taiko.cloud). **Zuerst fragen: NAS-Docker wie
   TaikoEat oder Coolify?** Er sagte „Synology NAS".

### Danach
1. E-Mail-Benachrichtigung bei Freigabe (nodemailer, Muster TaikoEat).
2. A4-Umbruch mit echtem langen Beschluss verifizieren (usePagination hat jetzt Tests, aber
   der visuelle Fall aus Session 1 wurde nie im Browser bestätigt).
3. Optional: „Chat zurücksetzen", Live-Web-Recherche für Rechtsprüfung, Anteile-Validierung 0-100,
   Anteile im PDF/Beschluss-Rahmen nutzen.

## Onboarding-Anweisungen für den neuen Chat

> **An den neuen Agent:**
> 1. Lies diese Datei komplett.
> 2. Lies: `server/index.js`, `server/db.js`, `~/Projects/TaikoEat/Dockerfile`,
>    `~/Projects/TaikoEat/.github/workflows/build.yml`, `~/Projects/TaikoEat/deploy/deploy.sh`
>    (+ README in deploy/).
> 3. `npx vitest run` (56 grün) und `npm run lint` als Smoke-Check.
> 4. **Aufgabe: Deployment auf Synology NAS** — Muster von TaikoEat übernehmen (GHCR-Image,
>    kein NAS-Build). Vorher kurz klären: klassisch NAS-Docker wie TaikoEat oder Coolify?
> 5. Beachte: Deutsch + knapp; Push nur auf Anfrage; nichts Destruktives ohne OK; User testet
>    selbst im Browser; `server/data/` ist heilig.
> 6. Antworte mit kurzer Zusammenfassung und einem konkreten Deployment-Plan.

Erste Nachricht im neuen Chat:
```
Bitte lies PROJECT_HANDOFF.md im Projekt-Root und starte mit dem Deployment auf die Synology NAS.
```
