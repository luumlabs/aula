import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AnimatePresence } from 'motion/react'
import type { DrawItem } from '@shared/schema/common'
import { DrawingCanvas } from './DrawingCanvas'

// La célula de la figura etiquetada: una elipse rellena al 8 %
const CELL = [{ kind: 'ellipse', cx: 300, cy: 200, rx: 272, ry: 176, stroke: 'brown', fill: 'amber', opacity: 0.08, width: 2.5 }] as unknown as DrawItem[]

/** Los <path> con relleno del marcado. */
function filled(html: string): string[] {
  return [...html.matchAll(/<path[^>]*>/g)].map((m) => m[0]).filter((p) => /fill="var\(--viz-amber\)"/.test(p))
}

describe('DrawingCanvas: el relleno respeta su transparencia', () => {
  it('con la entrada saltada por un padre (AnimatePresence initial={false}) y sin trazar todavía, el relleno sigue translúcido', () => {
    const html = renderToStaticMarkup(
      <AnimatePresence initial={false}>
        <DrawingCanvas key="d" items={CELL} W={600} H={400} pixelWidth={600} animate play={false} />
      </AnimatePresence>
    )
    const paths = filled(html)
    expect(paths.length).toBe(1)
    expect(paths[0]).toContain('fill-opacity="0.08"')
  })
  it('al entrar normal, el relleno empieza invisible (opacidad 0) pero ya con su fill-opacity', () => {
    const html = renderToStaticMarkup(<DrawingCanvas items={CELL} W={600} H={400} pixelWidth={600} animate play={false} />)
    const [p] = filled(html)
    expect(p).toContain('fill-opacity="0.08"')
    expect(p).toMatch(/(\sopacity="0"|opacity:\s*0[;"])/)
  })
  it('sin animación (impresión, movimiento reducido) también', () => {
    const [p] = filled(renderToStaticMarkup(<DrawingCanvas items={CELL} W={600} H={400} pixelWidth={600} animate={false} />))
    expect(p).toContain('fill-opacity="0.08"')
  })
})
