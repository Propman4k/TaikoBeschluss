// Roher Zugriff mit der gemeinsamen Fehler-Behandlung (401 -> Login-Screen,
// Server-Fehlertext als Error). Fuer Faelle, die die Response selbst brauchen:
// PDF-Blobs, PNG-Uploads.
export async function rawRequest(path, options = {}) {
  const res = await fetch(path, options)
  if (res.status === 401) {
    window.dispatchEvent(new Event('auth-expired'))
    throw new Error('nicht eingeloggt')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Fehler ${res.status}`)
  }
  return res
}

async function request(path, options = {}) {
  const isBlob = options.body instanceof Blob
  const res = await rawRequest(path, {
    ...options,
    headers: {
      ...(isBlob ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {}),
    },
    body:
      isBlob || typeof options.body === 'string' || options.body == null
        ? options.body
        : JSON.stringify(options.body),
  })
  return res.status === 204 ? null : res.json()
}

export const api = {
  get: (path) => request(path),
  post: (path, body, headers) => request(path, { method: 'POST', body, headers }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  del: (path) => request(path, { method: 'DELETE' }),
}

// Personengesellschaft (GbR) — bei Gesellschafter-Eintraegen ohne Rechtsform
// entscheidet der Name.
export const isPersonengesellschaft = (legalForm, name = '') =>
  legalForm === 'gbr' || /\bGbR\b/.test(name)

export const fmtDate = (iso) => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}
