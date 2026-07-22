// Restore-Drill: backup.mjs als Child-Prozess gegen tmp-Verzeichnisse.
// Ein Backup, das nie wiederhergestellt wurde, ist eine Annahme (Checkliste B.7).
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(__dirname, '..', 'scripts', 'backup.mjs')

let dataDir, backupDir, offsiteDir

function runBackup(extraEnv = {}) {
  return execFileSync('node', [SCRIPT], {
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      BACKUP_DIR: backupDir,
      OFFSITE_DIR: offsiteDir,
      ...extraEnv,
    },
    encoding: 'utf-8',
  })
}

beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-drill-data-'))
  backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-drill-backup-'))
  offsiteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-drill-offsite-'))

  // Mini-Live-DB mit bekanntem Inhalt + eine Signatur-Datei
  const db = new Database(path.join(dataDir, 'taikobeschluss.db'))
  db.pragma('journal_mode = WAL')
  db.exec(`CREATE TABLE resolutions (id INTEGER PRIMARY KEY, title TEXT);`)
  db.prepare(`INSERT INTO resolutions (title) VALUES ('Drill 1'), ('Drill 2'), ('Drill 3')`).run()
  db.close()
  fs.mkdirSync(path.join(dataDir, 'signatures'))
  fs.writeFileSync(path.join(dataDir, 'signatures', 'res1-sh1.png'), Buffer.from('fake-png'))
})

describe('backup.mjs Restore-Drill', () => {
  it('Snapshot enthaelt alle Daten und laesst sich als DB oeffnen (Restore)', () => {
    const out = runBackup()
    expect(out).toContain('backup done')
    expect(out).toContain('(3 resolutions)')

    const snaps = fs.readdirSync(backupDir).filter((f) => /^\d{4}-/.test(f))
    expect(snaps).toHaveLength(1)
    const snap = path.join(backupDir, snaps[0])

    // Restore = Snapshot-DB oeffnen und Inhalt vergleichen
    const restored = new Database(path.join(snap, 'taikobeschluss.db'), { readonly: true })
    const rows = restored.prepare('SELECT title FROM resolutions ORDER BY id').all()
    restored.close()
    expect(rows.map((r) => r.title)).toEqual(['Drill 1', 'Drill 2', 'Drill 3'])

    // Signaturen kopiert, READMEs/Safety-Marker gesetzt
    expect(fs.readFileSync(path.join(snap, 'signatures', 'res1-sh1.png'), 'utf-8')).toBe('fake-png')
    expect(fs.existsSync(path.join(backupDir, 'README.md'))).toBe(true)
    expect(fs.existsSync(path.join(offsiteDir, 'README.md'))).toBe(true)
  })

  it('Offsite-Mirror enthaelt den Snapshot', () => {
    const snaps = fs.readdirSync(offsiteDir).filter((f) => /^\d{4}-/.test(f))
    expect(snaps.length).toBeGreaterThanOrEqual(1)
    expect(fs.existsSync(path.join(offsiteDir, snaps[0], 'taikobeschluss.db'))).toBe(true)
  })

  it('Retention behaelt nur die neuesten KEEP Snapshots', () => {
    // Aeltere Fake-Snapshots anlegen (Namensmuster wie echte)
    for (let i = 1; i <= 5; i++) {
      const d = path.join(backupDir, `2020-01-0${i}T00-00-00`)
      fs.mkdirSync(d, { recursive: true })
      fs.writeFileSync(path.join(d, 'taikobeschluss.db'), 'alt')
    }
    runBackup({ BACKUP_KEEP: '3' })
    const snaps = fs.readdirSync(backupDir).filter((f) => /^\d{4}-/.test(f)).sort()
    expect(snaps).toHaveLength(3)
    // Neueste ueberleben: die aeltesten Fakes (01..03) sind weg
    expect(snaps.some((s) => s < '2020-01-04')).toBe(false)
    // Nicht-Snapshot-Dateien bleiben unangetastet
    expect(fs.existsSync(path.join(backupDir, 'README.md'))).toBe(true)
  })

  it('fehlende Live-DB -> Exit != 0 (kein stilles Pseudo-Backup)', () => {
    const emptyData = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-drill-empty-'))
    expect(() => runBackup({ DATA_DIR: emptyData })).toThrow()
  })
})
