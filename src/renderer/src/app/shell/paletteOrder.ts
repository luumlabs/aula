// Orden de la paleta (⌘K), sin React para poder probarlo: los comandos que coinciden de verdad primero, después lo encontrado
// dentro de los cursos, luego las coincidencias sueltas y «Pregúntale a Aula» siempre al final.
import { defaultFilter } from 'cmdk'

export type PaletteGroup = 'navigate' | 'courses' | 'tools' | 'actions'

export interface Filterable {
  id: string
  group: PaletteGroup
  label: string
  keywords?: string[]
}

export interface ScoredGroup<C extends Filterable> {
  group: PaletteGroup
  items: C[]
  best: number
}

export const PALETTE_GROUPS: PaletteGroup[] = ['actions', 'navigate', 'courses', 'tools']
/** Un grupo con una coincidencia así de buena va antes que lo encontrado en los cursos (por debajo, es una coincidencia suelta). */
export const STRONG_MATCH = 0.5
export const ASK_VALUE = 'ask'

/** Los comandos que coinciden con lo escrito, por grupos, cada grupo y cada comando de más a menos parecido. */
export function filterCommands<C extends Filterable>(commands: C[], query: string, score: (value: string, q: string) => number = defaultFilter): ScoredGroup<C>[] {
  const q = query.trim()
  const out: ScoredGroup<C>[] = []
  for (const group of PALETTE_GROUPS) {
    const scored = commands
      .filter((c) => c.group === group)
      .map((c) => ({ c, s: q ? score(`${c.label} ${(c.keywords ?? []).join(' ')}`, q) : 1 }))
      .filter((x) => x.s > 0)
    if (!scored.length) continue
    if (q) scored.sort((a, b) => b.s - a.s)
    out.push({ group, items: scored.map((x) => x.c), best: scored[0].s })
  }
  return q ? out.sort((a, b) => b.best - a.best) : out
}

/** Grupos que van antes de los resultados de los cursos (fuertes) y después (sueltos). Sin consulta, todos son fuertes. */
export function splitGroups<C extends Filterable>(groups: ScoredGroup<C>[], query: string): { strong: ScoredGroup<C>[]; weak: ScoredGroup<C>[] } {
  const q = query.trim()
  return { strong: groups.filter((g) => !q || g.best >= STRONG_MATCH), weak: groups.filter((g) => q && g.best < STRONG_MATCH) }
}

/** Los valores de cmdk en el orden de la pantalla (que es el de las flechas): el primero es el que se elige con Intro. */
export function paletteValues<C extends Filterable>(strong: ScoredGroup<C>[], hitIDs: string[], weak: ScoredGroup<C>[], showAsk: boolean): string[] {
  return [
    ...strong.flatMap((g) => g.items.map((c) => `cmd:${c.id}`)),
    ...hitIDs.map((id) => `hit:${id}`),
    ...weak.flatMap((g) => g.items.map((c) => `cmd:${c.id}`)),
    ...(showAsk ? [ASK_VALUE] : [])
  ]
}

/** Si la primera coincidencia queda lejos del principio, se recorta por delante (en un espacio) con «…». */
export function focusSnippet(text: string, lead = 36): string {
  const first = text.indexOf('**')
  if (first <= lead + 10) return text
  const from = text.lastIndexOf(' ', first - lead)
  const start = from > 0 ? from + 1 : first - lead
  return '…' + text.slice(start).replace(/^…/, '')
}
