// Guardián del color: en Aula no hay violeta, morado ni lila (decisión del dueño). Una sola definición, en OKLCH (el matiz
// que ve el ojo): de 270° a 335° —del índigo al ciruela— con croma ≥ 0,06 y sin ser casi negro ni casi blanco. Lo usan las
// pruebas (`colorGuard.test.ts`) y el barrido de capturas (`scripts/dev/violet-sweep.mjs`, misma fórmula).

export interface Oklch {
  l: number
  c: number
  h: number
}

const lin = (v: number): number => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** sRGB (0…255) → OKLCH (l 0…1, c ≥ 0, h en grados). */
export function rgbToOklch(r: number, g: number, b: number): Oklch {
  const R = lin(r), G = lin(g), B = lin(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { l: L, c: Math.hypot(A, Bb), h: ((Math.atan2(Bb, A) * 180) / Math.PI + 360) % 360 }
}

export const VIOLET = { hueFrom: 270, hueTo: 335, minChroma: 0.06, minL: 0.2, maxL: 0.97 } as const

/** ¿Este color (sRGB 0…255) se ve violeta, morado o lila? */
export function isVioletRgb(r: number, g: number, b: number, minChroma: number = VIOLET.minChroma): boolean {
  const { l, c, h } = rgbToOklch(r, g, b)
  return c >= minChroma && h >= VIOLET.hueFrom && h <= VIOLET.hueTo && l > VIOLET.minL && l < VIOLET.maxL
}

/** Igual, con un color «#rrggbb» (o un número 0xrrggbb). */
export function isViolet(color: string | number, minChroma?: number): boolean {
  const n = typeof color === 'number' ? color : parseInt(color.replace('#', ''), 16)
  return isVioletRgb((n >> 16) & 255, (n >> 8) & 255, n & 255, minChroma)
}
