import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import session from 'express-session'
import sqliteStoreFactory from 'better-sqlite3-session-store'
import rateLimit from 'express-rate-limit'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { OAuth2Client } from 'google-auth-library'
import { db } from './db.js'
import { isAllowed, requireAuth } from './auth.js'
import { companiesRouter } from './routes/companies.js'
import { shareholdersRouter } from './routes/shareholders.js'
import { resolutionsRouter } from './routes/resolutions.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PROD = process.env.NODE_ENV === 'production'
const PORT = Number(process.env.SERVER_PORT || 3010)
const APP_URL = process.env.APP_URL || `http://localhost:${PROD ? PORT : 3009}`

if (PROD && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET muss in Produktion gesetzt sein (server/.env)')
}

// ── Middleware ──
app.set('trust proxy', 1)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:'],
      },
    },
  }),
)
app.use(express.json({ limit: '1mb' }))
app.use(express.raw({ type: ['image/png', 'image/jpeg'], limit: '5mb' })) // Unterschrift-Bilder

const SqliteStore = sqliteStoreFactory(session)
app.use(
  session({
    store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 900000 } }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: PROD,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  }),
)

// ── Google OAuth ──
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `${APP_URL}/api/auth/google/callback`
const oauth = () =>
  new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, REDIRECT_URI)

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 })

app.get('/api/auth/google', authLimiter, (_req, res) => {
  const url = oauth().generateAuthUrl({ scope: ['openid', 'email', 'profile'] })
  res.redirect(url)
})

app.get('/api/auth/google/callback', authLimiter, async (req, res) => {
  try {
    const client = oauth()
    const { tokens } = await client.getToken(String(req.query.code ?? ''))
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    })
    const { email, name } = ticket.getPayload()
    const emailLc = email.toLowerCase()
    if (!isAllowed(emailLc)) return res.status(403).send('Kein Zugang fuer dieses Konto.')

    db.prepare(
      `INSERT INTO users (email, name) VALUES (?, ?)
       ON CONFLICT(email) DO UPDATE SET name = excluded.name`,
    ).run(emailLc, name ?? '')
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(emailLc)
    req.session.userId = user.id
    res.redirect('/')
  } catch (err) {
    console.error('oauth callback failed:', err.message)
    res.status(500).send('Login fehlgeschlagen.')
  }
})

// Dev-Login ohne OAuth — NUR wenn explizit DEV_LOGIN=1 gesetzt und nicht Prod.
if (!PROD && process.env.DEV_LOGIN === '1') {
  app.get('/api/auth/dev', (req, res) => {
    const email = String(req.query.email ?? 'mf@taikonauten.com').toLowerCase()
    if (!isAllowed(email)) return res.status(403).send('Kein Zugang fuer dieses Konto.')
    db.prepare(
      `INSERT INTO users (email, name) VALUES (?, ?) ON CONFLICT(email) DO NOTHING`,
    ).run(email, email.split('@')[0])
    req.session.userId = db.prepare('SELECT id FROM users WHERE email = ?').get(email).id
    res.redirect('/')
  })
}

app.get('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'))
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(req.user)
})

app.get('/api/health', (_req, res) => res.json({ ok: true }))

// ── Web-Push: Subscription-Verwaltung ──
app.get('/api/push/vapid-key', requireAuth, (_req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY ?? null })
})

app.post('/api/push/subscribe', requireAuth, (req, res) => {
  const sub = req.body
  if (!sub?.endpoint) return res.status(400).json({ error: 'subscription fehlt' })
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, subscription) VALUES (?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, subscription = excluded.subscription`,
  ).run(req.user.id, sub.endpoint, JSON.stringify(sub))
  res.json({ ok: true })
})

app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(
    req.body?.endpoint ?? '',
    req.user.id,
  )
  res.json({ ok: true })
})

app.use('/api/companies', requireAuth, companiesRouter)
app.use('/api/shareholders', requireAuth, shareholdersRouter)
app.use('/api/resolutions', requireAuth, resolutionsRouter)

// Zentrale Fehlerbehandlung: einheitliches JSON statt Express-Default-HTML.
// Express 5 leitet auch abgelehnte Promises aus async-Handlern hierher.
app.use('/api', (err, _req, res, _next) => {
  console.error('unhandled:', err)
  res.status(500).json({ error: 'Interner Fehler' })
})

// ── Prod: statisches Frontend ──
if (PROD) {
  const dist = path.join(__dirname, '..', 'dist')
  app.use(express.static(dist))
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, process.env.BIND_ADDR || '127.0.0.1', () => {
    console.log(`taiko-beschluss server on :${PORT}`)
  })
}

export { app }
