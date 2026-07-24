// Beschluss-Typen: Pflege (Einstellungen-Seite) + einmaliger KI-Backfill.
// Kein DELETE — Typen mit Verwendung werden deaktiviert, nicht geloescht.
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { db } from '../db.js'
import { classifyResolution, generateTitle } from '../services/ki.js'

export const typesRouter = Router()

// Kostendeckel: Backfill/Retitle machen einen LLM-Call JE Beschluss.
const bulkLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 })
// Doppelklick-/Parallel-Guard: ein Bulk-Lauf zur Zeit (in-memory, Single-Prozess)
let bulkRunning = false
const withBulkGuard = (handler) => async (req, res) => {
  if (bulkRunning) return res.status(409).json({ error: 'Es läuft bereits ein KI-Lauf — bitte warten.' })
  bulkRunning = true
  try {
    await handler(req, res)
  } finally {
    bulkRunning = false
  }
}

const allTypes = () =>
  db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM resolutions r WHERE r.type_id = t.id) AS used
       FROM resolution_types t ORDER BY t.position, t.id`,
    )
    .all()

typesRouter.get('/', (_req, res) => res.json(allTypes()))

typesRouter.post('/', (req, res) => {
  const name = String(req.body.name ?? '').trim()
  if (!name) return res.status(400).json({ error: 'Name fehlt' })
  try {
    const max = db.prepare('SELECT MAX(position) AS p FROM resolution_types').get().p ?? 0
    db.prepare('INSERT INTO resolution_types (name, position) VALUES (?, ?)').run(name, max + 1)
  } catch {
    return res.status(409).json({ error: 'Typ existiert bereits' })
  }
  res.status(201).json(allTypes())
})

typesRouter.patch('/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM resolution_types WHERE id = ?').get(req.params.id)
  if (!t) return res.status(404).json({ error: 'nicht gefunden' })
  const name = req.body.name !== undefined ? String(req.body.name).trim() : t.name
  if (!name) return res.status(400).json({ error: 'Name fehlt' })
  const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : t.active
  try {
    db.prepare('UPDATE resolution_types SET name = ?, active = ? WHERE id = ?').run(name, active, t.id)
  } catch {
    return res.status(409).json({ error: 'Typ existiert bereits' })
  }
  res.json(allTypes())
})

// Titel neu erzeugen — NUR fuer Entwuerfe (freigegebene/abgeschlossene Beschluesse
// werden bewusst nicht automatisch umbenannt; dafuer gibt es das manuelle
// Umbenennen im Editor). Titel ist reine App-Metadatensache (nicht im PDF).
typesRouter.post('/retitle', bulkLimiter, withBulkGuard(async (_req, res) => {
  const todo = db
    .prepare(
      `SELECT id, title, content FROM resolutions
       WHERE status = 'entwurf' AND deleted_at IS NULL AND trim(content) != ''`,
    )
    .all()
  const setTitle = db.prepare(`UPDATE resolutions SET title = ?, updated_at = datetime('now') WHERE id = ?`)
  let done = 0
  let failed = 0
  for (const r of todo) {
    try {
      const title = await generateTitle(r)
      if (title) {
        setTitle.run(title, r.id)
        done++
      } else failed++
    } catch (err) {
      console.warn(`Titel-Neuerzeugung fuer Beschluss ${r.id} fehlgeschlagen:`, err.message)
      failed++
    }
  }
  res.json({ total: todo.length, done, failed })
}))

// Einmaliger Backfill: klassifiziert alle Beschluesse ohne Typ (inkl. Papierkorb)
// anhand von Titel + Text. Idempotent — bereits typisierte werden uebersprungen.
typesRouter.post('/backfill', bulkLimiter, withBulkGuard(async (_req, res) => {
  const types = allTypes().filter((t) => t.active)
  const todo = db
    .prepare(`SELECT id, title, content FROM resolutions WHERE type_id IS NULL AND trim(content) != ''`)
    .all()
  const setType = db.prepare('UPDATE resolutions SET type_id = ? WHERE id = ?')
  let done = 0
  let failed = 0
  for (const r of todo) {
    try {
      const name = await classifyResolution(types.map((t) => t.name), r)
      const t = types.find((x) => x.name === name)
      if (t) {
        setType.run(t.id, r.id)
        done++
      } else failed++
    } catch (err) {
      console.warn(`Typ-Backfill fuer Beschluss ${r.id} fehlgeschlagen:`, err.message)
      failed++
    }
  }
  res.json({ total: todo.length, done, failed })
}))
