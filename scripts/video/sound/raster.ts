// Lienzo RGBA mínimo para las láminas de revisión del sonido (Node, sin dependencias): rectángulos, líneas, puntos y
// texto con una fuente de mapa de bits de 5×7. Se guarda con qc/png.ts.
import { encodePng } from '../qc/png.ts'

export type Rgb = [number, number, number]

export function hex(h: string): Rgb {
  const v = parseInt(h.replace('#', ''), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

// 5×7: cada glifo son 7 filas de 5 bits (el bit 4 es la columna izquierda)
const FONT: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [28, 18, 17, 17, 17, 18, 28],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31], '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14], '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 2, 12],
  '.': [0, 0, 0, 0, 0, 12, 12], ',': [0, 0, 0, 0, 12, 4, 8], ':': [0, 12, 12, 0, 12, 12, 0], '-': [0, 0, 0, 31, 0, 0, 0],
  '+': [0, 4, 4, 31, 4, 4, 0], '/': [0, 1, 2, 4, 8, 16, 0], '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8],
  '%': [24, 25, 2, 4, 8, 19, 3], '=': [0, 0, 31, 0, 31, 0, 0], '·': [0, 0, 0, 4, 0, 0, 0], '>': [8, 4, 2, 1, 2, 4, 8],
  '<': [2, 4, 8, 16, 8, 4, 2], '_': [0, 0, 0, 0, 0, 0, 31], '#': [10, 10, 31, 10, 31, 10, 10], "'": [4, 4, 8, 0, 0, 0, 0],
  '|': [4, 4, 4, 4, 4, 4, 4], '±': [4, 4, 31, 4, 4, 0, 31], '→': [0, 4, 2, 31, 2, 4, 0], ' ': [0, 0, 0, 0, 0, 0, 0]
}

export class Raster {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array
  constructor(width: number, height: number, bg: Rgb) {
    this.width = width
    this.height = height
    this.data = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      this.data[i * 4] = bg[0]
      this.data[i * 4 + 1] = bg[1]
      this.data[i * 4 + 2] = bg[2]
      this.data[i * 4 + 3] = 255
    }
  }
  px(x: number, y: number, c: Rgb, a = 1): void {
    x = Math.round(x)
    y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    const o = (y * this.width + x) * 4
    for (let k = 0; k < 3; k++) this.data[o + k] = Math.round(this.data[o + k] * (1 - a) + c[k] * a)
  }
  rect(x: number, y: number, w: number, h: number, c: Rgb, a = 1): void {
    for (let j = Math.max(0, Math.floor(y)); j < Math.min(this.height, Math.ceil(y + h)); j++)
      for (let i = Math.max(0, Math.floor(x)); i < Math.min(this.width, Math.ceil(x + w)); i++) this.px(i, j, c, a)
  }
  vline(x: number, y0: number, y1: number, c: Rgb, a = 1, w = 1): void {
    this.rect(Math.round(x - (w - 1) / 2), y0, w, y1 - y0, c, a)
  }
  hline(x0: number, x1: number, y: number, c: Rgb, a = 1): void {
    this.rect(x0, y, x1 - x0, 1, c, a)
  }
  dot(x: number, y: number, r: number, c: Rgb, ring?: Rgb): void {
    for (let j = -r - 2; j <= r + 2; j++)
      for (let i = -r - 2; i <= r + 2; i++) {
        const d = Math.hypot(i, j)
        if (d <= r) this.px(x + i, y + j, c, Math.min(1, r + 0.5 - d))
        else if (ring && d <= r + 2) this.px(x + i, y + j, ring, Math.min(1, r + 2.5 - d))
      }
  }
  /** Texto en mayúsculas con la fuente 5×7 a escala `s`. Devuelve el ancho. */
  text(x: number, y: number, str: string, c: Rgb, s = 2): number {
    let cx = x
    for (const ch of str.toUpperCase()) {
      const g = FONT[ch] ?? FONT[ch.normalize('NFD')[0]] ?? FONT[' ']
      for (let row = 0; row < 7; row++)
        for (let col = 0; col < 5; col++) if (g[row] & (16 >> col)) this.rect(cx + col * s, y + row * s, s, s, c)
      cx += 6 * s
    }
    return cx - x
  }
  static textWidth(str: string, s = 2): number {
    return [...str].length * 6 * s
  }
  png(): Buffer {
    return encodePng({ width: this.width, height: this.height, data: this.data })
  }
}
