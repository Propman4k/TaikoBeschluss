// Backup fuer TaikoBeschluss: konsistenter DB-Snapshot (inkl. WAL) + Signaturen
// nach ausserhalb des Projekt-Trees, Retention, Offsite-Mirror (Google Drive).
// Laeuft standalone (LaunchAgent) — braucht keinen laufenden Server.
// Aufruf: npm run backup --prefix server
// Muster aus TaikoTrack (server/scripts/cron-backup.mjs), reduziert.
// ponytail: kein JSON/CSV-Export — DB ist klein und selbst Source of Truth;
// nachruesten falls Format-Resilienz gewuenscht.
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
const BACKUP_ROOT =
  process.env.BACKUP_DIR ||
  path.join(os.homedir(), 'Library', 'Application Support', 'TaikoBeschluss', 'backups')
// Google-Drive-Desktop: beschreibbar ist nur "Meine Ablage"/"My Drive"
function resolveOffsite() {
  if (process.env.OFFSITE_DIR) return path.resolve(process.env.OFFSITE_DIR)
  const mount = path.join(os.homedir(), 'Library', 'CloudStorage', 'GoogleDrive-mf@taikonauten.com')
  for (const sub of ['Meine Ablage', 'My Drive']) {
    if (fs.existsSync(path.join(mount, sub))) return path.join(mount, sub, 'TaikoBeschluss-Backups')
  }
  return null
}
const OFFSITE_DIR = resolveOffsite()
const KEEP = Number(process.env.BACKUP_KEEP || 14)

const log = (level, msg) => process.stdout.write(`${new Date().toISOString()} [${level}] ${msg}\n`)

function die(msg) {
  log('ERROR', msg)
  // macOS-Notification, damit Fehler auch ohne offenes Terminal auffallen
  spawnSync('osascript', [
    '-e',
    `display notification ${JSON.stringify(msg)} with title "TaikoBeschluss Backup fehlgeschlagen"`,
  ])
  process.exit(1)
}

fs.mkdirSync(BACKUP_ROOT, { recursive: true })
const README = `# TaikoBeschluss Backups — NICHT LOESCHEN

Snapshots der Live-DB (rechtlich relevante, unterschriebene
Gesellschafterbeschluesse) + Unterschriften-PNGs.

Restore: Server stoppen, dann
  cp <snapshot>/taikobeschluss.db  <projekt>/server/data/taikobeschluss.db
  cp -R <snapshot>/signatures/     <projekt>/server/data/signatures/
(vorher evtl. vorhandene .db-wal/.db-shm im Ziel entfernen — gezielt, nie rm -rf)
`
for (const dir of [BACKUP_ROOT, OFFSITE_DIR]) {
  if (!dir) continue
  try {
    fs.mkdirSync(dir, { recursive: true })
    const marker = path.join(dir, 'README.md')
    if (!fs.existsSync(marker)) fs.writeFileSync(marker, README)
  } catch (err) {
    log('WARN', `Verzeichnis/Marker ${dir}: ${err.code || err.message}`)
  }
}

// ── Snapshot ──
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const dest = path.join(BACKUP_ROOT, stamp)
fs.mkdirSync(dest, { recursive: true })

const dbFile = path.join(dest, 'taikobeschluss.db')
try {
  // readonly + VACUUM INTO liest einen konsistenten Stand inkl. WAL
  const src = new Database(path.join(DATA_DIR, 'taikobeschluss.db'), {
    readonly: true,
    fileMustExist: true,
  })
  src.prepare('VACUUM INTO ?').run(dbFile)
  src.close()
} catch (err) {
  die(`Snapshot fehlgeschlagen: ${err.message}`)
}

try {
  const check = new Database(dbFile, { readonly: true })
  const integrity = check.pragma('integrity_check', { simple: true })
  const nRes = check.prepare('SELECT COUNT(*) n FROM resolutions').get().n
  check.close()
  if (integrity !== 'ok') {
    fs.renameSync(dest, `${dest}-CORRUPT`)
    die(`integrity_check: ${integrity}`)
  }
  log('INFO', `snapshot ok: ${stamp} (${nRes} resolutions)`)
} catch (err) {
  die(`Integrity-Check warf: ${err.message}`)
}

const sigSrc = path.join(DATA_DIR, 'signatures')
if (fs.existsSync(sigSrc)) {
  fs.cpSync(sigSrc, path.join(dest, 'signatures'), { recursive: true })
  log('INFO', `signaturen: ${fs.readdirSync(sigSrc).length} Dateien`)
}

// ── Retention: nur Snapshot-Ordner nach Namensmuster, neueste KEEP bleiben ──
function applyRetention(root) {
  const snapDirs = fs
    .readdirSync(root)
    .filter((f) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(f))
    .sort()
    .reverse()
  for (const old of snapDirs.slice(KEEP)) {
    fs.rmSync(path.join(root, old), { recursive: true, force: true })
    log('INFO', `retention: ${old} entfernt (${path.basename(root)})`)
  }
}
applyRetention(BACKUP_ROOT)

// ── Offsite-Mirror ──
// --inplace --no-whole-file: vermeidet Google-Drive-Sync-Races (Inode-Rename
// mitten im Upload, TaikoTrack-Incident 2026-05-22). KEIN --delete — Retention
// laeuft kontrolliert per applyRetention.
if (OFFSITE_DIR && fs.existsSync(OFFSITE_DIR)) {
  const rsync = spawnSync(
    'rsync',
    ['-a', '--inplace', '--no-whole-file', `${BACKUP_ROOT}/`, `${OFFSITE_DIR}/`],
    { encoding: 'utf-8' },
  )
  if (rsync.status !== 0) die(`Offsite-rsync fehlgeschlagen (exit ${rsync.status}): ${rsync.stderr?.trim()}`)
  applyRetention(OFFSITE_DIR)
  log('INFO', `offsite ok: ${OFFSITE_DIR}`)
} else {
  log('WARN', 'Offsite-Dir nicht erreichbar — nur lokales Backup')
}

log('INFO', 'backup done')
