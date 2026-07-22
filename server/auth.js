// Auth-Bausteine, testbar ohne Server-Start (Muster aus TaikoEat).
import { db } from './db.js'

const parseEmails = (v) => (v ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
const ALLOWED_EMAILS = parseEmails(process.env.ALLOWED_EMAILS)

// Zugang hat, wer auf der ENV-Whitelist steht ODER als Unterzeichner eines
// Gesellschafters hinterlegt ist (signer_email). So bekommen Mitgesellschafter
// automatisch Zugang, sobald sie im Tool erfasst sind.
export function isAllowed(email) {
  const e = String(email ?? '').toLowerCase()
  if (ALLOWED_EMAILS.includes(e)) return true
  const row = db
    .prepare('SELECT 1 FROM shareholders WHERE lower(signer_email) = ? LIMIT 1')
    .get(e)
  return Boolean(row)
}

export function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'nicht eingeloggt' })
  const user = db
    .prepare('SELECT id, email, name FROM users WHERE id = ?')
    .get(req.session.userId)
  if (!user) return res.status(401).json({ error: 'nicht eingeloggt' })
  req.user = user
  next()
}
