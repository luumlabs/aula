// Colores de las series (curvas, barras, categorías): los tonos curados de los cursos, en un orden donde vecinos se
// distinguen bien. Nunca un arcoíris saturado: tintas en claro, tonos suaves en oscuro.
import { TONES, type CourseToneName } from '@renderer/design/pixel/tones'

const ORDER: CourseToneName[] = ['coral', 'slate', 'sage', 'wine', 'amber', 'teal', 'olive', 'navy', 'rose', 'sand']

/** Tinta del tono para dibujar sobre el papel (o sobre el fondo oscuro). */
export function toneInk(name: CourseToneName, dark: boolean): string {
  const t = TONES.find((x) => x.name === name) ?? TONES[0]
  return dark ? t.inkDark : t.inkLight
}

/** Relleno del tono (para velos al 14–22 %). */
export function toneFill(name: CourseToneName, dark: boolean): string {
  const t = TONES.find((x) => x.name === name) ?? TONES[0]
  return dark ? t.fillDark : t.fillLight
}

/** Color de la serie i (la primera es el ladrillo de la app). */
export function seriesColor(i: number, dark: boolean): string {
  if (i % ORDER.length === 0) return 'var(--accent)'
  return toneInk(ORDER[i % ORDER.length], dark)
}

/** Velo plano de un color (sin degradados). */
export function wash(color: string, pct: number): string {
  return `color-mix(in oklab, ${color} ${pct}%, transparent)`
}

export const SERIES_TONES = ORDER
