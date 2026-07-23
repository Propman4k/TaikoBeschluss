// Drive-Ablage abgeschlossener Beschluesse (docs/adr/0001): Service Account,
// Drive REST-API direkt per fetch — google-auth-library liefert nur das Token.
// ENV: DRIVE_ROOT_FOLDER_ID + GOOGLE_APPLICATION_CREDENTIALS (Pfad zum SA-Key)
// oder GOOGLE_SA_KEY (Key-JSON inline).
import { GoogleAuth } from 'google-auth-library'
import { db } from '../db.js'
import { buildResolutionPdf, readSignatures } from './pdf.js'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

let auth
function getToken() {
  auth ??= new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive'],
    ...(process.env.GOOGLE_SA_KEY ? { credentials: JSON.parse(process.env.GOOGLE_SA_KEY) } : {}),
  })
  return auth.getAccessToken()
}

export const driveEnabled = () =>
  Boolean(
    process.env.DRIVE_ROOT_FOLDER_ID &&
      (process.env.GOOGLE_SA_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS),
  )

async function driveFetch(url, init = {}) {
  const token = await getToken()
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(`Drive ${init.method || 'GET'} ${res.status}: ${body.slice(0, 300)}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

// Unterordner je Firma: einmal per Name gesucht/erstellt, danach zaehlt nur
// noch die gemerkte ID (Umbenennungen zerreissen nichts).
async function ensureCompanyFolder(company) {
  if (company.drive_folder_id) return company.drive_folder_id
  const root = process.env.DRIVE_ROOT_FOLDER_ID
  const q = `'${root}' in parents and name = '${company.name.replaceAll("'", "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  const found = await driveFetch(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)`)
  let id = found.files?.[0]?.id
  if (!id) {
    const created = await driveFetch(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: company.name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [root],
      }),
    })
    id = created.id
  }
  db.prepare('UPDATE companies SET drive_folder_id = ? WHERE id = ?').run(id, company.id)
  return id
}

function multipartBody(metadata, pdf, boundary) {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
    ),
    Buffer.from(pdf),
    Buffer.from(`\r\n--${boundary}--`),
  ])
}

// Laedt das fertige Beschluss-PDF nach Drive hoch. Ueberschreibt die bestehende
// Datei (drive_file_id), sonst wird neu angelegt — nie geloescht, nie dupliziert.
export async function uploadResolutionPdf(resolutionId) {
  if (!driveEnabled()) throw new Error('Drive nicht konfiguriert (DRIVE_ROOT_FOLDER_ID / SA-Key fehlt)')
  const r = db.prepare('SELECT * FROM resolutions WHERE id = ?').get(resolutionId)
  if (!r) throw new Error('Beschluss nicht gefunden')
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(r.company_id)
  const shareholders = db
    .prepare(
      `SELECT s.* FROM shareholders s JOIN company_shareholders cs ON cs.shareholder_id = s.id
       WHERE cs.company_id = ? ORDER BY cs.position`,
    )
    .all(r.company_id)
  const sigs = readSignatures(
    db.prepare('SELECT shareholder_id, signature_path FROM resolution_signatures WHERE resolution_id = ?').all(r.id),
  )
  const pdf = await buildResolutionPdf(company, shareholders, r, sigs)

  const name = r.title ? `${r.number} – ${r.title}.pdf` : `${r.number}.pdf`
  const boundary = 'taikobeschluss-pdf'
  const upload = (url, method, metadata) =>
    driveFetch(`${url}?uploadType=multipart&fields=id,webViewLink`, {
      method,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipartBody(metadata, pdf, boundary),
    })

  let file
  if (r.drive_file_id) {
    try {
      file = await upload(`${UPLOAD}/files/${r.drive_file_id}`, 'PATCH', { name })
    } catch (err) {
      // Datei in Drive geloescht/verschoben -> neu anlegen statt dauerhaft brechen
      if (err.status !== 404) throw err
    }
  }
  if (!file) {
    const folderId = await ensureCompanyFolder(company)
    file = await upload(`${UPLOAD}/files`, 'POST', { name, parents: [folderId] })
  }
  db.prepare('UPDATE resolutions SET drive_file_id = ?, drive_link = ? WHERE id = ?').run(
    file.id,
    file.webViewLink,
    r.id,
  )
  return file
}
