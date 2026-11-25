// Piezas del papel compartidas por la vista de impresión (PDF), Word y Markdown: así los tres salen iguales (mismas letras
// de las opciones, mismos huecos, mismo barajado de «ordenar» y «relacionar»). Isomorfo.
import type { Block } from '../schema/blocks'
import type { Answer, Exercise } from '../schema/exercises'

/** Normaliza una cadena para comprobar si la salida de un bloque `code` coincide con una respuesta del ejercicio. */
function normOutput(s: string): string {
  return s.replace(/`/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** ¿La salida de un bloque `code` daría la respuesta del ejercicio (p. ej. «¿qué imprime?»)? */
export function outputRevealsAnswer(output: string, answer: Answer): boolean {
  const out = normOutput(output)
  if (!out) return false
  switch (answer.kind) {
    case 'choice':
      return answer.options.some((o) => o.correct && normOutput(o.md) === out)
    case 'numeric':
      return [answer.value, ...answer.alternatives].some((v) => normOutput(v) === out)
    case 'short':
      return answer.accepted.some((a) => normOutput(a) === out)
    case 'expression':
    case 'equation':
    case 'interval':
    case 'chem':
      return normOutput(answer.expected) === out
    case 'set':
    case 'point':
      return answer.expected.some((v) => normOutput(v) === out) || normOutput(answer.expected.join(', ')) === out
    case 'cloze':
      return answer.blanks.some((b) => b.accepted.some((a) => normOutput(a) === out))
    case 'open': {
      const model = normOutput(answer.modelAnswer)
      return !!model && model === out
    }
    case 'multi':
      return answer.parts.some((p) => outputRevealsAnswer(output, p.answer))
    default:
      return false
  }
}

/** Oculta `output` de un bloque `code` en un enunciado solo cuando daría la respuesta (un error o traza que explica el enunciado se queda). */
export function stripRevealedCodeOutput(blocks: Block[], answer: Answer): Block[] {
  return blocks.map((b) => (b.type === 'code' && b.output?.trim() && outputRevealsAnswer(b.output, answer) ? { ...b, output: undefined } : b))
}

/** Letra de una opción («a», «b»…; a partir de la 27, su número). */
export function choiceLetter(i: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  return i < letters.length ? letters[i] : String(i + 1)
}

/** Huecos «[[n]]» de un ejercicio de completar, con su línea para escribir en papel. */
export function blanks(md: string): string {
  return md.replace(/\[\[(\d+)\]\]/g, '**($1)** ________')
}

/** El enunciado listo para papel (los huecos con su línea y sin salidas de código que den la respuesta). */
export function printablePrompt(e: Exercise): Block[] {
  return stripRevealedCodeOutput(e.prompt, e.answer).map((b) => (b.type === 'text' && b.md.includes('[[') ? { ...b, md: blanks(b.md) } : b))
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
