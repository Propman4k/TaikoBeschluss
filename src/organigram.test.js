// Graph-Aufbau fuers Organigramm: Merge per Name, Ebenen, Anteile, Zyklus-Schutz.
import { describe, it, expect } from 'vitest'
import { buildGraph } from './organigram.js'

const sh = (name, type, shares = null) => ({ name, type, shares })

describe('buildGraph', () => {
  it('mehrstufige Beteiligung: Person -> Holding -> Firma, Anteile an den Kanten', () => {
    const { layers, edges } = buildGraph([
      { name: 'Holding GmbH', shareholders: [sh('Maik', 'person', 100)] },
      { name: 'Operativ GmbH', shareholders: [sh('Holding GmbH', 'company', 60), sh('Extern GmbH', 'company', 40)] },
    ])
    expect(layers[0].map((n) => n.name).sort()).toEqual(['Extern GmbH', 'Maik'])
    expect(layers[1].map((n) => n.name)).toEqual(['Holding GmbH'])
    expect(layers[2].map((n) => n.name)).toEqual(['Operativ GmbH'])
    expect(edges).toContainEqual({ from: 'Holding GmbH', to: 'Operativ GmbH', shares: 60 })
  })

  it('Gesellschafter und verwaltete Firma mit gleichem Namen sind EIN Knoten', () => {
    const { layers } = buildGraph([
      { name: 'Holding GmbH', shareholders: [sh('Maik', 'person')] },
      { name: 'Operativ GmbH', shareholders: [sh('Holding GmbH', 'company')] },
    ])
    const all = layers.flat().map((n) => n.name)
    expect(all.filter((n) => n === 'Holding GmbH')).toHaveLength(1)
  })

  it('Personen sind kind=person, Zyklus haengt nicht', () => {
    const { layers } = buildGraph([
      { name: 'A GmbH', shareholders: [sh('B GmbH', 'company'), sh('Pia', 'person')] },
      { name: 'B GmbH', shareholders: [sh('A GmbH', 'company')] },
    ])
    const pia = layers.flat().find((n) => n.name === 'Pia')
    expect(pia.kind).toBe('person')
    expect(layers.flat()).toHaveLength(3) // terminiert trotz Ring A<->B
  })

  it('GbR ohne eigene Beteiligungen liegt UEBER der Personen-Ebene', () => {
    const { layers } = buildGraph([
      { name: 'LeFaFa GbR', shareholders: [sh('Maik', 'person', 59), sh('Denise', 'person', 1)] },
      { name: 'Holding GmbH', shareholders: [sh('Maik', 'person', 100)] },
      { name: 'Operativ GmbH', shareholders: [sh('Holding GmbH', 'company', 60)] },
    ])
    expect(layers[0].map((n) => n.name)).toEqual(['LeFaFa GbR'])
    expect(layers[1].map((n) => n.name).sort()).toEqual(['Denise', 'Maik'])
    expect(layers[2].map((n) => n.name)).toEqual(['Holding GmbH'])
    expect(layers[3].map((n) => n.name)).toEqual(['Operativ GmbH'])
  })

  it('leere Eingabe -> keine Ebenen', () => {
    expect(buildGraph([]).layers).toEqual([])
  })
})
