// Colores de los datos de las figuras: la tinta del curso y la paleta de gráficas validada de la app original
// (ChartPalette.swift: 8 ranuras sobrias que pasan los controles de daltonismo y contraste en claro y oscuro). Las variables
// `--viz-*` están en blocks.css. Nunca arcoíris: una serie usa la tinta del curso; varias, las ranuras EN ORDEN.
import { toneForHue } from '@renderer/design'
import type { CourseTone } from '@renderer/design/pixel/tones'

/** Las 8 ranuras categóricas en su orden fijo (el orden forma parte de la validación). */
// Sin violeta (decisión del dueño): las antiguas ranuras ciruela e índigo son ahora sepia y oliva.
export const VIZ_SLOTS = ['blue', 'terracotta', 'teal', 'amber', 'brown', 'green', 'olive', 'rose'] as const
export type VizSlot = (typeof VIZ_SLOTS)[number]

/** La ranura de la familia del tono de un curso (para que el curso conserve «su» color en las gráficas). */
function slotForTone(tone: CourseTone): VizSlot {
  switch (tone.name) {
    case 'slate': return 'blue'
    case 'coral': return 'terracotta'
    case 'teal': return 'teal'
    case 'amber': case 'sand': return 'amber'
    case 'wine': return 'rose'
    case 'sage': case 'olive': return 'green'
    case 'navy': return 'blue'
    case 'rose': return 'rose'
  }
}

const slotVar = (s: VizSlot): string => `var(--viz-${s})`

/** Tinta del curso (o el ladrillo de Aula si la figura no es de un curso). */
export function inkColor(hue: number | undefined, dark: boolean): string {
  if (hue === undefined || !Number.isFinite(hue)) return 'var(--accent)'
  const t = toneForHue(hue)
  return dark ? t.inkDark : t.inkLight
}

/**
 * Colores de `n` series, sobrios: una sola, la tinta del curso; dos o tres, la tinta, un gris cálido y la tinta aclarada
 * (se distinguen por luminosidad y siempre van con leyenda); de cuatro en adelante, las ranuras validadas en orden,
 * empezando por la familia del curso.
 */
export function seriesColors(n: number, hue: number | undefined, dark: boolean): string[] {
  const ink = inkColor(hue, dark)
  if (n <= 1) return [ink]
  // la tercera, la tinta aclarada: hacia el papel en claro y hacia el texto en oscuro (si no, se apagaría sobre el fondo)
  if (n <= 3) return [ink, 'var(--viz-neutral)', dark ? `color-mix(in oklab, ${ink} 50%, var(--text))` : `color-mix(in oklab, ${ink} 45%, var(--surface))`].slice(0, n)
  return categoricalColors(n, hue)
}

/** Las ranuras validadas en orden, empezando por la familia del curso (para muchas series o categorías). */
export function categoricalColors(n: number, hue: number | undefined): string[] {
  const first = hue === undefined ? 1 : VIZ_SLOTS.indexOf(slotForTone(toneForHue(hue)))
  return Array.from({ length: n }, (_, i) => slotVar(VIZ_SLOTS[(first + i) % VIZ_SLOTS.length]))
}

/** Rampa de un solo tono (la tinta del curso, de intensa a clara sobre el papel): sectores y partes de un todo. */
export function rampColors(n: number, hue: number | undefined, dark: boolean): string[] {
  const ink = inkColor(hue, dark)
  if (n <= 1) return [ink]
  const span = dark ? 60 : 76
  return Array.from({ length: n }, (_, i) => `color-mix(in oklab, ${ink} ${Math.round(100 - (i * span) / (n - 1))}%, var(--surface))`)
}

/** Color por nombre (lo que escribe la IA: «accent», «blue», «naranja», «#2F67A9»…) para curvas, puntos e intervalos. */
export function namedColor(name: string | undefined, hue: number | undefined, dark: boolean): string {
  const n = (name ?? 'accent').trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(n) || /^#[0-9a-f]{3}$/.test(n)) return n
  switch (n) {
    case 'accent': case 'primary': case 'course': return inkColor(hue, dark)
    case 'ink': case 'black': case 'text': case 'negro': return 'var(--text)'
    case 'gray': case 'grey': case 'gris': case 'muted': return 'var(--text3)'
    case 'blue': case 'azul': case 'navy': case 'slate': return slotVar('blue')
    case 'red': case 'rojo': case 'crimson': return 'var(--viz-red)'
    case 'orange': case 'naranja': case 'terracotta': case 'coral': return slotVar('terracotta')
    case 'teal': case 'cyan': case 'turquoise': case 'turquesa': return slotVar('teal')
    case 'yellow': case 'amarillo': case 'amber': case 'ámbar': case 'gold': return slotVar('amber')
    case 'brown': case 'marrón': case 'sepia': return slotVar('brown')
    // los morados que pida la IA se pintan en rosa vino, y el índigo en azul (en Aula no hay violeta)
    case 'purple': case 'morado': case 'violet': case 'violeta': case 'plum': case 'magenta': case 'pink': case 'rosa': case 'rose': case 'wine': return slotVar('rose')
    case 'green': case 'verde': case 'sage': return slotVar('green')
    case 'olive': case 'oliva': return slotVar('olive')
    case 'indigo': case 'índigo': return slotVar('blue')
    default: return inkColor(hue, dark)
  }
}

/** El mismo color con transparencia (para velos de regiones, intervalos y periodos). */
export const withAlpha = (color: string, pct: number): string => `color-mix(in oklab, ${color} ${Math.round(pct)}%, transparent)`
