# PROJECT_HANDOFF – TaikoBeschluss

> Stand: 2026-07-22. Diese Datei ist der vollständige Kontext-Transfer für eine neue Session.
> Sprache im Chat: Deutsch. Code/Commits: Umlaute vermeiden (ae/oe/ue/ss) — ABER **generierter
> Beschlusstext und KI-Chat-Ausgaben sollen echte Umlaute (ä/ö/ü/ß) nutzen** (siehe offene Punkte).

---

## Projekt-Übersicht

**TaikoBeschluss** ist ein internes Tool zum Erstellen, Freigeben und Unterschreiben von
**Gesellschafterbeschlüssen** deutscher Gesellschaften (GmbH, UG, AG, GbR). Der Nutzer (Maik
Fahldieck) verwaltet mehrere Firmen; für jede können Beschlüsse gemeinsam mit einer KI im Chat
ausformuliert, rechtlich geprüft, als A4-PDF exportiert und von allen Gesellschaftern digital
unterschrieben werden.

- **Ziel/Vision:** Beschlüsse ohne Anwalt schnell, rechtssicher und vollständig digital abwickeln.
- **Problem:** Bisher manuelle Word-Dokumente; kein einheitlicher, rechtssicherer Prozess mit
  Unterschriften-Tracking.
- **Zielgruppe:** Maik Fahldieck + Mitgesellschafter (z.B. Jonas Lempa). Jeder mit eigenem Login.
- **Reifegrad:** MVP, lokal lauffähig, funktional weitgehend fertig. Noch nicht deployed.
- **Privates internes Projekt** (Taikonauten).

---

## Tech Stack & Setup

Stack ist bewusst 1:1 gespiegelt von den Schwester-Tools **TaikoEat** (`../TaikoEat`) und
**TaikoTasks/TaskManager** (`../TaskManager`) — bei Unsicherheit dort schauen, wie etwas gelöst ist.

### Kern-Technologien
- **React 19** + **Vite 7** (Client, Port **3009**) — Hash-Routing (kein Router-Lib, eigenes `useHashRoute`).
- **Tailwind CSS v4** (`@tailwindcss/vite`, Config via `@theme` in `src/index.css`) — Design-Tokens.
- **lucide-react** — Icons.
- **Express 5** + **better-sqlite3** (Server, Port **3010**).
- **express-session** + **better-sqlite3-session-store** — Sessions.
- **google-auth-library** — Google OAuth (Code-Flow).
- **helmet** + **express-rate-limit** — Security.
- **pdf-lib** — PDF-Erzeugung (aus TaikoEat übernommen).
- **vitest** + **supertest** — Tests.

### Infrastruktur
- **DB:** SQLite (`server/data/taikobeschluss.db`, WAL-Modus, `foreign_keys = ON`).
- **API:** REST unter `/api/*`, Vite proxied `/api` → `http://127.0.0.1:3010`.
- **Auth:** Google OAuth + Server-Session. Zugang: ENV-Whitelist `ALLOWED_EMAILS` ODER als
  `signer_email` eines Gesellschafters hinterlegt (`server/auth.js` `isAllowed`).
- **LLM:** Direkter **Gemini-Key** über Googles OpenAI-kompatiblen Endpoint (KEIN LiteLLM-Gateway —
  der Nutzer hat keins). `server/services/ai.js`, 1:1 aus TaikoEat.
- **Hosting:** noch offen — später NAS + Cloudflare wie die anderen Tools (nicht implementiert).

### Befehle
```
Dev (Client+Server):  npm run dev            # Port 3009 (Client) + 3010 (Server)
Build:                npm run build
Tests:                npx vitest run         # vom Projekt-Root!
Server allein:        npm run dev --prefix server
```
Nach jeder `server/.env`-Änderung: Server neu starten (`node --watch` überwacht nur Code-Dateien).
Trick zum Neustart im Dev: `touch server/index.js`.

**Dev-Login ohne Google:** `DEV_LOGIN=1` in `server/.env`, dann `/api/auth/dev?email=...` aufrufen
(nur wenn nicht Production).

### Umgebungsvariablen (`server/.env`, siehe `.env.example`)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — OAuth-Client (Redirect: `http://localhost:3009/api/auth/google/callback`).
- `ALLOWED_EMAILS` — kommagetrennte Login-Whitelist (z.B. `mf@taikonauten.com`).
- `LLM_API_KEY` — **Gemini-API-Key** (Bearer). Ohne den schlägt der Chat fehl.
- `LLM_MODELS` — Präferenz-Reihenfolge echter Modellnamen (z.B. `gemini-3.1-pro,gemini-3.5-flash`); Discovery via `GET /models`.
- `LLM_BASE_URL` — optional; Default `https://generativelanguage.googleapis.com/v1beta/openai`.
- `DEV_LOGIN` — `1` aktiviert `/api/auth/dev` (nur Dev).
- Prod: `SESSION_SECRET`, `APP_URL`, `NODE_ENV=production`.

---

## Projektstruktur

```
TaikoBeschluss/
├── index.html
├── vite.config.js         ← Ports 3009→3010 Proxy, vitest-Config
├── package.json           ← Client-Deps + Scripts (dev/build/test)
├── CLAUDE.md              ← Projekt-Regeln (Kurzfassung)
├── src/
│   ├── main.jsx           ← React-Entry
│   ├── App.jsx            ← Hash-Routing, Sidebar-Counts, Layout
│   ├── api.js             ← fetch-Wrapper (get/post/put/patch/del), fmtDate
│   ├── index.css          ← Tailwind v4 @theme (Brand #1100ff, Inter, Shadows, input-Klassen)
│   ├── components/
│   │   ├── Sidebar.jsx        ← Nav mit aufklappbarer Beschluss-Gruppe + Counter-Pillen
│   │   ├── SignatureModal.jsx ← Canvas-Unterschrift (aus TaikoEat) + "Vorlage nutzen"
│   │   └── Toast.jsx          ← Toast-Context (useToast)
│   └── pages/
│       ├── Login.jsx          ← Google-Login-Screen
│       ├── Resolutions.jsx    ← Beschluss-Listen (views: entwuerfe/offen/abgeschlossen) + Soft-Delete-Modal
│       ├── Editor.jsx         ← 3-spaltig: Nav | Chat | A4-Dokumentvorschau (Kernstück)
│       ├── Companies.jsx      ← Gesellschaften CRUD (inkl. Rechtsform, Gesellschafter-Zuordnung)
│       ├── Shareholders.jsx   ← Gesellschafter CRUD (Typ Gesellschaft/Person, Standard-Unterschrift)
│       └── Trash.jsx          ← Papierkorb (wiederherstellen / endgültig löschen)
└── server/
    ├── index.js           ← Express-Setup, OAuth, Session, Router-Mounting, Prod-Static
    ├── db.js              ← SQLite-Schema + Mini-Migrationen (ALTER TABLE try/catch)
    ├── auth.js            ← isAllowed(), requireAuth()
    ├── .env / .env.example
    ├── routes/
    │   ├── companies.js       ← /api/companies CRUD (+ legal_form)
    │   ├── shareholders.js    ← /api/shareholders CRUD + Standard-Unterschrift-Endpoints
    │   └── resolutions.js     ← /api/resolutions: CRUD, release, sign, pdf, chat, trash, restore
    ├── services/
    │   ├── ai.js              ← LLM-Client (Gemini OpenAI-kompat), Model-Discovery + Fallback
    │   ├── beschluss.js       ← buildFrame() (rechtsform-abhängiger Rahmen), normalizeContent(), fmtDate()
    │   └── pdf.js             ← buildResolutionPdf() mit pdf-lib, Textumbruch, Signatur-Einbettung
    └── test/
        ├── setup.js           ← DATA_DIR-Isolation (tmp), NODE_ENV=test
        └── api.test.js        ← Smoke-Durchstich + Standard-Unterschrift-Test (2 Tests)
```

### Schlüssel-Dateien (Must-Read)
1. `server/db.js` — komplettes DB-Schema + Migrationen. Erklärt das Datenmodell.
2. `server/routes/resolutions.js` — Herzstück: Beschluss-Lifecycle, Chat-Endpoint mit System-Prompt, Unterschriften, PDF, Papierkorb.
3. `server/services/beschluss.js` — `buildFrame()` (rechtsform-korrekter Rahmen) + `normalizeContent()`.
4. `server/services/pdf.js` — PDF-Layout (A4, Textumbruch, Unterschriften nebeneinander).
5. `server/services/ai.js` — LLM-Anbindung (Discovery/Fallback/Retry-Logik im Aufrufer).
6. `src/pages/Editor.jsx` — 3-spaltiger Editor, A4-Pagination (`usePagination`), Chat, Signatur-Flow.
7. `src/pages/Resolutions.jsx` — Listen-Views + StatusBadge (Ampel) + Soft-Delete (doppelte Abfrage).
8. `src/components/Sidebar.jsx` — Nav-Struktur + Counter.
9. `src/components/SignatureModal.jsx` — Unterschrift zeichnen + Vorlage laden.
10. `src/App.jsx` — Routing + Counts.
11. `server/routes/shareholders.js` — Gesellschafter + Standard-Unterschrift (sichere Spalten, kein FS-Pfad ans Frontend).
12. `server/routes/companies.js` — Gesellschaften + Rechtsform.
13. `src/index.css` — Design-Tokens (Brand `#1100ff`, Inter, `shadow-card`/`shadow-elevated`, `.input-base`/`.input-select`).

---

## Architektur & Datenfluss

**Schichten:** React SPA (Vite) → `/api` (Express) → SQLite (better-sqlite3, synchron).
Kein globaler State-Store; State lokal pro Page via `useState`/`useEffect`, Server ist Source of Truth.
Sidebar-Counts holt `App.jsx` bei jedem Routenwechsel neu.

**Request-Lifecycle Beispiel (Chat):**
1. Editor sendet `POST /api/resolutions/:id/chat { message }`.
2. Server baut System-Prompt (Firmendaten inkl. Rechtsform, aktueller Beschlusstext, Verhaltensregeln).
3. `chatCompletionWithFallback` ruft Gemini (OpenAI-kompat, `response_format: json_schema`).
4. Antwort `{reply, writeContent, content, title}` — bei `writeContent` wird `resolutions.content` aktualisiert.
5. Response `{reply, wrote, resolution}`; Editor rendert Chat + aktualisiert Dokumentvorschau.
Bis zu **3 Versuche** fangen transiente LLM-Fehler + ungültiges JSON ab (behebt frühere 500er).

**Beschluss-Rahmen:** Nur der **variable Teil** (`content`) wird von KI/Nutzer geschrieben. Kopf,
Gesellschafterliste, Boilerplate, Ort/Datum, Unterschriftszeilen erzeugt `buildFrame()`
**rechtsform-abhängig** — eine Quelle der Wahrheit für Vorschau (API) UND PDF.

---

## Datenmodell (SQLite, `server/db.js`)

- **users** — `id, email UNIQUE, name, created_at`. Angelegt beim ersten Login.
- **shareholders** (zentral, firmenübergreifend wiederverwendbar):
  `id, name, type ('company'|'person', default 'company'), signer_name, signer_email,
  default_signature_path (FS-Pfad, NIE ans Frontend), created_at`.
  Bei `type='person'` ist `signer_name = name`.
- **companies** — `id, name, legal_form ('gmbh'|'ug'|'ag'|'gbr'|'other', default 'gmbh'),
  registry_court, hrb, address, zip, city, created_at`.
- **company_shareholders** — M:N `company_id, shareholder_id, position` (PK: company_id+shareholder_id).
- **resolutions** — `id, company_id FK, number ('2026-01' fortlaufend je Firma+Jahr), title,
  content (variabler Teil), date (YYYY-MM-DD), status ('entwurf'|'freigegeben'), deleted_at (Soft-Delete),
  created_at, updated_at`.
- **resolution_signatures** — 1 Zeile je (resolution, shareholder), angelegt bei Freigabe:
  `id, resolution_id FK, shareholder_id FK, signature_path (gesetzt = unterschrieben), signed_at, signed_by FK users,
  UNIQUE(resolution_id, shareholder_id)`.
- **chat_messages** — `id, resolution_id FK, role ('user'|'assistant'), content, wrote (0/1 = hat den Beschluss geschrieben), created_at`.

**Migrationen:** Am Ende von `db.js` per `ALTER TABLE ... try/catch` (Spalten: `deleted_at`,
`default_signature_path`, `shareholders.type` + Backfill, `chat_messages.wrote`, `companies.legal_form` + Backfill).
**Wichtig:** `(x IS NOT NULL)`-Ausdrücke liefern **0/1 (Zahl)** an das Frontend → im JSX niemals
`{zahl && ...}` (rendert "0"), immer `{!!zahl && ...}` oder Ternary.

---

## API-Endpunkte (alle unter `/api`, `requireAuth` außer auth/health)

**Auth:** `GET /auth/google`, `GET /auth/google/callback`, `GET /auth/logout`, `GET /auth/me`,
`GET /auth/dev?email=` (nur Dev), `GET /health`.

**companies:** `GET /companies` (inkl. shareholders + has_default_signature), `POST`, `PUT/:id`, `DELETE/:id` (409 wenn Beschlüsse existieren).

**shareholders:** `GET /shareholders` (sichere Spalten), `POST`, `PUT/:id`, `DELETE/:id` (409 wenn zugeordnet).
Standard-Unterschrift: `POST/:id/signature` (raw PNG), `GET/:id/signature` (PNG), `DELETE/:id/signature`.

**resolutions:**
- `GET /resolutions` → `{resolutions[], toSign[]}` (toSign = offene Slots des eingeloggten Nutzers).
- `GET /resolutions/trash` (muss VOR `/:id` stehen — Reihenfolge!).
- `POST /resolutions {company_id}` → neuer Entwurf mit fortlaufender Nummer.
- `GET /resolutions/:id` → fullResolution (content normalisiert, frame, shareholders inkl. `template_shareholder_id`, signatures).
- `PATCH /resolutions/:id {title?, content?, date?}` — auch nach Unterschrift editierbar (Unterschriften bleiben).
- `DELETE /resolutions/:id` → Soft-Delete (deleted_at). `POST /:id/restore`. `DELETE /:id/permanent` (nur aus Papierkorb, löscht Signatur-Dateien).
- `POST /:id/release` → Status 'freigegeben', legt Signatur-Zeilen an.
- `POST /:id/sign/:shareholderId` (raw PNG, leer = entfernen) — **jeder eingeloggte Nutzer darf für jeden unterschreiben**; `signed_by` protokolliert. `GET /:id/sign/:shareholderId` (PNG).
- `GET /:id/pdf` → application/pdf inline.
- `GET /:id/chat`, `POST /:id/chat {message}` → `{reply, wrote, resolution}`.

---

## Feature-Map

| Feature | Status | Dateien |
|---|---|---|
| Google-Login + Zugangs-Whitelist | fertig (OAuth-Client muss provisioniert sein) | index.js, auth.js, Login.jsx |
| Gesellschaften CRUD + Rechtsform | fertig | companies.js, Companies.jsx |
| Gesellschafter CRUD (Gesellschaft/Person) | fertig | shareholders.js, Shareholders.jsx |
| Standard-Unterschriften (zeichnen/upload/drag&drop) | fertig | shareholders.js, Shareholders.jsx, SignatureModal.jsx |
| 3-spaltiger Chat-Editor | fertig | Editor.jsx, resolutions.js |
| Rechtsform-korrekter Rahmen (GmbH/UG/AG/GbR) | fertig | beschluss.js |
| KI-Rückfragen (eine Frage/Antwort) + Rechtsprüfung | fertig | resolutions.js (System-Prompt) |
| A4-Vorschau mit Seitenumbruch | fertig (Pagination-Edge-Cases beachten) | Editor.jsx (usePagination) |
| Freigabe + digitales Unterschreiben (+ Vorlage nutzen) | fertig | resolutions.js, Editor.jsx, SignatureModal.jsx |
| PDF-Export (Unterschriften nebeneinander) | fertig | pdf.js |
| Ampel-Statusbadge (0=rot, teil=gelb, voll=grün) | fertig | Resolutions.jsx |
| Listen-Views: Entwürfe / Zu unterschreiben / Abgeschlossen | fertig | Resolutions.jsx, Sidebar.jsx, App.jsx |
| Soft-Delete-Papierkorb (doppelte Abfrage) | fertig | resolutions.js, Trash.jsx, Resolutions.jsx |
| E-Mail-Benachrichtigung bei Freigabe | **offen (geplant)** | — (Muster: TaikoEat nodemailer) |
| Deployment NAS + Cloudflare | **offen** | — |
| Live-Web-Recherche für Rechtsprüfung | **offen (optional)** | — |

**"Zu unterschreiben"-View** ist zweigeteilt: „Von dir zu unterschreiben" (oben) und „Von anderen
Gesellschaftern noch zu unterschreiben"; leere Sektionen/Kästen werden ausgeblendet. Nach eigener
Unterschrift rutscht der Beschluss in die untere Gruppe.

---

## Design System & UI

- Tailwind v4, Tokens in `src/index.css` `@theme`: Brand `#1100ff` (`brand`/`brand-hover`),
  `surface`/`surface-raised (#F3F4F8)`/`border`/`text`/`text-muted`/`text-light`, `shadow-card`/`shadow-elevated`.
- Font **Inter** (Google Fonts). Icons `lucide-react`.
- Aktiv-Nav-Blau ist `#0014FF` (Sidebar), Brand ist `#1100ff` — beide bewusst so aus dem Design-System.
- Reusable Klassen: `.input-base`, `.input-select` (in index.css).
- Modals: `rounded-2xl overflow-hidden shadow-elevated animate-modal-in border border-border` (overflow-hidden nötig, sonst eckige Header-Ecken).
- **Regel: Seiten/Listen immer volle Breite (`w-full`), keine `max-w-*` auf Content-Containern.** Modals behalten `max-w-md/lg`.
- A4-Vorschau: `PAGE = {w:794, h:1123, pad:90}`, Fließtext **14px** `leading-relaxed`.

---

## Testing

- **vitest** (Config in `vite.config.js`), `server/test/setup.js` isoliert `DATA_DIR` in tmp.
- `server/test/api.test.js`: (1) voller Durchstich Gesellschafter→Firma→Beschluss→Freigabe→Unterschrift(beide)→PDF→Liste; (2) Standard-Unterschrift hochladen/ausliefern/entfernen + kein FS-Pfad im JSON.
- Router werden direkt gemountet, Auth per Middleware gestubbt (`req.user`).
- Ausführen: `npx vitest run` (vom Root). Aktuell **2/2 grün**.
- Keine Frontend-Komponententests bisher.

---

## Nutzer-Präferenzen & Arbeitsweise (WICHTIG)

- **Sprache:** Chat auf Deutsch, knapp, keine breiten Summaries. Pragmatisch > perfekt.
- **Code:** funktionale React-Komponenten, ES-Modules, `better-sqlite3` synchron. Muster von TaikoEat/TaskManager spiegeln.
- **Umlaute:** In **Code/Commits** ae/oe/ue/ss vermeiden. In **user-facing UI und generiertem
  Beschlusstext** aber echte Umlaute ä/ö/ü/ß (ausdrücklicher Wunsch — siehe offene Punkte).
- **Keine Emojis** in Commits/Code.
- **Destruktives** (rm, DB drop, reset) nur mit Rückfrage — auch im Auto-Mode. Kein `rm -rf` gegen Verzeichnisse mit Daten (globale Zero-Tolerance-Regel, siehe `~/.claude/CLAUDE.md`).
- **Commits** autonom erlaubt, **Push nur auf Anfrage**. (Projekt ist aktuell KEIN Git-Repo.)
- Der Nutzer testet visuell und gibt iteratives Feedback per Screenshot; er erwartet, dass Änderungen
  im Browser verifiziert werden (Browser-MCP: `preview_start name=taiko-beschluss`, dann Screenshots).
- Er mag Tabellen und knappe Punktlisten.

---

## Konventionen & Agent-Konfiguration

- **Ponytail-Mode** ist aktiv (lazy/minimal, stdlib/native zuerst, kürzeste funktionierende Lösung).
- **Naming:** Komponenten PascalCase (`Editor.jsx`), DB snake_case, Routen kebab/lowercase.
- **Auto-Memory** des Projekts unter `~/.claude/projects/-Users-maikfahldieck-Projects-TaikoBeschluss/memory/`
  (`projekt-taikobeschluss.md`, `ui-full-width.md`).
- Globale User-Rules in `~/.claude/CLAUDE.md` (Datenverlust-Schutz, deutsche Kommunikation, keine Umlaute in Code).

---

## Bekannte Probleme & Fallstricke

1. **`0 && ...`-Falle:** SQLite liefert Boolean-Ausdrücke als 0/1 (Zahl). Im JSX immer `{!!x && ...}`
   nutzen, sonst rendert eine nackte „0". (Zweimal aufgetreten, beide gefixt.)
2. **`.env`-Änderungen** werden vom laufenden Server nicht neu geladen → `touch server/index.js`.
3. **Route-Reihenfolge:** `GET /resolutions/trash` muss VOR `GET /:id` stehen.
4. **A4-Pagination (`usePagination` in Editor.jsx):** misst Blöcke in einem unsichtbaren Container
   (`aria-hidden`, `visibility:hidden`) und packt sie greedy auf Seiten (`CONTENT_H = 1123 - 2*90 = 943`).
   Die unsichtbaren Blöcke sind interaktive Duplikate (`pointer-events-none`) — bei JS-Queries tauchen
   Buttons doppelt auf. Fragil: Mess- und Render-Container MÜSSEN gleiche Breite (614px) + Schriftgröße (14px) haben.
5. **Standard-Unterschrift folgt der Person (E-Mail), nicht der Firma:** `shareholdersOf` liefert
   `template_shareholder_id` (eigener bevorzugt, sonst anderer Gesellschafter mit gleicher signer_email).
6. **Testdaten:** Die Dev-DB enthält diverse Test-Beschlüsse/-Gesellschafter aus dem Bauen. Ggf. leeren
   (nur gezielt, nie `rm -rf server/data`).

---

## Kontext aus bisherigen Sessions (chronologisch, eine lange Session)

1. **Scaffold + Kern:** Projekt aufgesetzt (React/Vite/Tailwind + Express/SQLite), Firmen-/Gesellschafter-
   Verwaltung, 3-spaltiger Chat-Editor, Freigabe/Unterschreiben (SignatureModal aus TaikoEat), PDF.
2. **KI/LLM:** Zuerst LiteLLM-Client gebaut — **verworfen**, weil der Nutzer kein Gateway hat. Umgestellt
   auf direkten Gemini-Key (OpenAI-kompat, aus TaikoEat). Key-Format-Falle: Gemini-Key `AQ.A…`, nicht `sk-…`.
3. **Chat-Verhalten:** Rolle = Fachanwalt (Gesellschafts-/Steuerrecht), duzt, knapp, keine Prosa; eine
   nummerierte Frage nach der anderen; grüne „Beschluss formuliert"-Markierung (`wrote`-Flag, persistiert);
   Löschen/Leeren via explizitem `writeContent`-Flag (behebt den „content=''"-Doppeldeutigkeits-Bug).
4. **UI-Iterationen:** volle Breite überall; Zeilen-Cards wie TaikoTasks; Sidebar-Gruppe „Beschlüsse"
   aufklappbar mit Countern (Entwürfe/Zu unterschreiben/Abgeschlossen/Papierkorb); Soft-Delete-Papierkorb
   mit doppelter Abfrage; Ampel-Statusbadge; „Zu unterschreiben" in „von dir"/„von anderen" geteilt.
5. **Rechtliche Korrektheit:** Rahmen datenabhängig (kein „Handelsregister des unter ," bei fehlenden
   Daten) + **Rechtsform** (`legal_form`) steuert Stammkapital/Register/Geschäftsführung-Formulierung;
   KI-Rechtsprüfung vor Finalisierung (vGA, §181 BGB, Fremdvergleich). Retry gegen transiente 500er.
   `normalizeContent()` erzwingt Leerzeilen zwischen nummerierten Punkten. Fließtext 14px.
6. **Listen-UI-Umbau (Session 2026-07-22):** Gesellschafts-Filter als **Custom-Dropdown**
   (`CompanyFilter` in Resolutions.jsx) in der Kopfzeile neben „Neuer Beschluss" (Look der
   Header-Buttons, `rounded-[6px]`). Rows als **Spaltenraster** (`GRID`-Konstante):
   Titel (`text-sm font-medium`) | Gesellschaft | Erstellt am (`created_at`, nicht Beschlussdatum),
   Status-Badge rechtsbündig in fester 160px-Spalte; Beschluss-Nummer aus der Liste entfernt.
   KEINE Spaltenköpfe (bewusst entfernt). „Von mir zu unterschreiben" wird **immer** angezeigt;
   wenn leer: grüne Kachel in Zeilenhöhe („Aktuell gibt es für dich nichts zu unterschreiben.").
   Abschnitts-Header einheitlich `text-sm font-semibold text-text-muted`. Papierkorb (Trash.jsx)
   nutzt dasselbe Raster + Spalte „Gelöscht am" und eigene `GRID`-Konstante mit Aktions-Spalte.

### Gescheiterte Ansätze
- **LiteLLM-Gateway:** verworfen (Nutzer hat keins). → direkter Gemini-Key.

---

## Aktuelle Prioritäten & Nächste Schritte

### Unmittelbar nächster Schritt: Umfassender Code-Audit (vom Nutzer beauftragt)

Der Nutzer will in der nächsten Session einen **umfassenden Code-Audit**. Dafür den
**`/audit`-Skill** (Code Health Audit) nutzen — er deckt Technische-Schulden-Suche,
Qualitätsmessung und Priorisierung ab. Ergänzend zum Skill-Standard sind dem Nutzer
diese Schwerpunkte ausdrücklich wichtig:

1. **Code-Qualität messen:** LOC gesamt und je Datei, Monolithen-Kandidaten identifizieren
   (Verdacht: `src/pages/Editor.jsx`, `server/routes/resolutions.js`), Komplexität,
   Duplikation, tote Pfade.
2. **Backend vollständig prüfen — Fokus Datenverlust-Risiko (mehrschichtig):**
   - **Es gibt aktuell KEINE Backup-Strategie.** SQLite-DB (`server/data/taikobeschluss.db`)
     und Unterschriften-PNGs (`server/data/signatures/`) liegen ungesichert nebeneinander —
     rechtlich relevante Dokumente (unterschriebene Beschlüsse!).
   - Data-Safety-Checkliste anwenden: `~/.claude/data-safety-checklist.md`, Phasen A–E
     systematisch durchgehen (globale Regel in `~/.claude/CLAUDE.md`, Stichwort
     „bitte prüf die Data-Safety").
   - Außerdem: Input-Validierung an den API-Grenzen, Fehlerbehandlung, FS-Operationen
     (`fs.rmSync` bei Sign/Permanent-Delete), Transaktionssicherheit.
3. **Weiteres Sinnvolles:** Security (Session-Secret, Dev-Login-Absicherung, raw-PNG-Uploads
   ohne Größen-/Format-Validierung, helmet/rate-limit-Konfiguration), Test-Abdeckung
   (nur 2 Smoke-Tests, keine Frontend-Tests), Dependency-Stand.

Ergebnis soll eine **priorisierte Maßnahmenliste** sein; nichts Destruktives ohne User-OK.

### Danach (bestehende Aufgabenliste)
1. A4-Umbruch verifizieren/robuster machen (Nutzer sah unnötigen Umbruch auf Seite 2;
   nach 14px-Umstellung misst der Inhalt 854px < 943px — vermutlich war der Screenshot
   noch der 15px-Stand; im Browser mit Beschluss #9 prüfen, ggf. `usePagination` härten).
2. **E-Mail-Benachrichtigung** bei „Zur Unterschrift freigeben" (nodemailer, Muster in TaikoEat).
3. **Deployment** auf NAS + Cloudflare (wie andere Tools) + Google-OAuth-Redirect für Prod-Domain.
4. Optional: Live-Web-Recherche/Grounding für die Rechtsprüfung (Gemini google_search o.ä.).
5. Optional: „Chat zurücksetzen"-Funktion (alte, teils gesiezte History in Beschluss #1).

### Erledigt
- Umlaute in generierten Ausgaben (System-Prompt erzwingt ä/ö/ü/ß; verifiziert). Optional offen:
  „Paragraph 181 BGB" statt „§ 181 BGB" — bei Bedarf im Prompt erzwingen.
- Listen-UI-Umbau (Custom-Filter-Dropdown, Spaltenlayout, grüne Leer-Kachel, Papierkorb-Raster) —
  siehe Session-Kontext Punkt 6.

---

## Onboarding-Anweisungen für den neuen Chat

> **An den neuen Agent:**
> 1. Lies diese Datei komplett.
> 2. Lies in dieser Reihenfolge:
>    - `/Users/maikfahldieck/Projects/TaikoBeschluss/server/db.js`
>    - `/Users/maikfahldieck/Projects/TaikoBeschluss/server/routes/resolutions.js`
>    - `/Users/maikfahldieck/Projects/TaikoBeschluss/server/services/beschluss.js`
>    - `/Users/maikfahldieck/Projects/TaikoBeschluss/src/pages/Editor.jsx`
>    - `/Users/maikfahldieck/Projects/TaikoBeschluss/src/pages/Resolutions.jsx`
> 3. Starte Dev: `npm run dev` (Client 3009, Server 3010). Dev-Login: `/api/auth/dev`. Tests: `npx vitest run`.
> 4. **Unmittelbar nächster Schritt: umfassender Code-Audit** — siehe Abschnitt
>    „Aktuelle Prioritäten". Nutze dafür den `/audit`-Skill und lege die dort genannten
>    Schwerpunkte (LOC/Monolithen, Backend + Backup-/Datenverlust-Prüfung mit
>    `~/.claude/data-safety-checklist.md`, Security, Tests) zugrunde. Nur analysieren
>    und priorisieren — keine destruktiven Änderungen ohne User-OK.
> 5. Beachte: Deutsch + knapp; volle Breite überall; `{!!zahl && ...}` (0/1-Falle); nach `.env`-Änderung Server neu starten; im Browser verifizieren (Browser-MCP `preview_start name=taiko-beschluss`).
> 6. Antworte mit kurzer Zusammenfassung des Verständnisses und frag bei Unklarheiten nach.
