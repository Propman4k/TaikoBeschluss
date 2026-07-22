// Smoke-Test: kompletter Durchstich Gesellschafter -> Gesellschaft -> Beschluss
// -> Freigabe -> Unterschrift -> PDF. Router direkt gemountet, Auth gestubbt.
import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { db } from '../db.js'
import { shareholdersRouter } from '../routes/shareholders.js'
import { companiesRouter } from '../routes/companies.js'
import { resolutionsRouter } from '../routes/resolutions.js'

db.prepare(`INSERT INTO users (id, email, name) VALUES (1, 'mf@taikonauten.com', 'Maik')`).run()

const app = express()
app.use(express.json())
app.use(express.raw({ type: 'image/png', limit: '5mb' }))
app.use((req, _res, next) => {
  req.user = { id: 1, email: 'mf@taikonauten.com', name: 'Maik' }
  next()
})
app.use('/api/shareholders', shareholdersRouter)
app.use('/api/companies', companiesRouter)
app.use('/api/resolutions', resolutionsRouter)

// 1x1 transparentes PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

describe('TaikoBeschluss API', () => {
  it('voller Durchstich bis zum PDF', async () => {
    const sh = await request(app)
      .post('/api/shareholders')
      .send({ name: 'Fahldieck Beteiligungs GmbH', signer_name: 'Maik Fahldieck', signer_email: 'mf@taikonauten.com' })
    expect(sh.status).toBe(201)

    const sh2 = await request(app)
      .post('/api/shareholders')
      .send({ name: 'Lempa Beteiligungs GmbH', signer_name: 'Jonas Lempa', signer_email: 'jl@taikonauten.com' })
    expect(sh2.status).toBe(201)

    const co = await request(app).post('/api/companies').send({
      name: 'Taikonauten GmbH',
      registry_court: 'Amtsgericht Charlottenburg',
      hrb: 'HRB 265001 B',
      address: 'Prinzenallee 74',
      zip: '13357',
      city: 'Berlin',
      shareholder_ids: [sh.body.id, sh2.body.id],
    })
    expect(co.status).toBe(201)
    expect(co.body.shareholders).toHaveLength(2)

    const res = await request(app).post('/api/resolutions').send({ company_id: co.body.id })
    expect(res.status).toBe(201)
    expect(res.body.number).toMatch(/^\d{4}-01$/)
    expect(res.body.frame.intro).toContain('Amtsgerichts Charlottenburg')
    expect(res.body.frame.shareholderList).toBe('Fahldieck Beteiligungs GmbH, Lempa Beteiligungs GmbH')

    // Freigabe ohne Inhalt -> 400
    const early = await request(app).post(`/api/resolutions/${res.body.id}/release`)
    expect(early.status).toBe(400)

    const patched = await request(app)
      .patch(`/api/resolutions/${res.body.id}`)
      .send({ content: '1. Die Gesellschafter beschliessen die Feststellung des Jahresabschlusses 2025.', title: 'Jahresabschluss 2025', date: '2026-07-01' })
    expect(patched.status).toBe(200)
    expect(patched.body.date).toBe('2026-07-01')

    const released = await request(app).post(`/api/resolutions/${res.body.id}/release`)
    expect(released.status).toBe(200)
    expect(released.body.status).toBe('freigegeben')
    expect(released.body.signatures).toHaveLength(2)

    // Ich darf fuer meinen Gesellschafter unterschreiben ...
    const sign = await request(app)
      .post(`/api/resolutions/${res.body.id}/sign/${sh.body.id}`)
      .set('Content-Type', 'image/png')
      .send(PNG)
    expect(sign.status).toBe(200)
    expect(sign.body.signatures.find((s) => s.shareholder_id === sh.body.id).signed).toBe(true)

    // ... und auch fuer Jonas (jeder darf fuer jeden unterschreiben)
    const forJonas = await request(app)
      .post(`/api/resolutions/${res.body.id}/sign/${sh2.body.id}`)
      .set('Content-Type', 'image/png')
      .send(PNG)
    expect(forJonas.status).toBe(200)
    expect(forJonas.body.signatures.find((s) => s.shareholder_id === sh2.body.id).signed).toBe(true)

    // Nachtraegliche Bearbeitung: Unterschrift bleibt (bewusste Entscheidung)
    const edited = await request(app)
      .patch(`/api/resolutions/${res.body.id}`)
      .send({ content: 'Geaenderter Text.' })
    expect(edited.body.signatures.find((s) => s.shareholder_id === sh.body.id).signed).toBe(true)

    const pdf = await request(app).get(`/api/resolutions/${res.body.id}/pdf`)
    expect(pdf.status).toBe(200)
    expect(pdf.headers['content-type']).toContain('application/pdf')
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF')

    // Uebersicht: beide unterschrieben -> nichts mehr offen fuer mich
    const list = await request(app).get('/api/resolutions')
    expect(list.body.resolutions).toHaveLength(1)
    expect(list.body.toSign).toHaveLength(0)
  })

  it('Nummern-Vergabe: keine Wiederverwendung nach endgueltigem Loeschen', async () => {
    const year = new Date().getFullYear()
    const sh = await request(app)
      .post('/api/shareholders')
      .send({ name: 'Nummern GmbH', signer_name: 'Nina Nummer', signer_email: 'nn@example.com' })
    const co = await request(app)
      .post('/api/companies')
      .send({ name: 'Nummerntest GmbH', shareholder_ids: [sh.body.id] })

    const ids = []
    for (let i = 1; i <= 3; i++) {
      const r = await request(app).post('/api/resolutions').send({ company_id: co.body.id })
      expect(r.body.number).toBe(`${year}-0${i}`)
      ids.push(r.body.id)
    }

    // Beschluss 02 in den Papierkorb und endgueltig loeschen
    await request(app).delete(`/api/resolutions/${ids[1]}`)
    const perm = await request(app).delete(`/api/resolutions/${ids[1]}/permanent`)
    expect(perm.status).toBe(204)

    // Naechster Beschluss bekommt 04 — NICHT die schon vergebene 03
    const next = await request(app).post('/api/resolutions').send({ company_id: co.body.id })
    expect(next.body.number).toBe(`${year}-04`)

    // Ungueltiges "PNG" beim Unterschreiben -> 400
    await request(app)
      .patch(`/api/resolutions/${next.body.id}`)
      .send({ content: 'Testinhalt.' })
    await request(app).post(`/api/resolutions/${next.body.id}/release`)
    const badSign = await request(app)
      .post(`/api/resolutions/${next.body.id}/sign/${sh.body.id}`)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('kein png'))
    expect(badSign.status).toBe(400)
  })

  it('Standard-Unterschrift: kein PNG -> 400', async () => {
    const sh = await request(app)
      .post('/api/shareholders')
      .send({ name: 'Fake GmbH', signer_name: 'Falk Fake', signer_email: 'ff@example.com' })
    const up = await request(app)
      .post(`/api/shareholders/${sh.body.id}/signature`)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('definitiv kein png'))
    expect(up.status).toBe(400)
    expect(up.body.has_default_signature).toBeUndefined()
  })

  it('Standard-Unterschrift: hochladen, ausliefern, entfernen; kein FS-Pfad im JSON', async () => {
    const sh = await request(app)
      .post('/api/shareholders')
      .send({ name: 'Muster GmbH', signer_name: 'Max Muster', signer_email: 'max@example.com' })
    expect(sh.body.has_default_signature).toBe(0) // noch keine

    const up = await request(app)
      .post(`/api/shareholders/${sh.body.id}/signature`)
      .set('Content-Type', 'image/png')
      .send(PNG)
    expect(up.status).toBe(200)
    expect(up.body.has_default_signature).toBe(1)
    expect(up.body.default_signature_path).toBeUndefined() // kein FS-Pfad nach aussen

    const img = await request(app).get(`/api/shareholders/${sh.body.id}/signature`)
    expect(img.status).toBe(200)
    expect(img.headers['content-type']).toContain('image/png')

    const del = await request(app).delete(`/api/shareholders/${sh.body.id}/signature`)
    expect(del.body.has_default_signature).toBe(0)
    const gone = await request(app).get(`/api/shareholders/${sh.body.id}/signature`)
    expect(gone.status).toBe(404)
  })
})
