// drive.js gegen gestubbtes fetch (Muster ai.test.js): Ordner-Suche/-Anlage,
// Upload neu vs. Ueberschreiben, 404-Fallback, fehlende Konfiguration.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '../db.js'

vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    getAccessToken() {
      return 'test-token'
    }
  },
}))

async function loadDrive(env = { DRIVE_ROOT_FOLDER_ID: 'root1', GOOGLE_SA_KEY: '{}' }) {
  vi.resetModules()
  delete process.env.DRIVE_ROOT_FOLDER_ID
  delete process.env.GOOGLE_SA_KEY
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS
  Object.assign(process.env, env)
  return import('../services/drive.js')
}

const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Firma + Beschluss direkt in der Test-DB anlegen
function seed() {
  const sh = db
    .prepare(`INSERT INTO shareholders (name, signer_name, signer_email) VALUES ('Drive Test GmbH', 'Dora', 'dora@example.com')`)
    .run()
  const co = db.prepare(`INSERT INTO companies (name) VALUES ('Stub & Söhne GmbH')`).run()
  db.prepare('INSERT INTO company_shareholders (company_id, shareholder_id) VALUES (?, ?)').run(
    co.lastInsertRowid,
    sh.lastInsertRowid,
  )
  const r = db
    .prepare(
      `INSERT INTO resolutions (company_id, number, title, content, date) VALUES (?, '2026-77', 'Stub-Titel', 'Inhalt.', '2026-07-23')`,
    )
    .run(co.lastInsertRowid)
  return { companyId: co.lastInsertRowid, resolutionId: r.lastInsertRowid }
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('driveEnabled / Konfiguration', () => {
  it('ohne ENV -> disabled, Upload wirft verstaendlichen Fehler', async () => {
    const { driveEnabled, uploadResolutionPdf } = await loadDrive({})
    expect(driveEnabled()).toBe(false)
    await expect(uploadResolutionPdf(1)).rejects.toThrow('Drive nicht konfiguriert')
  })

  it('unbekannter Beschluss -> Fehler', async () => {
    const { uploadResolutionPdf } = await loadDrive()
    await expect(uploadResolutionPdf(999999)).rejects.toThrow('nicht gefunden')
  })
})

describe('uploadResolutionPdf', () => {
  it('neuer Upload: Ordner wird erstellt und gemerkt, Datei angelegt, Link gespeichert', async () => {
    const { uploadResolutionPdf } = await loadDrive()
    const { companyId, resolutionId } = seed()
    const calls = []
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      calls.push({ url: String(url), method: opts.method ?? 'GET', body: opts.body })
      const u = String(url)
      if (u.includes('/drive/v3/files?q=')) return jsonRes({ files: [] }) // Suche: nichts da
      if (u.includes('/drive/v3/files?fields=id')) return jsonRes({ id: 'folder-neu' })
      if (u.includes('/upload/drive/v3/files?')) return jsonRes({ id: 'file-neu', webViewLink: 'https://drive/link-neu' })
      throw new Error(`unerwartete URL: ${u}`)
    })

    const file = await uploadResolutionPdf(resolutionId)
    expect(file).toEqual({ id: 'file-neu', webViewLink: 'https://drive/link-neu' })

    // Suche escaped Apostrophe? Hier: Name mit Umlaut+& kommt encoded in q vor
    const search = calls.find((c) => c.url.includes('/drive/v3/files?q='))
    expect(search.url).toContain('supportsAllDrives=true')
    expect(search.url).toContain(encodeURIComponent("name = 'Stub & Söhne GmbH'"))

    // Upload: multipart mit Dateiname "<nummer> – <titel>.pdf" und Shared-Drive-Flag
    const up = calls.find((c) => c.url.includes('/upload/drive/v3/files?'))
    expect(up.method).toBe('POST')
    expect(up.url).toContain('supportsAllDrives=true')
    expect(up.body.toString()).toContain('2026-77 – Stub-Titel.pdf')
    expect(up.body.toString()).toContain('"parents":["folder-neu"]')

    // DB: Ordner an der Firma, Datei+Link am Beschluss
    expect(db.prepare('SELECT drive_folder_id FROM companies WHERE id = ?').get(companyId).drive_folder_id).toBe('folder-neu')
    const r = db.prepare('SELECT drive_file_id, drive_link FROM resolutions WHERE id = ?').get(resolutionId)
    expect(r).toEqual({ drive_file_id: 'file-neu', drive_link: 'https://drive/link-neu' })
  })

  it('vorhandener Ordner wird per Suche gefunden (kein Create), gemerkte ID danach ohne Suche', async () => {
    const { uploadResolutionPdf } = await loadDrive()
    const { resolutionId } = seed()
    let searches = 0
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      const u = String(url)
      if (u.includes('/drive/v3/files?q=')) {
        searches++
        return jsonRes({ files: [{ id: 'folder-alt' }] })
      }
      if (u.includes('/upload/drive/v3/files/')) return jsonRes({ id: 'file-1', webViewLink: 'link' }) // PATCH
      if (u.includes('/upload/drive/v3/files?')) return jsonRes({ id: 'file-1', webViewLink: 'link' })
      throw new Error(`unerwartete URL: ${u}`)
    })

    await uploadResolutionPdf(resolutionId)
    expect(searches).toBe(1)
    // Zweiter Upload: drive_file_id gesetzt -> PATCH, keine neue Suche
    await uploadResolutionPdf(resolutionId)
    expect(searches).toBe(1)
  })

  it('Ueberschreiben: geloeschte Drive-Datei (404) -> Fallback auf Neuanlage', async () => {
    const { uploadResolutionPdf } = await loadDrive()
    const { companyId, resolutionId } = seed()
    db.prepare('UPDATE companies SET drive_folder_id = ? WHERE id = ?').run('folder-x', companyId)
    db.prepare('UPDATE resolutions SET drive_file_id = ? WHERE id = ?').run('file-weg', resolutionId)
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      const u = String(url)
      if (u.includes('/upload/drive/v3/files/file-weg')) return new Response('not found', { status: 404 })
      if (u.includes('/upload/drive/v3/files?')) return jsonRes({ id: 'file-ersatz', webViewLink: 'link-ersatz' })
      throw new Error(`unerwartete URL: ${u}`)
    })

    await uploadResolutionPdf(resolutionId)
    const r = db.prepare('SELECT drive_file_id, drive_link FROM resolutions WHERE id = ?').get(resolutionId)
    expect(r).toEqual({ drive_file_id: 'file-ersatz', drive_link: 'link-ersatz' })
  })

  it('harter Drive-Fehler (403) wird mit Status durchgereicht', async () => {
    const { uploadResolutionPdf } = await loadDrive()
    const { resolutionId } = seed()
    vi.stubGlobal('fetch', async () => new Response('{"error":{"message":"quota"}}', { status: 403 }))
    await expect(uploadResolutionPdf(resolutionId)).rejects.toThrow('Drive GET 403')
  })
})
