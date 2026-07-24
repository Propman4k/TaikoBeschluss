import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Building2, User } from 'lucide-react'
import { api, isPersonengesellschaft } from '../api.js'
import { buildGraph } from '../organigram.js'
import CompanyModal from '../components/CompanyModal.jsx'
import ShareholderModal from '../components/ShareholderModal.jsx'

const GAP_X = 40 // Mindestabstand zwischen Knoten einer Ebene
const GAP_Y = 110 // vertikaler Abstand zwischen Ebenen
const fmtShares = (s) => `${String(Number(s)).replace('.', ',')} %`

// Knoten unter dem Schwerpunkt ihrer Nachbarn zentrieren (Barycenter-Passes),
// Ueberlappungen per sequenzieller Platzierung mit Mindestabstand aufloesen.
function computeLayout(layers, edges, dims, containerWidth) {
  const width = (name) => dims.get(name)?.w ?? 200
  const nodeH = Math.max(56, ...[...dims.values()].map((d) => d.h))

  const centers = new Map()
  layers.forEach((layer) => {
    let x = 0
    for (const n of layer) {
      centers.set(n.name, x + width(n.name) / 2)
      x += width(n.name) + GAP_X
    }
  })

  const ownersOf = (name) => edges.filter((e) => e.to === name).map((e) => e.from)
  const childrenOf = (name) => edges.filter((e) => e.from === name).map((e) => e.to)
  const avg = (names) => names.reduce((s, n) => s + centers.get(n), 0) / names.length

  const place = (layer, desired) => {
    const arr = layer
      .map((n) => ({ name: n.name, d: desired.get(n.name) ?? centers.get(n.name) }))
      .sort((a, b) => a.d - b.d)
    let prevRight = null
    for (const it of arr) {
      const w = width(it.name)
      const left = prevRight == null ? it.d - w / 2 : Math.max(it.d - w / 2, prevRight + GAP_X)
      centers.set(it.name, left + w / 2)
      prevRight = left + w
    }
  }

  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < layers.length; i++) {
      const desired = new Map()
      for (const n of layers[i]) {
        const owners = ownersOf(n.name).filter((o) => centers.has(o))
        if (owners.length) desired.set(n.name, avg(owners))
      }
      place(layers[i], desired)
    }
    for (let i = layers.length - 2; i >= 0; i--) {
      const desired = new Map()
      for (const n of layers[i]) {
        const children = childrenOf(n.name).filter((c) => centers.has(c))
        if (children.length) desired.set(n.name, avg(children))
      }
      place(layers[i], desired)
    }
  }

  // Auf Container zentrieren
  let minLeft = Infinity
  let maxRight = -Infinity
  for (const layer of layers)
    for (const n of layer) {
      minLeft = Math.min(minLeft, centers.get(n.name) - width(n.name) / 2)
      maxRight = Math.max(maxRight, centers.get(n.name) + width(n.name) / 2)
    }
  const shift = Math.max((containerWidth - (maxRight - minLeft)) / 2, 0) - minLeft

  const pos = new Map()
  layers.forEach((layer, i) => {
    for (const n of layer) {
      const w = width(n.name)
      pos.set(n.name, {
        x: centers.get(n.name) - w / 2 + shift,
        y: i * (nodeH + GAP_Y),
        w,
        h: dims.get(n.name)?.h ?? nodeH,
      })
    }
  })

  // Kanten: alle Eigentuemer eines Ziels teilen sich eine Sammelschiene in
  // der Luecke direkt am Ziel; Schienen verschiedener Ziele sind versetzt.
  // Ziele koennen auch OBERHALB der Eigentuemer liegen (GbR-Ebene).
  const byTarget = new Map()
  for (const e of edges) {
    if (!pos.has(e.from) || !pos.has(e.to)) continue
    if (!byTarget.has(e.to)) byTarget.set(e.to, [])
    byTarget.get(e.to).push(e)
  }
  const groups = new Map() // Ziel-Ebene + Richtung -> Ziele
  for (const t of byTarget.keys()) {
    const p = pos.get(t)
    const down = pos.get(byTarget.get(t)[0].from).y < p.y
    const key = `${p.y}:${down}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }
  const lines = []
  for (const targets of groups.values()) {
    targets.sort((a, b) => pos.get(a).x - pos.get(b).x)
    targets.forEach((t, idx) => {
      const p = pos.get(t)
      const railOffset = (idx - (targets.length - 1) / 2) * 24
      for (const e of byTarget.get(t)) {
        const f = pos.get(e.from)
        const down = f.y < p.y
        lines.push({
          x1: f.x + f.w / 2,
          y1: down ? f.y + f.h : f.y,
          x2: p.x + p.w / 2,
          y2: down ? p.y : p.y + p.h,
          railY: down ? p.y - GAP_Y / 2 + railOffset : p.y + p.h + GAP_Y / 2 + railOffset,
          shares: e.shares,
        })
      }
    })
  }

  return { pos, lines, height: layers.length * (nodeH + GAP_Y) - GAP_Y }
}

export default function Organigram() {
  const [companies, setCompanies] = useState([])
  const [shareholders, setShareholders] = useState([])
  const [editCompany, setEditCompany] = useState(null)
  const [editShareholder, setEditShareholder] = useState(null)
  const load = () => {
    api.get('/api/companies').then(setCompanies).catch(() => {})
    api.get('/api/shareholders').then(setShareholders).catch(() => {})
  }
  useEffect(() => { load() }, [])

  const { layers, edges } = buildGraph(companies)

  // Klick auf einen Knoten: Bearbeiten-Modal direkt hier oeffnen —
  // verwaltete Gesellschaft -> Gesellschafts-Modal, sonst Gesellschafter-Modal.
  function openEditor(n) {
    const company = n.kind !== 'person' && companies.find((c) => c.name === n.name)
    if (company) return setEditCompany(company)
    const sh = shareholders.find((s) => s.name === n.name)
    if (sh) setEditShareholder(sh)
  }

  const containerRef = useRef(null)
  const nodeRefs = useRef(new Map())
  const [layout, setLayout] = useState(null)

  useLayoutEffect(() => {
    const relayout = () => {
      const root = containerRef.current
      if (!root || !layers.length) return setLayout(null)
      const dims = new Map()
      for (const [name, el] of nodeRefs.current) dims.set(name, { w: el.offsetWidth, h: el.offsetHeight })
      setLayout(computeLayout(layers, edges, dims, root.clientWidth))
    }
    relayout()
    window.addEventListener('resize', relayout)
    return () => window.removeEventListener('resize', relayout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies])

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Organigramm</h1>
      </div>

      {companies.length === 0 && (
        <div className="bg-slate-100 rounded-[10px] px-5 py-4 text-sm text-text-muted text-center">
          Noch keine Gesellschaften angelegt.
        </div>
      )}

      <div
        ref={containerRef}
        className={`relative overflow-x-auto ${layout ? '' : 'invisible'}`}
        style={{ height: layout?.height }}
      >
        <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
          <defs>
            <marker id="og-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
              <path d="M 1.5 1 L 7 4.5 L 1.5 8" fill="none" stroke="#94a3b8" strokeWidth="1.5" />
            </marker>
          </defs>
          {(layout?.lines ?? []).map((l, i) => (
            <path
              key={i}
              d={`M ${l.x1} ${l.y1} L ${l.x1} ${l.railY} L ${l.x2} ${l.railY} L ${l.x2} ${l.y2}`}
              fill="none"
              stroke="#94a3b8"
              strokeWidth="1.5"
              markerEnd="url(#og-arrow)"
            />
          ))}
          {/* Labels auf der Abgangs-Linie des Eigentuemers, ueber allen Linien */}
          {(layout?.lines ?? []).map((l, i) => {
            if (l.shares == null) return null
            const label = fmtShares(l.shares)
            const w = label.length * 6.5 + 14
            const labelY = (l.y1 + l.railY) / 2
            return (
              <g key={`label-${i}`}>
                <rect x={l.x1 - w / 2} y={labelY - 10} width={w} height={20} rx="5" fill="white" stroke="#e2e8f0" />
                <text x={l.x1} y={labelY + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="#475569">
                  {label}
                </text>
              </g>
            )
          })}
        </svg>

        {layers.flat().map((n) => (
          <div
            key={n.name}
            ref={(el) => {
              if (el) nodeRefs.current.set(n.name, el)
              else nodeRefs.current.delete(n.name)
            }}
            onClick={() => openEditor(n)}
            style={layout?.pos.get(n.name) ? { left: layout.pos.get(n.name).x, top: layout.pos.get(n.name).y } : undefined}
            className="absolute flex items-center gap-3 bg-surface rounded-[10px] shadow-card border border-border px-4 py-3 cursor-pointer hover:shadow-elevated hover:border-slate-300 transition-shadow"
          >
            <div
              className={`p-2 rounded-[8px] ${
                n.kind === 'person'
                  ? 'bg-emerald-50 text-emerald-600'
                  : isPersonengesellschaft(companies.find((c) => c.name === n.name)?.legal_form, n.name)
                    ? 'bg-orange-50 text-orange-500'
                    : 'bg-blue-50 text-brand'
              }`}
            >
              {n.kind === 'person' ? <User size={18} /> : <Building2 size={18} />}
            </div>
            <span className="text-sm font-medium whitespace-nowrap">{n.name}</span>
          </div>
        ))}
      </div>

      {!!editCompany && (
        <CompanyModal
          company={editCompany}
          shareholders={shareholders}
          onClose={() => setEditCompany(null)}
          onSaved={() => {
            setEditCompany(null)
            load()
          }}
        />
      )}
      {!!editShareholder && (
        <ShareholderModal
          shareholder={editShareholder}
          onClose={() => setEditShareholder(null)}
          onSaved={() => {
            setEditShareholder(null)
            load()
          }}
          onChanged={load}
        />
      )}
    </div>
  )
}
