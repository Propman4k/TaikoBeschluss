# TaikoBeschluss

Tool zum Erstellen, Freigeben und Unterschreiben von Gesellschafterbeschluessen.
Stack identisch zu TaikoEat/TaikoTasks: React 19 + Vite + Tailwind v4 (Client,
Port 3009) und Express 5 + better-sqlite3 (Server, Port 3010).

## Starten

```
npm run dev        # Server (3010) + Client (3009)
npm test           # Vitest (server/test/api.test.js = Smoke-Durchstich)
```

Dev-Login ohne Google OAuth: `DEV_LOGIN=1` in `server/.env`, dann
`/api/auth/dev?email=...` aufrufen. Nur aktiv wenn nicht Production.

## Architektur-Entscheidungen

- **Rahmen vs. Inhalt**: Der formale Beschluss-Rahmen (Einleitung, Gesellschafter-
  liste, Schlussformel, Ort/Datum, Unterschriftsbloecke) wird in
  `server/services/beschluss.js` (`buildFrame`) generiert — eine Quelle fuer
  Frontend-Vorschau und PDF. Chat/KI und Direkt-Bearbeitung aendern NUR
  `resolutions.content` (den variablen Teil).
- **Unterschriften bleiben bei Nachbearbeitung erhalten** (bewusste User-
  Entscheidung); `signed_at`/`signed_by` protokollieren, wann wer gezeichnet hat.
- **Login-Zuordnung**: Unterzeichner werden ueber `shareholders.signer_email`
  dem Google-Login zugeordnet. Zugang = ENV-Whitelist `ALLOWED_EMAILS` ODER
  als signer_email hinterlegt (server/auth.js `isAllowed`).
- **Gesellschafter sind zentral** (Tabelle `shareholders`) und werden Firmen
  ueber `company_shareholders` zugeordnet.
- **KI: direkter Gemini-Key** (gleiches Muster wie TaikoEat): `server/services/ai.js`
  ist 1:1 aus TaikoEat uebernommen — OpenAI-kompatibler Endpoint, Key in
  `LLM_API_KEY`, Praeferenz in `LLM_MODELS`, Discovery via GET /models, per
  `LLM_BASE_URL` optional auf ein Gateway umstellbar. Kein Modellname im Code.
  Structured Output: `{reply, content, title}`.
- **KI-Pipeline** (`server/services/ki.js`, empirisch validiert mit 21 Testfaellen):
  Diskussions-Turns = 1 LLM-Call (schnell). Verfassen/Aktualisieren (compose=true) =
  Composer -> Pruefagent -> Reconciliation (~45-85s, jede Stufe mit der
  NORM-BIBLIOTHEK als verbindlichem Anker — verhindert halluzinierte
  Norm-Einwaende und macht die Reconciliation widerspruchsfaehig gegen falsche
  Reviewer-Einwaende). Pruef-/Reconcile-Fehler degradieren still zum Entwurf.
  Deterministischer Rechtschreib-Retry (ae/oe/ue + ss-Hyperkorrektur "daß").
  Beschlussdatum (`r.date`) ist User-Entscheidung und steht als "nicht zu
  hinterfragen" im Kontext. Fortschritt: in-memory `composeStatus`-Map,
  GET `/:id/chat/status`, Client pollt und zeigt Blur+Overlay (Editor.jsx).
- **PDF**: pdf-lib in `server/services/pdf.js`, schlicht ohne Logo,
  Signatur-PNGs aus `server/data/signatures/` eingebettet.
- **Drive-Ablage** (docs/adr/0001): Letzte Unterschrift laedt das PDF asynchron
  nach Google Drive (`server/services/drive.js`, Service Account, REST per
  fetch). Unterordner je Firma (`companies.drive_folder_id`), Datei wird bei
  Aenderung ueberschrieben (`resolutions.drive_file_id`/`drive_link`).
  POST `/api/resolutions/:id/drive` = manueller Retry/Backfill (Button in der
  Abgeschlossen-Liste). ENV: `DRIVE_ROOT_FOLDER_ID` +
  `GOOGLE_APPLICATION_CREDENTIALS` (Pfad zum SA-Key) oder `GOOGLE_SA_KEY`
  (JSON inline).
- **SignatureModal** 1:1 aus TaikoEat uebernommen.
- **Beschluss-Typen** (`resolution_types`, kuratierte Liste, Seed in db.js): KI
  waehlt beim Verfassen NUR aus der aktiven Liste ("Sonstiges" = Fallback,
  neue Typen schlaegt sie nur vor — anlegen darf allein der Nutzer auf der
  Einstellungen-Seite). Badge + Typ-Filter in den Listen, Dropdown im Editor,
  POST /api/resolution-types/backfill = einmalige KI-Klassifikation des
  Bestands (Button in den Einstellungen). Titel-Regel: spezifisch mit
  Gegenpartei/Betrag/Jahr, keine "Gesellschafterbeschluss der X"-Floskeln.

## Offen / spaeter

- E-Mail-Benachrichtigung bei Freigabe (nodemailer, Muster in TaikoEat)
- Google-OAuth-Client + LiteLLM-Key provisionieren (server/.env.example)
- Deployment NAS + Cloudflare wie andere Tools
