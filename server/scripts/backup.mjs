// Notnagel-Backup: konsistenter DB-Snapshot (inkl. WAL) + Signaturen-Kopie
// nach ausserhalb des Projekt-Trees. Aufruf: npm run backup --prefix server
// ponytail: keine Retention/Offsite — kommt mit der TaikoTrack-Portierung.
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
const BACKUP_ROOT =
  process.env.BACKUP_DIR ||
  path.join(os.homedir(), 'Library', 'Application Support', 'TaikoBeschluss', 'backups')

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const dest = path.join(BACKUP_ROOT, stamp)
fs.mkdirSync(dest, { recursive: true })

const readmePath = path.join(BACKUP_ROOT, 'README.md')
if (!fs.existsSync(readmePath)) {
  fs.writeFileSync(
    readmePath,
    `# TaikoBeschluss Backups — NICHT LOESCHEN

Snapshots der Live-DB (rechtlich relevante, unterschriebene
Gesellschafterbeschluesse) + Unterschriften-PNGs.

Restore: Server stoppen, dann
  cp <snapshot>/taikobeschluss.db  <projekt>/server/data/taikobeschluss.db
  cp -R <snapshot>/signatures/     <projekt>/server/data/signatures/
(vorher evtl. vorhandene .db-wal/.db-shm im Ziel entfernen — gezielt, nie rm -rf)
`,
  )
}

// VACUUM INTO liest einen konsistenten Stand inklusive nicht-gecheckpointeter WAL
const src = new Database(path.join(DATA_DIR, 'taikobeschluss.db'), {
  readonly: true,
  fileMustExist: true,
})
const dbFile = path.join(dest, 'taikobeschluss.db')
src.prepare('VACUUM INTO ?').run(dbFile)
src.close()

const check = new Database(dbFile, { readonly: true })
const integrity = check.pragma('integrity_check', { simple: true })
check.close()
if (integrity !== 'ok') {
  fs.renameSync(dest, `${dest}-CORRUPT`)
  throw new Error(`Backup fehlgeschlagen, integrity_check: ${integrity}`)
}

const sigSrc = path.join(DATA_DIR, 'signatures')
let sigCount = 0
if (fs.existsSync(sigSrc)) {
  fs.cpSync(sigSrc, path.join(dest, 'signatures'), { recursive: true })
  sigCount = fs.readdirSync(sigSrc).length
}

const dbKb = Math.round(fs.statSync(dbFile).size / 1024)
console.log(`backup ok: ${dest}`)
console.log(`  db: ${dbKb} kB (integrity ok), signaturen: ${sigCount} Dateien`)
