// Beteiligungs-Graph aus den Gesellschaften (inkl. shareholders mit shares).
// Knoten werden ueber den Namen zusammengefuehrt: ein Gesellschafter vom Typ
// "company" und eine verwaltete Gesellschaft mit gleichem Namen sind derselbe
// Knoten (z.B. "Fahldieck Beteiligungs GmbH" als Firma UND als Gesellschafter).
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

  // Ebene = laengster Eigentuemer-Pfad; Eigentuemer ohne eigene Eigentuemer oben
  const ownersOf = new Map()
  for (const e of edges) {
    if (!ownersOf.has(e.to)) ownersOf.set(e.to, [])
    ownersOf.get(e.to).push(e.from)
  }
  const memo = new Map()
  const depth = (name, seen = new Set()) => {
    if (memo.has(name)) return memo.get(name)
    if (seen.has(name)) return 0 // ponytail: Zyklus-Schutz, Ringbeteiligungen landen oben
    seen.add(name)
    const owners = ownersOf.get(name) ?? []
    const d = owners.length ? 1 + Math.max(...owners.map((o) => depth(o, seen))) : 0
    memo.set(name, d)
    return d
  }

  const layers = []
  for (const n of nodes.values()) {
    const d = depth(n.name)
    ;(layers[d] ??= []).push(n)
  }
  return { layers, edges }
}
