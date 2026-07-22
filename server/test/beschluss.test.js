// Unit-Tests fuer den rechtsform-abhaengigen Beschluss-Rahmen.
import { describe, it, expect } from 'vitest'
import { buildFrame, normalizeContent, fmtDate } from '../services/beschluss.js'

const company = (overrides = {}) => ({
  name: 'Taikonauten GmbH',
  legal_form: 'gmbh',
  registry_court: 'Amtsgericht Charlottenburg',
  hrb: 'HRB 265001 B',
  city: 'Berlin',
  ...overrides,
})
const shareholders = [{ name: 'Fahldieck Beteiligungs GmbH' }, { name: 'Lempa Beteiligungs GmbH' }]
const resolution = { date: '2026-07-01' }

describe('buildFrame', () => {
  it('GmbH: Stammkapital, Handelsregister, Geschaeftsfuehrung, Genitiv', () => {
    const f = buildFrame(company(), shareholders, resolution)
    expect(f.intro).toContain('eingetragen im Handelsregister des Amtsgerichts Charlottenburg unter HRB 265001 B')
    expect(f.outro).toContain('Das Stammkapital der Gesellschaft ist in voller Höhe vertreten.')
    expect(f.closing).toContain('die Geschäftsführung')
    expect(f.placeDate).toBe('Berlin, 01.07.2026')
    expect(f.shareholderList).toBe('Fahldieck Beteiligungs GmbH, Lempa Beteiligungs GmbH')
  })

  it('AG: Grundkapital und Vorstand', () => {
    const f = buildFrame(company({ legal_form: 'ag' }), shareholders, resolution)
    expect(f.outro).toContain('Grundkapital')
    expect(f.closing).toContain('den Vorstand')
  })

  it('GbR: kein Stammkapital, Gesellschaftsregister, ohne Registerdaten keine Eintragungs-Passage', () => {
    const f = buildFrame(
      company({ legal_form: 'gbr', registry_court: '', hrb: '' }),
      shareholders,
      resolution,
    )
    expect(f.outro).toContain('Sämtliche Gesellschafter sind anwesend oder vertreten.')
    expect(f.intro).not.toContain('eingetragen')
    expect(f.closing).toContain('die geschäftsführenden Gesellschafter')
  })

  it('unbekannte Rechtsform faellt auf GmbH-Bausteine zurueck', () => {
    const f = buildFrame(company({ legal_form: 'kaputt' }), shareholders, resolution)
    expect(f.outro).toContain('Stammkapital')
  })

  it('nur HRB ohne Gericht: Passage ohne "des unter,"-Fragment', () => {
    const f = buildFrame(company({ registry_court: '' }), shareholders, resolution)
    expect(f.intro).toContain('eingetragen im Handelsregister unter HRB 265001 B')
    expect(f.intro).not.toContain('des  unter')
  })
})

describe('normalizeContent', () => {
  it('erzwingt Leerzeilen vor nummerierten Punkten, idempotent', () => {
    const once = normalizeContent('1. Erstens.\n2. Zweitens.')
    expect(once).toBe('1. Erstens.\n\n2. Zweitens.')
    expect(normalizeContent(once)).toBe(once)
  })

  it('entfernt doppelt-escapte Umbrueche und CR', () => {
    expect(normalizeContent('a\\nb\r\n')).toBe('a\nb')
  })
})

describe('fmtDate', () => {
  it('formatiert ISO zu deutsch, leer bleibt leer', () => {
    expect(fmtDate('2026-07-01')).toBe('01.07.2026')
    expect(fmtDate('')).toBe('')
  })
})
