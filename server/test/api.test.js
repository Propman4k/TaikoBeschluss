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

    // Nicht-WinAnsi-Zeichen (Emoji, Pfeil) duerfen den Export nicht werfen —
    // Standard-Helvetica kann nur Latin-1, der Sanitizer filtert den Rest.
    await request(app)
      .patch(`/api/resolutions/${res.body.id}`)
      .send({ content: '1. Zustimmung 👍 zum Vertrag → sofort. Umlaute bleiben: äöüß.' })
    const pdfEmoji = await request(app).get(`/api/resolutions/${res.body.id}/pdf`)
    expect(pdfEmoji.status).toBe(200)
    expect(pdfEmoji.body.subarray(0, 4).toString()).toBe('%PDF')

    // Uebersicht: beide unterschrieben -> nichts mehr offen fuer mich
    const list = await request(app).get('/api/resolutions')
    expect(list.body.resolutions).toHaveLength(1)
    expect(list.body.toSign).toHaveLength(0)

    // Restore-Szenario: die DB kommt aus Prod und traegt fremde absolute Pfade
    // (/app/data/...). Die Unterschriften muessen trotzdem gefunden werden.
    db.prepare(
      `UPDATE resolution_signatures SET signature_path = '/app/data/signatures/' || ?
       WHERE resolution_id = ? AND shareholder_id = ?`,
    ).run(`res${res.body.id}-sh${sh.body.id}.png`, res.body.id, sh.body.id)
    const restoredPng = await request(app).get(`/api/resolutions/${res.body.id}/sign/${sh.body.id}`)
    expect(restoredPng.status).toBe(200)
    expect(restoredPng.headers['content-type']).toContain('image/png')
    const restoredPdf = await request(app).get(`/api/resolutions/${res.body.id}/pdf`)
    expect(restoredPdf.status).toBe(200)
    // PDF mit eingebettetem Signatur-Bild ist deutlich groesser als ohne
    expect(restoredPdf.body.length).toBeGreaterThan(2000)
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

  it('Papierkorb: keine Bearbeitung/Freigabe/PDF fuer geloeschte Beschluesse', async () => {
    const sh = await request(app)
      .post('/api/shareholders')
      .send({ name: 'Trash GmbH', signer_name: 'Toni Trash', signer_email: 'tt@example.com' })
    const co = await request(app)
      .post('/api/companies')
      .send({ name: 'Trashtest GmbH', shareholder_ids: [sh.body.id] })
    const r = await request(app).post('/api/resolutions').send({ company_id: co.body.id })
    await request(app).patch(`/api/resolutions/${r.body.id}`).send({ content: 'Inhalt.' })

    await request(app).delete(`/api/resolutions/${r.body.id}`)
    const trash = await request(app).get('/api/resolutions/trash')
    expect(trash.body.map((t) => t.id)).toContain(r.body.id)
    expect((await request(app).patch(`/api/resolutions/${r.body.id}`).send({ title: 'x' })).status).toBe(404)
    expect((await request(app).post(`/api/resolutions/${r.body.id}/release`)).status).toBe(404)
    expect((await request(app).get(`/api/resolutions/${r.body.id}/pdf`)).status).toBe(404)

    // Nach Wiederherstellen geht alles wieder
    await request(app).post(`/api/resolutions/${r.body.id}/restore`)
    expect((await request(app).post(`/api/resolutions/${r.body.id}/release`)).status).toBe(200)
  })

  it('Gesellschafter/Gesellschaften: PUT, DELETE und Konflikt-Guards', async () => {
    const sh = await request(app)
      .post('/api/shareholders')
      .send({ name: 'Crud GmbH', signer_name: 'Carl Crud', signer_email: 'crud@example.com' })
    const co = await request(app)
      .post('/api/companies')
      .send({ name: 'Crudtest GmbH', legal_form: 'ug', shareholder_ids: [sh.body.id] })

    // PUT Gesellschafter (Person: signer_name folgt name), ungueltig -> 400, unbekannt -> 404
    const upd = await request(app)
      .put(`/api/shareholders/${sh.body.id}`)
      .send({ name: 'Carla Crud', type: 'person', signer_email: 'crud@example.com' })
    expect(upd.status).toBe(200)
    expect(upd.body.signer_name).toBe('Carla Crud')
    expect((await request(app).put(`/api/shareholders/${sh.body.id}`).send({ name: '' })).status).toBe(400)
    expect(
      (await request(app).put('/api/shareholders/99999').send({ name: 'X', signer_name: 'X', signer_email: 'x@x.de' }))
        .status,
    ).toBe(404)

    // Zugeordneter Gesellschafter nicht loeschbar
    expect((await request(app).delete(`/api/shareholders/${sh.body.id}`)).status).toBe(409)

    // PUT Gesellschaft: Rechtsform + Gesellschafter-Liste austauschbar
    const sh2 = await request(app)
      .post('/api/shareholders')
      .send({ name: 'Neu GmbH', signer_name: 'Nora Neu', signer_email: 'neu@example.com' })
    const updCo = await request(app)
      .put(`/api/companies/${co.body.id}`)
      .send({ name: 'Crudtest UG', legal_form: 'kaputt', shareholder_ids: [sh2.body.id] })
    expect(updCo.status).toBe(200)
    expect(updCo.body.legal_form).toBe('gmbh') // unbekannte Rechtsform -> Default
    expect(updCo.body.shareholders.map((s) => s.id)).toEqual([sh2.body.id])
    expect((await request(app).put('/api/companies/99999').send({ name: 'X' })).status).toBe(404)

    // Gesellschaft mit Beschluss nicht loeschbar; ohne -> 204
    await request(app).post('/api/resolutions').send({ company_id: co.body.id })
    expect((await request(app).delete(`/api/companies/${co.body.id}`)).status).toBe(409)
    const co2 = await request(app).post('/api/companies').send({ name: 'Leer GmbH', shareholder_ids: [] })
    expect((await request(app).delete(`/api/companies/${co2.body.id}`)).status).toBe(204)

    // Nicht mehr zugeordneter Gesellschafter loeschbar
    expect((await request(app).delete(`/api/shareholders/${sh.body.id}`)).status).toBe(204)
  })

  it('Gesellschaften: manuelle Reihenfolge per Reorder', async () => {
    const a = await request(app).post('/api/companies').send({ name: 'Zeta GmbH', shareholder_ids: [] })
    const b = await request(app).post('/api/companies').send({ name: 'Alpha GmbH', shareholder_ids: [] })
    expect((await request(app).post('/api/companies/reorder').send({ ids: [a.body.id, b.body.id] })).status).toBe(204)
    const list = (await request(app).get('/api/companies')).body.map((c) => c.id)
    expect(list.indexOf(a.body.id)).toBeLessThan(list.indexOf(b.body.id))

    expect((await request(app).post('/api/companies/reorder').send({ ids: [] })).status).toBe(400)
  })

  it('Anteile (shares) je Gesellschafter werden gespeichert und ausgeliefert', async () => {
    const sh1 = await request(app)
      .post('/api/shareholders')
      .send({ name: 'Anteil A GmbH', signer_name: 'A', signer_email: 'aa@example.com' })
    const sh2 = await request(app)
      .post('/api/shareholders')
      .send({ name: 'Anteil B GmbH', signer_name: 'B', signer_email: 'bb@example.com' })
    const co = await request(app)
      .post('/api/companies')
      .send({
        name: 'Anteilstest GmbH',
        shareholders: [
          { id: sh1.body.id, shares: 60 },
          { id: sh2.body.id, shares: '40' },
        ],
      })
    expect(co.status).toBe(201)
    expect(co.body.shareholders.map((s) => s.shares)).toEqual([60, 40])

    // Leere/ungueltige Angabe -> NULL; alte shareholder_ids-Form bleibt nutzbar
    const upd = await request(app)
      .put(`/api/companies/${co.body.id}`)
      .send({ name: 'Anteilstest GmbH', shareholders: [{ id: sh1.body.id, shares: '' }] })
    expect(upd.body.shareholders[0].shares).toBe(null)
    const legacy = await request(app)
      .put(`/api/companies/${co.body.id}`)
      .send({ name: 'Anteilstest GmbH', shareholder_ids: [sh2.body.id] })
    expect(legacy.body.shareholders.map((s) => s.id)).toEqual([sh2.body.id])
  })

  it('Gesellschafter: manuelle Reihenfolge per Reorder', async () => {
    const a = await request(app)
      .post('/api/shareholders')
      .send({ name: 'Zeta Holding', signer_name: 'Z', signer_email: 'z@example.com' })
    const b = await request(app)
      .post('/api/shareholders')
      .send({ name: 'Alpha Holding', signer_name: 'A', signer_email: 'a@example.com' })
    expect((await request(app).post('/api/shareholders/reorder').send({ ids: [a.body.id, b.body.id] })).status).toBe(204)
    const list = (await request(app).get('/api/shareholders')).body.map((s) => s.id)
    expect(list.indexOf(a.body.id)).toBeLessThan(list.indexOf(b.body.id))
  })

  it('Drive-Ablage: 409 solange nicht vollstaendig unterschrieben, 502 ohne Drive-Konfig', async () => {
    const sh = await request(app)
      .post('/api/shareholders')
      .send({ name: 'Drive GmbH', signer_name: 'Dora Drive', signer_email: 'dd@example.com' })
    const co = await request(app)
      .post('/api/companies')
      .send({ name: 'Drivetest GmbH', shareholder_ids: [sh.body.id] })
    const r = await request(app).post('/api/resolutions').send({ company_id: co.body.id })
    await request(app).patch(`/api/resolutions/${r.body.id}`).send({ content: 'Inhalt.' })

    // Entwurf und freigegeben-aber-offen -> 409
    expect((await request(app).post(`/api/resolutions/${r.body.id}/drive`)).status).toBe(409)
    await request(app).post(`/api/resolutions/${r.body.id}/release`)
    expect((await request(app).post(`/api/resolutions/${r.body.id}/drive`)).status).toBe(409)

    // Vollstaendig unterschrieben, aber Drive-ENV fehlt im Test -> 502
    await request(app)
      .post(`/api/resolutions/${r.body.id}/sign/${sh.body.id}`)
      .set('Content-Type', 'image/png')
      .send(PNG)
    expect((await request(app).post(`/api/resolutions/${r.body.id}/drive`)).status).toBe(502)
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
