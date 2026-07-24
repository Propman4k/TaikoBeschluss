import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'

// Custom-Dropdown im Stil der Header-Buttons (weiss, Chevron, Karte mit Haken).
// options: [{ id, name }] — inklusive einer etwaigen "Alle"/"Ohne"-Option des Aufrufers.
export default function Dropdown({ options, value, onChange, align = 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const current = options.find((o) => String(o.id) === String(value)) ?? options[0]

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-[6px] hover:bg-slate-50 transition-colors cursor-pointer"
      >
        {current.name}
        <ChevronDown size={15} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {!!open && (
        <div
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1.5 z-20 min-w-full w-max max-h-[70vh] overflow-y-auto bg-surface rounded-[10px] shadow-elevated border border-border p-1`}
        >
          {options.map((o) => (
            <button
              key={o.id}
              onClick={() => {
                onChange(String(o.id))
                setOpen(false)
              }}
              className="w-full flex items-center justify-between gap-6 text-left px-3 py-2 text-sm rounded-[6px] hover:bg-blue-50 transition-colors cursor-pointer"
            >
              {o.name}
              {String(o.id) === String(value) && <Check size={14} className="text-brand" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
