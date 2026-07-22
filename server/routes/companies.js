import { Router } from 'express'
import { db } from '../db.js'

export const companiesRouter = Router()

const withShareholders = (company) => ({
  ...company,
  shareholders: db
    .prepare(
      `SELECT s.id, s.name, s.type, s.signer_name, s.signer_email, cs.shares,
              (s.default_signature_path IS NOT NULL) AS has_default_signature
       FROM shareholders s
       JOIN company_shareholders cs ON cs.shareholder_id = s.id
       WHERE cs.company_id = ? ORDER BY cs.position`,
    )
    .all(company.id),
})

companiesRouter.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM companies ORDER BY position, name').all().map(withShareholders))
})

// Manuelle Reihenfolge (Drag & Drop): Body { ids: [companyId, ...] }
companiesRouter.post('/reorder', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : []
  if (!ids.length) return res.status(400).json({ error: 'ids fehlen' })
  const update = db.prepare('UPDATE companies SET position = ? WHERE id = ?')
  db.transaction(() => ids.forEach((id, i) => update.run(i, id)))()
  res.status(204).end()
})

function validate(body) {
  const name = String(body.name ?? '').trim()
  if (!name) return null
  const LEGAL_FORMS = ['gmbh', 'ug', 'ag', 'gbr', 'other']
  return {
    name,
    legal_form: LEGAL_FORMS.includes(body.legal_form) ? body.legal_form : 'gmbh',
    registry_court: String(body.registry_court ?? '').trim(),
    hrb: String(body.hrb ?? '').trim(),
    address: String(body.address ?? '').trim(),
    zip: String(body.zip ?? '').trim(),
    city: String(body.city ?? '').trim(),
    // Bevorzugt [{id, shares}], Fallback shareholder_ids (Bestandsclients/Tests)
    shareholderEntries: Array.isArray(body.shareholders)
      ? body.shareholders.map((x) => ({
          id: Number(x.id),
          shares: x.shares == null || x.shares === '' || Number.isNaN(Number(x.shares)) ? null : Number(x.shares),
        }))
      : (Array.isArray(body.shareholder_ids) ? body.shareholder_ids : []).map((id) => ({
          id: Number(id),
          shares: null,
        })),
  }
}

const setShareholders = db.transaction((companyId, entries) => {
  db.prepare('DELETE FROM company_shareholders WHERE company_id = ?').run(companyId)
  const insert = db.prepare(
    'INSERT INTO company_shareholders (company_id, shareholder_id, position, shares) VALUES (?, ?, ?, ?)',
  )
  entries.forEach((e, i) => insert.run(companyId, e.id, i, e.shares))
})

companiesRouter.post('/', (req, res) => {
  const v = validate(req.body)
  if (!v) return res.status(400).json({ error: 'Firmenname erforderlich' })
  const info = db
    .prepare(
      'INSERT INTO companies (name, legal_form, registry_court, hrb, address, zip, city) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(v.name, v.legal_form, v.registry_court, v.hrb, v.address, v.zip, v.city)
  setShareholders(info.lastInsertRowid, v.shareholderEntries)
  res
    .status(201)
    .json(withShareholders(db.prepare('SELECT * FROM companies WHERE id = ?').get(info.lastInsertRowid)))
})

companiesRouter.put('/:id', (req, res) => {
  const v = validate(req.body)
  if (!v) return res.status(400).json({ error: 'Firmenname erforderlich' })
  const info = db
    .prepare(
      'UPDATE companies SET name = ?, legal_form = ?, registry_court = ?, hrb = ?, address = ?, zip = ?, city = ? WHERE id = ?',
    )
    .run(v.name, v.legal_form, v.registry_court, v.hrb, v.address, v.zip, v.city, req.params.id)
  if (!info.changes) return res.status(404).json({ error: 'nicht gefunden' })
  setShareholders(Number(req.params.id), v.shareholderEntries)
  res.json(withShareholders(db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id)))
})

companiesRouter.delete('/:id', (req, res) => {
  const used = db.prepare('SELECT 1 FROM resolutions WHERE company_id = ? LIMIT 1').get(req.params.id)
  if (used) return res.status(409).json({ error: 'Gesellschaft hat bereits Beschluesse' })
  const info = db.prepare('DELETE FROM companies WHERE id = ?').run(req.params.id)
  if (!info.changes) return res.status(404).json({ error: 'nicht gefunden' })
  res.status(204).end()
})
