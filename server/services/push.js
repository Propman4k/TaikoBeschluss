import webpush from 'web-push'
import { db } from '../db.js'

const configured = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
if (configured) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:mf@taikonauten.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  )
}

/** Push an alle Subscriptions eines Users. Abgelaufene Subscriptions werden entfernt. */
async function sendToUser(userId, payload) {
  if (!configured) return
  const subs = db
    .prepare('SELECT id, subscription FROM push_subscriptions WHERE user_id = ?')
    .all(userId)
  const body = JSON.stringify(payload)
  for (const sub of subs) {
    try {
      await webpush.sendNotification(JSON.parse(sub.subscription), body)
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id)
      } else {
        console.warn('push failed:', err.message)
      }
    }
  }
}

/**
 * Push an alle am Beschluss Beteiligten (User hinter den signer_emails der
 * Unterschriftszeilen), ausser dem Ausloeser. Fire-and-forget: Fehler landen
 * im Log, nie beim Request.
 */
export function notifyResolution(resolutionId, { title, body }, exceptUserId = null) {
  const users = db
    .prepare(
      `SELECT DISTINCT u.id FROM resolution_signatures rs
       JOIN shareholders s ON s.id = rs.shareholder_id
       JOIN users u ON lower(u.email) = lower(s.signer_email)
       WHERE rs.resolution_id = ?`,
    )
    .all(resolutionId)
  const payload = { title, body, url: `/beschluss/${resolutionId}` }
  for (const u of users) {
    if (u.id === exceptUserId) continue
    sendToUser(u.id, payload).catch((err) => console.warn('push failed:', err.message))
  }
}
