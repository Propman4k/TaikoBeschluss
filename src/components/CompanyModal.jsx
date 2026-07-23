// Gesellschaft anlegen/bearbeiten — genutzt von Companies-Seite und Organigramm.
import { useState } from 'react'
import { api } from '../api.js'
import { useToast } from './Toast.jsx'

export const EMPTY_COMPANY = {
  name: '',
  legal_form: 'gmbh',
  registry_court: '',
  hrb: '',
  managing_directors: '',
  address: '',
  zip: '',
  city: '',
  shareholders: [],
}

const LEGAL_FORMS = [
  { v: 'gmbh', label: 'GmbH' },
  { v: 'ug', label: 'UG (haftungsbeschränkt)' },
  { v: 'ag', label: 'AG' },
  { v: 'gbr', label: 'GbR' },
  { v: 'other', label: 'Sonstige' },
]

export default function CompanyModal({ company, shareholders, onClose, onSaved }) {
  const toast = useToast()
  const [editing, setEditing] = useState(() => ({
    ...company,
    shareholder_ids: (company.shareholders ?? []).map((s) => s.id),
    sharesById: Object.fromEntries((company.shareholders ?? []).map((s) => [s.id, s.shares ?? ''])),
  }))

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
      toast('Gespeichert')
      onSaved()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  function toggleShareholder(id) {
    const ids = editing.shareholder_ids.includes(id)
      ? editing.shareholder_ids.filter((x) => x !== id)
      : [...editing.shareholder_ids, id]
    setEditing({ ...editing, shareholder_ids: ids })
  }

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto"
    >
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
            <span className="text-text-muted">Geschäftsführung</span>
            <input
              className="input-base mt-1"
              value={editing.managing_directors ?? ''}
              onChange={(e) => setEditing({ ...editing, managing_directors: e.target.value })}
              placeholder="z.B. Maik Fahldieck, Jonas Lempa — auch Personen, die sonst nicht erfasst sind"
            />
          </label>
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
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-text-muted hover:text-slate-700 cursor-pointer">
            Abbrechen
          </button>
          <button type="submit" className="px-5 py-2 text-sm font-semibold text-white bg-brand hover:bg-brand-hover rounded-[6px] transition-colors cursor-pointer">
            Speichern
          </button>
        </div>
      </form>
    </div>
  )
}
