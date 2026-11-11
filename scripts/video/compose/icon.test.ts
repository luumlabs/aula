import { describe, expect, it } from 'vitest'
import { ICON, STROKES, extractInk, extractSun, pathLength, type Px } from './icon.ts'

/** Papel crema; con sol: medio disco ámbar (centro (20, 20), radio 10) y un pincelazo de horizonte encima (filas 19–22). */
function scene(sun: boolean): Px {
  const w = 40
  const h = 30
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let c = [0xf6, 0xf0, 0xe4]
      if (sun && y < 21 && Math.hypot(x - 20, y - 20) <= 10) c = [0xe9, 0x9e, 0x3e]
      if (y >= 19 && y <= 22) c = [0xb9, 0x59, 0x33]
      data.set([...c, 255], i)
    }
  return { width: w, height: h, data }
}

describe('icono pintado', () => {
  it('el sol se recorta con su color y alfa, y la máscara corta en el horizonte pintado', () => {
    const { sprite, mask } = extractSun(scene(true), scene(false))
    const at = (p: Px, x: number, y: number) => Array.from(p.data.slice((y * p.width + x) * 4, (y * p.width + x) * 4 + 4))
    expect(at(sprite, 20, 15)).toEqual([0xe9, 0x9e, 0x3e, 255])
    expect(at(sprite, 2, 2)[3]).toBe(0)
    // el horizonte no es sol (el pincelazo es igual con sol y sin él)
    expect(at(sprite, 20, 20)[3]).toBe(0)
    // en las columnas del sol se ve hasta donde empieza el horizonte (fila 19) y nada desde ahí
    expect(at(mask, 20, 18)[3]).toBe(255)
    expect(at(mask, 20, 19)[3]).toBe(0)
    // fuera del sol no se recorta nada
    expect(at(mask, 2, 25)[3]).toBe(255)
  })
  it('con el suelo a tinta, la máscara corta en la línea oscura aunque debajo del sol haya aguada', () => {
    const inked = (sun: boolean): Px => {
      const p = scene(sun)
      for (let y = 0; y < p.height; y++)
        for (let x = 0; x < p.width; x++) {
          const i = (y * p.width + x) * 4
          // una aguada que oscurece el papel hacia abajo (más de 12 niveles) y la línea de tinta en las filas 19–22
          if (y >= 19 && y <= 22) p.data.set([0x2c, 0x28, 0x23, 255], i)
          else if (!(sun && y < 21 && Math.hypot(x - 20, y - 20) <= 10)) p.data.set([0xf6 - y, 0xe6 - y * 2, 0xc4 - y * 3, 255], i)
        }
      return p
    }
    const { mask } = extractSun(inked(true), inked(false), 0x3e, true)
    const alpha = (x: number, y: number) => mask.data[(y * mask.width + x) * 4 + 3]
    expect(alpha(20, 18)).toBe(255)
    expect(alpha(20, 19)).toBe(0)
  })
  it('la puerta es el hueco por dentro del pincel del arco, hasta el horizonte', () => {
    expect(ICON.door).toEqual({ top: 264, w: 228, bottom: 672 })
    expect(ICON.sun.y).toBe(ICON.door.bottom)
  })
  it('la tinta sale con su color y transparencia; el papel y lo de fuera de la squircle, transparentes', () => {
    const art: Px = { width: 3, height: 1, data: new Uint8ClampedArray([0xf6, 0xf0, 0xe4, 255, 0xb9, 0x59, 0x36, 255, 0xb9, 0x59, 0x36, 0]) }
    const ink = extractInk(art, [0xf6, 0xf0, 0xe4])
    expect(Array.from(ink.data.slice(0, 4))[3]).toBe(0)
    expect(Array.from(ink.data.slice(4, 8))).toEqual([0xb9, 0x59, 0x36, 255])
    expect(ink.data[11]).toBe(0)
  })
  it('el trazo del arco se posa abajo a la izquierda, pasa por la clave y sale por debajo del horizonte a la derecha', () => {
    const pts = STROKES.arch.pts()
    expect(pts[0][0]).toBeLessThan(ICON.cx)
    expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(216, 0)
    expect(pts[pts.length - 1][1]).toBeGreaterThan(ICON.door.bottom)
    expect(pathLength(pts)).toBeGreaterThan(900)
  })
})
