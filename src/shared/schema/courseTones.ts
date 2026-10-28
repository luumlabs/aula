// Los diez tonos de los cursos, en el espacio de `Pack.hue` (0…1): el proceso principal los usa para elegir el tono de un
// curso nuevo y para imprimir su color (Word). La interfaz pinta con `design/pixel/tones.ts` (mismos `hue`, lo vigila
// `colorGuard.test.ts`). Ningún tono es violeta: 0,68 y 0,8 (antes índigo y ciruela) pintan azul noche y vino.

export const COURSE_TONE_HUES = {
  coral: 0.03, amber: 0.09, sand: 0.13, olive: 0.2, sage: 0.38, teal: 0.5, slate: 0.6, navy: 0.68, wine: 0.8, rose: 0.93
} as const
export type CourseToneId = keyof typeof COURSE_TONE_HUES

/** Tinta de cada tono para imprimir sobre papel blanco (la `inkLight` de la interfaz), sin «#». */
const PRINT_INK: Record<CourseToneId, string> = {
  coral: 'A54A31', amber: '94560F', sand: '7D613C', olive: '5D6825', sage: '386E51', teal: '1F6A6E', slate: '395D88', navy: '26426C', wine: '7C2937', rose: '9F3F5A'
}

/** El tono más cercano a un `hue` cualquiera (0…1, da la vuelta; NaN → coral). */
export function courseToneFor(hue: number | undefined | null): CourseToneId {
  if (hue == null || !Number.isFinite(hue)) return 'coral'
  const h = hue - Math.floor(hue)
  let best: CourseToneId = 'coral'
  let bestD = Infinity
  for (const [id, t] of Object.entries(COURSE_TONE_HUES) as Array<[CourseToneId, number]>) {
    const d0 = Math.abs(h - t)
    const d = Math.min(d0, 1 - d0)
    if (d < bestD - 1e-9) {
      best = id
      bestD = d
    }
  }
  return best
}

/** El `hue` canónico (el del tono más cercano): lo que se guarda en un curso nuevo. */
export const canonicalCourseHue = (hue: number): number => COURSE_TONE_HUES[courseToneFor(hue)]

/** Tinta del curso para documentos impresos (hexadecimal sin «#»). */
export const coursePrintInk = (hue: number): string => PRINT_INK[courseToneFor(hue)]

/** Un tono estable para un título (cada curso nuevo con su color, repartidos por igual entre los diez). */
export function courseHueForTitle(title: string): number {
  let h = 0
  for (const ch of title) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  const ids = Object.keys(COURSE_TONE_HUES) as CourseToneId[]
  return COURSE_TONE_HUES[ids[h % ids.length]]
}
