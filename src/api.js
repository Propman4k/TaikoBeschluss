async function request(path, options = {}) {
  const isBlob = options.body instanceof Blob
  const res = await fetch(path, {
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
  if (res.status === 401) {
    window.dispatchEvent(new Event('auth-expired'))
    throw new Error('nicht eingeloggt')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Fehler ${res.status}`)
  }
  return res.status === 204 ? null : res.json()
}

export const api = {
  get: (path) => request(path),
  post: (path, body, headers) => request(path, { method: 'POST', body, headers }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  del: (path) => request(path, { method: 'DELETE' }),
}

export const fmtDate = (iso) => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}
