import { useEffect, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { api, fmtDate } from '../api.js'
import { useToast } from '../components/Toast.jsx'

// Spaltenraster wie in Resolutions.jsx, plus "Geloescht am" und Aktions-Spalte
const GRID =
  'grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_190px] items-center gap-4'

export default function Trash() {
  const [items, setItems] = useState(null)
  const [purging, setPurging] = useState(null) // { r, step: 1|2 }
  const toast = useToast()

  const load = () => api.get('/api/resolutions/trash').then(setItems).catch(() => {})
  useEffect(() => { load() }, [])

  async function restore(r) {
    try {
      await api.post(`/api/resolutions/${r.id}/restore`)
      load()
      toast('Wiederhergestellt')
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function confirmPurge() {
    try {
      await api.del(`/api/resolutions/${purging.r.id}/permanent`)
      setPurging(null)
      load()
      toast('Endgültig gelöscht')
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  if (!items) return null

  return (
    <div className="w-full">
      <h1 className="text-xl font-bold mb-2">Papierkorb</h1>
      <p className="text-sm text-text-muted mb-6">
        Gelöschte Beschlüsse. Wiederherstellen oder endgültig entfernen.
      </p>

      {items.length === 0 ? (
        <div className="bg-surface rounded-[10px] shadow-card border border-border px-6 py-10 text-sm text-text-muted text-center">
          Der Papierkorb ist leer.
        </div>
      ) : (
        <div>
          <div className="space-y-2">
            {items.map((r) => (
              <div key={r.id} className={`${GRID} bg-surface rounded-[10px] shadow-card border border-border px-5 py-4`}>
                <div className="text-sm font-medium truncate">{r.title || 'Ohne Titel'}</div>
                <div className="text-sm text-text-muted truncate">{r.company_name}</div>
                <div className="text-sm text-text-muted">{fmtDate((r.created_at || '').slice(0, 10))}</div>
                <div className="text-sm text-text-muted">{fmtDate((r.deleted_at || '').slice(0, 10))}</div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => restore(r)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-[6px] hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <RotateCcw size={14} /> Wiederherstellen
                  </button>
                  <button
                    onClick={() => setPurging({ r, step: 1 })}
                    className="p-2 rounded-[6px] text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer"
                    aria-label="Endgültig löschen"
                    title="Endgültig löschen"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!!purging && (
        <div
          onClick={(e) => e.target === e.currentTarget && setPurging(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
        >
          <div className="bg-surface rounded-2xl overflow-hidden shadow-elevated animate-modal-in border border-border w-full max-w-md">
            <div className="px-6 py-4 border-b border-border bg-slate-50 font-semibold">
              {purging.step === 1 ? 'Endgültig löschen?' : 'Letzte Warnung'}
            </div>
            <div className="p-6 text-sm text-text-muted">
              {purging.step === 1 ? (
                <>„{purging.r.title || 'Ohne Titel'}" ({purging.r.number}) wird unwiderruflich gelöscht — inklusive aller Unterschriften.</>
              ) : (
                <>Diese Aktion kann <span className="font-semibold text-red-600">nicht rückgängig</span> gemacht werden. Endgültig löschen?</>
              )}
            </div>
            <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
              <button onClick={() => setPurging(null)} className="px-4 py-2 text-sm text-text-muted hover:text-slate-700 cursor-pointer">
                Abbrechen
              </button>
              {purging.step === 1 ? (
                <button
                  onClick={() => setPurging({ ...purging, step: 2 })}
                  className="px-5 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-[6px] transition-colors cursor-pointer"
                >
                  Weiter
                </button>
              ) : (
                <button
                  onClick={confirmPurge}
                  className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-[6px] transition-colors cursor-pointer"
                >
                  <Trash2 size={15} /> Endgültig löschen
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
