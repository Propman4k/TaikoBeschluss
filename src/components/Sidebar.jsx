import { useState } from 'react'
import { FileSignature, LogOut, X, ScrollText, ChevronDown, Network } from 'lucide-react'

const itemBase = 'flex items-center gap-3 px-3 py-2 rounded-[6px] text-sm transition-colors'
const itemIdle = 'text-slate-700 hover:bg-slate-100'
// Gruppen-Kopf: aktiv nur blaue Schrift, kein Hintergrund (Pille gehoert dem Unterpunkt)
const headerActive = 'text-[#0014FF] font-medium'
const headerIdle = 'text-slate-700 hover:bg-slate-100'
const subBase = 'flex items-center gap-2.5 pl-9 pr-3 py-1.5 rounded-[6px] text-[13px] transition-colors'
const subActive = 'bg-blue-50 text-[#0014FF] font-medium'
const subIdle = 'text-slate-600 hover:bg-slate-100'
const badgeCls = (active) =>
  `inline-flex items-center justify-center min-w-[22px] h-[18px] px-1.5 rounded-full text-[10px] font-medium tabular-nums ${
    active ? 'bg-blue-100 text-[#0014FF]' : 'bg-slate-100 text-slate-500'
  }`

function BeschluesseGroup({ route, counts }) {
  const [open, setOpen] = useState(true)
  const groupActive =
    ['', 'entwuerfe', 'abgeschlossen', 'papierkorb'].includes(route) || route.startsWith('beschluss')
  const subs = [
    { href: '#/entwuerfe', key: 'entwuerfe', label: 'Entwürfe', count: counts.entwuerfe },
    { href: '#/', key: '', label: 'Zu unterschreiben', count: counts.offen },
    { href: '#/abgeschlossen', key: 'abgeschlossen', label: 'Abgeschlossen', count: counts.abgeschlossen },
  ]
  return (
    <div>
      <div className={`${itemBase} !pr-1 ${groupActive ? headerActive : headerIdle}`}>
        {/* Klick auf den Gruppen-Namen klappt ein/aus (kein Navigations-Link) */}
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer text-left"
        >
          <ScrollText size={16} strokeWidth={2} />
          <span className="truncate">Beschlüsse</span>
        </button>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Einklappen' : 'Aufklappen'}
          className="p-1 -mr-0.5 rounded-[6px] text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors cursor-pointer"
        >
          <ChevronDown size={15} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
      </div>
      {!!open && (
        <div className="mt-0.5 space-y-0.5">
          {subs.map((s) => {
            const active = route === s.key
            return (
              <a key={s.href} href={s.href} className={`${subBase} ${active ? subActive : subIdle}`}>
                <span className="flex-1">{s.label}</span>
                {s.count > 0 && <span className={badgeCls(active)}>{s.count}</span>}
              </a>
            )
          })}
          <div className="mx-3 my-1.5 border-t border-border" />
          <a href="#/papierkorb" className={`${subBase} ${route === 'papierkorb' ? subActive : subIdle}`}>
            <span className="flex-1">Papierkorb</span>
            {counts.papierkorb > 0 && <span className={badgeCls(route === 'papierkorb')}>{counts.papierkorb}</span>}
          </a>
        </div>
      )}
    </div>
  )
}

function StrukturGroup({ route }) {
  const [open, setOpen] = useState(true)
  const subs = [
    { href: '#/gesellschaften', key: 'gesellschaften', label: 'Gesellschaften' },
    { href: '#/gesellschafter', key: 'gesellschafter', label: 'Gesellschafter' },
    { href: '#/organigramm', key: 'organigramm', label: 'Organigramm' },
  ]
  const groupActive = subs.some((s) => route === s.key)
  return (
    <div>
      <div className={`${itemBase} !pr-1 ${groupActive ? headerActive : headerIdle}`}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer text-left"
        >
          <Network size={16} strokeWidth={2} />
          <span className="truncate">Struktur</span>
        </button>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Einklappen' : 'Aufklappen'}
          className="p-1 -mr-0.5 rounded-[6px] text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors cursor-pointer"
        >
          <ChevronDown size={15} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
      </div>
      {!!open && (
        <div className="mt-0.5 space-y-0.5">
          {subs.map((s) => (
            <a key={s.href} href={s.href} className={`${subBase} ${route === s.key ? subActive : subIdle}`}>
              <span className="flex-1">{s.label}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Sidebar({ route, user, counts = {}, mobileOpen, onClose }) {
  const c = { entwuerfe: 0, offen: 0, abgeschlossen: 0, papierkorb: 0, ...counts }
  const nav = (
    <nav className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 h-16">
        <a href="#/" className="flex items-center gap-2 text-brand font-bold text-lg">
          <FileSignature size={20} strokeWidth={2.5} /> TaikoBeschluss
        </a>
        <button onClick={onClose} className="md:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Schließen">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 px-3 py-2 space-y-0.5">
        <BeschluesseGroup route={route} counts={c} />
        <StrukturGroup route={route} />
      </div>
      <div className="px-3 py-4 border-t border-border">
        <div className="px-3 pb-2 text-xs text-text-muted truncate">{user.name || user.email}</div>
        <a href="/api/auth/logout" className={`${itemBase} ${itemIdle}`}>
          <LogOut size={16} strokeWidth={2} /> Abmelden
        </a>
      </div>
    </nav>
  )

  return (
    <>
      <aside className="hidden md:block w-60 shrink-0 bg-surface border-r border-border sticky top-0 h-screen">
        {nav}
      </aside>
      {!!mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-surface shadow-elevated">{nav}</aside>
        </div>
      )}
    </>
  )
}
