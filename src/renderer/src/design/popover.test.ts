import { describe, expect, it } from 'vitest'
import { placePopover, placeTooltip } from './popover'

const vp = { width: 1000, height: 680 }

describe('placePopover', () => {
  it('abre debajo del botón si cabe', () => {
    const p = placePopover({ top: 100, bottom: 136, left: 40, right: 300 }, vp, { width: 260, height: 300 })
    expect(p.above).toBe(false)
    expect(p.top).toBe(142)
    // la estimación no es el alto máximo: puede crecer hasta el borde (menos el margen)
    expect(p.maxHeight).toBe(680 - 136 - 6 - 8)
    expect(p.left).toBe(40)
  })

  it('cerca del borde inferior abre hacia arriba y nunca se sale de la ventana', () => {
    // el selector de idioma de Ajustes, pegado abajo (antes se abría en y = 898 en una ventana de 900)
    const p = placePopover({ top: 620, bottom: 656, left: 40, right: 300 }, vp, { width: 260, height: 320 })
    expect(p.above).toBe(true)
    expect(p.bottom).toBe(680 - 620 + 6)
    expect(p.maxHeight).toBe(620 - 6 - 8)
    expect(680 - (p.bottom ?? 0) - p.maxHeight).toBeGreaterThanOrEqual(8)
  })

  it('si no cabe en ningún lado, se queda donde hay más sitio y se recorta con desplazamiento', () => {
    const p = placePopover({ top: 300, bottom: 336, left: 40, right: 300 }, vp, { width: 260, height: 900 })
    expect(p.above).toBe(false)
    expect((p.top ?? 0) + p.maxHeight).toBeLessThanOrEqual(680 - 8)
  })

  it('alineado a la derecha y sin salirse por los lados', () => {
    const end = placePopover({ top: 10, bottom: 40, left: 900, right: 990 }, vp, { width: 220, height: 100 }, { align: 'end' })
    expect(end.left).toBe(990 - 220)
    const start = placePopover({ top: 10, bottom: 40, left: 900, right: 990 }, vp, { width: 220, height: 100 })
    expect(start.left + 220).toBeLessThanOrEqual(1000 - 8)
  })

  it('A4-P1-3: un menú de opciones de dos líneas no se recorta a lo estimado (36 px por opción)', () => {
    // «Explore ▾» de la lección: 3 opciones estimadas en 120 px, que miden 272; debajo quedan ~650 px
    const p = placePopover({ top: 40, bottom: 68, left: 600, right: 700 }, { width: 1440, height: 900 }, { width: 240, height: 120 }, { align: 'end' })
    expect(p.above).toBe(false)
    expect(p.maxHeight).toBeGreaterThanOrEqual(272)
  })

  it('un tope propio (las listas de Select) sí se respeta', () => {
    const p = placePopover({ top: 100, bottom: 136, left: 40, right: 300 }, vp, { width: 260, height: 900 }, { maxHeight: 320 })
    expect(p.maxHeight).toBe(320)
  })
})

describe('placeTooltip', () => {
  const box = { width: 220, height: 34 }
  it('encima y centrada cuando cabe', () => {
    const p = placeTooltip({ top: 300, bottom: 330, left: 400, right: 480 }, vp, box, 'top')
    expect(p).toEqual({ left: 440 - 110, top: 300 - 8 - 34, side: 'top' })
  })

  it('A4-P2-9: pegada al borde derecho no se sale ni se estrecha: se desplaza hacia dentro', () => {
    const p = placeTooltip({ top: 40, bottom: 68, left: 930, right: 990 }, vp, box, 'bottom')
    expect(p.left + box.width).toBeLessThanOrEqual(1000 - 8)
    expect(p.top).toBe(68 + 8)
  })

  it('si no cabe en su lado, pasa al contrario', () => {
    expect(placeTooltip({ top: 4, bottom: 30, left: 400, right: 480 }, vp, box, 'top').side).toBe('bottom')
    expect(placeTooltip({ top: 300, bottom: 330, left: 900, right: 990 }, vp, box, 'right').side).toBe('left')
  })
})
