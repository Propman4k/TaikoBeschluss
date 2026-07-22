import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Building2, GripVertical } from 'lucide-react'
import { api, isPersonengesellschaft } from '../api.js'
import { useToast } from '../components/Toast.jsx'
import CompanyModal, { EMPTY_COMPANY } from '../components/CompanyModal.jsx'

export default function Companies() {
  const [items, setItems] = useState([])
  const [shareholders, setShareholders] = useState([])
  const [editing, setEditing] = useState(null) // null | Company-Row | EMPTY_COMPANY
  const [dragId, setDragId] = useState(null)
  const toast = useToast()

  const load = () => {
    api.get('/api/companies').then(setItems).catch(() => {})
    api.get('/api/shareholders').then(setShareholders).catch(() => {})
  }
  useEffect(() => { load() }, [])

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

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Gesellschaften</h1>
        <button
          onClick={() => setEditing({ ...EMPTY_COMPANY })}
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
                onClick={() => setEditing(c)}
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
        <CompanyModal
          company={editing}
          shareholders={shareholders}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}
