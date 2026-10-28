// Mensajes para el estudiante. El texto base (y la clave) está en español, con los mismos marcadores que el catálogo
// de la app Swift (`%@` para textos, `%lld` para enteros; las traducciones pueden usar `%1$@`, `%2$lld`…).
// El idioma se elige con `setMathLanguage`; las frases salen de `l10n-catalog.ts` (generado del catálogo Swift).

import { MATH_MESSAGE_CATALOG, type MathCatalogEntry, type MathLanguage } from './l10n-catalog'

export { MATH_MESSAGE_CATALOG, type MathCatalogEntry, type MathLanguage }

/** Traductor: devuelve el texto traducido de una clave (o `undefined` para usar el catálogo del idioma). */
export type MathTranslator = (key: string) => string | undefined

/** Idiomas con catálogo (el primero, español, es el idioma base). */
export const MATH_LANGUAGES: readonly MathLanguage[] = ['es', 'en']

let language: MathLanguage = 'es'
let translator: MathTranslator | null = null

/** Instala (o quita con `null`) un traductor propio; tiene prioridad sobre el catálogo. */
export function setMathTranslator(fn: MathTranslator | null): void {
  translator = fn
}

/** Normaliza un código de idioma («en-US» → «en», «es_ES» → «es»). Desconocido → «es». */
export function normalizeMathLanguage(code: string | null | undefined): MathLanguage {
  const base = (code ?? '').trim().replace('_', '-').split('-')[0].toLowerCase()
  return MATH_LANGUAGES.find((l) => l === base) ?? 'es'
}

/** Cambia el idioma de los mensajes (por defecto, español). Quita el traductor propio, si lo había. */
export function setMathLanguage(code: string): void {
  language = normalizeMathLanguage(code)
  translator = null
}

export function getMathLanguage(): MathLanguage {
  return language
}

/** Sustituye los marcadores de un texto (`%@`, `%lld`, `%d`, `%1$@`, `%%`) por los argumentos en orden. */
export function formatMessage(template: string, args: ReadonlyArray<string | number>): string {
  let next = 0
  return template.replace(/%(?:(\d+)\$)?(@|lld|ld|d|lf|f)|%%/g, (match: string, pos: string | undefined) => {
    if (match === '%%') return '%'
    const index = pos !== undefined ? Number(pos) - 1 : next++
    const v = args[index]
    return v === undefined ? '' : String(v)
  })
}

/** Forma de plural de una entrada: la del primer argumento numérico (como las variaciones de Apple). */
function resolveEntry(entry: MathCatalogEntry, args: ReadonlyArray<string | number>): string | undefined {
  if (typeof entry === 'string') return entry
  const n = args.find((a): a is number => typeof a === 'number')
  let category: Intl.LDMLPluralRule = 'other'
  if (n !== undefined) {
    try {
      category = new Intl.PluralRules(language).select(n)
    } catch {
      category = n === 1 ? 'one' : 'other'
    }
  }
  return entry[category] ?? entry.other
}

/** Mensaje localizado: `tr("Falta el valor de la variable «%@»", name)`. */
export function tr(key: string, ...args: Array<string | number>): string {
  const entry = MATH_MESSAGE_CATALOG[language][key]
  const template = translator?.(key) ?? (entry === undefined ? undefined : resolveEntry(entry, args)) ?? key
  return args.length === 0 ? template : formatMessage(template, args)
}
