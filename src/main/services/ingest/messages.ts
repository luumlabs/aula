// Textos para el usuario (avisos, errores, progreso). La clave es el texto en español con los mismos marcadores que el
// catálogo de la app Swift («%@», «%lld»), así que las traducciones se comparten. El español es el idioma base.
import { EN_MESSAGES } from './messages.en'
import { EN_EXTRA_MESSAGES } from './messages.en.extra'

export type MessageArg = string | number

/** Una traducción: texto, o variantes de plural (`one`/`other`) según el primer número de los argumentos. */
export type Translation = string | { one: string; other: string }

let language = 'es'

/** Idioma de los textos que genera la lectura (el de la interfaz). Por defecto, español. */
export function setIngestLanguage(code: string): void {
  language = (code || 'es').trim() || 'es'
}

export function ingestLanguage(): string {
  return language
}

/** Texto localizado: `L('Leyendo página %@ de %@…', 3, 10)`. */
export function L(key: string, ...args: MessageArg[]): string {
  let template: string = key
  if (language.toLowerCase().startsWith('en')) {
    const t = EN_MESSAGES[key] ?? EN_EXTRA_MESSAGES[key]
    if (typeof t === 'string') template = t
    else if (t) {
      const n = args.find((a) => typeof a === 'number')
      template = n === 1 ? t.one : t.other
    }
  }
  return format(template, args)
}

/** Sustituye `%@`, `%lld`, `%d` y las formas posicionales `%1$@`, `%2$lld`; `%%` es un «%». */
export function format(template: string, args: MessageArg[]): string {
  let next = 0
  return template.replace(/%(?:(\d+)\$)?(@|lld|ld|d|%)/g, (_m, pos: string | undefined, spec: string) => {
    if (spec === '%') return '%'
    const index = pos ? Number(pos) - 1 : next++
    const v = args[index]
    return v === undefined ? '' : String(v)
  })
}
