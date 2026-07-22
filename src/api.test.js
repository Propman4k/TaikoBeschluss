// @vitest-environment jsdom
// fetch-Wrapper: Fehler-Mapping, 401-Event, 204, fmtDate.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api, fmtDate } from './api.js'

const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => vi.unstubAllGlobals())

describe('api', () => {
  it('Server-Fehlertext landet in der Error-Message', async () => {
    vi.stubGlobal('fetch', async () => jsonRes({ error: 'Datum muss YYYY-MM-DD sein' }, 400))
    await expect(api.patch('/api/x', { date: 'quark' })).rejects.toThrow('Datum muss YYYY-MM-DD sein')
  })

  it('Fehler ohne JSON-Body -> generische Meldung mit Status', async () => {
    vi.stubGlobal('fetch', async () => new Response('kaputt', { status: 500 }))
    await expect(api.get('/api/x')).rejects.toThrow('Fehler 500')
  })

  it('401 feuert auth-expired-Event', async () => {
    vi.stubGlobal('fetch', async () => jsonRes({}, 401))
    const handler = vi.fn()
    window.addEventListener('auth-expired', handler)
    await expect(api.get('/api/me')).rejects.toThrow('nicht eingeloggt')
    expect(handler).toHaveBeenCalled()
    window.removeEventListener('auth-expired', handler)
  })

  it('204 -> null; Objekt-Body wird JSON, Blob bleibt roh', async () => {
    const seen = []
    vi.stubGlobal('fetch', async (_url, opts) => {
      seen.push(opts)
      return new Response(null, { status: 204 })
    })
    expect(await api.post('/api/a', { x: 1 })).toBe(null)
    expect(seen[0].body).toBe('{"x":1}')
    expect(seen[0].headers['Content-Type']).toBe('application/json')

    const blob = new Blob(['png'], { type: 'image/png' })
    await api.post('/api/b', blob, { 'Content-Type': 'image/png' })
    expect(seen[1].body).toBe(blob) // nicht stringifiziert
  })
})

describe('fmtDate', () => {
  it('ISO -> deutsch, leer -> Gedankenstrich, schneidet Zeitanteil ab', () => {
    expect(fmtDate('2026-07-01')).toBe('01.07.2026')
    expect(fmtDate('2026-07-01T12:30:00Z')).toBe('01.07.2026')
    expect(fmtDate('')).toBe('—')
    expect(fmtDate(null)).toBe('—')
  })
})
