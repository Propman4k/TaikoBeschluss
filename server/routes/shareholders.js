import { Router } from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { db, SIGNATURES_DIR } from '../db.js'
import { isPng } from '../services/png.js'

export const shareholdersRouter = Router()

// Sichere Spalten: nie den FS-Pfad der Standard-Unterschrift ausliefern,
// nur ein Boolean, ob eine hinterlegt ist.
const SAFE_COLS =
  's.id, s.name, s.type, s.signer_name, s.signer_email, s.created_at, (s.default_signature_path IS NOT NULL) AS has_default_signature'

const getSafe = (id) =>
  db.prepare(`SELECT ${SAFE_COLS} FROM shareholders s WHERE s.id = ?`).get(id)

shareholdersRouter.get('/', (_req, res) => {
  res.json(db.prepare(`SELECT ${SAFE_COLS} FROM shareholders s ORDER BY s.position, s.name`).all())
})

// Manuelle Reihenfolge (Drag & Drop, je Kategorie): Body { ids: [shareholderId, ...] }
shareholdersRouter.post('/reorder', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : []
  if (!ids.length) return res.status(400).json({ error: 'ids fehlen' })
  const update = db.prepare('UPDATE shareholders SET position = ? WHERE id = ?')
  db.transaction(() => ids.forEach((id, i) => update.run(i, id)))()
  res.status(204).end()
})

function validate(body) {
  const type = body.type === 'person' ? 'person' : 'company'
  const name = String(body.name ?? '').trim()
  // Bei einer Person ist der Unterzeichner die Person selbst.
  const signerName = type === 'person' ? name : String(body.signer_name ?? '').trim()
  const signerEmail = String(body.signer_email ?? '').trim().toLowerCase()
  if (!name || !signerName || !/^\S+@\S+\.\S+$/.test(signerEmail)) return null
  return { type, name, signerName, signerEmail }
}

shareholdersRouter.post('/', (req, res) => {
  const v = validate(req.body)
  if (!v) return res.status(400).json({ error: 'Name, Unterzeichner und gueltige E-Mail erforderlich' })
  const info = db
    .prepare('INSERT INTO shareholders (name, type, signer_name, signer_email) VALUES (?, ?, ?, ?)')
    .run(v.name, v.type, v.signerName, v.signerEmail)
  res.status(201).json(getSafe(info.lastInsertRowid))
})

shareholdersRouter.put('/:id', (req, res) => {
  const v = validate(req.body)
  if (!v) return res.status(400).json({ error: 'Name, Unterzeichner und gueltige E-Mail erforderlich' })
  const info = db
    .prepare('UPDATE shareholders SET name = ?, type = ?, signer_name = ?, signer_email = ? WHERE id = ?')
    .run(v.name, v.type, v.signerName, v.signerEmail, req.params.id)
  if (!info.changes) return res.status(404).json({ error: 'nicht gefunden' })
  res.json(getSafe(req.params.id))
})

shareholdersRouter.delete('/:id', (req, res) => {
  const used = db
    .prepare('SELECT 1 FROM company_shareholders WHERE shareholder_id = ? LIMIT 1')
    .get(req.params.id)
  if (used) return res.status(409).json({ error: 'Gesellschafter ist noch einer Gesellschaft zugeordnet' })
  const sh = db.prepare('SELECT default_signature_path FROM shareholders WHERE id = ?').get(req.params.id)
  const info = db.prepare('DELETE FROM shareholders WHERE id = ?').run(req.params.id)
  if (!info.changes) return res.status(404).json({ error: 'nicht gefunden' })
  if (sh?.default_signature_path) fs.rmSync(sh.default_signature_path, { force: true })
  res.status(204).end()
})

// ── Standard-Unterschrift (fixe Vorlage) ──
shareholdersRouter.post('/:id/signature', (req, res) => {
  const sh = db.prepare('SELECT id FROM shareholders WHERE id = ?').get(req.params.id)
  if (!sh) return res.status(404).json({ error: 'nicht gefunden' })
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'Kein Bild empfangen' })
  if (!isPng(req.body)) return res.status(400).json({ error: 'Unterschrift muss ein PNG sein' })
  const file = path.join(SIGNATURES_DIR, `shareholder-${req.params.id}.png`)
  fs.writeFileSync(file, req.body)
  db.prepare('UPDATE shareholders SET default_signature_path = ? WHERE id = ?').run(file, req.params.id)
  res.json(getSafe(req.params.id))
})

shareholdersRouter.get('/:id/signature', (req, res) => {
  const sh = db.prepare('SELECT default_signature_path FROM shareholders WHERE id = ?').get(req.params.id)
  if (!sh?.default_signature_path || !fs.existsSync(sh.default_signature_path))
    return res.status(404).json({ error: 'keine Standard-Unterschrift' })
  res.type('png').send(fs.readFileSync(sh.default_signature_path))
})

shareholdersRouter.delete('/:id/signature', (req, res) => {
  const sh = db.prepare('SELECT default_signature_path FROM shareholders WHERE id = ?').get(req.params.id)
  if (sh?.default_signature_path) fs.rmSync(sh.default_signature_path, { force: true })
  db.prepare('UPDATE shareholders SET default_signature_path = NULL WHERE id = ?').run(req.params.id)
  res.json(getSafe(req.params.id))
})
