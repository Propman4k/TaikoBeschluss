import { useLayoutEffect, useRef, useState } from 'react'

// A4 bei 96dpi (210x297mm), Rand ~24mm — entspricht dem PDF-Layout.
export const PAGE = { w: 794, h: 1123, pad: 90 }
export const CONTENT_H = PAGE.h - 2 * PAGE.pad

// Misst alle Bloecke in einem unsichtbaren Container und verteilt sie auf
// A4-Seiten. Ein Block, der allein hoeher als eine Seite ist, bekommt eine
// eigene Seite (und darf ueberlaufen).
// WICHTIG: Mess- und Render-Container muessen gleiche Breite + Schriftgroesse
// haben, sonst stimmen die Umbrueche nicht (siehe PROJECT_HANDOFF).
export function usePagination(blocks, deps) {
  const measureRef = useRef(null)
  const [pages, setPages] = useState([blocks.map((b) => b.id)])
  useLayoutEffect(() => {
    const el = measureRef.current
    if (!el) return
    const acc = [[]]
    let h = 0
    for (const child of el.children) {
      const bh = child.offsetHeight
      if (h + bh > CONTENT_H && acc.at(-1).length) {
        acc.push([])
        h = 0
      }
      acc.at(-1).push(child.dataset.block)
      h += bh
    }
    setPages(acc)
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return { measureRef, pages }
}
