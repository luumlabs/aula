// Mapa de coropletas: un valor por país repartido en clases (cuantiles, como mucho 5) y cada clase un escalón plano de la
// tinta del curso sobre la tierra. Escalones, nunca un degradado continuo («Papel y luz»). Lógica pura.

export interface Classes {
  /** Límites inferiores de las clases 2…k (la clase de un valor = cuántos límites alcanza). */
  cuts: number[]
  /** Número de clases (1…5). */
  k: number
  min: number
  max: number
  /** Si hay tan pocos valores distintos que cada uno es su propia clase, esos valores (en orden). */
  exact?: number[]
}

/** Clases por cuantiles de los valores finitos (empates juntos); undefined si no hay ninguno. */
export function choroplethClasses(values: readonly number[], max = 5): Classes | undefined {
  const v = values.filter(Number.isFinite).slice().sort((a, b) => a - b)
  if (!v.length) return undefined
  const kMax = Math.max(1, Math.min(5, Math.floor(max)))
  const distinct = [...new Set(v)]
  if (distinct.length <= kMax) return { cuts: distinct.slice(1), k: distinct.length, min: v[0], max: v[v.length - 1], exact: distinct }
  const cuts: number[] = []
  for (let i = 1; i < kMax; i++) {
    const c = v[Math.round((i * v.length) / kMax)]
    if (c > v[0] && (cuts.length === 0 || c > cuts[cuts.length - 1])) cuts.push(c)
  }
  return { cuts, k: cuts.length + 1, min: v[0], max: v[v.length - 1] }
}

/** Clase (0…k−1) de un valor. */
export function classOf(value: number, c: Classes): number {
  let i = 0
  while (i < c.cuts.length && value >= c.cuts[i]) i++
  return i
}

/**
 * Porcentaje de tinta de la clase i de k: 26, 42, 57, 73, 88 con 5; repartidos igual con menos. El más claro no baja de
 * 26 % para que, en oscuro, no se confunda con la tierra sin datos.
 */
export function classShade(i: number, k: number): number {
  if (k <= 1) return 70
  return Math.round(26 + ((88 - 26) * i) / (k - 1))
}

/** Color plano de la clase: la tinta mezclada con la tierra del mapa. */
export const classColor = (i: number, k: number, ink: string): string => `color-mix(in oklab, ${ink} ${classShade(i, k)}%, var(--viz-land))`

/**
 * Rótulos de la leyenda: con valores exactos, uno bajo cada muestra; con cuantiles, los límites entre muestras (del mínimo al
 * máximo, k + 1 cifras).
 */
export interface LegendStops { under: 'swatch' | 'edge'; labels: string[] }

export function legendStops(c: Classes, fmt: (v: number) => string): LegendStops {
  if (c.exact) return { under: 'swatch', labels: c.exact.map(fmt) }
  return { under: 'edge', labels: [c.min, ...c.cuts, c.max].map(fmt) }
}

export interface LegendLayout {
  /** Ancho de cada muestra y hueco entre dos (px). */
  swatch: number
  gap: number
  /** Aire a cada lado de las muestras para que la primera y la última cifra no se salgan. */
  pad: number
  width: number
  /** Las cifras que se escriben, centradas en x. */
  labels: Array<{ x: number; text: string }>
}

/**
 * Dónde va cada cifra de la leyenda: bajo su muestra (valores exactos) o en el borde entre dos (límites de cuantiles). Las
 * muestras se ensanchan para que las cifras no se pisen, sin pasar de `maxWidth`; si aun así no caben, se escribe una de
 * cada pocas (la última, siempre).
 */
export function legendLayout(stops: LegendStops, measure: (s: string) => number, maxWidth: number, gap = 3): LegendLayout {
  const edge = stops.under === 'edge'
  const n = stops.labels.length
  const k = Math.max(1, edge ? n - 1 : n)
  const widest = Math.max(0, ...stops.labels.map(measure))
  const sidePad = edge ? Math.ceil(widest / 2) : 0
  const fit = (maxWidth - 2 * sidePad - gap * (k - 1)) / k
  const swatch = Math.round(Math.max(22, Math.min(Math.max(30, widest + 10), fit)))
  // bajo la muestra, una cifra más ancha que ella tampoco se sale por la izquierda
  const pad = edge ? sidePad : Math.max(0, Math.ceil((widest - swatch) / 2))
  const x = (j: number): number => {
    if (!edge) return pad + j * (swatch + gap) + swatch / 2
    if (j === 0) return pad
    if (j === k) return pad + k * swatch + (k - 1) * gap
    return pad + j * (swatch + gap) - gap / 2
  }
  const step = Math.max(1, Math.ceil((widest + 4) / (swatch + gap)))
  const labels = stops.labels
    .map((text, j) => ({ x: x(j), text }))
    .filter((_, j) => step === 1 || j === n - 1 || (j % step === 0 && n - 1 - j >= step))
  return { swatch, gap, pad, width: 2 * pad + k * swatch + (k - 1) * gap, labels }
}
