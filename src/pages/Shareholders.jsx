import { useEffect, useRef, useState } from 'react'
import { Plus, Pencil, Trash2, PenLine, Upload, Building2, User, GripVertical } from 'lucide-react'
import { api } from '../api.js'
import { useToast } from '../components/Toast.jsx'
import SignatureModal from '../components/SignatureModal.jsx'

const EMPTY = { type: 'company', name: '', signer_name: '', signer_email: '', has_default_signature: false }

export default function Shareholders() {
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null) // null | {id?, ...form}
  const [sigModal, setSigModal] = useState(false)
  const [sigV, setSigV] = useState(0) // Cache-Bust fuer die Vorschau
  const [dragOver, setDragOver] = useState(false) // Signatur-Dropzone im Modal
  const [dragShId, setDragShId] = useState(null) // Listen-Sortierung
  const fileRef = useRef(null)
  const toast = useToast()

  function afterSigChange(updated) {
    setEditing((e) => ({ ...e, has_default_signature: updated.has_default_signature }))
    setSigV((v) => v + 1)
    load()
  }

  async function removeSig() {
    try {
      afterSigChange(await api.del(`/api/shareholders/${editing.id}/signature`))
      toast('Standard-Unterschrift entfernt')
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function saveDrawnSig(blob) {
    setSigModal(false)
    if (!blob) return removeSig()
    const res = await fetch(`/api/shareholders/${editing.id}/signature`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: blob,
    })
    if (res.ok) {
      afterSigChange(await res.json())
      toast('Standard-Unterschrift gespeichert')
    } else {
      toast('Speichern fehlgeschlagen', 'error')
    }
  }

  // Upload: beliebiges Bild clientseitig auf PNG normalisieren, dann hochladen
  function uploadSig(file) {
    if (!file) return
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      canvas.getContext('2d').drawImage(img, 0, 0)
      canvas.toBlob(async (blob) => {
        const res = await fetch(`/api/shareholders/${editing.id}/signature`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/png' },
          body: blob,
        })
        if (res.ok) {
          afterSigChange(await res.json())
          toast('Standard-Unterschrift hochgeladen')
        } else {
          toast('Upload fehlgeschlagen', 'error')
        }
        URL.revokeObjectURL(url)
      }, 'image/png')
    }
    img.onerror = () => {
      toast('Bild konnte nicht gelesen werden', 'error')
      URL.revokeObjectURL(url)
    }
    img.src = url
  }

  const load = () => api.get('/api/shareholders').then(setItems).catch(() => {})
  useEffect(() => { load() }, [])

  async function save(e) {
    e.preventDefault()
    try {
      if (editing.id) await api.put(`/api/shareholders/${editing.id}`, editing)
      else await api.post('/api/shareholders', editing)
      setEditing(null)
      load()
      toast('Gespeichert')
    } catch (err) {
      toast(err.message, 'error')
    }
  }

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

  const Item = ({ s }) => (
    <div
      draggable
      onDragStart={() => setDragShId(s.id)}
      onDragOver={(e) => rowDragOver(e, s)}
      onDragEnd={rowDragEnd}
      className={`flex items-center gap-4 bg-surface rounded-[10px] shadow-card border border-border px-5 py-4 ${
        dragShId === s.id ? 'opacity-50' : ''
      }`}
    >
      <GripVertical size={16} className="text-slate-300 cursor-grab shrink-0" />
      <div className={`p-2 rounded-[8px] ${s.type === 'person' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-brand'}`}>
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
          onClick={() => setEditing({ ...EMPTY })}
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
            <Building2 size={15} /> Gesellschaften
          </h2>
          <div className="space-y-2">
            {companies.map((s) => (
              <Item key={s.id} s={s} />
            ))}
          </div>
        </div>
      )}

      {persons.length > 0 && (
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-muted mb-2">
            <User size={15} /> Personen
          </h2>
          <div className="space-y-2">
            {persons.map((s) => (
              <Item key={s.id} s={s} />
            ))}
          </div>
        </div>
      )}

      {!!editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <form onSubmit={save} className="bg-surface rounded-2xl overflow-hidden shadow-elevated animate-modal-in border border-border w-full max-w-md">
            <div className="px-6 py-4 border-b border-border bg-slate-50 font-semibold">
              {editing.id ? 'Gesellschafter bearbeiten' : 'Neuer Gesellschafter'}
            </div>
            <div className="p-6 space-y-4">
              {/* Typ-Umschalter */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-[8px]">
                {[
                  { v: 'company', label: 'Gesellschaft', icon: Building2 },
                  { v: 'person', label: 'Person', icon: User },
                ].map(({ v, label, icon: Icon }) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setEditing({ ...editing, type: v })}
                    className={`inline-flex items-center justify-center gap-1.5 py-1.5 text-sm font-medium rounded-[6px] transition-colors cursor-pointer ${
                      (editing.type ?? 'company') === v ? 'bg-white shadow-card text-brand' : 'text-text-muted hover:text-slate-700'
                    }`}
                  >
                    <Icon size={14} /> {label}
                  </button>
                ))}
              </div>

              <label className="block text-sm">
                <span className="text-text-muted">
                  {editing.type === 'person' ? 'Name der Person' : 'Firmenname'}
                </span>
                <input
                  className="input-base mt-1"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder={editing.type === 'person' ? 'Maik Fahldieck' : 'Fahldieck Beteiligungs GmbH'}
                  required
                />
              </label>
              {editing.type !== 'person' && (
                <label className="block text-sm">
                  <span className="text-text-muted">Unterzeichner (natürliche Person)</span>
                  <input className="input-base mt-1" value={editing.signer_name} onChange={(e) => setEditing({ ...editing, signer_name: e.target.value })} placeholder="Maik Fahldieck" required />
                </label>
              )}
              <label className="block text-sm">
                <span className="text-text-muted">
                  {editing.type === 'person' ? 'E-Mail (Login-Zuordnung)' : 'E-Mail des Unterzeichners (Login-Zuordnung)'}
                </span>
                <input type="email" className="input-base mt-1" value={editing.signer_email} onChange={(e) => setEditing({ ...editing, signer_email: e.target.value })} placeholder="mf@taikonauten.com" required />
              </label>

              {editing.id ? (
                <div className="text-sm">
                  <span className="text-text-muted">Standard-Unterschrift (optional)</span>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault()
                      setDragOver(true)
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragOver(false)
                      uploadSig(e.dataTransfer.files[0])
                    }}
                    onClick={() => fileRef.current?.click()}
                    className={`mt-1 flex items-center justify-center h-32 rounded-[8px] border-2 border-dashed cursor-pointer transition-colors ${
                      dragOver ? 'border-brand bg-blue-50' : 'border-border hover:bg-slate-50'
                    }`}
                  >
                    {editing.has_default_signature ? (
                      <img
                        src={`/api/shareholders/${editing.id}/signature?t=${sigV}`}
                        alt="Standard-Unterschrift"
                        className="max-h-28 max-w-[85%] object-contain"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 text-xs text-text-light">
                        <Upload size={20} />
                        Bild hierher ziehen oder klicken zum Hochladen
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSigModal(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-[6px] hover:bg-slate-50 cursor-pointer"
                    >
                      <PenLine size={13} /> Zeichnen
                    </button>
                    {!!editing.has_default_signature && (
                      <button
                        type="button"
                        onClick={removeSig}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-[6px] cursor-pointer"
                      >
                        <Trash2 size={13} /> Entfernen
                      </button>
                    )}
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/png,image/jpeg"
                      className="hidden"
                      onChange={(e) => {
                        uploadSig(e.target.files[0])
                        e.target.value = ''
                      }}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-text-light">
                  Standard-Unterschrift kann nach dem ersten Speichern hinterlegt werden.
                </p>
              )}
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

      {/* Ausserhalb des Formulars, damit die Modal-Buttons das Formular nicht absenden */}
      {!!sigModal && !!editing?.id && (
        <SignatureModal
          existingUrl={editing.has_default_signature ? `/api/shareholders/${editing.id}/signature?t=${sigV}` : null}
          onClose={() => setSigModal(false)}
          onSave={saveDrawnSig}
        />
      )}
    </div>
  )
}
