import { useEffect, useState } from 'react'
import { Plus, Check, X, Pencil, Sparkles } from 'lucide-react'
import { api } from '../api.js'
import { useToast } from '../components/Toast.jsx'

// Einstellungen: Pflege der Beschluss-Typen (KI waehlt nur aus dieser Liste;
// neue Typen legt ausschliesslich der Nutzer an) + einmaliger Typ-Backfill.
export default function Settings() {
  const [types, setTypes] = useState(null)
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState(null) // { id, name }
  const [backfilling, setBackfilling] = useState(false)
  const toast = useToast()

  useEffect(() => {
    api.get('/api/resolution-types').then(setTypes).catch((e) => toast(e.message, 'error'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function add(e) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    try {
      setTypes(await api.post('/api/resolution-types', { name }))
      setNewName('')
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function patch(id, fields) {
    try {
      setTypes(await api.patch(`/api/resolution-types/${id}`, fields))
      setEditing(null)
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function backfill() {
    setBackfilling(true)
    try {
      const r = await api.post('/api/resolution-types/backfill')
      setTypes(await api.get('/api/resolution-types'))
      toast(
        r.total === 0
          ? 'Alle Beschlüsse sind bereits typisiert.'
          : `${r.done} von ${r.total} Beschlüssen klassifiziert${r.failed ? `, ${r.failed} fehlgeschlagen` : ''}.`,
      )
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBackfilling(false)
    }
  }

  if (!types) return null

  return (
    <div className="w-full max-w-3xl">
      <h1 className="text-xl font-bold mb-6">Einstellungen</h1>

      <div className="bg-surface rounded-[10px] shadow-card border border-border">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-sm">Beschluss-Typen</div>
            <div className="text-xs text-text-muted mt-0.5">
              Die KI ordnet jeden Beschluss einem Typ aus dieser Liste zu. Neue Typen legst nur du an —
              die KI schlägt sie höchstens im Chat vor.
            </div>
          </div>
          <button
            onClick={backfill}
            disabled={backfilling}
            className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-[6px] hover:bg-slate-50 disabled:opacity-50 transition-colors cursor-pointer"
            title="Alle Beschlüsse ohne Typ einmalig per KI klassifizieren"
          >
            <Sparkles size={13} /> {backfilling ? 'Klassifiziert …' : 'Bestand klassifizieren'}
          </button>
        </div>

        <div className="divide-y divide-border">
          {types.map((t) => (
            <div key={t.id} className={`flex items-center gap-3 px-5 py-2.5 ${t.active ? '' : 'opacity-50'}`}>
              {editing?.id === t.id ? (
                <form
                  className="flex-1 flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    patch(t.id, { name: editing.name })
                  }}
                >
                  <input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="input-base !text-text flex-1"
                    autoFocus
                  />
                  <button type="submit" className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-[6px] cursor-pointer" aria-label="Speichern">
                    <Check size={15} />
                  </button>
                  <button type="button" onClick={() => setEditing(null)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-[6px] cursor-pointer" aria-label="Abbrechen">
                    <X size={15} />
                  </button>
                </form>
              ) : (
                <>
                  <span className="flex-1 text-sm">{t.name}</span>
                  <span className="text-xs text-text-light tabular-nums" title="Anzahl Beschlüsse mit diesem Typ">
                    {t.used > 0 ? `${t.used}×` : ''}
                  </span>
                  <button
                    onClick={() => setEditing({ id: t.id, name: t.name })}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-[6px] cursor-pointer"
                    aria-label="Umbenennen"
                    title="Umbenennen"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => patch(t.id, { active: !t.active })}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors ${
                      t.active ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                    title={t.active ? 'Deaktivieren (KI wählt ihn nicht mehr)' : 'Aktivieren'}
                  >
                    {t.active ? 'aktiv' : 'inaktiv'}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        <form onSubmit={add} className="px-5 py-3 border-t border-border flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Neuen Typ anlegen …"
            className="input-base !text-text flex-1"
          />
          <button
            type="submit"
            disabled={!newName.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-brand hover:bg-brand-hover disabled:bg-brand/40 rounded-[6px] transition-colors cursor-pointer"
          >
            <Plus size={14} /> Anlegen
          </button>
        </form>
      </div>
    </div>
  )
}
