import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Building2, GripVertical } from 'lucide-react'
import { api, isPersonengesellschaft } from '../api.js'
import { useToast } from '../components/Toast.jsx'

const EMPTY = { name: '', legal_form: 'gmbh', registry_court: '', hrb: '', address: '', zip: '', city: '', shareholder_ids: [], sharesById: {} }

const LEGAL_FORMS = [
  { v: 'gmbh', label: 'GmbH' },
  { v: 'ug', label: 'UG (haftungsbeschränkt)' },
  { v: 'ag', label: 'AG' },
  { v: 'gbr', label: 'GbR' },
  { v: 'other', label: 'Sonstige' },
]

export default function Companies() {
  const [items, setItems] = useState([])
  const [shareholders, setShareholders] = useState([])
  const [editing, setEditing] = useState(null)
  const [dragId, setDragId] = useState(null)
  const toast = useToast()

  const load = () => {
    api.get('/api/companies').then(setItems).catch(() => {})
    api.get('/api/shareholders').then(setShareholders).catch(() => {})
  }
  useEffect(() => { load() }, [])

  async function save(e) {
    e.preventDefault()
    try {
      const payload = {
        ...editing,
        // Komma-Dezimaltrennzeichen tolerieren ("33,3" -> 33.3)
        shareholders: editing.shareholder_ids.map((id) => ({
          id,
          shares: String(editing.sharesById[id] ?? '').replace(',', '.'),
        })),
      }
      if (editing.id) await api.put(`/api/companies/${editing.id}`, payload)
      else await api.post('/api/companies', payload)
      setEditing(null)
      load()
      toast('Gespeichert')
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function remove(id) {
    if (!confirm('Gesellschaft wirklich löschen?')) return
    try {
      await api.del(`/api/companies/${id}`)
      load()
      toast('Gelöscht')
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  // Drag & Drop: waehrend des Ziehens lokal umsortieren, am Ende persistieren
  function dragOver(e, overId) {
    e.preventDefault()
    if (dragId == null || dragId === overId) return
    setItems((list) => {
      const from = list.findIndex((c) => c.id === dragId)
      const to = list.findIndex((c) => c.id === overId)
      if (from < 0 || to < 0) return list
      const next = [...list]
      next.splice(to, 0, ...next.splice(from, 1))
      return next
    })
  }
  async function dragEnd() {
    if (dragId == null) return
    setDragId(null)
    try {
      await api.post('/api/companies/reorder', { ids: items.map((c) => c.id) })
    } catch (err) {
      toast(err.message, 'error')
      load()
    }
  }

  function toggleShareholder(id) {
    const ids = editing.shareholder_ids.includes(id)
      ? editing.shareholder_ids.filter((x) => x !== id)
      : [...editing.shareholder_ids, id]
    setEditing({ ...editing, shareholder_ids: ids })
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Gesellschaften</h1>
        <button
          onClick={() => setEditing({ ...EMPTY })}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand hover:bg-brand-hover rounded-[6px] transition-colors cursor-pointer"
        >
          <Plus size={16} /> Neue Gesellschaft
        </button>
      </div>

      <div className="space-y-4">
        {items.length === 0 && (
          <div className="bg-surface rounded-[10px] shadow-card border border-border px-6 py-10 text-sm text-text-muted text-center">
            Noch keine Gesellschaften angelegt.
          </div>
        )}
        {items.map((c) => (
          <div
            key={c.id}
            draggable
            onDragStart={() => setDragId(c.id)}
            onDragOver={(e) => dragOver(e, c.id)}
            onDragEnd={dragEnd}
            className={`bg-surface rounded-[10px] shadow-card border border-border px-6 py-5 ${
              dragId === c.id ? 'opacity-50' : ''
            }`}
          >
            <div className="flex items-center gap-4">
              <GripVertical size={16} className="text-slate-300 cursor-grab shrink-0" />
              <div
                className={`p-2 rounded-[8px] ${
                  isPersonengesellschaft(c.legal_form, c.name) ? 'bg-orange-50 text-orange-500' : 'bg-blue-50 text-brand'
                }`}
              >
                <Building2 size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{c.name}</div>
                <div className="text-sm text-text-muted truncate">
                  {[
                    [c.registry_court, c.hrb].filter(Boolean).join(' · '),
                    [c.address, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {c.shareholders.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {c.shareholders.map((s) => (
                      <span key={s.id} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs">
                        {s.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() =>
                  setEditing({
                    ...c,
                    shareholder_ids: c.shareholders.map((s) => s.id),
                    sharesById: Object.fromEntries(c.shareholders.map((s) => [s.id, s.shares ?? ''])),
                  })
                }
                className="p-2 rounded-[6px] text-slate-500 hover:bg-slate-100 cursor-pointer self-center"
                aria-label="Bearbeiten"
              >
                <Pencil size={16} />
              </button>
              <button onClick={() => remove(c.id)} className="p-2 rounded-[6px] text-slate-500 hover:bg-red-50 hover:text-red-600 cursor-pointer self-center" aria-label="Löschen">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {!!editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
          <form onSubmit={save} className="bg-surface rounded-2xl overflow-hidden shadow-elevated animate-modal-in border border-border w-full max-w-xl my-8">
            <div className="px-6 py-4 border-b border-border bg-slate-50 font-semibold">
              {editing.id ? 'Gesellschaft bearbeiten' : 'Neue Gesellschaft'}
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-[1fr_150px] gap-4">
                <label className="block text-sm">
                  <span className="text-text-muted">Firma</span>
                  <input className="input-base mt-1" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Taikonauten GmbH" required />
                </label>
                <label className="block text-sm">
                  <span className="text-text-muted">Rechtsform</span>
                  <select
                    className="input-select mt-1"
                    value={editing.legal_form ?? 'gmbh'}
                    onChange={(e) => setEditing({ ...editing, legal_form: e.target.value })}
                  >
                    {LEGAL_FORMS.map(({ v, label }) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-[1fr_150px] gap-4">
                <label className="block text-sm">
                  <span className="text-text-muted">Handelsregister</span>
                  <input className="input-base mt-1" value={editing.registry_court} onChange={(e) => setEditing({ ...editing, registry_court: e.target.value })} placeholder="Amtsgericht Charlottenburg" />
                </label>
                <label className="block text-sm">
                  <span className="text-text-muted">HRB</span>
                  <input className="input-base mt-1" value={editing.hrb} onChange={(e) => setEditing({ ...editing, hrb: e.target.value })} placeholder="HRB 265001 B" />
                </label>
              </div>
              <label className="block text-sm">
                <span className="text-text-muted">Straße und Hausnummer</span>
                <input className="input-base mt-1" value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} placeholder="Prinzenallee 74" />
              </label>
              <div className="grid grid-cols-[120px_1fr] gap-4">
                <label className="block text-sm">
                  <span className="text-text-muted">PLZ</span>
                  <input className="input-base mt-1" value={editing.zip} onChange={(e) => setEditing({ ...editing, zip: e.target.value })} placeholder="13357" />
                </label>
                <label className="block text-sm">
                  <span className="text-text-muted">Ort</span>
                  <input className="input-base mt-1" value={editing.city} onChange={(e) => setEditing({ ...editing, city: e.target.value })} placeholder="Berlin" />
                </label>
              </div>
              <div className="text-sm">
                <span className="text-text-muted">Gesellschafter</span>
                <div className="mt-2 space-y-1.5">
                  {shareholders.length === 0 && (
                    <div className="text-xs text-text-light">
                      Noch keine Gesellschafter — zuerst unter „Gesellschafter" anlegen.
                    </div>
                  )}
                  {/* Reihenfolge wie auf der Gesellschafter-Seite: Gesellschaften, dann Personen */}
                  {[...shareholders.filter((s) => s.type !== 'person'), ...shareholders.filter((s) => s.type === 'person')].map((s) => (
                    // feste Hoehe: Zeile springt nicht, wenn das Anteil-Feld erscheint
                    <label key={s.id} className="flex items-center gap-2.5 px-3 h-11 rounded-[6px] border border-border hover:bg-slate-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editing.shareholder_ids.includes(s.id)}
                        onChange={() => toggleShareholder(s.id)}
                        className="accent-[#1100ff]"
                      />
                      <span className="flex-1">{s.name}</span>
                      {!!editing.shareholder_ids.includes(s.id) && (
                        <span className="flex items-center gap-1 text-xs text-text-muted">
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="Anteil"
                            value={editing.sharesById[s.id] ?? ''}
                            onClick={(e) => e.preventDefault()}
                            onChange={(e) =>
                              setEditing({ ...editing, sharesById: { ...editing.sharesById, [s.id]: e.target.value } })
                            }
                            className="input-base !w-20 !py-1 text-right"
                          />
                          %
                        </span>
                      )}
                      {/* Name immer ganz rechts an fester Position */}
                      <span className="w-32 text-right text-xs text-text-muted truncate">{s.signer_name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-text-muted hover:text-slate-700 cursor-pointer">
                Abbrechen
              </button>
              <button type="submit" className="px-5 py-2 text-sm font-semibold text-white bg-brand hover:bg-brand-hover rounded-[6px] transition-colors cursor-pointer">
                Speichern
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
