// Beschluss-PDF: schlichter Fliesstext (kein Logo), Rahmen aus buildFrame,
// variabler Beschlussteil, Unterschriftszeilen mit eingebetteten Signatur-PNGs.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import fs from 'node:fs'
import { buildFrame, normalizeContent, fmtDate } from './beschluss.js'

const A4 = { w: 595.28, h: 841.89 }
const MARGIN = 70 // ~25mm
const BLACK = rgb(0, 0, 0)
const BODY_SIZE = 11
const LEADING = 16

// WinAnsi-sichere Zeichen (Standard-Helvetica kann kein volles Unicode):
// Latin-1 + die gaengigen typografischen Zeichen; Rest (z.B. Emojis) fliegt raus.
const sanitize = (s) =>
  // eslint-disable-next-line no-control-regex -- \x00-\xFF = Latin-1-Bereich ist hier Absicht
  String(s ?? '').replace(/[^\x00-\xFF€‚„“”‘’–—…•§\n]/g, '')

/** Text an Wortgrenzen auf maxWidth umbrechen; respektiert vorhandene \n.
 *  Sanitized immer auf WinAnsi — sonst wirft drawText bei Emojis & Co. */
function wrap(text, font, size, maxWidth) {
  const lines = []
  for (const para of sanitize(text).split('\n')) {
    if (!para.trim()) {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of para.split(/\s+/)) {
      const probe = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(probe, size) <= maxWidth) {
        line = probe
      } else {
        if (line) lines.push(line)
        line = word
      }
    }
    lines.push(line)
  }
  return lines
}

/**
 * @param {object} company companies-Row
 * @param {Array} shareholders shareholders-Rows in Positionsreihenfolge
 * @param {object} resolution resolutions-Row
 * @param {Map<number, Buffer>} signatureBuffers shareholder_id -> PNG-Buffer
 */
export async function buildResolutionPdf(company, shareholders, resolution, signatureBuffers) {
  const doc = await PDFDocument.create()
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const width = A4.w - 2 * MARGIN

  let page = doc.addPage([A4.w, A4.h])
  let y = A4.h - MARGIN

  const newPageIfNeeded = (needed) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([A4.w, A4.h])
      y = A4.h - MARGIN
    }
  }

  const drawParagraph = (text, { font = regular, size = BODY_SIZE, gapAfter = LEADING } = {}) => {
    for (const line of wrap(text, font, size, width)) {
      newPageIfNeeded(LEADING)
      if (line) page.drawText(line, { x: MARGIN, y, size, font, color: BLACK })
      y -= LEADING
    }
    y -= gapAfter
  }

  // Titel (inkl. Firma, ggf. umbrochen)
  const title = `Gesellschafterbeschluss der ${company.name}`
  for (const line of wrap(title, bold, 16, width)) {
    page.drawText(line, {
      x: A4.w / 2 - bold.widthOfTextAtSize(line, 16) / 2,
      y,
      size: 16,
      font: bold,
    })
    y -= 22
  }
  y -= 28

  const frame = buildFrame(company, shareholders, resolution)
  drawParagraph(frame.intro)
  drawParagraph(frame.shareholderList, { font: bold })
  drawParagraph(frame.outro)
  drawParagraph(normalizeContent(resolution.content), { gapAfter: LEADING * 2 })
  drawParagraph(frame.closing, { gapAfter: LEADING * 2 })
  drawParagraph(frame.placeDate, { gapAfter: LEADING * 2 })

  // Unterschriftsbloecke: zwei nebeneinander pro Reihe. Signatur-Bild (falls
  // vorhanden) ueber der Linie, darunter Unterzeichner-Name und Gesellschafter.
  const SIG_H = 55
  const GAP = 40
  const colW = (width - GAP) / 2
  for (let i = 0; i < shareholders.length; i += 2) {
    const pair = shareholders.slice(i, i + 2)
    newPageIfNeeded(SIG_H + 80)
    for (let j = 0; j < pair.length; j++) {
      const s = pair[j]
      const x = MARGIN + j * (colW + GAP)
      const buf = signatureBuffers.get(s.id)
      if (buf) {
        const img = await doc.embedPng(buf)
        const scale = Math.min((colW - 20) / img.width, SIG_H / img.height)
        page.drawImage(img, {
          x,
          y: y - SIG_H + 8,
          width: img.width * scale,
          height: img.height * scale,
        })
      }
      page.drawLine({
        start: { x, y: y - SIG_H },
        end: { x: x + colW, y: y - SIG_H },
        thickness: 0.8,
        color: BLACK,
      })
      page.drawText(sanitize(s.signer_name), { x, y: y - SIG_H - 14, size: 10, font: regular })
      page.drawText(sanitize(`für ${s.name}`), {
        x,
        y: y - SIG_H - 27,
        size: 9,
        font: regular,
        color: rgb(0.35, 0.35, 0.35),
      })
    }
    y -= SIG_H + 80
  }

  return Buffer.from(await doc.save())
}

/**
 * Pruefdossier fuer den (echten) Anwalt: Anfrage-Zusammenfassung, Parteien-
 * Struktur, kompletter Chatverlauf, rechtliche Hinweise, Beschlusspunkte.
 * @param {object} p { company, resolution, summary, orgLines: string[],
 *                     chat: {role, content, created_at}[], hints: string[] }
 */
export async function buildDossierPdf({ company, resolution, summary, orgLines, chat, hints }) {
  const doc = await PDFDocument.create()
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const width = A4.w - 2 * MARGIN

  let page = doc.addPage([A4.w, A4.h])
  let y = A4.h - MARGIN

  const newPageIfNeeded = (needed) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([A4.w, A4.h])
      y = A4.h - MARGIN
    }
  }
  const drawParagraph = (text, { font = regular, size = BODY_SIZE, gapAfter = LEADING, x = MARGIN } = {}) => {
    for (const line of wrap(sanitize(text), font, size, width - (x - MARGIN))) {
      newPageIfNeeded(LEADING)
      if (line) page.drawText(line, { x, y, size, font, color: BLACK })
      y -= LEADING
    }
    y -= gapAfter
  }
  const drawHeading = (text) => {
    newPageIfNeeded(LEADING * 3)
    y -= LEADING / 2
    page.drawText(sanitize(text), { x: MARGIN, y, size: 13, font: bold, color: BLACK })
    y -= 6
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: A4.w - MARGIN, y },
      thickness: 0.6,
      color: rgb(0.75, 0.75, 0.75),
    })
    y -= LEADING
  }
  const drawBullets = (items) => {
    for (const item of items) {
      newPageIfNeeded(LEADING)
      page.drawText('•', { x: MARGIN, y, size: BODY_SIZE, font: regular, color: BLACK })
      drawParagraph(item, { x: MARGIN + 14, gapAfter: 4 })
    }
    y -= LEADING - 4
  }

  // Kopf
  page.drawText('Prüfdossier', { x: MARGIN, y, size: 18, font: bold })
  y -= 24
  drawParagraph(
    `${resolution.title || 'Gesellschafterbeschluss'} — ${company.name} · Beschluss ${resolution.number} · Beschlussdatum ${fmtDate(resolution.date)}`,
    { gapAfter: 4 },
  )
  drawParagraph(
    `Automatisch erstellt von TaikoBeschluss am ${fmtDate(new Date().toISOString().slice(0, 10))} zur anwaltlichen Kontrolle.`,
    { size: 9, gapAfter: LEADING },
  )

  drawHeading('1. Anfrage (Zusammenfassung)')
  drawParagraph(summary || '(keine Zusammenfassung verfügbar)')

  drawHeading('2. Parteien und Beteiligungsverhältnisse')
  drawBullets(orgLines.map((l) => l.replace(/^-\s*/, '')))

  drawHeading('3. Chatverlauf (vollständig)')
  if (!chat.length) drawParagraph('(kein Chatverlauf)')
  for (const m of chat) {
    newPageIfNeeded(LEADING * 2)
    // SQLite speichert UTC ("YYYY-MM-DD HH:MM:SS") -> lokale deutsche Zeit
    const when = m.created_at
      ? ` — ${new Date(m.created_at.replace(' ', 'T') + 'Z').toLocaleString('de-DE', {
          timeZone: 'Europe/Berlin',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })} Uhr`
      : ''
    drawParagraph(`${m.role === 'user' ? 'Mandant' : 'KI'}${when}`, { font: bold, size: 9.5, gapAfter: 2 })
    drawParagraph(m.content, { gapAfter: LEADING })
  }

  drawHeading('4. Rechtliche Hinweise (von der KI gesammelt)')
  if (hints.length) drawBullets(hints)
  else drawParagraph('(keine Hinweise erfasst)')

  drawHeading('5. Beschlusspunkte (Inhalt des Beschlussdokuments)')
  drawParagraph(normalizeContent(resolution.content) || '(noch kein Beschlusstext)')

  return Buffer.from(await doc.save())
}

export function readSignatures(rows) {
  const map = new Map()
  for (const row of rows) {
    if (!row.signature_path) continue
    try {
      map.set(row.shareholder_id, fs.readFileSync(row.signature_path))
    } catch {
      // Datei fehlt -> Zeile bleibt unsigniert im PDF
    }
  }
  return map
}
