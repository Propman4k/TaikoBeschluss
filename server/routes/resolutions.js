import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import path from 'node:path'
import fs from 'node:fs'
import { db, SIGNATURES_DIR } from '../db.js'
import { buildFrame, normalizeContent } from '../services/beschluss.js'
import { buildResolutionPdf, buildDossierPdf, readSignatures } from '../services/pdf.js'
import { runBeschlussChat, summarizeRequest } from '../services/ki.js'
import { isPng } from '../services/png.js'
import { notifyResolution } from '../services/push.js'
import { uploadResolutionPdf } from '../services/drive.js'

export const resolutionsRouter = Router()

const companyOf = (r) => db.prepare('SELECT * FROM companies WHERE id = ?').get(r.company_id)
// Fuer schreibende Aktionen + PDF: Papierkorb-Beschluesse sind tabu (erst wiederherstellen)
const activeResolution = (id) =>
  db.prepare('SELECT * FROM resolutions WHERE id = ? AND deleted_at IS NULL').get(id)
const shareholdersOf = (companyId) =>
  db
    .prepare(
      // template_shareholder_id = Gesellschafter (eigener bevorzugt, sonst ein
      // anderer mit gleicher signer_email), der eine Standard-Unterschrift hat.
      // So folgt die Vorlage der Person, nicht der Firma.
      `SELECT s.id, s.name, s.signer_name, s.signer_email,
              (s.default_signature_path IS NOT NULL) AS has_default_signature,
              (SELECT s2.id FROM shareholders s2
                 WHERE lower(s2.signer_email) = lower(s.signer_email)
                   AND s2.default_signature_path IS NOT NULL
                 ORDER BY (s2.id = s.id) DESC LIMIT 1) AS template_shareholder_id
       FROM shareholders s
       JOIN company_shareholders cs ON cs.shareholder_id = s.id
       WHERE cs.company_id = ? ORDER BY cs.position`,
    )
    .all(companyId)
const openSignatures = (resolutionId) =>
  db
    .prepare(
      'SELECT COUNT(*) AS n FROM resolution_signatures WHERE resolution_id = ? AND signature_path IS NULL',
    )
    .get(resolutionId).n
// Drive-Ablage asynchron und nie blockierend — Fehlschlag laesst nur den
// Drive-Link weg, der "Nach Drive"-Button in der Liste ist der Retry.
const uploadToDrive = (resolutionId) =>
  uploadResolutionPdf(resolutionId).catch((err) =>
    console.error(`Drive-Upload fuer Beschluss ${resolutionId} fehlgeschlagen:`, err.message),
  )
const signaturesOf = (resolutionId) =>
  db
    .prepare(
      `SELECT rs.*, s.name AS shareholder_name, s.signer_name, s.signer_email
       FROM resolution_signatures rs JOIN shareholders s ON s.id = rs.shareholder_id
       WHERE rs.resolution_id = ?`,
    )
    .all(resolutionId)

// Gesamte Beteiligungsstruktur als Textzeilen — Kontext fuer die KI und
// Parteien-Abschnitt im Pruefdossier (Verflechtungen statt Nachfragen).
function orgLines() {
  const orgRows = db
    .prepare(
      `SELECT c.name AS company, c.managing_directors, s.name, s.type, s.signer_name, cs.shares
       FROM company_shareholders cs
       JOIN companies c ON c.id = cs.company_id
       JOIN shareholders s ON s.id = cs.shareholder_id
       ORDER BY c.position, c.id, cs.position`,
    )
    .all()
  const byCompany = {}
  for (const row of orgRows) (byCompany[row.company] ??= []).push(row)
  return Object.entries(byCompany).map(([name, rows]) => {
    const parts = rows.map((x) => {
      const share = x.shares != null ? ` ${x.shares}%` : ''
      const via = x.type === 'company' ? `, vertreten durch ${x.signer_name}` : ' (natürliche Person)'
      return `${x.name}${share}${via}`
    })
    const gf = rows[0].managing_directors ? ` Geschäftsführung: ${rows[0].managing_directors}.` : ''
    return `- ${name}: ${parts.join('; ')}.${gf}`
  })
}

function fullResolution(r) {
  const company = companyOf(r)
  const shareholders = shareholdersOf(r.company_id)
  const signatures = signaturesOf(r.id).map(({ signature_path, ...rest }) => ({
    ...rest,
    signed: Boolean(signature_path),
  }))
  const content = normalizeContent(r.content)
  let hints = []
  try {
    hints = JSON.parse(r.hints || '[]')
  } catch {
    hints = []
  }
  const type_name = r.type_id
    ? db.prepare('SELECT name FROM resolution_types WHERE id = ?').get(r.type_id)?.name ?? null
    : null
  return { ...r, content, hints, type_name, company, shareholders, signatures, frame: buildFrame(company, shareholders, r) }
}

// ── Uebersicht: alle Beschluesse + was der eingeloggte Nutzer unterschreiben muss ──
resolutionsRouter.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, c.name AS company_name,
         (SELECT name FROM resolution_types rt WHERE rt.id = r.type_id) AS type_name,
         (SELECT COUNT(*) FROM resolution_signatures rs WHERE rs.resolution_id = r.id) AS sig_total,
         (SELECT COUNT(*) FROM resolution_signatures rs
            WHERE rs.resolution_id = r.id AND rs.signature_path IS NOT NULL) AS sig_done
       FROM resolutions r JOIN companies c ON c.id = r.company_id
       WHERE r.deleted_at IS NULL
       ORDER BY r.date DESC, r.id DESC`,
    )
    .all()
  const mine = db
    .prepare(
      `SELECT r.id FROM resolutions r
       JOIN resolution_signatures rs ON rs.resolution_id = r.id
       JOIN shareholders s ON s.id = rs.shareholder_id
       WHERE r.deleted_at IS NULL AND rs.signature_path IS NULL AND lower(s.signer_email) = ?`,
    )
    .all(req.user.email.toLowerCase())
    .map((x) => x.id)
  res.json({ resolutions: rows, toSign: mine })
})

// ── Papierkorb: soft-geloeschte Beschluesse ──
resolutionsRouter.get('/trash', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, c.name AS company_name
       FROM resolutions r JOIN companies c ON c.id = r.company_id
       WHERE r.deleted_at IS NOT NULL
       ORDER BY r.deleted_at DESC`,
    )
    .all()
  res.json(rows)
})

resolutionsRouter.post('/', (req, res) => {
  const companyId = Number(req.body.company_id)
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId)
  if (!company) return res.status(400).json({ error: 'Gesellschaft nicht gefunden' })
  if (!shareholdersOf(companyId).length)
    return res.status(400).json({ error: 'Gesellschaft hat keine Gesellschafter' })

  // Fortlaufende Nummer je Firma und Jahr: "2026-01". MAX statt COUNT, damit
  // nach endgueltigem Loeschen keine bereits vergebene Nummer wiederkehrt.
  const year = new Date().getFullYear()
  const max =
    db
      .prepare(
        `SELECT MAX(CAST(substr(number, 6) AS INTEGER)) AS n FROM resolutions WHERE company_id = ? AND number LIKE ?`,
      )
      .get(companyId, `${year}-%`).n ?? 0
  const number = `${year}-${String(max + 1).padStart(2, '0')}`
  const today = new Date().toISOString().slice(0, 10)

  const info = db
    .prepare('INSERT INTO resolutions (company_id, number, date) VALUES (?, ?, ?)')
    .run(companyId, number, today)
  res.status(201).json(fullResolution(db.prepare('SELECT * FROM resolutions WHERE id = ?').get(info.lastInsertRowid)))
})

resolutionsRouter.get('/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM resolutions WHERE id = ?').get(req.params.id)
  if (!r) return res.status(404).json({ error: 'nicht gefunden' })
  res.json(fullResolution(r))
})

// Titel, Inhalt, Datum aenderbar — auch nach Freigabe/Unterschrift
// (bewusste Entscheidung: bestehende Unterschriften bleiben erhalten).
resolutionsRouter.patch('/:id', (req, res) => {
  const r = activeResolution(req.params.id)
  if (!r) return res.status(404).json({ error: 'nicht gefunden' })
  const title = req.body.title !== undefined ? String(req.body.title) : r.title
  const content = req.body.content !== undefined ? String(req.body.content) : r.content
  let date = r.date
  if (req.body.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.body.date)))
      return res.status(400).json({ error: 'Datum muss YYYY-MM-DD sein' })
    date = String(req.body.date)
  }
  let typeId = r.type_id
  if (req.body.type_id !== undefined) {
    typeId = req.body.type_id === null ? null : Number(req.body.type_id)
    if (typeId !== null && !db.prepare('SELECT id FROM resolution_types WHERE id = ?').get(typeId))
      return res.status(400).json({ error: 'Unbekannter Beschlusstyp' })
  }
  db.prepare(
    `UPDATE resolutions SET title = ?, content = ?, date = ?, type_id = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(title, content, date, typeId, r.id)
  // Nachbearbeitung eines bereits abgelegten, vollstaendig unterschriebenen
  // Beschlusses -> Drive-PDF ueberschreiben (Link bleibt stabil, ADR 0001)
  if (r.drive_file_id && r.status === 'freigegeben' && openSignatures(r.id) === 0) uploadToDrive(r.id)
  res.json(fullResolution(db.prepare('SELECT * FROM resolutions WHERE id = ?').get(r.id)))
})

// Soft-Delete: verschiebt in den Papierkorb (wiederherstellbar). Unterschriften
// und Chat bleiben erhalten.
resolutionsRouter.delete('/:id', (req, res) => {
  const info = db
    .prepare(`UPDATE resolutions SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`)
    .run(req.params.id)
  if (!info.changes) return res.status(404).json({ error: 'nicht gefunden' })
  res.status(204).end()
})

// Wiederherstellen aus dem Papierkorb
resolutionsRouter.post('/:id/restore', (req, res) => {
  const info = db
    .prepare('UPDATE resolutions SET deleted_at = NULL WHERE id = ?')
    .run(req.params.id)
  if (!info.changes) return res.status(404).json({ error: 'nicht gefunden' })
  res.json(fullResolution(db.prepare('SELECT * FROM resolutions WHERE id = ?').get(req.params.id)))
})

// Endgueltig loeschen (nur aus dem Papierkorb) — inkl. Unterschrift-Dateien
resolutionsRouter.delete('/:id/permanent', (req, res) => {
  const rows = db
    .prepare('SELECT signature_path FROM resolution_signatures WHERE resolution_id = ?')
    .all(req.params.id)
  const info = db
    .prepare('DELETE FROM resolutions WHERE id = ? AND deleted_at IS NOT NULL')
    .run(req.params.id)
  if (!info.changes)
    return res.status(409).json({ error: 'Nur Beschluesse aus dem Papierkorb koennen endgueltig geloescht werden' })
  for (const row of rows) {
    if (row.signature_path) fs.rmSync(row.signature_path, { force: true })
  }
  res.status(204).end()
})

// ── Freigabe: legt je Gesellschafter eine offene Unterschriftszeile an ──
resolutionsRouter.post('/:id/release', (req, res) => {
  const r = activeResolution(req.params.id)
  if (!r) return res.status(404).json({ error: 'nicht gefunden' })
  if (!r.content.trim()) return res.status(400).json({ error: 'Beschluss hat noch keinen Inhalt' })
  const insert = db.prepare(
    `INSERT INTO resolution_signatures (resolution_id, shareholder_id) VALUES (?, ?)
     ON CONFLICT(resolution_id, shareholder_id) DO NOTHING`,
  )
  db.transaction(() => {
    for (const s of shareholdersOf(r.company_id)) insert.run(r.id, s.id)
    db.prepare(`UPDATE resolutions SET status = 'freigegeben', updated_at = datetime('now') WHERE id = ?`).run(r.id)
  })()
  notifyResolution(
    r.id,
    { title: 'Neuer Beschluss zu unterschreiben', body: `${companyOf(r).name}: ${r.title || r.number}` },
    req.user.id,
  )
  res.json(fullResolution(db.prepare('SELECT * FROM resolutions WHERE id = ?').get(r.id)))
})

// ── Unterschreiben: PNG-Body. Jeder eingeloggte Nutzer darf fuer jeden
// Gesellschafter unterschreiben; signed_by protokolliert, wer es war. ──
resolutionsRouter.post('/:id/sign/:shareholderId', (req, res) => {
  if (!activeResolution(req.params.id)) return res.status(404).json({ error: 'nicht gefunden' })
  const row = db
    .prepare('SELECT id, signature_path FROM resolution_signatures WHERE resolution_id = ? AND shareholder_id = ?')
    .get(req.params.id, req.params.shareholderId)
  if (!row) return res.status(404).json({ error: 'Beschluss nicht freigegeben oder Zeile fehlt' })

  // Leerer Body = Unterschrift entfernen
  if (!req.body || !req.body.length) {
    if (row.signature_path) fs.rmSync(row.signature_path, { force: true })
    db.prepare(
      'UPDATE resolution_signatures SET signature_path = NULL, signed_at = NULL, signed_by = NULL WHERE id = ?',
    ).run(row.id)
  } else {
    if (!isPng(req.body)) return res.status(400).json({ error: 'Unterschrift muss ein PNG sein' })
    const file = path.join(SIGNATURES_DIR, `res${req.params.id}-sh${req.params.shareholderId}.png`)
    fs.writeFileSync(file, req.body)
    db.prepare(
      `UPDATE resolution_signatures SET signature_path = ?, signed_at = datetime('now'), signed_by = ? WHERE id = ?`,
    ).run(file, req.user.id, row.id)

    const r0 = db.prepare('SELECT * FROM resolutions WHERE id = ?').get(req.params.id)
    const shName = db
      .prepare('SELECT name FROM shareholders WHERE id = ?')
      .get(req.params.shareholderId)?.name
    const open = openSignatures(r0.id)
    // Letzte Unterschrift -> nur die "vollstaendig"-Meldung (nicht beide)
    notifyResolution(
      r0.id,
      open === 0
        ? { title: 'Beschluss vollständig unterschrieben', body: `${companyOf(r0).name}: ${r0.title || r0.number}` }
        : { title: `${shName} hat unterschrieben`, body: `${companyOf(r0).name}: ${r0.title || r0.number}` },
      req.user.id,
    )
    // Abgeschlossen (letzte Unterschrift) -> PDF in die Drive-Ablage
    if (open === 0) uploadToDrive(r0.id)
  }
  const r = db.prepare('SELECT * FROM resolutions WHERE id = ?').get(req.params.id)
  res.json(fullResolution(r))
})

// Bestehende Unterschrift als Bild (fuer das Modal beim Ueberschreiben)
resolutionsRouter.get('/:id/sign/:shareholderId', (req, res) => {
  const row = db
    .prepare(
      'SELECT signature_path FROM resolution_signatures WHERE resolution_id = ? AND shareholder_id = ?',
    )
    .get(req.params.id, req.params.shareholderId)
  if (!row?.signature_path || !fs.existsSync(row.signature_path))
    return res.status(404).json({ error: 'keine Unterschrift' })
  res.type('png').send(fs.readFileSync(row.signature_path))
})

// ── PDF ──
resolutionsRouter.get('/:id/pdf', async (req, res) => {
  const r = activeResolution(req.params.id)
  if (!r) return res.status(404).json({ error: 'nicht gefunden' })
  const company = companyOf(r)
  const shareholders = shareholdersOf(r.company_id)
  const sigs = readSignatures(
    db.prepare('SELECT shareholder_id, signature_path FROM resolution_signatures WHERE resolution_id = ?').all(r.id),
  )
  const pdf = await buildResolutionPdf(company, shareholders, r, sigs)
  const slug = company.name.replace(/[^\w]+/g, '-')
  res
    .type('application/pdf')
    .set('Content-Disposition', `inline; filename="Gesellschafterbeschluss-${slug}-${r.number}.pdf"`)
    .send(pdf)
})

// ── Pruefdossier: strukturiertes PDF fuer die anwaltliche Kontrolle ──
// Anfrage-Zusammenfassung (KI, mit deterministischem Fallback), Parteien-
// Struktur, kompletter Chatverlauf, gesammelte Hinweise, Beschlusspunkte.
resolutionsRouter.get('/:id/dossier', async (req, res) => {
  const r = activeResolution(req.params.id)
  if (!r) return res.status(404).json({ error: 'nicht gefunden' })
  const company = companyOf(r)
  const chat = db
    .prepare('SELECT role, content, created_at FROM chat_messages WHERE resolution_id = ? ORDER BY id')
    .all(r.id)
  let hints = []
  try {
    hints = JSON.parse(r.hints || '[]')
  } catch {
    hints = []
  }

  let summary = ''
  if (chat.length) {
    const transcript = chat.map((m) => `${m.role === 'user' ? 'Mandant' : 'Anwalt'}: ${m.content}`).join('\n')
    try {
      summary = await summarizeRequest(transcript)
    } catch (err) {
      console.warn(`Dossier-Zusammenfassung fuer Beschluss ${r.id} fehlgeschlagen:`, err.message)
      // Fallback: erste Mandanten-Nachricht statt gar keiner Zusammenfassung
      summary = chat.find((m) => m.role === 'user')?.content ?? ''
    }
  }

  const pdf = await buildDossierPdf({ company, resolution: r, summary, orgLines: orgLines(), chat, hints })
  const slug = company.name.replace(/[^\w]+/g, '-')
  res
    .type('application/pdf')
    .set('Content-Disposition', `attachment; filename="Pruefdossier-${slug}-${r.number}.pdf"`)
    .send(pdf)
})

// ── Drive-Ablage manuell anstossen: Retry nach Fehlschlag + Backfill fuer
// Alt-Beschluesse. Nur fuer abgeschlossene (vollstaendig unterschriebene). ──
resolutionsRouter.post('/:id/drive', async (req, res) => {
  const r = activeResolution(req.params.id)
  if (!r) return res.status(404).json({ error: 'nicht gefunden' })
  const total = db
    .prepare('SELECT COUNT(*) AS n FROM resolution_signatures WHERE resolution_id = ?')
    .get(r.id).n
  if (r.status !== 'freigegeben' || total === 0 || openSignatures(r.id) > 0)
    return res.status(409).json({ error: 'Beschluss ist noch nicht vollständig unterschrieben' })
  try {
    await uploadResolutionPdf(r.id)
    res.json(fullResolution(db.prepare('SELECT * FROM resolutions WHERE id = ?').get(r.id)))
  } catch (err) {
    console.error(`Drive-Upload fuer Beschluss ${r.id} fehlgeschlagen:`, err.message)
    res.status(502).json({ error: 'Drive-Upload fehlgeschlagen. Bitte erneut versuchen.' })
  }
})

// ── Chat: KI formuliert den variablen Beschlussteil mit (Pipeline in services/ki.js) ──

// Fortschritt der Verfassen-Pipeline je Beschluss (in-memory, Single-Prozess).
// Client pollt GET /:id/chat/status waehrend compose laeuft.
const composeStatus = new Map()

resolutionsRouter.get('/:id/chat/status', (req, res) => {
  res.json(composeStatus.get(String(req.params.id)) ?? { stage: null })
})

resolutionsRouter.get('/:id/chat', (req, res) => {
  res.json(
    db
      .prepare('SELECT id, role, content, wrote, created_at FROM chat_messages WHERE resolution_id = ? ORDER BY id')
      .all(req.params.id),
  )
})

// Kostendeckel: jeder Chat-Turn ist ein LLM-Call
const chatLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60 })

resolutionsRouter.post('/:id/chat', chatLimiter, async (req, res) => {
  const r = activeResolution(req.params.id)
  if (!r) return res.status(404).json({ error: 'nicht gefunden' })
  // Drei Modi: Diskussion (kein Entwurf, kein compose — schreibt NIE),
  // Verfassen (compose=true — synthetisiert aus dem ganzen Gespraech),
  // Nachbearbeitung (Entwurf existiert — Aenderungswuensche wirken direkt).
  const composing = req.body.compose === true
  let text = String(req.body.message ?? '').trim()
  if (!text && composing)
    text = r.content
      ? 'Bitte aktualisiere den Beschluss auf Basis unseres Gesprächs.'
      : 'Bitte verfasse jetzt den Beschluss auf Basis unseres Gesprächs.'
  if (!text) return res.status(400).json({ error: 'Nachricht fehlt' })

  const company = companyOf(r)
  const shareholders = shareholdersOf(r.company_id)
  const history = db
    .prepare('SELECT role, content FROM chat_messages WHERE resolution_id = ? ORDER BY id')
    .all(r.id)

  try {
    db.prepare(`INSERT INTO chat_messages (resolution_id, role, content) VALUES (?, 'user', ?)`).run(r.id, text)
    const typeRows = db
      .prepare('SELECT id, name FROM resolution_types WHERE active = 1 ORDER BY position, id')
      .all()
    let hintsList = []
    try {
      hintsList = JSON.parse(r.hints || '[]')
    } catch {
      hintsList = []
    }
    const parsed = await runBeschlussChat({
      company,
      shareholders,
      orgLines: orgLines().join('\n'),
      resolution: { ...r, hintsList },
      userName: req.user.name || req.user.email,
      userId: req.user.email,
      history,
      text,
      composing,
      typeNames: typeRows.map((t) => t.name),
      onStage: (stage, extra) => composeStatus.set(String(r.id), { stage, ...extra }),
    })
    db.prepare(
      `INSERT INTO chat_messages (resolution_id, role, content, wrote) VALUES (?, 'assistant', ?, ?)`,
    ).run(r.id, parsed.reply, parsed.writeContent ? 1 : 0)
    // writeContent = explizites Signal, ob das Dokument geaendert werden soll.
    // Leerer content bei writeContent=true = bewusstes Leeren (nicht "unveraendert").
    // Typ nur uebernehmen, wenn die KI einen gueltigen Listen-Namen geliefert hat
    const matched = typeRows.find((t) => t.name === String(parsed.type ?? '').trim())
    if (parsed.writeContent) {
      db.prepare(
        `UPDATE resolutions SET content = ?, title = ?, type_id = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(parsed.content, parsed.title.trim() || r.title, matched?.id ?? r.type_id, r.id)
    } else if (matched && !r.type_id) {
      // Diskussionsmodus: Erst-Zuordnung sobald das Thema erkennbar ist —
      // eine manuelle oder bestehende Zuordnung wird hier NIE ueberschrieben.
      db.prepare(`UPDATE resolutions SET type_id = ?, updated_at = datetime('now') WHERE id = ?`).run(matched.id, r.id)
    }
    // Kuratierte Hinweis-Liste (voller Ersatz je Turn, wie der Beschlusstext).
    // null = Modell hat kein Array geliefert -> bestehende Liste unangetastet.
    if (Array.isArray(parsed.hints)) {
      db.prepare(`UPDATE resolutions SET hints = ? WHERE id = ?`).run(JSON.stringify(parsed.hints), r.id)
    }
    res.json({
      reply: parsed.reply,
      wrote: Boolean(parsed.writeContent), // true = Beschluss wurde geschrieben/geaendert
      resolution: fullResolution(db.prepare('SELECT * FROM resolutions WHERE id = ?').get(r.id)),
    })
  } catch (err) {
    console.error('chat failed:', err.message)
    res.status(502).json({ error: 'KI-Anfrage fehlgeschlagen. Bitte erneut versuchen.' })
  } finally {
    composeStatus.delete(String(r.id))
  }
})
