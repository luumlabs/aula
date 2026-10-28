// Ayudas puras para escribir respuestas: insertar símbolos donde está el cursor, la vista previa en LaTeX de lo que se
// escribe («Así lo leo»), la química con mhchem, la coma decimal y las teclas de las opciones.
import { MathParser } from '@engine/math/parse/parser'
import { toLatex } from '@engine/math/print/latex'
import type { Answer, ChemMode } from '@shared/schema/exercises'

// MARK: Texto

/** Inserta `insert` en la selección [start, end) y deja el cursor `caretBack` caracteres antes del final de lo insertado. */
export function insertAt(value: string, start: number, end: number, insert: string, caretBack = 0): { value: string; caret: number } {
  const s = Math.max(0, Math.min(start, value.length))
  const e = Math.max(s, Math.min(end, value.length))
  const next = value.slice(0, s) + insert + value.slice(e)
  return { value: next, caret: Math.max(s, s + insert.length - Math.max(0, caretBack)) }
}

/** Palabras de un texto (para el límite de las respuestas abiertas). */
export function wordCount(text: string): number {
  const t = text.trim()
  return t ? t.split(/\s+/u).length : 0
}

/** Ancho en caracteres de un hueco: lo escrito o el marcador, entre 4 y 28. */
export function blankWidth(value: string, placeholder = ''): number {
  return Math.max(4, Math.min(28, Math.max(value.length, placeholder.length) + 1))
}

/** Sin tildes, en minúsculas y con los espacios, comillas y primas unificados (comparar respuestas cortas). */
export function looseText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[′’‘`´]/g, "'")
    .replace(/[″“”]/g, '"')
    .replace(/º/g, '°')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.。]$/u, '')
}

/** ¿El idioma escribe los decimales con coma? (es, fr, de, it, pt…) */
export function usesDecimalComma(lang: string | undefined): boolean {
  const l = (lang ?? '').toLowerCase().slice(0, 2)
  return ['es', 'fr', 'de', 'it', 'pt', 'ca', 'nl', 'ru', 'pl', 'tr', 'sv', 'da', 'nb', 'fi', 'cs', 'ro'].includes(l)
}

/** Número escrito por una persona («0,25», «1 234,5», «−3») → texto con punto decimal (para comparar). */
export function normalizeDecimal(text: string): string {
  let t = text.trim().replace(/[−–]/g, '-').replace(/ | /g, ' ')
  // «1 234,5» / «1.234,5» (miles) → «1234,5»
  if (/^-?\d{1,3}([ .]\d{3})+(,\d+)?$/.test(t)) t = t.replace(/[ .](?=\d{3})/g, '')
  // una sola coma entre cifras = decimal
  if (/^-?\d*,\d+$/.test(t)) t = t.replace(',', '.')
  return t
}

// MARK: Vista previa («Así lo leo»)

/** Muestra los decimales con coma en LaTeX (`3.5` → `3{,}5`). */
export function texDecimalComma(tex: string): string {
  return tex.replace(/(\d)\.(\d)/g, '$1{,}$2')
}

export interface Preview {
  /** LaTeX de lo que se entendió. */
  tex?: string
  /** Por qué no se entiende todavía (localizado por el motor). */
  error?: string
  /** Aviso cuando lo escrito admite dos lecturas («Entendí 1/2x como 1/(2x)…»). */
  note?: string
}

function exprTex(text: string): string {
  return toLatex(MathParser.parse(text))
}

/** Separa una lista «1, 2, 3» (o «1,5; 2» con coma decimal) en sus elementos. */
export function splitList(text: string, decimalComma: boolean): string[] {
  const t = text.trim().replace(/^\{|\}$/g, '')
  if (!t) return []
  const sep = t.includes(';') || (decimalComma && /\d,\d/.test(t) && !/,\s/.test(t)) ? ';' : ','
  return t.split(sep).map((x) => x.trim()).filter(Boolean)
}

/** Intervalo a LaTeX: extremos, ∞, ∪ y desigualdades. */
export function intervalTex(text: string): string {
  const t = text.trim()
  if (!t) return ''
  // desigualdad: «x > 3», «-2 ≤ x < 5»
  if (/[<>≤≥]/.test(t) && !/^[[(]/.test(t)) {
    const parts = t.split(/(<=|>=|≤|≥|<|>)/)
    return parts
      .map((p) => {
        const s = p.trim()
        if (s === '<=' || s === '≤') return '\\le'
        if (s === '>=' || s === '≥') return '\\ge'
        if (s === '<' || s === '>') return s
        try {
          return exprTex(s)
        } catch {
          return s
        }
      })
      .join(' ')
  }
  return t
    .split(/\s*(?:∪|\bU\b|\bu\b)\s*/)
    .map((piece) => {
      const m = /^([[(\]])\s*(.*?)\s*[,;]\s*(.*?)\s*([\])[])$/.exec(piece.trim())
      if (!m) throw new Error('interval')
      const end = (s: string): string => {
        const x = s.replace(/inf(inity)?|infinito/gi, '∞')
        if (x === '∞' || x === '+∞') return '\\infty'
        if (x === '-∞') return '-\\infty'
        return exprTex(x)
      }
      const open = m[1] === '(' || m[1] === ']' ? '(' : '['
      const close = m[4] === ')' || m[4] === '[' ? ')' : ']'
      return `\\left${open}${end(m[2])},\\ ${end(m[3])}\\right${close}`
    })
    .join(' \\cup ')
}

/** Lo que entiende Aula de lo escrito, en LaTeX, según el tipo de respuesta (o el motivo de que aún no se entienda). */
export function mathPreview(text: string, answer: Answer, decimalComma = false): Preview {
  const t = text.trim()
  if (!t) return {}
  const fix = (tex: string): string => (decimalComma ? texDecimalComma(tex) : tex)
  try {
    switch (answer.kind) {
      case 'numeric':
      case 'expression':
        return { tex: fix(exprTex(t)), note: MathParser.ambiguityNote(t) ?? undefined }
      case 'equation': {
        const { lhs, rhs } = MathParser.parseEquation(t)
        return { tex: fix(`${toLatex(lhs)} = ${toLatex(rhs)}`) }
      }
      case 'set': {
        const items = splitList(t, decimalComma).map(exprTex)
        return { tex: fix(items.join(',\\ ')) }
      }
      case 'point': {
        const inner = t.replace(/^\(|\)$/g, '')
        const items = splitList(inner, decimalComma).map(exprTex)
        return { tex: fix(`\\left(${items.join(',\\ ')}\\right)`) }
      }
      case 'interval':
        return { tex: fix(intervalTex(t)) }
      default:
        return {}
    }
  } catch (e) {
    const msg = e instanceof Error && e.name === 'MathError' ? e.message : undefined
    return { error: msg }
  }
}

/** ¿Merece la pena enseñar la vista previa? (en un número simple como «45» no aporta nada) */
export function previewIsUseful(text: string, tex: string | undefined): boolean {
  if (!tex) return false
  return !/^-?\s*\d+([.,]\d+)?\s*$/.test(text.trim())
}

// MARK: Química

/** Fórmula o ecuación química escrita a mano → `\ce{…}` de mhchem (flechas, hidratos, cargas con ^). */
export function chemTex(text: string, mode: ChemMode): string | undefined {
  const t = text.trim()
  if (!t) return undefined
  if (mode === 'configuration') {
    // «[Ar] 4s2 3d6» → [Ar] 4s² 3d⁶
    const parts = t.split(/\s+/).map((p) => {
      const core = /^\[(\w+)\]$/.exec(p)
      if (core) return `[\\mathrm{${core[1]}}]`
      const orb = /^(\d+)([spdfg])(\d+)$/i.exec(p)
      if (orb) return `${orb[1]}\\mathrm{${orb[2].toLowerCase()}}^{${orb[3]}}`
      return `\\text{${p.replace(/[{}\\]/g, '')}}`
    })
    return parts.join('\\,')
  }
  if (mode === 'name' || mode === 'number') return undefined
  const ce = t
    .replace(/[{}\\$]/g, '')
    // el equilibrio antes que la flecha (si no, «<=>» se leería como «<» + «=>»)
    .replace(/\s*(⇌|<=>|<->)\s*/g, '\u0000')
    .replace(/\s*(→|->|=>|⟶)\s*/g, ' -> ')
    .replace(/\u0000/g, ' <=> ')
    .replace(/[·•∙]/g, '*')
  return `\\ce{${ce}}`
}

// MARK: Teclado

/** «a»/«1» → 0, «b»/«2» → 1… (elegir una opción con el teclado). */
export function optionIndexForKey(key: string): number | null {
  if (key.length !== 1) return null
  const c = key.toLowerCase().charCodeAt(0)
  if (c >= 97 && c <= 122) return c - 97
  if (c >= 49 && c <= 57) return c - 49
  return null
}

/** Verdadero: 1, V, T, W (wahr) · Falso: 2, F. */
export function trueFalseForKey(key: string): boolean | null {
  switch (key.toLowerCase()) {
    case '1': case 'v': case 't': case 'w': return true
    case '2': case 'f': return false
    default: return null
  }
}

/** ¿El foco está en un sitio donde se escribe? (entonces las letras no eligen opciones) */
export function isTypingTarget(el: { tagName?: string; isContentEditable?: boolean; readOnly?: boolean; getAttribute?: (n: string) => string | null } | null | undefined): boolean {
  if (!el) return false
  const tag = (el.tagName ?? '').toLowerCase()
  // un campo de solo lectura (respuesta ya comprobada) no se escribe: ↩ sigue
  if (el.readOnly && (tag === 'input' || tag === 'textarea')) return false
  if (tag === 'textarea' || el.isContentEditable) return true
  if (tag === 'input') {
    const type = (el.getAttribute?.('type') ?? 'text').toLowerCase()
    return !['button', 'checkbox', 'radio', 'range', 'submit'].includes(type)
  }
  return false
}

/** Mueve un elemento de una lista (ordenar con el teclado o arrastrando). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list]
  const target = Math.max(0, Math.min(list.length - 1, to))
  const out = [...list]
  const [x] = out.splice(from, 1)
  out.splice(target, 0, x)
  return out
}

/** Letra de una opción: A, B, C… (y números pasado la Z). */
export const optionLetter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1))

/** Punto «x,y» (0…1) de «señala la parte». */
export function parsePoint(s: string): { x: number; y: number } | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(s)
  if (!m) return null
  const x = Number(m[1]), y = Number(m[2])
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

export const formatPoint = (x: number, y: number): string => `${x.toFixed(4)},${y.toFixed(4)}`
