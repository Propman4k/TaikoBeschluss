// Zugangs-Gatekeeper: ENV-Whitelist ODER signer_email, Case-Insensitivitaet.
import { describe, it, expect, vi } from 'vitest'

process.env.ALLOWED_EMAILS = 'MF@taikonauten.com, extra@taikonauten.com'
const { isAllowed, requireAuth } = await import('../auth.js')
const { db } = await import('../db.js')

describe('isAllowed', () => {
  it('ENV-Whitelist, case-insensitiv', () => {
    expect(isAllowed('mf@taikonauten.com')).toBe(true)
    expect(isAllowed('MF@TAIKONAUTEN.COM')).toBe(true)
    expect(isAllowed('extra@taikonauten.com')).toBe(true)
  })

  it('signer_email eines Gesellschafters gibt Zugang, case-insensitiv', () => {
    db.prepare(
      `INSERT INTO shareholders (name, signer_name, signer_email) VALUES ('X GmbH', 'Jonas', 'JL@taikonauten.com')`,
    ).run()
    expect(isAllowed('jl@taikonauten.com')).toBe(true)
  })

  it('unbekannte E-Mail und Leeres -> kein Zugang', () => {
    expect(isAllowed('fremd@example.com')).toBe(false)
    expect(isAllowed('')).toBe(false)
    expect(isAllowed(null)).toBe(false)
  })
})

describe('requireAuth', () => {
  const res = () => {
    const r = { statusCode: null, body: null }
    r.status = (c) => ((r.statusCode = c), r)
    r.json = (b) => ((r.body = b), r)
    return r
  }

  it('ohne Session -> 401, next nicht gerufen', () => {
    const r = res()
    const next = vi.fn()
    requireAuth({ session: {} }, r, next)
    expect(r.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('Session mit geloeschtem/unbekanntem User -> 401', () => {
    const r = res()
    requireAuth({ session: { userId: 99999 } }, r, vi.fn())
    expect(r.statusCode).toBe(401)
  })

  it('gueltige Session eines Berechtigten setzt req.user und ruft next', () => {
    db.prepare(`INSERT OR IGNORE INTO users (id, email, name) VALUES (7, 'extra@taikonauten.com', 'U')`).run()
    const req = { session: { userId: 7 } }
    const next = vi.fn()
    requireAuth(req, res(), next)
    expect(next).toHaveBeenCalled()
    expect(req.user).toMatchObject({ id: 7, email: 'extra@taikonauten.com' })
  })

  it('Zugang entzogen (kein Whitelist-/signer_email-Treffer mehr) -> 401 trotz Session', () => {
    // User existiert und war mal Unterzeichner — der Gesellschafter wurde entfernt
    db.prepare(`INSERT OR IGNORE INTO users (id, email, name) VALUES (8, 'ex@example.com', 'Ex')`).run()
    const info = db
      .prepare(`INSERT INTO shareholders (name, signer_name, signer_email) VALUES ('Ex GmbH', 'Ex', 'ex@example.com')`)
      .run()
    const req = { session: { userId: 8 } }
    const next = vi.fn()
    requireAuth(req, res(), next)
    expect(next).toHaveBeenCalled() // solange Gesellschafter existiert: Zugang

    db.prepare('DELETE FROM shareholders WHERE id = ?').run(info.lastInsertRowid)
    const r = res()
    const next2 = vi.fn()
    requireAuth({ session: { userId: 8 } }, r, next2)
    expect(r.statusCode).toBe(401)
    expect(next2).not.toHaveBeenCalled()
  })
})
