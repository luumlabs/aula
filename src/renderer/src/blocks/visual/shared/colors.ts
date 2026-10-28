// Colores con nombre que la IA puede usar en dibujos, diagramas, mapas y simulaciones (port de AulaColors.named y
// ChartPalette.slot(named:) de la app Swift). Devuelven valores CSS que siguen al tema (claro/oscuro).

const SLOTS: Record<string, string> = {
  blue: 'blue', azul: 'blue', slate: 'blue', navy: 'blue',
  orange: 'terracotta', naranja: 'terracotta', terracotta: 'terracotta', terracota: 'terracotta', coral: 'terracotta',
  teal: 'teal', cyan: 'teal', turquesa: 'teal', turquoise: 'teal', aqua: 'teal',
  yellow: 'amber', amarillo: 'amber', gold: 'amber', amber: 'amber', ámbar: 'amber',
  // en Aula no hay violeta: los morados van a rosa y el índigo/violeta a azul
  purple: 'rose', morado: 'rose', magenta: 'rose', plum: 'rose', ciruela: 'rose',
  green: 'green', verde: 'green', sage: 'green', salvia: 'green', lime: 'green',
  violet: 'blue', violeta: 'blue', indigo: 'blue', índigo: 'blue',
  pink: 'rose', rosa: 'rose', rose: 'rose', crimson: 'rose'
}

/** Las 8 ranuras de la paleta de gráficas en su orden validado. */
export const SERIES = ['blue', 'terracotta', 'teal', 'amber', 'brown', 'green', 'olive', 'rose'].map((s) => `var(--viz-${s})`)

/** Color de la serie `i` (pasada la octava vuelve a empezar). */
export const seriesColor = (i: number): string => SERIES[((i % 8) + 8) % 8]

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

export const INK = 'var(--viz-accent, var(--accent))'

/** Color CSS para un nombre («blue», «rojo», «accent», «#2f67a9»…). Sin nombre (o desconocido): `fallback`. «accent» es la tinta del curso. */
export function vizColor(name: string | undefined, fallback = INK): string {
  const n = name?.trim().toLowerCase()
  if (!n) return fallback
  const slot = SLOTS[n]
  if (slot) return `var(--viz-${slot})`
  switch (n) {
    case 'accent': return INK
    case 'red': case 'rojo': return 'var(--danger)'
    case 'brown': case 'marrón': case 'marron': return 'var(--viz-brown)'
    case 'olive': case 'oliva': return 'var(--viz-olive)'
    case 'gray': case 'grey': case 'gris': return 'var(--text2)'
    case 'ink': case 'black': case 'white': case 'negro': case 'blanco': return 'var(--text)'
    default: return HEX.test(n) ? n : fallback
  }
}

/** El mismo color mezclado con transparencia (velos de regiones y nodos). */
export const wash = (color: string, pct: number): string => `color-mix(in oklab, ${color} ${Math.round(pct)}%, transparent)`

/** Valor real (rgb) de un color CSS en un elemento (lo necesita three.js, que no entiende `var(--…)`). */
export function resolveCss(color: string, within: Element | null): string {
  if (typeof document === 'undefined') return '#888888'
  const probe = document.createElement('span')
  probe.style.color = color
  probe.style.display = 'none'
  ;(within ?? document.body).appendChild(probe)
  const out = getComputedStyle(probe).color
  probe.remove()
  return out || '#888888'
}

/**
 * Colores de los elementos: la convención CPK de siempre (carbono gris, oxígeno rojo, nitrógeno azul, hidrógeno blanco…) en
 * una versión «papel», menos saturada, que convive con la página (la de la app Swift). Son datos, como la tabla periódica.
 */
const PAPER_CPK: Record<string, string> = {
  H: '#d3cbbf', C: '#6e6a64', N: '#3b5ba9', O: '#b5483a', F: '#7fa65a', Cl: '#4e9a5b', Br: '#8e3b32', I: '#7a4a3c',
  S: '#c2a048', P: '#c2733a', Na: '#9a8f84', K: '#857a70', Mg: '#6e9a4a', Ca: '#5e9150', Fe: '#b0603a', B: '#c79a8a',
  Si: '#b9a385', Xe: '#4f8f9b', Li: '#b0a597', Cu: '#b0743a', Zn: '#7c7fa6', He: '#b7d0d2', Ne: '#95bcc8', Ar: '#7faab6',
  Be: '#93a657', Al: '#a49896', Se: '#c08c45', Kr: '#6aa0b0'
}

export function cpkColor(element: string, dark: boolean): string {
  if (element === 'H' && dark) return '#e4ded4'
  if (element === 'C' && dark) return '#8a857e'
  return PAPER_CPK[element] ?? '#b06a82'
}

/** Rótulo de gráfica con subíndices escritos a mano («V_C (V)», «T_1/2»): esas palabras pasan a fórmula. */
export function mathify(label: string): string {
  if (label.includes('$')) return label
  return label
    .split(/(\s+)/)
    .map((w) => (/^[A-Za-z\u0370-\u03ff]+[_^][A-Za-z0-9{}\u0370-\u03ff]+(\([^)]*\))?$/.test(w) ? `$${w}$` : w))
    .join('')
}
