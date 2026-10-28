// Idioma de las frases de ChemKit que ve el alumno (errores, correcciones) y separador decimal del alumno.
// Las claves son el texto en español con los marcadores de la app Swift (%@, %lld…): las mismas del catálogo
// `Localizable.xcstrings`, así las traducciones se reutilizan tal cual. Los informes para la IA siguen en español fijo.

import { CHEM_LANGUAGES, type ChemLanguage } from './element-l10n'
import { MESSAGE_CATALOG, type CatalogEntry } from './l10n-catalog'

export { CHEM_LANGUAGES, type ChemLanguage }

let language: ChemLanguage = 'es'
let decimalComma: boolean | null = null

/** Normaliza un código de idioma («en-US» → «en», «pt» → «pt-BR», «zh» → «zh-Hans»). Desconocido → «es». */
export function normalizeChemLanguage(code: string | null | undefined): ChemLanguage {
  const c = (code ?? '').trim().replace('_', '-')
  if (!c) return 'es'
  const exact = CHEM_LANGUAGES.find((l) => l.toLowerCase() === c.toLowerCase())
  if (exact) return exact
  const base = c.split('-')[0].toLowerCase()
  if (base === 'pt') return 'pt-BR'
  if (base === 'zh') return 'zh-Hans'
  return CHEM_LANGUAGES.find((l) => l.toLowerCase() === base) ?? 'es'
}

/** Cambia el idioma de las frases para el alumno (por defecto, español: el idioma base de la app). */
export function setChemLanguage(code: string): void {
  language = normalizeChemLanguage(code)
}

export function getChemLanguage(): ChemLanguage {
  return language
}

/** `true` si las frases salen en español (la nomenclatura solo sabe nombrar compuestos en español). */
export function phrasesAreSpanish(): boolean {
  return language === 'es'
}

/** Separador decimal del alumno: `true` coma, `false` punto, `null` automático (punto, sin región conocida). */
export function setChemDecimalComma(value: boolean | null): void {
  decimalComma = value
}

export function isDecimalComma(): boolean {
  return decimalComma ?? false
}

/** Frase localizada: busca la clave en el catálogo del idioma actual y rellena sus marcadores. */
export function L(key: string, ...args: (string | number)[]): string {
  const entry = MESSAGE_CATALOG[language]?.[key]
  return formatTemplate(entry === undefined ? key : resolveEntry(entry, args), args)
}

/** Texto de una entrada del catálogo: si tiene formas de plural, la del primer argumento numérico (como Apple). */
function resolveEntry(entry: CatalogEntry, args: readonly (string | number)[]): string {
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
  return entry[category] ?? entry.other ?? Object.values(entry)[0] ?? ''
}

/** Rellena «%@», «%lld», «%1$@»… (formato de las cadenas de Apple) con los argumentos, en orden o por posición. */
export function formatTemplate(template: string, args: readonly (string | number)[]): string {
  let next = 0
  return template.replace(/%(?:(\d+)\$)?(@|lld|ld|d|lf|f|%)/g, (_m, pos: string | undefined, spec: string) => {
    if (spec === '%') return '%'
    const index = pos ? Number(pos) - 1 : next++
    const v = args[index]
    return v === undefined ? '' : String(v)
  })
}
