import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Building2, User, GripVertical } from 'lucide-react'
import { api, isPersonengesellschaft } from '../api.js'
import { useToast } from '../components/Toast.jsx'
import ShareholderModal, { EMPTY_SHAREHOLDER } from '../components/ShareholderModal.jsx'

export default function Shareholders() {
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null) // null | Shareholder-Row | EMPTY_SHAREHOLDER
  const [dragShId, setDragShId] = useState(null)
  const toast = useToast()

  const load = () => api.get('/api/shareholders').then(setItems).catch(() => {})
  useEffect(() => { load() }, [])

  async function remove(id) {
    if (!confirm('Gesellschafter wirklich löschen?')) return
    try {
      await api.del(`/api/shareholders/${id}`)
      load()
      toast('Gelöscht')
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  const companies = items.filter((s) => s.type !== 'person')
  const persons = items.filter((s) => s.type === 'person')

  // Drag & Drop nur innerhalb derselben Kategorie (Gesellschaft/Person)
  function rowDragOver(e, over) {
    e.preventDefault()
    if (dragShId == null || dragShId === over.id) return
    setItems((list) => {
      const from = list.findIndex((s) => s.id === dragShId)
      const to = list.findIndex((s) => s.id === over.id)
      if (from < 0 || to < 0 || list[from].type !== list[to].type) return list
      const next = [...list]
      next.splice(to, 0, ...next.splice(from, 1))
      return next
    })
  }
  async function rowDragEnd() {
    if (dragShId == null) return
    setDragShId(null)
    try {
      await api.post('/api/shareholders/reorder', { ids: items.map((s) => s.id) })
    } catch (err) {
      toast(err.message, 'error')
      load()
    }
  }

  // Render-Funktion statt Komponente: eine Inline-Komponente wuerde bei jedem
  // Re-Render als neuer Typ gelten, React baut die DOM-Knoten neu auf und der
  // Browser bricht das native Drag & Drop sofort ab.
  const renderItem = (s) => (
    <div
      key={s.id}
      draggable
      onDragStart={() => setDragShId(s.id)}
      onDragOver={(e) => rowDragOver(e, s)}
      onDragEnd={rowDragEnd}
      className={`flex items-center gap-4 bg-surface rounded-[10px] shadow-card border border-border px-5 py-4 ${
        dragShId === s.id ? 'opacity-50' : ''
      }`}
    >
      <GripVertical size={16} className="text-slate-300 cursor-grab shrink-0" />
      <div
        className={`p-2 rounded-[8px] ${
          s.type === 'person'
            ? 'bg-emerald-50 text-emerald-600'
            : isPersonengesellschaft(null, s.name)
              ? 'bg-orange-50 text-orange-500'
              : 'bg-blue-50 text-brand'
        }`}
      >
        {s.type === 'person' ? <User size={20} /> : <Building2 size={20} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{s.name}</div>
        <div className="text-sm text-text-muted truncate">
          {s.type === 'person' ? s.signer_email : `Unterzeichner: ${s.signer_name} · ${s.signer_email}`}
        </div>
      </div>
      {!!s.has_default_signature && (
        <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">Unterschrift ✓</span>
      )}
      <button onClick={() => setEditing({ ...s })} className="p-2 rounded-[6px] text-slate-500 hover:bg-slate-100 cursor-pointer" aria-label="Bearbeiten">
        <Pencil size={16} />
      </button>
      <button onClick={() => remove(s.id)} className="p-2 rounded-[6px] text-slate-500 hover:bg-red-50 hover:text-red-600 cursor-pointer" aria-label="Löschen">
        <Trash2 size={16} />
      </button>
    </div>
  )

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Gesellschafter</h1>
        <button
          onClick={() => setEditing({ ...EMPTY_SHAREHOLDER })}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand hover:bg-brand-hover rounded-[6px] transition-colors cursor-pointer"
        >
          <Plus size={16} /> Neuer Gesellschafter
        </button>
      </div>

      {items.length === 0 && (
        <div className="bg-surface rounded-[10px] shadow-card border border-border px-6 py-10 text-sm text-text-muted text-center">
          Noch keine Gesellschafter angelegt.
        </div>
      )}

      {companies.length > 0 && (
        <div className="mb-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-muted mb-2">
            <Building2 size={15} /> Firmen Gesellschafter
          </h2>
          <div className="space-y-2">{companies.map(renderItem)}</div>
        </div>
      )}

      {persons.length > 0 && (
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-muted mb-2">
            <User size={15} /> Personen Gesellschafter
          </h2>
          <div className="space-y-2">{persons.map(renderItem)}</div>
        </div>
      )}

      {!!editing && (
        <ShareholderModal
          shareholder={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
          onChanged={load}
        />
      )}
    </div>
  )
}
