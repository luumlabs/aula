// El lienzo del dibujo con lo nuevo: rayado con su patrón, papel, movimiento (un transform por elemento), etapas, lo
// destacado de un paso y las partes con nombre para «marcar y preguntar».
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import '@renderer/i18n'
import type { DrawItem } from '@shared/schema/common'
import { DrawingCanvas } from './DrawingCanvas'
import { PAPER, vizColor } from './colors'
import { handPath } from '../lib/hand'
import DrawingBlock from '../DrawingBlock'
import { makeBlockContext } from '../../types'
import type { BlockOf } from '@shared/schema/blocks'

const HATCH: DrawItem[] = [{ kind: 'rect', x: 10, y: 10, w: 80, h: 20, fill: 'gray', fillStyle: 'hatch' }]
const canvas = (items: DrawItem[], more: Partial<Parameters<typeof DrawingCanvas>[0]> = {}): string =>
  renderToStaticMarkup(<DrawingCanvas items={items} W={400} H={300} pixelWidth={600} animate={false} {...more} />)

describe('lienzo del dibujo: lo nuevo', () => {
  it('el rayado usa su patrón (ids distintos en dos lienzos) y lleva papel debajo', () => {
    const html = renderToStaticMarkup(<div><DrawingCanvas items={HATCH} W={400} H={300} pixelWidth={600} animate={false} /><DrawingCanvas items={HATCH} W={400} H={300} pixelWidth={600} animate={false} /></div>)
    const ids = [...html.matchAll(/<pattern id="([^"]+)"/g)].map((m) => m[1])
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
    for (const id of ids) expect(html).toContain(`fill="url(#${id})"`)
    expect(html).toContain(`fill="${PAPER}"`)
  })

  it('«paper» es el papel; «white» sigue siendo tinta como siempre', () => {
    expect(vizColor('paper')).toBe(PAPER)
    expect(vizColor('papel')).toBe(PAPER)
    expect(vizColor('white')).toBe('var(--text)')
  })

  it('un fotograma desplaza y gira cada elemento con su transform', () => {
    const html = canvas([{ kind: 'circle', cx: 10, cy: 10, r: 5 }, { kind: 'dot', cx: 50, cy: 50 }], { frame: [{ dx: 12, dy: -3, deg: 30, px: 10, py: 10 }, undefined] })
    expect(html).toContain('transform="translate(12.00 -3.00) rotate(-30.00 10.00 10.00)"')
    expect(html.match(/transform="translate/g)).toHaveLength(1)
  })

  it('las etapas por encima de `show` no se pintan', () => {
    const items: DrawItem[] = [{ kind: 'circle', cx: 10, cy: 10, r: 5 }, { kind: 'circle', cx: 90, cy: 90, r: 7, stage: 2 }]
    expect(canvas(items, { show: 1 })).not.toContain('M83 90')
    expect(canvas(items)).toContain('M83 90')
  })

  it('en un paso, lo no destacado se atenúa y el relleno conserva su transparencia', () => {
    const items: DrawItem[] = [{ kind: 'rect', id: 'a', x: 0, y: 0, w: 10, h: 10, fill: 'amber', opacity: 0.08 }, { kind: 'rect', id: 'b', x: 20, y: 0, w: 10, h: 10 }]
    const html = canvas(items, { focus: new Set([1]) })
    expect(html).toMatch(/style="opacity:0.3[^"]*"/)
    expect(html).toContain('fill-opacity="0.08"')
  })

  it('un relleno de papel tapa lo que queda detrás (opaco), sin pedir opacidad', () => {
    const html = canvas([{ kind: 'line', x1: 0, y1: 200, x2: 300, y2: 200 }, { kind: 'circle', cx: 100, cy: 200, r: 5, fill: 'paper', stroke: 'ink' }])
    expect(html).toContain(`fill="${PAPER}" fill-opacity="1"`)
  })

  it('rodear algo que aún no se ve no atenúa el resto', () => {
    const items: DrawItem[] = [{ kind: 'circle', id: 'a', cx: 10, cy: 10, r: 5 }, { kind: 'dot', id: 'P', cx: 50, cy: 50, stage: 2 }]
    expect(canvas(items, { show: 1, focus: new Set([1]) })).not.toMatch(/opacity:0\.3/)
    expect(canvas(items, { show: 2, focus: new Set([1]) })).toMatch(/opacity:0\.3/)
  })

  it('con nombre, lo dibujado es una imagen dentro del lienzo de «marcar y preguntar» (lo que se pone en él queda fuera)', () => {
    const items: DrawItem[] = [{ kind: 'circle', cx: 10, cy: 10, r: 5 }]
    const html = canvas(items, { label: 'Ángulo inscrito' })
    expect(html).toMatch(/^<div [^>]*data-ask-canvas=""[^>]*><div role="img" aria-label="Ángulo inscrito"/)
    expect(html.match(/role="img"/g)).toHaveLength(1)
    const plain = canvas(items)
    expect(plain).not.toContain('role="img"')
    expect(plain).not.toContain('data-ask-canvas')
  })

  it('las partes con nombre llevan data-ask-part y data-ask-label (solo si se piden)', () => {
    const items: DrawItem[] = [
      { kind: 'arrow', id: 'N', name: 'fuerza normal', x1: 0, y1: 0, x2: 10, y2: 0 },
      { kind: 'circle', cx: 50, cy: 50, r: 5, label: 'Núcleo' },
      { kind: 'text', x: 5, y: 5, text: 'nota' },
      { kind: 'line', x1: 0, y1: 50, x2: 10, y2: 50 }
    ]
    const html = canvas(items, { askParts: true })
    expect(html).toContain('data-ask-part="N" data-ask-label="fuerza normal"')
    expect(html).toContain('data-ask-part="item-1" data-ask-label="Núcleo"')
    expect(html).toContain('data-ask-part="item-2" data-ask-label="nota"')
    expect(html.match(/data-ask-part=/g)).toHaveLength(3)
    expect(canvas(items)).not.toContain('data-ask-part')
  })
})

describe('línea a mano', () => {
  const pts: Array<[number, number]> = [[0, 0], [100, 0], [100, 60], [0, 60]]
  it('es determinista, cierra las formas cerradas y no se aparta más de lo debido', () => {
    expect(handPath(pts, true, 7, 1.4)).toBe(handPath(pts, true, 7, 1.4))
    expect(handPath(pts, true, 7, 1.4)).not.toBe(handPath(pts, true, 8, 1.4))
    expect(handPath(pts, true, 7, 1.4).endsWith('Z')).toBe(true)
    const open = handPath([[0, 0], [200, 0]], false, 3, 1.5)
    const ys = (open.match(/-?\d+(\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 1)
    for (const y of ys) expect(Math.abs(y)).toBeLessThan(2.5)
  })
})

describe('bloque de dibujo', () => {
  const block = (more: Partial<BlockOf<'drawing'>>): BlockOf<'drawing'> => ({ id: 'd', type: 'drawing', width: 400, height: 300, items: [{ kind: 'dot', id: 'p', cx: 10, cy: 10, motion: { dx: 'v' } }], ...more })
  const params = [{ name: 'v', label: 'Velocidad', min: 0, max: 10, step: 1, value: 0 }]
  it('un dibujo que se mueve trae sus deslizadores; con pasos, sus controles', () => {
    const html = renderToStaticMarkup(<DrawingBlock block={block({ params, steps: [{ md: 'uno' }, { md: 'dos' }] })} ctx={makeBlockContext(null, 'es')} />)
    expect(html).toContain('Velocidad')
    expect(html).toContain('type="range"')
    expect(html).toContain('role="slider"')
  })
  it('en papel: la imagen en reposo, sin controles y con los pasos en lista', () => {
    const html = renderToStaticMarkup(<DrawingBlock block={block({ params, steps: [{ title: 'Uno', md: 'primero' }, { md: 'segundo' }] })} ctx={makeBlockContext(null, 'es', { mode: 'print' })} />)
    expect(html).not.toContain('type="range"')
    expect(html).not.toContain('role="slider"')
    expect(html).toContain('primero')
    expect(html).toContain('segundo')
  })
  it('la figura no es una imagen: la imagen es lo dibujado, para que «Marcar» y la zona de marcar no queden dentro', () => {
    const html = renderToStaticMarkup(<DrawingBlock block={block({ title: 'Coche' })} ctx={makeBlockContext(null, 'es')} />)
    expect(html).toContain('<figure')
    expect(html).not.toContain('role="img"')
  })
  it('un dibujo de siempre no trae controles', () => {
    const html = renderToStaticMarkup(<DrawingBlock block={{ id: 'd', type: 'drawing', width: 400, height: 300, items: [{ kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }] }} ctx={makeBlockContext(null, 'es')} />)
    expect(html).not.toContain('role="group"')
  })
})
