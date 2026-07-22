// Beschluss-PDF: schlichter Fliesstext (kein Logo), Rahmen aus buildFrame,
// variabler Beschlussteil, Unterschriftszeilen mit eingebetteten Signatur-PNGs.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import fs from 'node:fs'
import { buildFrame, normalizeContent } from './beschluss.js'

const A4 = { w: 595.28, h: 841.89 }
const MARGIN = 70 // ~25mm
const BLACK = rgb(0, 0, 0)
const BODY_SIZE = 11
const LEADING = 16

/** Text an Wortgrenzen auf maxWidth umbrechen; respektiert vorhandene \n. */
function wrap(text, font, size, maxWidth) {
  const lines = []
  for (const para of String(text ?? '').split('\n')) {
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
      page.drawText(s.signer_name, { x, y: y - SIG_H - 14, size: 10, font: regular })
      page.drawText(`für ${s.name}`, {
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
