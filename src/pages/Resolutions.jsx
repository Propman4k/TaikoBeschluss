import { useEffect, useState } from 'react'
import { Plus, CheckCircle2, CircleDashed, Trash2, ChevronRight, ExternalLink, CloudUpload } from 'lucide-react'
import { api, fmtDate } from '../api.js'
import { useToast } from '../components/Toast.jsx'
import Dropdown from '../components/Dropdown.jsx'

function StatusBadge({ r }) {
  if (r.status === 'entwurf')
    return <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">Entwurf</span>
  // Ampel: 0 = rot, teilweise = gelb, vollstaendig = gruen
  if (r.sig_done >= r.sig_total)
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">
        <CheckCircle2 size={13} /> {r.sig_done}/{r.sig_total} Unterschriften
      </span>
    )
  const zero = r.sig_done === 0
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
        zero ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
      }`}
    >
      <CircleDashed size={13} /> {r.sig_done}/{r.sig_total} Unterschriften
    </span>
  )
}

// Spaltenraster: Titel | Gesellschaft | Erstellt am | Status (rechtsbuendig)
const GRID = 'grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_160px] items-center gap-4'

// Drive-Ablage (nur abgeschlossene Beschluesse): Link auf das PDF in Drive,
// oder "Nach Drive" als Retry/Backfill, wenn der Upload (noch) fehlt.
function DriveButton({ r, onUpload }) {
  const [busy, setBusy] = useState(false)
  if (r.drive_link)
    return (
      <a
        href={r.drive_link}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-[6px] hover:bg-slate-50 transition-colors"
        title="PDF in Google Drive öffnen"
      >
        <ExternalLink size={13} /> Drive
      </a>
    )
  return (
    <button
      onClick={async () => {
        setBusy(true)
        try {
          await onUpload(r)
        } finally {
          setBusy(false)
        }
      }}
      disabled={busy}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-[6px] hover:bg-slate-50 disabled:opacity-50 transition-colors cursor-pointer"
      title="PDF nach Google Drive hochladen"
    >
      <CloudUpload size={13} /> {busy ? 'Lädt…' : 'Nach Drive'}
    </button>
  )
}

// Einzeiliges Listenelement (eigene Card pro Beschluss, wie TaikoTasks)
function Row({ r, onDelete, onUpload }) {
  return (
    <div className="group flex items-center gap-4 bg-surface rounded-[10px] shadow-card border border-border px-5 py-4 hover:border-brand/30 transition-colors">
      <a href={`#/beschluss/${r.id}`} className={`flex-1 min-w-0 ${GRID}`}>
        <div className="min-w-0 flex items-center gap-2">
          {!!r.type_name && (
            <span className="shrink-0 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-medium">
              {r.type_name}
            </span>
          )}
          <span className="text-sm font-medium truncate">{r.title || 'Ohne Titel'}</span>
        </div>
        <div className="text-sm text-text-muted truncate">{r.company_name}</div>
        {/* Beschlussdatum (steht auf dem Dokument), nicht Anlage-Datum */}
        <div className="text-sm text-text-muted">{fmtDate(r.date)}</div>
        <div className="justify-self-end">
          <StatusBadge r={r} />
        </div>
      </a>
      {!!onUpload && <DriveButton r={r} onUpload={onUpload} />}
      {!!onDelete && (
        <button
          onClick={() => onDelete(r)}
          className="p-2 rounded-[6px] text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer"
          aria-label="In den Papierkorb"
          title="In den Papierkorb"
        >
          <Trash2 size={16} />
        </button>
      )}
      <a href={`#/beschluss/${r.id}`} className="text-slate-300 group-hover:text-slate-400" aria-hidden>
        <ChevronRight size={18} />
      </a>
    </div>
  )
}

function List({ items, onDelete, onUpload }) {
  return (
    <div className="space-y-2">
      {items.map((r) => (
        <Row key={r.id} r={r} onDelete={onDelete} onUpload={onUpload} />
      ))}
    </div>
  )
}

// Listen-Filter = gemeinsame Dropdown-Komponente mit vorangestellter "Alle"-Option
function SelectFilter({ options: items, allLabel, value, onChange }) {
  return <Dropdown options={[{ id: 'alle', name: allLabel }, ...items]} value={value} onChange={onChange} />
}

const isDone = (r) => r.sig_total > 0 && r.sig_done >= r.sig_total

export default function Resolutions({ view = 'offen' }) {
  const [data, setData] = useState(null)
  const [companies, setCompanies] = useState([])
  const [picking, setPicking] = useState(false)
  const [filter, setFilter] = useState('alle')
  const [types, setTypes] = useState([])
  const [typeFilter, setTypeFilter] = useState('alle')
  const [deleting, setDeleting] = useState(null) // { r, step: 1|2 }
  const toast = useToast()

  const load = () => api.get('/api/resolutions').then(setData).catch(() => {})
  useEffect(() => {
    load()
    api.get('/api/companies').then(setCompanies).catch(() => {})
    api.get('/api/resolution-types').then(setTypes).catch(() => {})
  }, [])

  async function createFor(companyId) {
    try {
      const r = await api.post('/api/resolutions', { company_id: companyId })
      window.location.hash = `#/beschluss/${r.id}`
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function uploadDrive(r) {
    try {
      await api.post(`/api/resolutions/${r.id}/drive`)
      load()
      toast('PDF in Drive abgelegt')
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function confirmDelete() {
    try {
      await api.del(`/api/resolutions/${deleting.r.id}`)
      setDeleting(null)
      load()
      toast('In den Papierkorb verschoben')
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  if (!data) return null
  const del = (res) => setDeleting({ r: res, step: 1 })
  const byCompany =
    filter === 'alle' ? data.resolutions : data.resolutions.filter((r) => r.company_id === Number(filter))
  const base = typeFilter === 'alle' ? byCompany : byCompany.filter((r) => r.type_id === Number(typeFilter))
  const toSignSet = new Set(data.toSign)

  // Drei Buckets: Entwuerfe (in Bearbeitung), Zu unterschreiben (freigegeben,
  // noch nicht vollstaendig), Abgeschlossen (vollstaendig unterschrieben).
  const zuSign = base.filter((r) => r.status === 'freigegeben' && !isDone(r))
  const mine = zuSign.filter((r) => toSignSet.has(r.id))
  const rest = zuSign.filter((r) => !toSignSet.has(r.id))
  const entwuerfe = base.filter((r) => r.status === 'entwurf')
  const done = base.filter(isDone)

  const TITLES = { entwuerfe: 'Entwürfe', abgeschlossen: 'Abgeschlossen', offen: 'Zu unterschreiben' }
  const EMPTY = {
    entwuerfe: 'Keine Entwürfe in Bearbeitung.',
    abgeschlossen: 'Noch nichts abgeschlossen.',
  }
  const simpleList = view === 'entwuerfe' ? entwuerfe : done // fuer die Nicht-offen-Views
  const emptyBox = (text) => (
    <div className="bg-surface rounded-[10px] shadow-card border border-border px-6 py-10 text-sm text-text-muted text-center">
      {text}
    </div>
  )

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">{TITLES[view]}</h1>
        <div className="flex items-center gap-3">
          <SelectFilter options={types} allLabel="Alle Typen" value={typeFilter} onChange={setTypeFilter} />
          <SelectFilter options={companies} allLabel="Alle Gesellschaften" value={filter} onChange={setFilter} />
          <button
            onClick={() => setPicking(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand hover:bg-brand-hover rounded-[6px] transition-colors cursor-pointer"
          >
            <Plus size={16} /> Neuer Beschluss
          </button>
        </div>
      </div>

      {view === 'offen' ? (
        <>
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-text-muted mb-2">Von mir zu unterschreiben</h2>
            {mine.length > 0 ? (
              <List items={mine} onDelete={del} />
            ) : (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-[10px] px-5 py-4 text-sm text-emerald-700">
                <CheckCircle2 size={16} /> Aktuell gibt es für dich nichts zu unterschreiben.
              </div>
            )}
          </div>

          {rest.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-text-muted mb-2">
                Von anderen Gesellschaftern noch zu unterschreiben
              </h2>
              <List items={rest} onDelete={del} />
            </div>
          )}
        </>
      ) : (
        <>
          {simpleList.length === 0 ? (
            emptyBox(EMPTY[view])
          ) : (
            <List items={simpleList} onDelete={del} onUpload={view === 'abgeschlossen' ? uploadDrive : null} />
          )}
        </>
      )}

      {!!picking && (
        <div
          onClick={(e) => e.target === e.currentTarget && setPicking(false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
        >
          <div className="bg-surface rounded-2xl overflow-hidden shadow-elevated animate-modal-in border border-border w-full max-w-md">
            <div className="px-6 py-4 border-b border-border bg-slate-50 font-semibold">
              Für welche Gesellschaft?
            </div>
            <div className="p-4 space-y-1">
              {companies.length === 0 && (
                <div className="px-3 py-6 text-sm text-text-muted text-center">
                  Zuerst eine <a href="#/gesellschaften" className="text-brand underline">Gesellschaft anlegen</a>.
                </div>
              )}
              {companies.map((c) => (
                <button
                  key={c.id}
                  onClick={() => createFor(c.id)}
                  disabled={!c.shareholders.length}
                  className="w-full text-left px-4 py-3 rounded-[8px] hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-text-muted">
                    {c.shareholders.length
                      ? c.shareholders.map((s) => s.name).join(', ')
                      : 'Keine Gesellschafter zugeordnet'}
                  </div>
                </button>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-border flex justify-end">
              <button onClick={() => setPicking(false)} className="px-4 py-2 text-sm text-text-muted hover:text-slate-700 cursor-pointer">
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loeschen: doppelte Abfrage (2 Schritte), Soft-Delete in den Papierkorb */}
      {!!deleting && (
        <div
          onClick={(e) => e.target === e.currentTarget && setDeleting(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
        >
          <div className="bg-surface rounded-2xl overflow-hidden shadow-elevated animate-modal-in border border-border w-full max-w-md">
            <div className="px-6 py-4 border-b border-border bg-slate-50 font-semibold">
              {deleting.step === 1 ? 'In den Papierkorb verschieben?' : 'Bitte bestätigen'}
            </div>
            <div className="p-6 text-sm text-text-muted">
              {deleting.step === 1 ? (
                <>
                  „{deleting.r.title || 'Ohne Titel'}" ({deleting.r.number}) wird in den Papierkorb
                  verschoben. Du kannst ihn dort jederzeit wiederherstellen.
                </>
              ) : (
                <>
                  Wirklich in den Papierkorb verschieben? Der Beschluss verschwindet aus der Übersicht,
                  bleibt aber im <span className="font-medium text-text">Papierkorb</span> wiederherstellbar.
                </>
              )}
            </div>
            <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
              <button onClick={() => setDeleting(null)} className="px-4 py-2 text-sm text-text-muted hover:text-slate-700 cursor-pointer">
                Abbrechen
              </button>
              {deleting.step === 1 ? (
                <button
                  onClick={() => setDeleting({ ...deleting, step: 2 })}
                  className="px-5 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-[6px] transition-colors cursor-pointer"
                >
                  Weiter
                </button>
              ) : (
                <button
                  onClick={confirmDelete}
                  className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-[6px] transition-colors cursor-pointer"
                >
                  <Trash2 size={15} /> In den Papierkorb
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
