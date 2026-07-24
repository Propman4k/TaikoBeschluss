# PROJECT_HANDOFF – TaikoBeschluss

> Stand: 2026-07-24 (Session 3). Vollständiger Kontext-Transfer für eine neue Session.
> Sprache im Chat: Deutsch. Code/Commits: Umlaute vermeiden (ae/oe/ue/ss) — ABER user-facing
> UI-Texte, KI-Prompts und generierter Beschlusstext nutzen echte Umlaute (ä/ö/ü/ß).
> **Erste Aufgabe der neuen Session: umfangreiches Code-Audit** (siehe Prioritäten).

---

## Projekt-Übersicht

**TaikoBeschluss** ist ein internes Tool zum Erstellen, Freigeben und Unterschreiben von
**Gesellschafterbeschlüssen** deutscher Gesellschaften (GmbH, UG, AG, GbR). Der Nutzer (Maik
Fahldieck) verwaltet mehrere Firmen; für jede können Beschlüsse gemeinsam mit einer KI im Chat
ausformuliert, durch eine mehrstufige KI-Pipeline juristisch gegengeprüft, als A4-PDF exportiert
und von allen Gesellschaftern digital unterschrieben werden. Fertige PDFs landen automatisch in
Google Drive; ein Organigramm visualisiert die Beteiligungsstruktur; ein Prüfdossier-PDF fasst
alles für den echten Anwalt zusammen.

- **Ziel/Vision:** Beschlüsse ohne Anwalt schnell, maximal rechtssicher und volldigital abwickeln.
- **Zielgruppe:** Maik Fahldieck + Mitgesellschafter (z.B. Jonas Lempa). Login je Person.
- **Reifegrad:** Produktiv — **läuft live auf der Synology NAS (Port 3010, Docker via GHCR)**
  und wird real genutzt (echte Beschlüsse, echter Anwalt gibt Feedback).
- **Privates internes Projekt** (Taikonauten). GitHub: https://github.com/Propman4k/TaikoBeschluss
  (main; CI: Tests + Docker-Build/Push nach GHCR bei jedem Push).

---

## Tech Stack & Setup

Stack bewusst 1:1 gespiegelt von **TaikoEat** (`../TaikoEat`) und **TaikoTasks/TaskManager**
(`../TaskManager`) — bei Unsicherheit dort schauen. ~6.000 LOC.

### Kern-Technologien
- **React 19** + **Vite 7** (Client, Dev-Port **3009**) — Hash-Routing (eigenes `useHashRoute`).
- **Tailwind CSS v4** (`@tailwindcss/vite`, Tokens via `@theme` in `src/index.css`), **lucide-react**.
- **Express 5** + **better-sqlite3** (Server, Port **3010**); **express-session** +
  better-sqlite3-session-store; **google-auth-library** (OAuth); **helmet** + express-rate-limit;
  **pdf-lib** (Beschluss-PDF + Prüfdossier); **web-push** (Benachrichtigungen).
- **LLM:** direkter **Gemini-Key** über Googles OpenAI-kompatiblen Endpoint
  (`server/services/ai.js`, aus TaikoEat; `LLM_MODELS=gemini-3.1-pro,gemini-3.5-flash`).
- **vitest** + supertest + jsdom; **ESLint 9** flat config (inkl. `react/jsx-no-leaked-render`).

### Infrastruktur
- **DB:** SQLite `server/data/taikobeschluss.db` (WAL, foreign_keys ON; Prod: `/app/data` =
  NAS-Volume `/volume1/docker/taikobeschluss-data`). **NIE `rm -rf` auf Datenverzeichnisse.**
- **Deployment (läuft):** Push auf main → CI (`.github/workflows/ci.yml`: Tests + Coverage-Ratchet
  90/68, dann Docker-Build → `ghcr.io/propman4k/taikobeschluss:latest`) → `./deploy/deploy.sh`
  (Pre-Deploy-Backup auf NAS, Image-Pull, Container-Neustart, Health-Check).
  **WICHTIG: Nach `git push` erst CI abwarten (`gh run watch`), sonst zieht deploy.sh das alte
  Image** (Race ist zweimal passiert).
- **Backup Mac (Dev):** `server/scripts/backup.mjs` via LaunchAgent alle 4 h (VACUUM INTO +
  Integrity-Check + Google-Drive-Mirror). `BACKUP_NOTIFY=0` unterdrückt die macOS-Fehler-
  Notification (Tests setzen das — sonst Fehlalarme beim User!). NAS-Backup: `deploy/backup.sh`.
- **Auth:** Google OAuth + Server-Session. Zugang: `ALLOWED_EMAILS` ODER signer_email
  (`server/auth.js isAllowed`). Dev-Login: `DEV_LOGIN=1` + `/api/auth/dev?email=…`.
- **Drive-Ablage:** letzte Unterschrift lädt das PDF async nach Google Drive (Service Account,
  Geteilte Ablage, `server/services/drive.js`; ADR docs/adr/0001).

### Befehle
```
Dev (Client+Server):  npm run dev              # 3009 + 3010
Build:                npm run build
Tests:                npm test                 # vitest, 84 Tests
Coverage:             npx vitest run --coverage
Lint:                 npm run lint
Deploy:               git push && gh run watch <id> && ./deploy/deploy.sh
Backup manuell:       npm run backup --prefix server
```

### Umgebungsvariablen (`server/.env` — Lesen per Tool ist gesperrt, Env via node --env-file)
`GOOGLE_CLIENT_ID/SECRET`, `ALLOWED_EMAILS`, `LLM_API_KEY` (Gemini), `LLM_MODELS`,
`LLM_BASE_URL` (optional), `DEV_LOGIN`, `DRIVE_ROOT_FOLDER_ID`,
`GOOGLE_APPLICATION_CREDENTIALS`/`GOOGLE_SA_KEY`, Prod: `SESSION_SECRET`, `APP_URL`,
`NODE_ENV`, `DATA_DIR`, `BACKUP_*`, `VAPID_*` (Push).

---

## Architektur & Datenfluss

React SPA → `/api` (Express, Vite-Proxy in Dev) → SQLite (synchron). Kein State-Store; Server ist
Source of Truth. Prod servt Express das gebaute `dist/`.

### KI-Pipeline (Herzstück, `server/services/ki.js` — empirisch validiert mit 21 Testfällen)
- **Diskussions-Turn** (Chat-Nachricht): 1 LLM-Call, schnell. Schreibt NIE ins Dokument.
- **Verfassen/Aktualisieren** (`compose=true`, nur per Button): 3 Stufen, ~45–85 s:
  **Composer → Prüfagent → Reconciliation** (Reconciliation entscheidet Einwände AUTONOM —
  bewusste User-Entscheidung, kein Mensch in der Prüfschleife).
- **NORM-BIBLIOTHEK** (Konstante in ki.js): ~17 Ein-Satz-Normzusammenfassungen (GmbHG 30/31/43/
  43a/46/47/48/53/55/15, BGB 181/488, KStG 8b/14–17, AktG 293/302 analog, vGA, HR-Praxis) —
  verbindlicher Anker ALLER drei Stufen. Ohne sie halluzinierte der Prüfagent („§ 43a existiert
  nicht") und die Reconciliation übernahm alles blind. NIE entfernen; Änderungen per Eval testen.
- **Anwalts-Stil** (Feedback des echten Anwalts, A/B-validiert): „Der Beschluss regelt, er
  begründet nicht" — KEINE Feststellungen objektiver Tatsachen (Marktüblichkeit, §§ 30/43a,
  Bonität) im Beschlusstext; Risiken nur als Chat-Hinweis. Abstimmungsergebnis als letzte Ziffer
  (Standardformulierung; bei Stimmverbot: mit wessen Stimmen). Verweis auf separat bezeichnete
  Verträge zulässig (Kanzlei-Workflow: Vertrag + schlanker Beschluss). Unzulässige Geschäfte
  (z.B. Ausschüttung gegen § 30) → verweigern, NIE eigenmächtig substituieren. Riskante-aber-
  zulässige Wünsche (rückwirkendes Gehalt) → umsetzen + warnen.
- **Structured Output** `{reply, writeContent, content, title, type, hints}`; Rechtschreib-Retry
  (ae/oe/ue-Detektor + ß-Hyperkorrektur-Blacklist „daß/Beschluß"); Platzhalter-Regel statt
  erfundener Fakten; Beschlussdatum (`r.date`) im Kontext als „vom Nutzer festgelegt, nicht zu
  hinterfragen" (Datum bestimmt allein der User, auch rückdatiert).
- Prüf-/Reconcile-Fehler degradieren still zum Composer-Entwurf (nie 502 wegen Zusatzstufen).
- **Fortschritt:** in-memory `composeStatus`-Map + `GET /:id/chat/status`; Editor pollt und zeigt
  Blur + Overlay (3 Stufen mit rotierenden Detailtexten), Resume nach Reload.
- Weitere ki.js-Exports: `classifyResolution` (Typ-Backfill), `generateTitle` (Retitle),
  `summarizeRequest` (Dossier).

### Beschluss-Rahmen
Nur `content` ist variabel; Kopf/Gesellschafterliste/Schlussformel/Unterschriften erzeugt
`buildFrame()` (`server/services/beschluss.js`) rechtsform-abhängig — eine Quelle für Vorschau UND PDF.

---

## Datenmodell (SQLite, `server/db.js` — Migrationen als try/catch-ALTERs)

- **users** — id, email UNIQUE, name.
- **shareholders** — name, type ('company'|'person'), signer_name, signer_email,
  default_signature_path, position.
- **companies** — name, legal_form, registry_court, hrb, address, zip, city, managing_directors,
  position, drive_folder_id.
- **company_shareholders** — M:N + position + shares REAL (%).
- **resolutions** — company_id, number ('2026-01' je Firma+Jahr, MAX + UNIQUE-Index), title,
  content, date, status ('entwurf'|'freigegeben'), deleted_at (Soft-Delete), drive_file_id,
  drive_link, **type_id** (FK resolution_types), **hints** (JSON-Array, KI-kuratiert).
- **resolution_types** — kuratierte Typenliste (name UNIQUE, active, position). Seed: 16 Typen
  („Jahresabschluss & Gewinnverwendung" … „Sonstiges"). Anlegen darf NUR der User (Einstellungen);
  die KI wählt nur aus der aktiven Liste und schlägt Neues höchstens im Chat vor.
- **resolution_signatures** — je (resolution, shareholder); signature_path gesetzt = unterschrieben.
- **chat_messages** — resolution_id, role, content, wrote (0/1).
- **push_subscriptions** — Web-Push je Gerät.

## API (alle unter `/api`, requireAuth außer auth/health)

- **auth/health:** wie gehabt (Google OAuth, /auth/dev nur non-Prod).
- **companies / shareholders:** CRUD + `/reorder` + Anteile + Signatur-Endpoints (PNG geprüft).
- **resolutions:** GET / (+type_name, +toSign), GET /trash, POST, GET/PATCH/DELETE /:id
  (PATCH: title, content, date, **type_id**), /restore, /permanent, /release,
  POST|GET /:id/sign/:shId, GET /:id/pdf, **GET /:id/dossier** (Prüfdossier-PDF, attachment),
  GET|POST /:id/chat (POST: 3-Stufen-Pipeline bei compose=true; speichert type/hints),
  **GET /:id/chat/status** (Compose-Fortschritt), POST /:id/drive (Drive-Retry).
- **resolution-types:** GET, POST, PATCH/:id (name/active), **POST /backfill** (KI-Klassifikation
  Bestand, idempotent), **POST /retitle** (neue Titel NUR für Entwürfe).

---

## Feature-Map (alles fertig & live, sofern nicht anders vermerkt)

| Feature | Dateien |
|---|---|
| Google-Login + Whitelist, Dev-Login | server/auth.js, index.js |
| Gesellschaften/Gesellschafter CRUD, Anteile, Drag&Drop, Standard-Unterschriften | routes + Modals |
| 3-Spalten-Editor: Chat, A4-Vorschau (usePagination), editierbarer Titel, Typ-Dropdown, resizbares Eingabefeld (Griff oben, Default 88px, Session-only) | src/pages/Editor.jsx |
| KI-Pipeline (3 Stufen + Norm-Bibliothek + Anwalts-Stil) + Fortschritts-Overlay | server/services/ki.js, Editor.jsx |
| Beschluss-Typen: Badge + Filter in Listen, Einstellungen-Seite (CRUD + Backfill + Retitle) | routes/types.js, pages/Settings.jsx, Resolutions.jsx |
| Hinweis-Bubble: KI-kuratierte Rechtshinweise, Counter grau/orange, Overlay | Editor.jsx (HintsBubble), ki.js |
| Prüfdossier-PDF für den Anwalt (Zusammenfassung, Parteien, Chat, Hinweise, Beschlusspunkte; Direkt-Download mit Lade-Zustand) | services/pdf.js (buildDossierPdf), routes/resolutions.js |
| Freigabe + Unterschreiben + PDF + Drive-Ablage + Web-Push | pdf.js, drive.js, push.js |
| Organigramm (Barycenter-Layout, Klick öffnet Modals) | pages/Organigram.jsx, src/organigram.js |
| Papierkorb (Soft-Delete), Empty-States grau in Listenhöhe | Trash.jsx, Listen |
| Backup Mac (LaunchAgent) + NAS (deploy/backup.sh) + Restore-Drill-Test | scripts/, deploy/ |
| Offen: E-Mail-Benachrichtigung bei Freigabe (nodemailer, Muster TaikoEat) | — |

## Schlüssel-Dateien (Must-Read)

1. `server/services/ki.js` — **die** zentrale Datei: Norm-Bibliothek, alle Prompts, 3-Stufen-
   Pipeline, Rechtschreib-Retry, classify/retitle/summarize. (~450 Zeilen)
2. `server/routes/resolutions.js` — Lifecycle, Chat-Route (Pipeline-Anbindung, type/hints-
   Persistenz), Dossier, PDF, orgLines()-Helper, composeStatus-Map.
3. `server/routes/types.js` — Typen-CRUD + Backfill + Retitle.
4. `server/db.js` — Schema + Migrationen + Typen-Seed.
5. `server/services/beschluss.js` — buildFrame() + normalizeContent().
6. `server/services/pdf.js` — Beschluss-PDF + buildDossierPdf (WinAnsi-Sanitizer!).
7. `server/services/ai.js` — LLM-Client (Discovery, Fallback, Retry).
8. `src/pages/Editor.jsx` — größte Client-Datei: ComposeOverlay, HintsBubble, Titel-Edit,
   Typ-Dropdown, Dossier-Download, resizbares Eingabefeld, Status-Polling.
9. `src/pages/Resolutions.jsx` — Listen + SelectFilter (nutzt components/Dropdown.jsx).
10. `src/pages/Settings.jsx` — Typen-Verwaltung + Backfill/Retitle-Buttons.
11. `src/components/Dropdown.jsx` — geteiltes Custom-Dropdown (Listen-Filter + Editor).
12. `server/test/chat.test.js` — Pipeline-Semantik (writeContent, hints, Dossier, Retry).
13. `deploy/deploy.sh` + `.github/workflows/ci.yml` — Deploy-Kette.
14. `server/scripts/backup.mjs` — Mac-Backup (BACKUP_NOTIFY-Flag!).

## Testing

**84 Tests, alle grün. Coverage-Ratchet 90 % Lines / 68 % Branches (vite.config.js) blockt CI.**
- `server/test/setup.js` — DATA_DIR nach tmp (Live-DB-Schutz, NIE entfernen).
- chat.test.js (Pipeline gemockt: Verfassen/Prüfen/Reconcile, hints, Dossier-PDF, Spelling-Retry,
  Status-Endpoint), types.test.js (Seed, CRUD, Backfill, Retitle, Typ-Zuordnung),
  api/auth/ai/backup/beschluss/drive.test.js, Frontend: usePagination/api/organigram.
- Achtung: Testsuite NICHT parallel zu Eval-Läufen im selben Terminalbefehl starten (einmalige
  Flake-Ursache).
- KI-Qualität wird NICHT per Unit-Test, sondern per **Eval-Harness** gesichert (siehe unten).

## Nutzer-Präferenzen & Arbeitsweise (WICHTIG)

- **Deutsch, knapp, pragmatisch. Ponytail-Mode aktiv** (lazy/minimal bauen).
- Umlaute: Code/Commits ae/oe/ue; UI/Prompts/Beschlusstexte echte Umlaute. Keine Emojis in Commits.
- **Commits autonom, Push+Deploy NUR auf Ansage** („ship" / „Push und Deploy").
- **Rückfragen/Entscheidungen IMMER im AskUserQuestion-Modal, EINZELN** (eine Frage pro Modal).
- Für Feature-Planung nutzt der User gern „/grill-with-docs" → grilling-Skill: Entscheidungen
  einzeln abfragen, Empfehlung markieren, Bauplan bestätigen lassen, erst dann bauen.
- Der User testet selbst auf Prod und schickt Screenshots. Browser-Verifikation lokal ist
  erwünscht — aber Vorsicht: Downloads aus dem Browser-Pane landen in SEINEN Downloads
  (hat schon zu Verwechslung geführt); der Dev-Server läuft auf seinem Mac.
- KI-Entscheidungen nicht an den User delegieren („damit lagerst du dein Wissen in mein
  Unwissen aus") — Pipeline entscheidet autonom, User will Ergebnisse, nicht Paragrafen-Fragen.
- Der echte Anwalt (WhatsApp-Feedback) ist die höchste Autorität für Beschluss-Stil.

## Konventionen & Fallstricke

- Komponenten PascalCase, DB snake_case. ESM überall. `{!!x && …}` statt `{x && …}` (ESLint).
- Route-Reihenfolge: /trash vor /:id. Inline-Komponenten brechen natives Drag&Drop.
- `server/.env*` ist für Tools LESEGESPERRT — Skripte mit `node --env-file=server/.env` starten,
  Key bleibt unsichtbar. LLM-Konfig-Werte nie erfragen, nur per Env nutzen.
- Prod-DB read-only inspizieren: `ssh mf@100.90.56.21 "sudo /usr/local/bin/docker exec -w
  /app/server taikobeschluss node -e \"…better-sqlite3 readonly…\""` (node_modules liegen in
  /app/server!). Schreibzugriffe auf Prod-DB nur über die App.
- pdf-lib Standard-Helvetica = WinAnsi — Chat-Text vor dem Zeichnen sanitizen (ist in
  buildDossierPdf drin); SQLite-Timestamps sind UTC → für Anzeige nach Europe/Berlin wandeln.
- Eval-Harness fuer Prompt-Aenderungen: Muster liegt in der Memory (`ki-pipeline.md`) und war im
  Session-Scratchpad (eval-pipeline.mjs + cases.json) — bei Prompt-Aenderungen neu aufsetzen:
  importiert `runBeschlussChat` direkt, 10 Realfaelle, A/B vor/nach Aenderung vergleichen.

## Kontext aus bisherigen Sessions

1. **Session 1 (22.07., Scaffold):** MVP komplett (Editor, Freigabe, Unterschriften, PDF,
   Organigramm). LiteLLM verworfen → direkter Gemini-Key.
2. **Session 2 (22./23.07.):** Code-Audit → alle Datenrisiken behoben; Git/GitHub + CI +
   Coverage-Ratchet; Backup-System (Mac); Tests 13→56; Drag&Drop, Anteile, Organigramm-Layout;
   Drive-Ablage; Deployment auf Synology NAS (GHCR + deploy.sh).
3. **Session 3 (23./24.07., diese):**
   - **KI-Prompt-Evaluierung** (21 Realfälle, 3 Runden): Baseline gut, aber Prüfagent
     halluzinierte Norm-Einwände und Reconciliation war reviewer-hörig → **Norm-Bibliothek als
     Anker** eingeführt, 3-Stufen-Pipeline produktiv (Composer→Prüfagent→Reconciliation) +
     Fortschritts-Overlay. Web-Recherche/Grounding bewusst verworfen (Bibliothek deckt den
     Use-Case offline ab).
   - **Anwalts-Feedback eingearbeitet** (A/B-validiert): keine Feststellungen objektiver
     Tatsachen mehr, Abstimmungs-Ziffer, Vertragsverweise, Verweigern statt Substituieren.
   - **Features:** Beschluss-Typen (kuratierte Liste, Badge/Filter, Einstellungen-Seite,
     KI-Backfill, Retitle), Hinweis-Bubble (KI-kuratierte hints), Prüfdossier-PDF,
     editierbarer Titel, Custom-Dropdowns, resizbares Chat-Eingabefeld, Empty-State-Kacheln.
   - **Fixes:** \n-Escapes in reply, erfundene Vertragsdaten, Backup-Fehlalarm-Notifications
     (BACKUP_NOTIFY=0 in Tests), Dossier-Direktdownload statt weißem Tab, CI/Deploy-Race
     (erst `gh run watch`, dann deployen).
   - **Gescheitert/gelernt:** Naive Verify→Reconcile-Pipeline übernimmt falsche Einwände
     (Sykophantie) — nur mit Norm-Bibliothek sicher. Screenshot- vs. Viewport-Koordinaten im
     Browser-Pane verwechselt (Klicks gingen ins Leere) — refs benutzen. Browser-Pane-Downloads
     landen in User-Downloads (Dossier-Verwechslung).

## Aktuelle Prioritäten & Nächste Schritte

### Unmittelbar: **Umfangreiches Code-Audit** (explizit vom User als erste Aufgabe gesetzt)
- Skill `/audit` (bzw. anthropic-skills:audit „Code Health Audit") verwenden — es existiert ein
  alter `CODE_HEALTH_REPORT.md` aus Session 2 als Vergleichsbasis (damals 24/100 → behoben).
- Seit dem letzten Audit kamen ~20 Commits dazu (ki.js-Pipeline, types, hints, dossier,
  Settings/Dropdown/Editor-Umbauten) — Schwerpunkte: server/services/ki.js (450 Zeilen Prompts +
  Pipeline), routes/resolutions.js (gewachsen), Editor.jsx (größte Client-Datei),
  Fehlerbehandlung der neuen Endpoints (dossier/backfill/retitle = LLM-Kosten ohne Rate-Limit!),
  composeStatus-Map (in-memory, Single-Prozess-Annahme), hints/type-Persistenzpfade.
- Danach Fixes priorisieren und wie gewohnt einzeln shippen.

### Danach (Backlog)
1. E-Mail-Benachrichtigung bei Freigabe (nodemailer, Muster TaikoEat).
2. Prod: Typ-Backfill + Entwurfs-Titel-Retitle ausführen, falls noch nicht geklickt
   (Einstellungen-Seite, je ein Button — idempotent).
3. Optional: Rate-Limit für dossier/backfill/retitle, Stimmverbots-Feststellung strukturierter,
   A4-Umbruch mit langem Beschluss visuell verifizieren.

## Onboarding-Anweisungen für den neuen Chat

> **An den neuen Agent:**
> 1. Lies diese Datei komplett, dazu CLAUDE.md (Projekt + global) und die Memory
>    (`ki-pipeline.md`, `projekt-taikobeschluss.md`).
> 2. Lies in dieser Reihenfolge: `server/services/ki.js`, `server/routes/resolutions.js`,
>    `server/db.js`, `src/pages/Editor.jsx`, `server/routes/types.js`, `server/services/pdf.js`.
> 3. Smoke-Check: `npm test` (84 grün) und `npm run lint`.
> 4. **Aufgabe: umfangreiches Code-Audit** — Skill `/audit` nutzen, `CODE_HEALTH_REPORT.md`
>    (Session 2) als Vergleichsbasis, Schwerpunkte siehe Prioritäten oben.
> 5. Beachte: Deutsch + knapp, Ponytail; Fragen einzeln im Modal; Commits autonom,
>    **Push/Deploy nur auf „ship"**; nach Push IMMER erst CI abwarten, dann deployen;
>    `server/data/` und `server/.env` sind tabu; Norm-Bibliothek in ki.js nie ohne Eval ändern.
> 6. Antworte mit kurzer Zusammenfassung + priorisiertem Audit-Plan.

Erste Nachricht im neuen Chat:
```
Bitte lies PROJECT_HANDOFF.md im Projekt-Root und starte danach das umfangreiche Code-Audit.
```
