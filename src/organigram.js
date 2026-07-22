// Beteiligungs-Graph aus den Gesellschaften (inkl. shareholders mit shares).
// Knoten werden ueber den Namen zusammengefuehrt: ein Gesellschafter vom Typ
// "company" und eine verwaltete Gesellschaft mit gleichem Namen sind derselbe
// Knoten (z.B. "Fahldieck Beteiligungs GmbH" als Firma UND als Gesellschafter).
//
// Ebenen-Logik (Muster aus dem User-Entwurf): Personen sind die Anker-Ebene
// in der Mitte. Gesellschaften ohne eigene Beteiligungen, die nur Personen
// gehoeren (z.B. eine GbR), kommen als eigene Ebene DARUEBER — das haelt den
// Beteiligungsbaum nach unten frei von Querlinien.
export function buildGraph(companies) {
  const nodes = new Map() // name -> {name, kind}
  const edges = [] // {from: Eigentuemer, to: Gesellschaft, shares}
  const add = (name, kind) => {
    if (!nodes.has(name)) nodes.set(name, { name, kind })
  }
  for (const c of companies) add(c.name, 'company')
  for (const c of companies) {
    for (const s of c.shareholders ?? []) {
      add(s.name, s.type === 'person' ? 'person' : 'company')
      edges.push({ from: s.name, to: c.name, shares: s.shares ?? null })
    }
  }

  const ownersOf = new Map()
  const childrenOf = new Map()
  for (const e of edges) {
    if (!ownersOf.has(e.to)) ownersOf.set(e.to, [])
    ownersOf.get(e.to).push(e.from)
    if (!childrenOf.has(e.from)) childrenOf.set(e.from, [])
    childrenOf.get(e.from).push(e.to)
  }
  const owners = (n) => ownersOf.get(n) ?? []
  const children = (n) => childrenOf.get(n) ?? []

  const persons = [...nodes.values()].filter((n) => n.kind === 'person')
  const comps = [...nodes.values()].filter((n) => n.kind === 'company')

  // Nach oben: keine eigenen Beteiligungen, gehoert ausschliesslich Personen
  const aboveNames = new Set(
    comps
      .filter(
        (n) =>
          !children(n.name).length &&
          owners(n.name).length > 0 &&
          owners(n.name).every((o) => nodes.get(o)?.kind === 'person'),
      )
      .map((n) => n.name),
  )

  // Tiefe unterhalb der Anker: Personen, Oben-Ebene und Gesellschaften ohne
  // erfasste Eigentuemer zaehlen als 0.
  const memo = new Map()
  const depthBelow = (name, seen = new Set()) => {
    if (memo.has(name)) return memo.get(name)
    if (seen.has(name)) return 1 // ponytail: Zyklus-Schutz bei Ringbeteiligungen
    seen.add(name)
    const d =
      1 +
      Math.max(
        0,
        ...owners(name).map((o) => {
          const on = nodes.get(o)
          if (!on || on.kind === 'person' || aboveNames.has(o) || !owners(o).length) return 0
          return depthBelow(o, seen)
        }),
      )
    memo.set(name, d)
    return d
  }

  const layers = []
  const above = comps.filter((n) => aboveNames.has(n.name))
  if (above.length) layers.push(above)
  // Anker: Personen + Gesellschaften ohne erfasste Eigentuemer (externe Halter)
  const anchors = [...persons, ...comps.filter((n) => !aboveNames.has(n.name) && !owners(n.name).length)]
  if (anchors.length) layers.push(anchors)
  const byDepth = []
  for (const n of comps) {
    if (aboveNames.has(n.name) || !owners(n.name).length) continue
    const d = depthBelow(n.name)
    ;(byDepth[d - 1] ??= []).push(n)
  }
  for (const arr of byDepth) if (arr) layers.push(arr)
  return { layers, edges }
}
