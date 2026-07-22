import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')
export const SIGNATURES_DIR = path.join(DATA_DIR, 'signatures')

for (const dir of [DATA_DIR, SIGNATURES_DIR]) {
  fs.mkdirSync(dir, { recursive: true })
}

export const db = new Database(path.join(DATA_DIR, 'taikobeschluss.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Zentrale Gesellschafter (z.B. "Fahldieck Beteiligungs GmbH"), wiederverwendbar
  -- ueber mehrere Gesellschaften. signer_* = natuerliche Person, die fuer diesen
  -- Gesellschafter unterschreibt; Zuordnung zum Login ueber signer_email.
  CREATE TABLE IF NOT EXISTS shareholders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    signer_name TEXT NOT NULL,
    signer_email TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    registry_court TEXT NOT NULL DEFAULT '',   -- z.B. "Amtsgericht Charlottenburg"
    hrb TEXT NOT NULL DEFAULT '',              -- z.B. "HRB 265001 B"
    address TEXT NOT NULL DEFAULT '',          -- Strasse + Hausnummer
    zip TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',             -- auch Ort im Beschluss-Fuss
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS company_shareholders (
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    shareholder_id INTEGER NOT NULL REFERENCES shareholders(id),
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (company_id, shareholder_id)
  );

  CREATE TABLE IF NOT EXISTS resolutions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    number TEXT NOT NULL,                      -- fortlaufend je Firma, z.B. "2026-01"
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',          -- variabler Beschlussteil (der Rahmen wird generiert)
    date TEXT NOT NULL,                        -- YYYY-MM-DD, frei aenderbar
    status TEXT NOT NULL DEFAULT 'entwurf'
      CHECK (status IN ('entwurf', 'freigegeben')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Eine Zeile je Gesellschafter und Beschluss, angelegt bei Freigabe.
  -- signature_path gesetzt = unterschrieben.
  CREATE TABLE IF NOT EXISTS resolution_signatures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resolution_id INTEGER NOT NULL REFERENCES resolutions(id) ON DELETE CASCADE,
    shareholder_id INTEGER NOT NULL REFERENCES shareholders(id),
    signature_path TEXT,
    signed_at TEXT,
    signed_by INTEGER REFERENCES users(id),
    UNIQUE (resolution_id, shareholder_id)
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resolution_id INTEGER NOT NULL REFERENCES resolutions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_resolutions_company ON resolutions(company_id);
  CREATE INDEX IF NOT EXISTS idx_chat_resolution ON chat_messages(resolution_id);
`)

// Mini-Migration fuer Bestands-DBs (Spalten nachziehen, wenn sie fehlen)
for (const ddl of [
  'ALTER TABLE resolutions ADD COLUMN deleted_at TEXT', // Soft-Delete / Papierkorb
  'ALTER TABLE shareholders ADD COLUMN default_signature_path TEXT', // fixe Standard-Unterschrift
]) {
  try {
    db.exec(ddl)
  } catch {
    // Spalte existiert bereits
  }
}

// Typ (Gesellschaft/Person) mit einmaligem Backfill: name == signer_name -> Person
try {
  db.exec("ALTER TABLE shareholders ADD COLUMN type TEXT NOT NULL DEFAULT 'company'")
  db.exec("UPDATE shareholders SET type = 'person' WHERE name = signer_name")
} catch {
  // Spalte existiert bereits
}

// wrote = hat diese Assistent-Nachricht den Beschluss geschrieben/geaendert?
try {
  db.exec('ALTER TABLE chat_messages ADD COLUMN wrote INTEGER NOT NULL DEFAULT 0')
} catch {
  // Spalte existiert bereits
}

// Rechtsform der Gesellschaft (steuert die rechtlich korrekte Beschluss-Formulierung).
// Backfill anhand des Namens beim ersten Anlegen der Spalte.
try {
  db.exec("ALTER TABLE companies ADD COLUMN legal_form TEXT NOT NULL DEFAULT 'gmbh'")
  db.exec("UPDATE companies SET legal_form = 'gbr' WHERE name LIKE '%GbR%'")
  db.exec("UPDATE companies SET legal_form = 'ug' WHERE name LIKE '%UG%' OR name LIKE '%haftungsbeschr%'")
  db.exec("UPDATE companies SET legal_form = 'ag' WHERE name LIKE '% AG' OR name LIKE '%Aktiengesellschaft%'")
} catch {
  // Spalte existiert bereits
}
