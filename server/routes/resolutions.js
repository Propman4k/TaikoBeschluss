import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import path from 'node:path'
import fs from 'node:fs'
import { db, SIGNATURES_DIR } from '../db.js'
import { buildFrame, normalizeContent } from '../services/beschluss.js'
import { buildResolutionPdf, readSignatures } from '../services/pdf.js'
import { chatCompletionWithFallback } from '../services/ai.js'
import { isPng } from '../services/png.js'
import { notifyResolution } from '../services/push.js'

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
const signaturesOf = (resolutionId) =>
  db
    .prepare(
      `SELECT rs.*, s.name AS shareholder_name, s.signer_name, s.signer_email
       FROM resolution_signatures rs JOIN shareholders s ON s.id = rs.shareholder_id
       WHERE rs.resolution_id = ?`,
    )
    .all(resolutionId)

function fullResolution(r) {
  const company = companyOf(r)
  const shareholders = shareholdersOf(r.company_id)
  const signatures = signaturesOf(r.id).map(({ signature_path, ...rest }) => ({
    ...rest,
    signed: Boolean(signature_path),
  }))
  const content = normalizeContent(r.content)
  return { ...r, content, company, shareholders, signatures, frame: buildFrame(company, shareholders, r) }
}

// ── Uebersicht: alle Beschluesse + was der eingeloggte Nutzer unterschreiben muss ──
resolutionsRouter.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, c.name AS company_name,
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
  db.prepare(
    `UPDATE resolutions SET title = ?, content = ?, date = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(title, content, date, r.id)
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
    const open = db
      .prepare(
        'SELECT COUNT(*) AS n FROM resolution_signatures WHERE resolution_id = ? AND signature_path IS NULL',
      )
      .get(r0.id).n
    // Letzte Unterschrift -> nur die "vollstaendig"-Meldung (nicht beide)
    notifyResolution(
      r0.id,
      open === 0
        ? { title: 'Beschluss vollständig unterschrieben', body: `${companyOf(r0).name}: ${r0.title || r0.number}` }
        : { title: `${shName} hat unterschrieben`, body: `${companyOf(r0).name}: ${r0.title || r0.number}` },
      req.user.id,
    )
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

// ── Chat: KI formuliert den variablen Beschlussteil mit ──
const CHAT_SCHEMA = {
  name: 'beschluss_chat',
  schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'Kurze Antwort an den Nutzer im Chat (Deutsch)' },
      writeContent: {
        type: 'boolean',
        description:
          'true = das Beschlussdokument soll gesetzt/geaendert/geleert werden (content wird uebernommen). false = Dokument unveraendert lassen (z.B. wenn du nur eine Rueckfrage stellst oder plauderst).',
      },
      content: {
        type: 'string',
        description:
          'Nur relevant wenn writeContent=true: der VOLLSTAENDIGE neue Beschlusstext (nur variabler Teil). Leerer String = Beschluss komplett leeren.',
      },
      title: {
        type: 'string',
        description: 'Kurzer Titel des Beschlusses (z.B. "Gewinnverwendung 2025"), leer wenn unveraendert',
      },
    },
    required: ['reply', 'writeContent', 'content', 'title'],
    additionalProperties: false,
  },
}

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
  const text = String(req.body.message ?? '').trim()
  if (!text) return res.status(400).json({ error: 'Nachricht fehlt' })

  const company = companyOf(r)
  const shareholders = shareholdersOf(r.company_id)
  const history = db
    .prepare('SELECT role, content FROM chat_messages WHERE resolution_id = ? ORDER BY id')
    .all(r.id)

  // Gesamte Beteiligungsstruktur als Kontext, damit die KI Verflechtungen
  // (z.B. wer hinter einer Beteiligungs-GmbH steht) kennt statt nachzufragen.
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
  const orgLines = Object.entries(byCompany).map(([name, rows]) => {
    const parts = rows.map((x) => {
      const share = x.shares != null ? ` ${x.shares}%` : ''
      const via = x.type === 'company' ? `, vertreten durch ${x.signer_name}` : ' (natuerliche Person)'
      return `${x.name}${share}${via}`
    })
    const gf = rows[0].managing_directors ? ` Geschäftsführung: ${rows[0].managing_directors}.` : ''
    return `- ${name}: ${parts.join('; ')}.${gf}`
  })

  const system = [
    'WICHTIG — Rechtschreibung: Verwende in ALLEN Ausgaben (reply, content, title) echte deutsche Umlaute und ß: ä, ö, ü, Ä, Ö, Ü, ß. Schreibe NIEMALS Ersatzformen wie ae, oe, ue oder ss.',
    'Du bist ein erfahrener deutscher Rechtsanwalt und Fachanwalt für Gesellschaftsrecht und Steuerrecht.',
    'Du unterstützt beim Formulieren von Gesellschafterbeschlüssen einer deutschen Gesellschaft und weist proaktiv auf rechtliche oder steuerliche Fallstricke hin (z.B. Formerfordernisse, notarielle Beurkundung, steuerliche Folgen).',
    'Duze den Nutzer. Antworte im Chat KNAPP und sachlich — KEINE Begrüßung, KEIN Smalltalk, KEINE Füllsätze oder Meta-Kommentare (also nicht "klingt nach einem Plan", nicht "um es rechtssicher zu formulieren"). Komm direkt zur Sache.',
    'Der formale Rahmen (Einleitung, Gesellschafterliste, Schlussformel, Ort/Datum, Unterschriften) wird automatisch erzeugt.',
    'Du formulierst NUR den variablen Beschlussteil (was die Versammlung beschließt), präzise und in üblicher juristischer Sprache.',
    'Stil des Beschlusstexts: kurz und prägnant, keine Schachtelsätze. Gliedere immer in einzelne nummerierte Punkte (1., 2., ...) — ein Punkt pro Regelungsgegenstand, nie ein großer Textblock. Kein Markdown, reiner Text mit Absätzen.',
    'WICHTIG — Rückfragen: Wenn Details fehlen (Beträge, Zinssatz, Laufzeit, Daten, Konditionen, Beteiligte, steuerliche Absicht), stelle ZUERST Rückfragen, BEVOR du schreibst. Stelle GENAU EINE Frage pro Antwort im Format "Frage X: <Frage>". Beim ERSTEN Nachfragen nenne kurz die Anzahl offener Fragen, z.B. "Dazu habe ich noch 3 Fragen. Frage 1: ...". Danach je Antwort nur die nächste ("Frage 2: ..."). Bündle NIEMALS mehrere Fragen in einer Nachricht.',
    'RECHTSPRÜFUNG vor dem finalen Beschluss: Wenn alle Fragen beantwortet sind, prüfe als Fachanwalt kurz die rechtliche Zulässigkeit und Fallstricke (Formvorschriften, notarielle Beurkundungspflicht, Zustimmungs-/Mehrheitserfordernisse, steuerliche Risiken wie verdeckte Gewinnausschüttung, Selbstkontrahierungsverbot §181 BGB, Marktüblichkeit). Formuliere den Beschluss so, dass er rechtlich sauber ist (z.B. Befreiung von §181 BGB aufnehmen, marktübliche Konditionen). Wenn es echte Bedenken oder nötige Zusatzpunkte gibt, weise in "reply" KNAPP darauf hin.',
    'Solange du fragst: writeContent=false. Erst wenn alles geklärt und rechtlich geprüft ist, lieferst du den fertigen Beschluss mit writeContent=true — ohne Ankündigung, einfach den Text (in "reply" ein kurzer Satz wie "Beschluss formuliert." plus ggf. ein knapper rechtlicher Hinweis).',
    'Wenn der Nutzer den Beschluss leeren/verwerfen will ("nimm alles weg", "lösche", "fang neu an"): writeContent=true und content="" (leerer String). NUR so wird das Dokument tatsächlich geleert.',
    `Gesellschaft: ${company.name} (Rechtsform: ${company.legal_form}), ${company.registry_court}, ${company.hrb}, Sitz: ${company.city}. Formuliere den Beschluss rechtlich passend zu dieser Rechtsform.`,
    `Gesellschafter: ${shareholders.map((s) => s.name).join(', ')}.`,
    `Beteiligungsstruktur der gesamten Firmengruppe (nutze dieses Wissen über Beteiligungen, Quoten und Verflechtungen, statt danach zu fragen):\n${orgLines.join('\n')}`,
    `Aktueller Beschlusstext:\n${r.content || '(noch leer)'}`,
    'Bei writeContent=true gibst du in "content" IMMER den vollständigen neuen Beschlusstext zurück (nicht nur die Änderung).',
  ].join('\n')

  try {
    db.prepare(`INSERT INTO chat_messages (resolution_id, role, content) VALUES (?, 'user', ?)`).run(r.id, text)
    const messages = [
      { role: 'system', content: system },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ]
    // Bis zu 3 Versuche: faengt transiente LLM-Fehler (500/503/overload) UND
    // ungueltiges JSON ab, bevor der Nutzer einen Fehler sieht.
    let parsed
    let lastErr
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const raw = await chatCompletionWithFallback({
          messages,
          jsonSchema: CHAT_SCHEMA,
          userId: req.user.email,
          generationName: 'beschluss-chat',
        })
        parsed = JSON.parse(raw)
        break
      } catch (e) {
        lastErr = e
        console.warn(`chat attempt ${attempt}/3 failed:`, e.message)
      }
    }
    if (!parsed) throw lastErr ?? new Error('keine Antwort')
    // Manche Modelle escapen Zeilenumbrueche doppelt ("\\n" als Literal im Text)
    parsed.content = String(parsed.content ?? '').replace(/\\n/g, '\n')
    parsed.reply = String(parsed.reply ?? '')
    parsed.title = String(parsed.title ?? '')
    db.prepare(
      `INSERT INTO chat_messages (resolution_id, role, content, wrote) VALUES (?, 'assistant', ?, ?)`,
    ).run(r.id, parsed.reply, parsed.writeContent ? 1 : 0)
    // writeContent = explizites Signal, ob das Dokument geaendert werden soll.
    // Leerer content bei writeContent=true = bewusstes Leeren (nicht "unveraendert").
    if (parsed.writeContent) {
      db.prepare(
        `UPDATE resolutions SET content = ?, title = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(parsed.content, parsed.title.trim() || r.title, r.id)
    }
    res.json({
      reply: parsed.reply,
      wrote: Boolean(parsed.writeContent), // true = Beschluss wurde geschrieben/geaendert
      resolution: fullResolution(db.prepare('SELECT * FROM resolutions WHERE id = ?').get(r.id)),
    })
  } catch (err) {
    console.error('chat failed:', err.message)
    res.status(502).json({ error: 'KI-Anfrage fehlgeschlagen. Bitte erneut versuchen.' })
  }
})
