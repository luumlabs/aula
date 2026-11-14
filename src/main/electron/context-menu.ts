// Menú del clic derecho de la ventana: copiar lo seleccionado y, en macOS, consultarlo en el diccionario del sistema;
// traducirlo o buscarlo en la web (se abre en el navegador); cortar, copiar, pegar y la ortografía en los campos; copiar
// un enlace. En el simulacro solo copiar (y editar en los campos): nada de ayudas. En los campos de respuesta de un
// ejercicio no hay sugerencias de ortografía (darían la respuesta). La plantilla es pura: window.ts la abre.
import type { MenuItemConstructorOptions } from 'electron'

type Lang = 'es' | 'en'

const TEXT = {
  es: { copy: 'Copiar', cut: 'Cortar', paste: 'Pegar', selectAll: 'Seleccionar todo', lookUp: 'Consultar', translate: 'Traducir', search: 'Buscar en la web', copyLink: 'Copiar enlace' },
  en: { copy: 'Copy', cut: 'Cut', paste: 'Paste', selectAll: 'Select All', lookUp: 'Look Up', translate: 'Translate', search: 'Search the web', copyLink: 'Copy Link' }
} as const

/** Lo que usa el menú de los `ContextMenuParams` de Electron. */
export interface ContextTarget {
  selectionText: string
  isEditable: boolean
  linkURL: string
  misspelledWord: string
  dictionarySuggestions: readonly string[]
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean }
}

export interface ContextOptions {
  lang: Lang
  platform: NodeJS.Platform
  /** Simulacro abierto: solo copiar (y editar en los campos). */
  exam: boolean
  /** El clic es en un campo de respuesta de un ejercicio: sin ortografía ni consultas. */
  exerciseField: boolean
  /** Idioma al que traducir (el del sistema del estudiante: `translateTarget`). */
  translateTo: string
}

/** Lo que hacen las entradas que no son un rol de Electron (window.ts las da). */
export interface ContextActions {
  lookUp: () => void
  openExternal: (url: string) => void
  replaceMisspelling: (word: string) => void
  copyText: (text: string) => void
}

/** Lo que se manda a un traductor o a un buscador: sin saltos de línea ni espacios de más y como mucho ~500 caracteres. */
export const MAX_QUERY = 500
/** Ventana en la que vale el aviso de «campo de respuesta» (llega justo antes que el menú nativo). */
export const FIELD_NOTICE_MS = 1500

export function cleanQuery(text: string, max = MAX_QUERY): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() : flat
}

/** «Consultar “fotosíntesis”»: la selección corta, con «…» si no cabe. */
function quoted(text: string, max = 24): string {
  const chars = Array.from(cleanQuery(text))
  return `“${chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : chars.join('')}”`
}

/** Idioma al que traducir: el primero de los del sistema, en el código del traductor («es-ES» → «es», chino → zh-CN/zh-TW). */
export function translateTarget(preferred: readonly string[], fallback = 'en'): string {
  const first = preferred.find((l) => typeof l === 'string' && l.trim())
  if (!first) return fallback
  const [base = '', ...rest] = first.trim().replace(/_/g, '-').toLowerCase().split('-')
  if (base === 'zh') return rest.some((p) => p === 'hant' || p === 'tw' || p === 'hk' || p === 'mo') ? 'zh-TW' : 'zh-CN'
  return /^[a-z]{2,3}$/.test(base) ? base : fallback
}

/** El traductor web con el texto ya puesto (idioma de origen automático). */
export function translateURL(text: string, target: string): string {
  const u = new URL('https://translate.google.com/')
  u.searchParams.set('sl', 'auto')
  u.searchParams.set('tl', target)
  u.searchParams.set('text', cleanQuery(text))
  u.searchParams.set('op', 'translate')
  return u.href
}

/** La búsqueda web (DuckDuckGo, el mismo buscador que usa Aula: services/tools/web.ts). */
export function searchURL(text: string): string {
  const u = new URL('https://duckduckgo.com/')
  u.searchParams.set('q', cleanQuery(text))
  return u.href
}

/** Solo se copian enlaces web o de correo (no las citas de página internas ni otras direcciones). */
function copyableLink(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url.trim())
}

/** Une los grupos con separadores, sin grupos vacíos. */
function joinGroups(groups: MenuItemConstructorOptions[][]): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = []
  for (const g of groups.filter((x) => x.length)) {
    if (out.length) out.push({ type: 'separator' })
    out.push(...g)
  }
  return out
}

/** La plantilla del menú para este clic. Vacía = no se abre ningún menú. */
export function buildContextMenuTemplate(p: ContextTarget, o: ContextOptions, act: ContextActions): MenuItemConstructorOptions[] {
  const t = TEXT[o.lang]
  const text = cleanQuery(p.selectionText)
  // consultar, traducir y buscar: nunca en el simulacro ni sobre la respuesta que se escribe en un ejercicio
  const helps = !o.exam && !(p.isEditable && o.exerciseField)
  const spelling: MenuItemConstructorOptions[] =
    p.isEditable && helps && p.misspelledWord
      ? p.dictionarySuggestions.slice(0, 5).map((w) => ({ label: w, click: () => act.replaceMisspelling(w) }))
      : []
  const edit: MenuItemConstructorOptions[] = p.isEditable
    ? [
        { label: t.cut, role: 'cut', enabled: p.editFlags.canCut },
        { label: t.copy, role: 'copy', enabled: p.editFlags.canCopy },
        { label: t.paste, role: 'paste', enabled: p.editFlags.canPaste },
        { type: 'separator' },
        { label: t.selectAll, role: 'selectAll', enabled: p.editFlags.canSelectAll }
      ]
    : text
      ? [{ label: t.copy, role: 'copy' }]
      : []
  const lookups: MenuItemConstructorOptions[] =
    text && helps
      ? [
          ...(o.platform === 'darwin' ? [{ label: `${t.lookUp} ${quoted(text)}`, click: () => act.lookUp() }] : []),
          { label: t.translate, click: () => act.openExternal(translateURL(text, o.translateTo)) },
          { label: t.search, click: () => act.openExternal(searchURL(text)) }
        ]
      : []
  const link: MenuItemConstructorOptions[] = copyableLink(p.linkURL) ? [{ label: t.copyLink, click: () => act.copyText(p.linkURL.trim()) }] : []
  return joinGroups([spelling, edit, lookups, link])
}

/**
 * Lo que la interfaz avisa para el menú: si el simulacro está abierto (al entrar y al salir) y si el clic derecho es en un
 * campo de respuesta (justo antes del menú nativo: vale solo para ese menú y caduca enseguida).
 */
export function createContextGuard(now: () => number = () => performance.now()) {
  let exam = false
  let fieldAt: number | null = null
  return {
    setExam(on: boolean): void {
      exam = on
    },
    markAnswerField(on: boolean): void {
      fieldAt = on ? now() : null
    },
    /** Para el menú que se abre ahora (el aviso del campo se gasta). */
    take(): { exam: boolean; exerciseField: boolean } {
      const at = fieldAt
      fieldAt = null
      const elapsed = at === null ? Infinity : now() - at
      return { exam, exerciseField: elapsed >= 0 && elapsed <= FIELD_NOTICE_MS }
    },
    /** La página se recarga o se cae: nada de lo avisado sigue valiendo. */
    reset(): void {
      exam = false
      fieldAt = null
    }
  }
}

export type ContextGuard = ReturnType<typeof createContextGuard>

/** El de la ventana principal (lo llenan los manejadores de 'app.*' y lo lee window.ts). */
export const contextGuard: ContextGuard = createContextGuard()
