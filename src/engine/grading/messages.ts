// Frases propias del corrector y del motor de estudio, en español (base) e inglés.
import type { GradeLang } from './types'

/** El texto en el idioma pedido (español por defecto). */
export function L(lang: GradeLang | undefined, es: string, en: string): string {
  return lang === 'en' ? en : es
}

/** Lista legible: «a, b y c» / «a, b and c». */
export function listText(items: readonly string[], lang: GradeLang | undefined): string {
  if (items.length <= 1) return items[0] ?? ''
  const last = items[items.length - 1]
  return `${items.slice(0, -1).join(', ')} ${lang === 'en' ? 'and' : 'y'} ${last}`
}
