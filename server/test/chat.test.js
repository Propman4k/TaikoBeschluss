// Chat-Endpoint mit gemocktem LLM: writeContent-Semantik, Retry, Fehlerpfad.
// Kritischster Backend-Pfad — ein Bug hier ueberschreibt Beschlusstexte.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../services/ai.js', () => ({
  chatCompletionWithFallback: vi.fn(),
}))
const { chatCompletionWithFallback } = await import('../services/ai.js')
const { db } = await import('../db.js')
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

async function freshResolution() {
  const sh = await request(app)
    .post('/api/shareholders')
    .send({ name: 'Chat GmbH', signer_name: 'Carla Chat', signer_email: 'cc@example.com' })
  const co = await request(app)
    .post('/api/companies')
    .send({ name: 'Chattest GmbH', shareholder_ids: [sh.body.id] })
  const r = await request(app).post('/api/resolutions').send({ company_id: co.body.id })
  return r.body
}

const llmReply = (obj) => JSON.stringify(obj)

beforeEach(() => {
  chatCompletionWithFallback.mockReset()
})

describe('POST /api/resolutions/:id/chat', () => {
  it('compose=true schreibt content und title', async () => {
    const r = await freshResolution()
    chatCompletionWithFallback.mockResolvedValue(
      llmReply({ reply: 'Beschluss formuliert.', writeContent: true, content: '1. Testpunkt.', title: 'Testbeschluss' }),
    )
    const res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ message: 'Formuliere.', compose: true })
    expect(res.status).toBe(200)
    expect(res.body.wrote).toBe(true)
    expect(res.body.resolution.content).toBe('1. Testpunkt.')
    expect(res.body.resolution.title).toBe('Testbeschluss')
    const msgs = db.prepare('SELECT role, wrote FROM chat_messages WHERE resolution_id = ? ORDER BY id').all(r.id)
    expect(msgs).toEqual([
      { role: 'user', wrote: 0 },
      { role: 'assistant', wrote: 1 },
    ])
  })

  it('Diskussionsmodus (kein Entwurf, kein compose): writeContent=true wird ignoriert', async () => {
    const r = await freshResolution()
    chatCompletionWithFallback.mockResolvedValue(
      llmReply({ reply: 'ok', writeContent: true, content: '1. Sollte nicht landen.', title: 'Nein' }),
    )
    const res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ message: 'Darlehen 5000 Euro' })
    expect(res.body.wrote).toBe(false)
    expect(res.body.resolution.content).toBe('')
    expect(res.body.resolution.title).toBe('')
  })

  it('compose=true ohne message nutzt Standard-Verfassen-Nachricht', async () => {
    const r = await freshResolution()
    chatCompletionWithFallback.mockResolvedValue(
      llmReply({ reply: 'Beschluss formuliert.', writeContent: true, content: '1. Punkt.', title: 'T' }),
    )
    const res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ compose: true })
    expect(res.status).toBe(200)
    expect(res.body.wrote).toBe(true)
    const user = db
      .prepare(`SELECT content FROM chat_messages WHERE resolution_id = ? AND role = 'user'`)
      .get(r.id)
    expect(user.content).toContain('verfasse')
  })

  it('auch mit Entwurf: ohne compose wird nie geschrieben', async () => {
    const r = await freshResolution()
    await request(app).patch(`/api/resolutions/${r.id}`).send({ content: '1. Alt.' })
    chatCompletionWithFallback.mockResolvedValue(
      llmReply({ reply: 'Geändert.', writeContent: true, content: '1. Neu.', title: '' }),
    )
    const res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ message: 'aendere Punkt 1' })
    expect(res.body.wrote).toBe(false)
    expect(res.body.resolution.content).toBe('1. Alt.')
  })

  it('mit Entwurf + compose=true: Aktualisierung wirkt', async () => {
    const r = await freshResolution()
    await request(app).patch(`/api/resolutions/${r.id}`).send({ content: '1. Alt.' })
    chatCompletionWithFallback.mockResolvedValue(
      llmReply({ reply: 'Aktualisiert.', writeContent: true, content: '1. Neu.', title: '' }),
    )
    const res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ compose: true })
    expect(res.body.wrote).toBe(true)
    expect(res.body.resolution.content).toBe('1. Neu.')
    const user = db
      .prepare(`SELECT content FROM chat_messages WHERE resolution_id = ? AND role = 'user' ORDER BY id DESC`)
      .get(r.id)
    expect(user.content).toContain('aktualisiere')
  })

  it('writeContent=false laesst das Dokument unveraendert (Rueckfrage)', async () => {
    const r = await freshResolution()
    await request(app).patch(`/api/resolutions/${r.id}`).send({ content: 'Bestand.', title: 'Alt' })
    chatCompletionWithFallback.mockResolvedValue(
      llmReply({ reply: 'Frage 1: Wie hoch?', writeContent: false, content: '', title: '' }),
    )
    const res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ message: 'Gewinn ausschuetten' })
    expect(res.body.wrote).toBe(false)
    expect(res.body.resolution.content).toBe('Bestand.')
    expect(res.body.resolution.title).toBe('Alt')
  })

  it('writeContent=true mit leerem content leert den Beschluss bewusst', async () => {
    const r = await freshResolution()
    await request(app).patch(`/api/resolutions/${r.id}`).send({ content: 'Wegwerfen.' })
    chatCompletionWithFallback.mockResolvedValue(
      llmReply({ reply: 'Geleert.', writeContent: true, content: '', title: '' }),
    )
    const res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ message: 'fang neu an', compose: true })
    expect(res.body.wrote).toBe(true)
    expect(res.body.resolution.content).toBe('')
  })

  it('ungueltiges JSON wird bis zu 3x wiederholt, dann Erfolg', async () => {
    const r = await freshResolution()
    chatCompletionWithFallback
      .mockResolvedValueOnce('kein json')
      .mockResolvedValueOnce(llmReply({ reply: 'ok', writeContent: false, content: '', title: '' }))
    const res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ message: 'hi' })
    expect(res.status).toBe(200)
    expect(chatCompletionWithFallback).toHaveBeenCalledTimes(2)
  })

  // Vormals blieb die Nachricht stehen; sie tauchte dann nach dem Retry doppelt
  // im Verlauf, im Pruefdossier und in der KI-History auf -> Rollback.
  it('LLM dauerhaft kaputt -> 502, User-Nachricht wird zurueckgerollt', async () => {
    const r = await freshResolution()
    chatCompletionWithFallback.mockRejectedValue(new Error('boom'))
    const res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ message: 'hallo' })
    expect(res.status).toBe(502)
    expect(chatCompletionWithFallback).toHaveBeenCalledTimes(3)
    expect(db.prepare('SELECT role FROM chat_messages WHERE resolution_id = ?').all(r.id)).toEqual([])

    // Retry nach dem Fehlschlag: genau ein Paar im Verlauf, kein Duplikat
    chatCompletionWithFallback.mockReset()
    chatCompletionWithFallback.mockResolvedValue(
      JSON.stringify({ reply: 'ok', writeContent: false, content: '', title: '', type: '' }),
    )
    const retry = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ message: 'hallo' })
    expect(retry.status).toBe(200)
    expect(
      db.prepare('SELECT role, content FROM chat_messages WHERE resolution_id = ? ORDER BY id').all(r.id),
    ).toEqual([
      { role: 'user', content: 'hallo' },
      { role: 'assistant', content: 'ok' },
    ])
  })

  it('leere Nachricht -> 400, kein LLM-Call', async () => {
    const r = await freshResolution()
    const res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ message: '   ' })
    expect(res.status).toBe(400)
    expect(chatCompletionWithFallback).not.toHaveBeenCalled()
  })

  // ── Verfassen-Pipeline: Composer -> Pruefagent -> Reconciliation ──
  it('Pipeline: Pruefagent findet Einwaende -> Reconciliation-Text landet im Beschluss', async () => {
    const r = await freshResolution()
    chatCompletionWithFallback
      .mockResolvedValueOnce(llmReply({ reply: 'Entwurf.', writeContent: true, content: '1. Entwurf.', title: 'T' })) // Composer
      .mockResolvedValueOnce(
        llmReply({ issues: [{ severity: 'wichtig', text: 'Fehler X', fix: 'Fix X' }], verdict: 'ueberarbeiten' }),
      ) // Pruefagent
      .mockResolvedValueOnce(
        llmReply({ assessments: [{ issue: 'Fehler X', accepted: true, reasoning: 'ok' }], content: '1. Final.', reply: 'Fertig.', title: 'T2' }),
      ) // Reconciliation
    const res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ compose: true })
    expect(res.status).toBe(200)
    expect(chatCompletionWithFallback).toHaveBeenCalledTimes(3)
    expect(res.body.wrote).toBe(true)
    expect(res.body.reply).toBe('Fertig.')
    expect(res.body.resolution.content).toBe('1. Final.')
    expect(res.body.resolution.title).toBe('T2')
  })

  it('Pipeline: keine Einwaende -> Composer-Entwurf bleibt, keine Reconciliation', async () => {
    const r = await freshResolution()
    chatCompletionWithFallback
      .mockResolvedValueOnce(llmReply({ reply: 'Entwurf.', writeContent: true, content: '1. Sauber.', title: 'T' }))
      .mockResolvedValueOnce(llmReply({ issues: [], verdict: 'freigeben' }))
    const res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ compose: true })
    expect(chatCompletionWithFallback).toHaveBeenCalledTimes(2)
    expect(res.body.resolution.content).toBe('1. Sauber.')
  })

  it('Pipeline: Pruefagent kaputt -> Entwurf wird trotzdem geliefert (kein 502)', async () => {
    const r = await freshResolution()
    chatCompletionWithFallback
      .mockResolvedValueOnce(llmReply({ reply: 'Entwurf.', writeContent: true, content: '1. Entwurf.', title: 'T' }))
      .mockRejectedValue(new Error('verify kaputt'))
    const res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ compose: true })
    expect(res.status).toBe(200)
    expect(res.body.resolution.content).toBe('1. Entwurf.')
  })

  it('Diskussionsmodus laeuft ohne Pruefagent (genau 1 LLM-Call)', async () => {
    const r = await freshResolution()
    chatCompletionWithFallback.mockResolvedValue(llmReply({ reply: 'ok', writeContent: false, content: '', title: '' }))
    await request(app).post(`/api/resolutions/${r.id}/chat`).send({ message: 'Frage zur Ausschuettung' })
    expect(chatCompletionWithFallback).toHaveBeenCalledTimes(1)
  })

  it('Rechtschreib-Retry: ae/oe/ue-Antwort ohne Umlaute wird einmal neu angefordert', async () => {
    const r = await freshResolution()
    chatCompletionWithFallback
      .mockResolvedValueOnce(llmReply({ reply: 'Beschluss fuer die Gesellschaft erstellt.', writeContent: false, content: '', title: '' }))
      .mockResolvedValueOnce(llmReply({ reply: 'Beschluss für die Gesellschaft erstellt.', writeContent: false, content: '', title: '' }))
    const res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ message: 'hi' })
    expect(chatCompletionWithFallback).toHaveBeenCalledTimes(2)
    expect(res.body.reply).toBe('Beschluss für die Gesellschaft erstellt.')
  })

  it('Hinweis-Liste: KI-kuratierte hints werden gespeichert und ersetzt, null laesst sie stehen', async () => {
    const r = await freshResolution()
    chatCompletionWithFallback.mockResolvedValue(
      llmReply({ reply: 'ok', writeContent: false, content: '', title: '', type: '', hints: ['Stimmverbot nach § 47 Abs. 4 GmbHG.'] }),
    )
    let res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ message: 'Darlehen an GF' })
    expect(res.body.resolution.hints).toEqual(['Stimmverbot nach § 47 Abs. 4 GmbHG.'])

    // Naechster Turn kuratiert: ersetzt die Liste komplett
    chatCompletionWithFallback.mockResolvedValue(
      llmReply({ reply: 'ok', writeContent: false, content: '', title: '', type: '', hints: ['Neuer Hinweis.'] }),
    )
    res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ message: 'weiter' })
    expect(res.body.resolution.hints).toEqual(['Neuer Hinweis.'])

    // Kein hints-Feld in der Antwort -> bestehende Liste bleibt unangetastet
    chatCompletionWithFallback.mockResolvedValue(
      llmReply({ reply: 'ok', writeContent: false, content: '', title: '', type: '' }),
    )
    res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ message: 'noch was' })
    expect(res.body.resolution.hints).toEqual(['Neuer Hinweis.'])
  })

  it('Status-Endpoint: ohne laufende Pipeline stage=null', async () => {
    const r = await freshResolution()
    const res = await request(app).get(`/api/resolutions/${r.id}/chat/status`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ stage: null })
  })

  it('Dossier: liefert PDF mit KI-Zusammenfassung, LLM-Ausfall faellt auf erste Nachricht zurueck', async () => {
    const r = await freshResolution()
    await request(app).patch(`/api/resolutions/${r.id}`).send({ content: '1. Testpunkt.' })
    db.prepare(`INSERT INTO chat_messages (resolution_id, role, content) VALUES (?, 'user', 'Darlehen 5000 Euro bitte')`).run(r.id)
    chatCompletionWithFallback.mockResolvedValue(JSON.stringify({ summary: 'Mandant will ein Darlehen.' }))
    let res = await request(app).get(`/api/resolutions/${r.id}/dossier`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-')

    // LLM kaputt -> trotzdem 200 (Fallback-Zusammenfassung)
    chatCompletionWithFallback.mockRejectedValue(new Error('boom'))
    res = await request(app).get(`/api/resolutions/${r.id}/dossier`)
    expect(res.status).toBe(200)
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('doppelt-escapte Umbrueche im content werden normalisiert', async () => {
    const r = await freshResolution()
    chatCompletionWithFallback.mockResolvedValue(
      llmReply({ reply: 'ok', writeContent: true, content: '1. Eins.\\n\\n2. Zwei.', title: '' }),
    )
    const res = await request(app).post(`/api/resolutions/${r.id}/chat`).send({ message: 'schreib', compose: true })
    expect(res.body.resolution.content).toBe('1. Eins.\n\n2. Zwei.')
  })
})
