import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Building2, User } from 'lucide-react'
import { api } from '../api.js'
import { buildGraph } from '../organigram.js'

// Anteil huebsch formatieren: 33.33 -> "33,33 %", 60 -> "60 %"
const fmtShares = (s) => `${String(Number(s)).replace('.', ',')} %`

export default function Organigram() {
  const [companies, setCompanies] = useState([])
  useEffect(() => {
    api.get('/api/companies').then(setCompanies).catch(() => {})
  }, [])

  const { layers, edges } = buildGraph(companies)

  // Linien: Knoten-Positionen nach dem Render messen und als SVG-Pfade legen
  const containerRef = useRef(null)
  const nodeRefs = useRef(new Map())
  const [lines, setLines] = useState([])
  useLayoutEffect(() => {
    const measure = () => {
      const root = containerRef.current
      if (!root) return
      const rootBox = root.getBoundingClientRect()
      setLines(
        edges.flatMap((e) => {
          const from = nodeRefs.current.get(e.from)
          const to = nodeRefs.current.get(e.to)
          if (!from || !to) return []
          const a = from.getBoundingClientRect()
          const b = to.getBoundingClientRect()
          return [
            {
              ...e,
              x1: a.left + a.width / 2 - rootBox.left,
              y1: a.bottom - rootBox.top,
              x2: b.left + b.width / 2 - rootBox.left,
              y2: b.top - rootBox.top,
            },
          ]
        }),
      )
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies])

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Organigramm</h1>
      </div>

      {companies.length === 0 && (
        <div className="bg-surface rounded-[10px] shadow-card border border-border px-6 py-10 text-sm text-text-muted text-center">
          Noch keine Gesellschaften angelegt.
        </div>
      )}

      <div ref={containerRef} className="relative overflow-x-auto py-2">
        <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
          {(() => {
            // Kanten zwischen denselben Ebenen auf eigene horizontale Spuren
            // verteilen, damit Linien und Labels sich nicht ueberlagern.
            const groups = new Map()
            for (const l of lines) {
              const key = `${Math.round(l.y1)}:${Math.round(l.y2)}`
              if (!groups.has(key)) groups.set(key, [])
              groups.get(key).push(l)
            }
            const withRail = []
            for (const group of groups.values()) {
              group.sort((a, b) => (a.x1 + a.x2) / 2 - (b.x1 + b.x2) / 2)
              group.forEach((l, idx) => {
                const midY = (l.y1 + l.y2) / 2 + (idx - (group.length - 1) / 2) * 18
                withRail.push({ ...l, midY })
              })
            }
            return (
              <>
                {withRail.map((l, i) => (
                  <path
                    key={i}
                    d={`M ${l.x1} ${l.y1} L ${l.x1} ${l.midY} L ${l.x2} ${l.midY} L ${l.x2} ${l.y2}`}
                    fill="none"
                    stroke="#94a3b8"
                    strokeWidth="1.5"
                  />
                ))}
                {/* Labels in eigenem Durchgang, damit sie ueber ALLEN Linien liegen */}
                {withRail.map((l, i) => {
                  if (l.shares == null) return null
                  const label = fmtShares(l.shares)
                  const labelX = (l.x1 + l.x2) / 2
                  const labelW = label.length * 6.5 + 14
                  return (
                    <g key={`label-${i}`}>
                      <rect x={labelX - labelW / 2} y={l.midY - 10} width={labelW} height={20} rx="5" fill="white" stroke="#e2e8f0" />
                      <text x={labelX} y={l.midY + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="#475569">
                        {label}
                      </text>
                    </g>
                  )
                })}
              </>
            )
          })()}
        </svg>

        {layers.map((layer, i) => (
          <div key={i} className={`relative flex flex-wrap justify-evenly gap-6 ${i < layers.length - 1 ? 'mb-24' : ''}`}>
            {layer.map((n) => (
              <div
                key={n.name}
                ref={(el) => {
                  if (el) nodeRefs.current.set(n.name, el)
                  else nodeRefs.current.delete(n.name)
                }}
                className="flex items-center gap-3 bg-surface rounded-[10px] shadow-card border border-border px-4 py-3"
              >
                <div
                  className={`p-2 rounded-[8px] ${
                    n.kind === 'person' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-brand'
                  }`}
                >
                  {n.kind === 'person' ? <User size={18} /> : <Building2 size={18} />}
                </div>
                <span className="text-sm font-medium whitespace-nowrap">{n.name}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
