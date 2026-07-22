// @vitest-environment jsdom
// Der fragilste Frontend-Teil: greedy A4-Pagination (CONTENT_H = 943px).
import { describe, it, expect, beforeAll } from 'vitest'
import { render } from '@testing-library/react'
import { usePagination, CONTENT_H } from './usePagination.js'

// jsdom layoutet nicht — offsetHeight aus data-h lesen
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return Number(this.dataset.h || 0)
    },
  })
})

function paginate(heights) {
  const blocks = heights.map((h, i) => ({ id: `b${i}`, h }))
  let result
  function Probe() {
    const { measureRef, pages } = usePagination(blocks, [heights.join()])
    result = pages
    return (
      <div ref={measureRef}>
        {blocks.map((b) => (
          <div key={b.id} data-block={b.id} data-h={b.h} />
        ))}
      </div>
    )
  }
  render(<Probe />)
  return result
}

describe('usePagination', () => {
  it('alles passt auf eine Seite', () => {
    expect(paginate([300, 300, 300])).toEqual([['b0', 'b1', 'b2']])
  })

  it('bricht exakt an der Seitengrenze um', () => {
    // 500 + 443 = 943 = CONTENT_H passt genau; der naechste Block muss umbrechen
    expect(paginate([500, CONTENT_H - 500, 10])).toEqual([['b0', 'b1'], ['b2']])
  })

  it('summiert korrekt ueber mehrere Seiten', () => {
    expect(paginate([500, 500, 500])).toEqual([['b0'], ['b1'], ['b2']])
  })

  it('Ueberlaenge-Block bleibt allein auf eigener Seite statt Endlos-Umbruch', () => {
    expect(paginate([2000, 100])).toEqual([['b0'], ['b1']])
  })

  it('keine Bloecke -> eine leere Seite (kein Crash)', () => {
    expect(paginate([])).toEqual([[]])
  })

  it('Null-Hoehen (noch nicht gemessen) bleiben auf einer Seite', () => {
    expect(paginate([0, 0, 0])).toEqual([['b0', 'b1', 'b2']])
  })
})
