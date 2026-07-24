// Beschluss-Typen: Pflege (Einstellungen-Seite) + einmaliger KI-Backfill.
// Kein DELETE — Typen mit Verwendung werden deaktiviert, nicht geloescht.
import { Router } from 'express'
import { db } from '../db.js'
import { classifyResolution } from '../services/ki.js'

export const typesRouter = Router()

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

// Einmaliger Backfill: klassifiziert alle Beschluesse ohne Typ (inkl. Papierkorb)
// anhand von Titel + Text. Idempotent — bereits typisierte werden uebersprungen.
typesRouter.post('/backfill', async (_req, res) => {
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
})
