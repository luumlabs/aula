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
  it('la puerta es el hueco por dentro del pincel del arco, hasta el horizonte', () => {
    expect(ICON.door).toEqual({ top: 266, w: 228, bottom: 600 })
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
    expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(222, 0)
    expect(pts[pts.length - 1][1]).toBeGreaterThan(ICON.door.bottom)
    expect(pathLength(pts)).toBeGreaterThan(900)
  })
})
