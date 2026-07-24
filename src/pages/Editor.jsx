import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Send, FileDown, PenLine, Check, Pencil, Loader2, Sparkles, Scale, ClipboardCheck } from 'lucide-react'
import { api, fmtDate } from '../api.js'
import { useToast } from '../components/Toast.jsx'
import SignatureModal from '../components/SignatureModal.jsx'
import { PAGE, usePagination } from '../usePagination.js'

// Stufen der Verfassen-Pipeline (Server: services/ki.js). Die Detail-Zeilen
// rotieren client-seitig und beschreiben, was die jeweilige Stufe wirklich prueft.
const COMPOSE_STEPS = [
  {
    key: 'verfassen',
    label: 'Entwurf verfassen',
    icon: PenLine,
    details: [
      'Beschlusstyp bestimmen …',
      'Einschlägige Normen heranziehen …',
      'Beschlusspunkte formulieren …',
      'Erforderliche Feststellungen ergänzen …',
      'Angaben aus dem Gespräch abgleichen …',
    ],
  },
  {
    key: 'pruefen',
    label: 'Juristische Gegenprüfung',
    icon: Scale,
    details: [
      'Formerfordernisse prüfen (Beurkundung, Handelsregister) …',
      'Stimmverbote prüfen (§ 47 Abs. 4 GmbHG) …',
      'Kapitalerhaltung prüfen (§§ 30, 43a GmbHG) …',
      'Steuerliche Risiken prüfen (vGA, Fremdvergleich) …',
      'Insichgeschäfte prüfen (§ 181 BGB) …',
      'Bestimmtheit jedes Beschlusspunkts prüfen …',
      'Vollständigkeit gegen das Gespräch prüfen …',
    ],
  },
  {
    key: 'einarbeiten',
    label: 'Prüfergebnisse einarbeiten',
    icon: ClipboardCheck,
    details: [
      'Jeden Einwand am Gesetz bewerten …',
      'Berechtigte Einwände einarbeiten …',
      'Unbegründete Einwände verwerfen …',
      'Finalen Beschlusstext erstellen …',
    ],
  },
]

// Overlay ueber dem Dokument, solange die Verfassen-Pipeline laeuft.
function ComposeOverlay({ status }) {
  const activeIdx = Math.max(0, COMPOSE_STEPS.findIndex((s) => s.key === status.stage))
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 3000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center">
      <div className="w-[400px] bg-white/95 backdrop-blur rounded-2xl shadow-elevated border border-border p-7">
        <div className="flex items-center gap-3 pb-5">
          <span className="relative flex h-9 w-9 items-center justify-center">
            <span className="absolute inline-flex h-full w-full rounded-full bg-brand/20 animate-ping" />
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white">
              <Sparkles size={16} />
            </span>
          </span>
          <div>
            <div className="font-semibold text-sm">Beschluss wird erstellt</div>
            <div className="text-xs text-text-muted">Verfassen, Gegenprüfung und Überarbeitung laufen automatisch</div>
          </div>
        </div>
        <div className="space-y-4">
          {COMPOSE_STEPS.map((step, i) => {
            const state = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending'
            const Icon = step.icon
            return (
              <div key={step.key} className={`flex gap-3 ${state === 'pending' ? 'opacity-40' : ''}`}>
                <div className="w-5 pt-0.5 shrink-0">
                  {state === 'done' ? (
                    <Check size={16} className="text-emerald-600" />
                  ) : state === 'active' ? (
                    <Loader2 size={16} className="animate-spin text-brand" />
                  ) : (
                    <Icon size={15} className="text-text-light" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className={`text-sm font-medium ${state === 'active' ? 'text-text' : 'text-text-muted'}`}>
                    {step.label}
                    {step.key === 'einarbeiten' && status.issues > 0 && state !== 'pending' && (
                      <span className="ml-2 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                        {status.issues} {status.issues === 1 ? 'Hinweis' : 'Hinweise'}
                      </span>
                    )}
                  </div>
                  {state === 'active' && (
                    <div key={tick % step.details.length} className="text-xs text-text-muted mt-0.5 animate-fade-in">
                      {step.details[tick % step.details.length]}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <div className="pt-5 text-[11px] text-text-light">
          Dauert etwa eine Minute — der Entwurf wird wie in einer Kanzlei erst verfasst und dann gegengeprüft.
        </div>
      </div>
    </div>
  )
}

export default function Editor({ id }) {
  const [r, setR] = useState(null)
  const [chat, setChat] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [editingContent, setEditingContent] = useState(null)
  const [signingFor, setSigningFor] = useState(null)
  const [composeStatus, setComposeStatus] = useState(null)
  const [types, setTypes] = useState([])
  const [editingTitle, setEditingTitle] = useState(null)
  const chatEndRef = useRef(null)
  const pollRef = useRef(null)
  const toast = useToast()

  useEffect(() => {
    api.get(`/api/resolutions/${id}`).then(setR).catch((e) => toast(e.message, 'error'))
    api.get(`/api/resolutions/${id}/chat`).then(setChat).catch(() => {})
    api.get('/api/resolution-types').then(setTypes).catch(() => {})
    // Laeuft serverseitig noch eine Verfassen-Pipeline (z.B. nach Reload)?
    // Dann Overlay zeigen und nach Abschluss Beschluss + Chat neu laden.
    api
      .get(`/api/resolutions/${id}/chat/status`)
      .then((s) => {
        if (!s.stage) return
        setComposeStatus(s)
        pollRef.current = setInterval(async () => {
          try {
            const cur = await api.get(`/api/resolutions/${id}/chat/status`)
            if (cur.stage) return setComposeStatus(cur)
            clearInterval(pollRef.current)
            setComposeStatus(null)
            setR(await api.get(`/api/resolutions/${id}`))
            setChat(await api.get(`/api/resolutions/${id}/chat`))
          } catch {} // eslint-disable-line no-empty
        }, 1500)
      })
      .catch(() => {})
    return () => clearInterval(pollRef.current)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat, sending])

  async function chatTurn(body, userBubble) {
    setChat((c) => [...c, { id: `tmp-${Date.now()}`, role: 'user', content: userBubble }])
    setSending(true)
    try {
      const res = await api.post(`/api/resolutions/${id}/chat`, body)
      setChat((c) => [...c, { id: `tmp-a-${Date.now()}`, role: 'assistant', content: res.reply, wrote: res.wrote }])
      setR(res.resolution)
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setSending(false)
    }
  }

  async function send(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    await chatTurn({ message: text }, text)
  }

  // Verfassen/Aktualisieren: NUR hierueber wird das Dokument geschrieben —
  // Chat-Nachrichten sind immer reine Diskussion (Server erzwingt das).
  // Waehrend die Pipeline laeuft (~1 Minute), zeigt das Overlay den Fortschritt
  // (Status-Polling gegen /chat/status).
  async function compose() {
    if (sending) return
    setComposeStatus({ stage: 'verfassen' })
    pollRef.current = setInterval(() => {
      api
        .get(`/api/resolutions/${id}/chat/status`)
        .then((s) => s.stage && setComposeStatus(s))
        .catch(() => {})
    }, 1500)
    try {
      await chatTurn(
        { compose: true },
        r.content
          ? 'Bitte aktualisiere den Beschluss auf Basis unseres Gesprächs.'
          : 'Bitte verfasse jetzt den Beschluss auf Basis unseres Gesprächs.',
      )
    } finally {
      clearInterval(pollRef.current)
      setComposeStatus(null)
    }
  }

  async function patch(fields) {
    try {
      setR(await api.patch(`/api/resolutions/${id}`, fields))
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function release() {
    try {
      setR(await api.post(`/api/resolutions/${id}/release`))
      toast('Zur Unterschrift freigegeben')
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function saveSignature(blob) {
    try {
      const res = await fetch(`/api/resolutions/${id}/sign/${signingFor}`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: blob ?? new Blob([], { type: 'image/png' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Fehler ${res.status}`)
      }
      setR(await res.json())
      setSigningFor(null)
      toast(blob ? 'Unterschrieben' : 'Unterschrift entfernt')
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  // Hooks muessen vor jedem early return stehen — Bloecke bei r=null leer.
  const released = r?.status === 'freigegeben'
  const signatureFor = (shareholderId) => r?.signatures.find((s) => s.shareholder_id === shareholderId)

  const blocks = r ? buildBlocks() : []

  function buildBlocks() {
    const list = [
      {
        id: 'title',
        node: (
          <h1 className="text-center text-xl font-bold pb-10">
            Gesellschafterbeschluss der {r.company.name}
          </h1>
        ),
      },
      { id: 'intro', node: <p className="pb-5">{r.frame.intro}</p> },
      { id: 'sh-list', node: <p className="pb-5 font-semibold">{r.frame.shareholderList}</p> },
      { id: 'outro', node: <p className="pb-8">{r.frame.outro}</p> },
    ]

    if (editingContent !== null) {
      list.push({
        id: 'content-edit',
        node: (
          <div className="pb-8">
            <textarea
              value={editingContent}
              onChange={(e) => setEditingContent(e.target.value)}
              rows={Math.max(6, editingContent.split('\n').length + 1)}
              className="input-base !text-text font-[inherit] !text-[14px] leading-relaxed"
            />
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setEditingContent(null)} className="px-3 py-1.5 text-xs text-text-muted hover:text-slate-700 cursor-pointer">
                Abbrechen
              </button>
              <button
                onClick={async () => {
                  await patch({ content: editingContent })
                  setEditingContent(null)
                }}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-brand hover:bg-brand-hover rounded-[6px] cursor-pointer"
              >
                Speichern
              </button>
            </div>
          </div>
        ),
      })
    } else {
      // Absatzweise Bloecke, damit langer Beschlusstext sauber ueber Seiten umbrechen kann
      const paras = r.content ? r.content.split(/\n\n+/) : []
      if (!paras.length) {
        list.push({
          id: 'content-empty',
          node: (
            <div
              onClick={() => setEditingContent(r.content)}
              className="group relative mb-8 -mx-3 px-3 py-2 rounded-[8px] hover:bg-blue-50/60 cursor-text transition-colors min-h-[60px]"
              title="Klicken zum Bearbeiten"
            >
              <span className="text-text-light italic">
                Noch kein Beschlusstext — nutze den Chat links oder klicke hier.
              </span>
              <Pencil size={13} className="absolute top-2 right-2 text-text-light opacity-0 group-hover:opacity-100" />
            </div>
          ),
        })
      }
      paras.forEach((p, i) => {
        list.push({
          id: `content-${i}`,
          node: (
            <div
              onClick={() => setEditingContent(r.content)}
              className="group relative -mx-3 px-3 rounded-[8px] hover:bg-blue-50/60 cursor-text transition-colors whitespace-pre-wrap pb-5"
              title="Klicken zum Bearbeiten"
            >
              {p}
              <Pencil size={13} className="absolute top-1 right-2 text-text-light opacity-0 group-hover:opacity-100" />
            </div>
          ),
        })
      })
      if (paras.length) list.push({ id: 'content-gap', node: <div className="pb-3" /> })
    }

    list.push({ id: 'closing', node: <p className="pb-8">{r.frame.closing}</p> })
    list.push({ id: 'place-date', node: <p className="pb-10">{r.company.city}, {fmtDate(r.date)}</p> })

    // Unterschriften: zwei nebeneinander pro Reihe (wie im PDF)
    for (let i = 0; i < r.shareholders.length; i += 2) {
      const pair = r.shareholders.slice(i, i + 2)
      list.push({
        id: `sig-row-${i}`,
        node: (
          <div className="grid grid-cols-2 gap-10 pb-8">
            {pair.map((s) => {
              const sig = signatureFor(s.id)
              return (
                <div key={s.id}>
                  <div className="h-16 flex items-end">
                    {sig?.signed ? (
                      <img
                        src={`/api/resolutions/${id}/sign/${s.id}?t=${sig.signed_at}`}
                        alt="Unterschrift"
                        className="max-h-16 max-w-[200px]"
                      />
                    ) : released ? (
                      <button
                        onClick={() => setSigningFor(s.id)}
                        className="mb-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-brand border border-brand/40 border-dashed rounded-[6px] hover:bg-blue-50 transition-colors cursor-pointer"
                      >
                        <PenLine size={13} /> Hier unterschreiben
                      </button>
                    ) : null}
                  </div>
                  <div className="border-t border-slate-400 pt-1.5">
                    <div className="text-sm">{s.signer_name}</div>
                    <div className="text-xs text-text-muted">für {s.name}</div>
                    {!!sig?.signed && !!released && (
                      <button onClick={() => setSigningFor(s.id)} className="mt-1 text-[11px] text-text-light hover:text-brand cursor-pointer">
                        Unterschrift ändern
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ),
      })
    }
    return list
  }

  const { measureRef, pages } = usePagination(blocks, [
    r?.content,
    r?.date,
    r?.status,
    editingContent,
    r ? r.signatures.map((s) => `${s.shareholder_id}:${s.signed}`).join() : '',
  ])

  if (!r) return null

  const allSigned = released && r.signatures.length > 0 && r.signatures.every((s) => s.signed)
  const signingSig = signingFor ? signatureFor(signingFor) : null
  const signingSh = signingFor ? r.shareholders.find((s) => s.id === signingFor) : null
  const byId = Object.fromEntries(blocks.map((b) => [b.id, b.node]))

  return (
    <div className="flex h-[calc(100vh-0px)] max-h-screen">
      {/* ── Mitte: Chat ── */}
      <div className="flex flex-col w-[420px] shrink-0 border-r border-border bg-surface">
        <div className="flex items-center gap-3 px-4 h-16 border-b border-border">
          <button
            onClick={() => (window.history.length > 1 ? window.history.back() : (window.location.hash = '#/'))}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
            aria-label="Zurück"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            {editingTitle !== null ? (
              <input
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={async () => {
                  await patch({ title: editingTitle.trim() })
                  setEditingTitle(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.target.blur()
                  if (e.key === 'Escape') setEditingTitle(null)
                }}
                className="input-base !text-text !text-sm !py-1"
                autoFocus
              />
            ) : (
              <button
                onClick={() => setEditingTitle(r.title)}
                className="group/title flex items-center gap-1.5 max-w-full cursor-text text-left"
                title="Titel bearbeiten"
              >
                <span className="font-semibold text-sm truncate">{r.title || 'Neuer Beschluss'}</span>
                <Pencil size={12} className="shrink-0 text-text-light opacity-0 group-hover/title:opacity-100" />
              </button>
            )}
            <div className="text-xs text-text-muted truncate">
              {r.company.name} · {r.number}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {chat.length === 0 && (
            <div className="text-sm text-text-muted px-2 py-6 text-center">
              Beschreibe und diskutiere, was beschlossen werden soll. Wenn alles geklärt ist,
              erstellt „Verfassen" den Beschlussentwurf rechts.
            </div>
          )}
          {chat.map((m) => (
            <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex flex-col items-start'}>
              <div
                className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-brand text-white rounded-br-md'
                    : m.wrote
                      ? 'bg-emerald-50 text-text rounded-bl-md border border-emerald-200'
                      : 'bg-slate-100 text-text rounded-bl-md'
                }`}
              >
                {m.content}
              </div>
              {!!m.wrote && (
                <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                  <Check size={12} /> Beschluss formuliert
                </span>
              )}
            </div>
          ))}
          {!!sending && (
            <div className="flex justify-start">
              <div className="px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-slate-100 text-text-muted text-sm inline-flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Denkt nach …
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <form onSubmit={send} className="p-3 border-t border-border">
          {chat.length > 0 && (
            <button
              type="button"
              onClick={compose}
              disabled={sending}
              className="w-full mb-2 inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-brand border border-brand/40 rounded-[8px] hover:bg-blue-50 disabled:opacity-40 transition-colors cursor-pointer"
            >
              <Sparkles size={15} /> {r.content ? 'Beschluss aktualisieren' : 'Beschluss verfassen'}
            </button>
          )}
          <div className="relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send(e)
                }
              }}
              rows={2}
              placeholder="Was soll beschlossen werden?"
              className="input-base !text-text resize-none min-h-[70px] !pr-10 focus:!ring-0 focus:!border-slate-200"
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="absolute right-2 bottom-2.5 p-1.5 text-slate-400 hover:text-slate-600 disabled:text-slate-300 transition-colors cursor-pointer"
              aria-label="Senden"
            >
              <Send size={17} />
            </button>
          </div>
        </form>
      </div>

      {/* ── Rechts: Beschluss als A4-Seiten ── */}
      <div className="flex-1 min-w-0 relative">
        {!!composeStatus && <ComposeOverlay status={composeStatus} />}
        <div
          className={`h-full overflow-y-auto transition-all duration-500 ${
            composeStatus ? 'blur-[5px] opacity-50 pointer-events-none select-none' : ''
          }`}
        >
        <div className="sticky top-0 z-10 flex items-center gap-3 px-6 h-16 bg-surface-raised/95 backdrop-blur border-b border-border">
          <input
            type="date"
            value={r.date}
            onChange={(e) => e.target.value && patch({ date: e.target.value })}
            className="input-base !w-auto !text-text"
            title="Beschlussdatum"
          />
          <select
            value={r.type_id ?? ''}
            onChange={(e) => patch({ type_id: e.target.value ? Number(e.target.value) : null })}
            className="input-select !w-auto !text-text cursor-pointer"
            title="Beschlusstyp"
          >
            <option value="">Ohne Typ</option>
            {types
              .filter((t) => t.active || t.id === r.type_id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
          <div className="flex-1" />
          {!!allSigned && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
              <Check size={15} /> Vollständig unterschrieben
            </span>
          )}
          <a
            href={`/api/resolutions/${id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-[6px] hover:bg-slate-50 transition-colors"
          >
            <FileDown size={15} /> PDF
          </a>
          {!released && (
            <button
              onClick={release}
              disabled={!r.content.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand hover:bg-brand-hover disabled:bg-brand/40 rounded-[6px] transition-colors cursor-pointer"
            >
              <PenLine size={15} /> Zur Unterschrift freigeben
            </button>
          )}
        </div>

        <div className="px-6 py-8 overflow-x-auto">
          {/* Unsichtbarer Mess-Container: gleiche Breite wie der Seiteninhalt */}
          <div
            ref={measureRef}
            aria-hidden
            className="fixed top-0 left-0 invisible pointer-events-none text-[14px] leading-relaxed"
            style={{ width: PAGE.w - 2 * PAGE.pad }}
          >
            {blocks.map((b) => (
              <div key={b.id} data-block={b.id}>
                {b.node}
              </div>
            ))}
          </div>

          {/* Die A4-Seiten */}
          <div className="space-y-8" style={{ minWidth: PAGE.w }}>
            {pages.map((ids, i) => (
              <div key={i} className="mx-auto relative bg-white rounded-[4px] shadow-elevated border border-border" style={{ width: PAGE.w, height: PAGE.h }}>
                <div
                  className="text-[14px] leading-relaxed overflow-hidden"
                  style={{ padding: PAGE.pad, height: '100%' }}
                >
                  {ids.map((bid) => (
                    <div key={bid}>{byId[bid]}</div>
                  ))}
                </div>
                <div className="absolute bottom-3 right-5 text-[11px] text-text-light">
                  Seite {i + 1} / {pages.length}
                </div>
              </div>
            ))}
          </div>
        </div>
        </div>
      </div>

      {!!signingFor && (
        <SignatureModal
          existingUrl={signingSig?.signed ? `/api/resolutions/${id}/sign/${signingFor}` : null}
          templateUrl={signingSh?.template_shareholder_id ? `/api/shareholders/${signingSh.template_shareholder_id}/signature` : null}
          onClose={() => setSigningFor(null)}
          onSave={saveSignature}
        />
      )}
    </div>
  )
}
