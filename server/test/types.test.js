// Beschluss-Typen: Seed, CRUD, Typ-Zuweisung (manuell + KI + Backfill).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../services/ai.js', () => ({
  chatCompletionWithFallback: vi.fn(),
}))
const { chatCompletionWithFallback } = await import('../services/ai.js')
const { db } = await import('../db.js')
const { typesRouter } = await import('../routes/types.js')
const { resolutionsRouter } = await import('../routes/resolutions.js')
const { shareholdersRouter } = await import('../routes/shareholders.js')
const { companiesRouter } = await import('../routes/companies.js')

db.prepare(`INSERT OR IGNORE INTO users (id, email, name) VALUES (1, 'mf@taikonauten.com', 'Maik')`).run()

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { id: 1, email: 'mf@taikonauten.com', name: 'Maik' }
  next()
})
app.use('/api/shareholders', shareholdersRouter)
app.use('/api/companies', companiesRouter)
app.use('/api/resolutions', resolutionsRouter)
app.use('/api/resolution-types', typesRouter)

async function freshResolution() {
  const sh = await request(app)
    .post('/api/shareholders')
    .send({ name: 'Typ GmbH', signer_name: 'Tina Typ', signer_email: 'tt@example.com' })
  const co = await request(app)
    .post('/api/companies')
    .send({ name: 'Typtest GmbH', shareholder_ids: [sh.body.id] })
  const r = await request(app).post('/api/resolutions').send({ company_id: co.body.id })
  return r.body
}

beforeEach(() => chatCompletionWithFallback.mockReset())

describe('resolution_types', () => {
  it('Seed: Startliste vorhanden, "Sonstiges" enthalten', async () => {
    const res = await request(app).get('/api/resolution-types')
    expect(res.status).toBe(200)
    expect(res.body.length).toBeGreaterThanOrEqual(16)
    expect(res.body.map((t) => t.name)).toContain('Sonstiges')
    expect(res.body.map((t) => t.name)).toContain('Darlehen')
  })

  it('POST legt Typ an, Duplikat -> 409', async () => {
    const res = await request(app).post('/api/resolution-types').send({ name: 'Testtyp XY' })
    expect(res.status).toBe(201)
    expect(res.body.map((t) => t.name)).toContain('Testtyp XY')
    const dup = await request(app).post('/api/resolution-types').send({ name: 'Testtyp XY' })
    expect(dup.status).toBe(409)
  })

  it('PATCH: umbenennen und deaktivieren', async () => {
    const created = await request(app).post('/api/resolution-types').send({ name: 'Umbenenn-Kandidat' })
    const t = created.body.find((x) => x.name === 'Umbenenn-Kandidat')
    const res = await request(app).patch(`/api/resolution-types/${t.id}`).send({ name: 'Umbenannt', active: false })
    const updated = res.body.find((x) => x.id === t.id)
    expect(updated.name).toBe('Umbenannt')
    expect(updated.active).toBe(0)
  })

  it('PATCH resolutions: type_id setzen und entfernen, unbekannter Typ -> 400', async () => {
    const r = await freshResolution()
    const darlehen = (await request(app).get('/api/resolution-types')).body.find((t) => t.name === 'Darlehen')
    let res = await request(app).patch(`/api/resolutions/${r.id}`).send({ type_id: darlehen.id })
    expect(res.body.type_id).toBe(darlehen.id)
    expect(res.body.type_name).toBe('Darlehen')
    res = await request(app).patch(`/api/resolutions/${r.id}`).send({ type_id: null })
    expect(res.body.type_id).toBeNull()
    res = await request(app).patch(`/api/resolutions/${r.id}`).send({ type_id: 999999 })
    expect(res.status).toBe(400)
  })

  it('Chat compose=true uebernimmt gueltigen KI-Typ (ungueltiger wird ignoriert)', async () => {
    const r = await freshResolution()
    chatCompletionWithFallback
      .mockResolvedValueOnce(
        JSON.stringify({ reply: 'ok', writeContent: true, content: '1. X.', title: 'T', type: 'Darlehen' }),
      )
      .mockResolvedValueOnce(JSON.stringify({ issues: [], verdict: 'freigeben' }))
    let res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ compose: true })
    expect(res.body.resolution.type_name).toBe('Darlehen')

    chatCompletionWithFallback.mockReset()
    chatCompletionWithFallback
      .mockResolvedValueOnce(
        JSON.stringify({ reply: 'ok', writeContent: true, content: '1. Y.', title: 'T', type: 'Erfundener Typ' }),
      )
      .mockResolvedValueOnce(JSON.stringify({ issues: [], verdict: 'freigeben' }))
    res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ compose: true })
    expect(res.body.resolution.type_name).toBe('Darlehen') // bleibt, ungueltiger Name ignoriert
  })

  it('Diskussionsmodus: Erst-Zuordnung des Typs, bestehender Typ wird nie ueberschrieben', async () => {
    const r = await freshResolution()
    chatCompletionWithFallback.mockResolvedValue(
      JSON.stringify({ reply: 'Frage 1: Betrag?', writeContent: false, content: '', title: '', type: 'Darlehen' }),
    )
    let res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ message: 'Darlehen an mich' })
    expect(res.body.wrote).toBe(false)
    expect(res.body.resolution.type_name).toBe('Darlehen')

    // KI meint jetzt etwas anderes -> bestehende Zuordnung bleibt
    chatCompletionWithFallback.mockResolvedValue(
      JSON.stringify({ reply: 'ok', writeContent: false, content: '', title: '', type: 'Entlastung' }),
    )
    res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ message: 'noch eine Frage' })
    expect(res.body.resolution.type_name).toBe('Darlehen')
  })

  it('Retitle erzeugt neue Titel NUR fuer Entwuerfe mit Inhalt', async () => {
    const r = await freshResolution()
    await request(app)
      .patch(`/api/resolutions/${r.id}`)
      .send({ content: '1. Darlehen 5.000 EUR.', title: 'Gesellschafterbeschluss der Typtest GmbH' })
    chatCompletionWithFallback.mockResolvedValue(JSON.stringify({ title: 'Darlehen an Tina Typ (5.000 EUR)' }))
    const res = await request(app).post('/api/resolution-types/retitle')
    expect(res.status).toBe(200)
    expect(res.body.done).toBeGreaterThanOrEqual(1)
    const updated = await request(app).get(`/api/resolutions/${r.id}`)
    expect(updated.body.title).toBe('Darlehen an Tina Typ (5.000 EUR)')
  })

  it('PATCH resolutions: Titel manuell aenderbar', async () => {
    const r = await freshResolution()
    const res = await request(app).patch(`/api/resolutions/${r.id}`).send({ title: 'Mein manueller Titel' })
    expect(res.body.title).toBe('Mein manueller Titel')
  })

  it('Backfill klassifiziert Beschluesse ohne Typ, ueberspringt typisierte und leere', async () => {
    const r = await freshResolution()
    await request(app).patch(`/api/resolutions/${r.id}`).send({ content: '1. Entlastung wird erteilt.' })
    chatCompletionWithFallback.mockResolvedValue(JSON.stringify({ type: 'Entlastung' }))
    const res = await request(app).post('/api/resolution-types/backfill')
    expect(res.status).toBe(200)
    expect(res.body.done).toBeGreaterThanOrEqual(1)
    const updated = await request(app).get(`/api/resolutions/${r.id}`)
    expect(updated.body.type_name).toBe('Entlastung')
    // Zweiter Lauf: nichts mehr zu tun fuer diesen Beschluss (idempotent)
    chatCompletionWithFallback.mockClear()
    const again = await request(app).post('/api/resolution-types/backfill')
    const stillTyped = await request(app).get(`/api/resolutions/${r.id}`)
    expect(stillTyped.body.type_name).toBe('Entlastung')
    expect(again.status).toBe(200)
  })
})
