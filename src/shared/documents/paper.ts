// Piezas del papel compartidas por la vista de impresión (PDF), Word y Markdown: así los tres salen iguales (mismas letras
// de las opciones, mismos huecos, mismo barajado de «ordenar» y «relacionar»). Isomorfo.
import type { Block } from '../schema/blocks'
import type { Exercise } from '../schema/exercises'

/** Letra de una opción («a», «b»…; a partir de la 27, su número). */
export function choiceLetter(i: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  return i < letters.length ? letters[i] : String(i + 1)
}

/** Huecos «[[n]]» de un ejercicio de completar, con su línea para escribir en papel. */
export function blanks(md: string): string {
  return md.replace(/\[\[(\d+)\]\]/g, '**($1)** ________')
}

/** El enunciado listo para papel (los huecos con su línea). */
export function printablePrompt(e: Exercise): Block[] {
  return e.prompt.map((b) => (b.type === 'text' && b.md.includes('[[') ? { ...b, md: blanks(b.md) } : b))
}

/**
 * Barajado estable (el mismo examen se imprime igual) que nunca deja los elementos en su orden original (en «ordenar», el
 * orden original ES la respuesta). El mismo de Swift: así Word, Markdown y PDF salen iguales.
 */
export function stableShuffle<T>(xs: readonly T[], key: string): T[] {
  if (xs.length <= 1) return [...xs]
  const M = (1n << 64n) - 1n
  let h = 1469598103934665603n
  for (const b of new TextEncoder().encode(key)) h = ((h ^ BigInt(b)) * 1099511628211n) & M
  const a = xs.map((x, i) => [x, i] as const).slice()
  for (let i = a.length - 1; i > 0; i--) {
    h = (h * 6364136223846793005n + 1442695040888963407n) & M
    const j = Number((h >> 33n) % BigInt(i + 1))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  if (a.every(([, i], k) => i === k)) a.push(a.shift() as (typeof a)[number])
  return a.map(([x]) => x)
}
