// Utilidades isomorfas de Documentos: claves de documento, páginas citadas, tarjetas de una respuesta, rangos de páginas,
// lectura tolerante de las marcas y de las peticiones (lo que llega por IPC o de un archivo se valida aquí).
import { repairParse } from '@engine/base/jsonRepair'
import { isObj, vDate, vInt, vStr, type Obj } from '../schema/coding'
import {
  DOCUMENT_FORMATS, DOCUMENT_KINDS, MARK_COLORS, MARK_KINDS,
  type DocumentAnnotation, type DocumentCardDraft, type DocumentFormat, type DocumentKind, type DocumentMarkColor, type DocumentMarkKind,
  type DocumentRef, type DocumentRequest, type DocumentScope, type DocumentStyle
} from './types'

// MARK: - Claves

/** Clave estable de un documento: «source:<curso>:<material>», «import:<id>» o «saved:<curso>:<id>» (partes codificadas). */
export function docKey(ref: DocumentRef): string {
  const e = encodeURIComponent
  switch (ref.kind) {
    case 'source': return `source:${e(ref.packId)}:${e(ref.sourceId)}`
    case 'import': return `import:${e(ref.docId)}`
    case 'saved': return `saved:${e(ref.packId)}:${e(ref.savedId)}`
  }
}

/** La referencia de una clave (y la página, si la clave lleva «@12» al final). undefined si no se entiende. */
export function parseDocKey(key: string): { ref: DocumentRef; page?: number } | undefined {
  const at = key.lastIndexOf('@')
  const pageRaw = at > 0 ? Number(key.slice(at + 1)) : NaN
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : undefined
  const base = page !== undefined ? key.slice(0, at) : key
  const parts = base.split(':')
  const d = (s: string | undefined): string | undefined => {
    if (s === undefined || s === '') return undefined
    try { return decodeURIComponent(s) } catch { return undefined }
  }
  let ref: DocumentRef | undefined
  if (parts[0] === 'source' && parts.length === 3) {
    const packId = d(parts[1]), sourceId = d(parts[2])
    if (packId && sourceId) ref = { kind: 'source', packId, sourceId }
  } else if (parts[0] === 'import' && parts.length === 2) {
    const docId = d(parts[1])
    if (docId) ref = { kind: 'import', docId }
  } else if (parts[0] === 'saved' && parts.length === 3) {
    const packId = d(parts[1]), savedId = d(parts[2])
    if (packId && savedId) ref = { kind: 'saved', packId, savedId }
  }
  return ref ? { ref, page } : undefined
}

/** La referencia de un argumento de IPC (forma estricta) o undefined. */
export function parseDocRef(raw: unknown): DocumentRef | undefined {
  if (!isObj(raw)) return undefined
  const s = (k: string): string | undefined => {
    const v = raw[k]
    return typeof v === 'string' && v.length > 0 && v.length <= 300 ? v : undefined
  }
  switch (raw.kind) {
    case 'source': { const packId = s('packId'), sourceId = s('sourceId'); return packId && sourceId ? { kind: 'source', packId, sourceId } : undefined }
    case 'import': { const docId = s('docId'); return docId ? { kind: 'import', docId } : undefined }
    case 'saved': { const packId = s('packId'), savedId = s('savedId'); return packId && savedId ? { kind: 'saved', packId, savedId } : undefined }
    default: return undefined
  }
}

export function sameRef(a: DocumentRef, b: DocumentRef): boolean {
  return docKey(a) === docKey(b)
}

// MARK: - Citas y tarjetas

/** Las páginas citadas en una respuesta («(p. 12)», «pp. 3–4», «p. 7, 9», «[p. 5]»), sin repetir y dentro del documento. */
export function citedPages(text: string, maxPage: number): number[] {
  const re = /\bpp?\.\s*(\d{1,4})(?:\s*[–-]\s*(\d{1,4}))?((?:\s*,\s*\d{1,4})*)/g
  const out: number[] = []
  for (const m of text.matchAll(re)) {
    out.push(Number(m[1]))
    if (m[2]) out.push(Number(m[2]))
    if (m[3]) for (const x of m[3].split(',')) { const n = Number(x.trim()); if (x.trim()) out.push(n) }
  }
  const seen = new Set<number>()
  return out.filter((p) => Number.isInteger(p) && p >= 1 && p <= maxPage && !seen.has(p) && (seen.add(p), true)).sort((a, b) => a - b)
}

/** Partes de un texto con sus citas de página separadas (para hacerlas pulsables). */
export function splitCitations(text: string, maxPage: number): Array<{ text: string; page?: number }> {
  const re = /[([]?\bpp?\.\s*(\d{1,4})(?:\s*[–-]\s*\d{1,4})?[)\]]?/g
  const out: Array<{ text: string; page?: number }> = []
  let last = 0
  for (const m of text.matchAll(re)) {
    const p = Number(m[1])
    if (!(p >= 1 && p <= maxPage)) continue
    const i = m.index ?? 0
    if (i > last) out.push({ text: text.slice(last, i) })
    out.push({ text: m[0], page: p })
    last = i + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/** Tarjetas de la respuesta de «tarjetas» (JSON tolerante: «front/back» o «question/answer»). Como mucho 12. */
export function parseCards(text: string): DocumentCardDraft[] {
  let t = text.trim()
  const a = t.indexOf('['), b = t.lastIndexOf(']')
  if (a >= 0 && b > a) t = t.slice(a, b + 1)
  let v: unknown
  try { v = repairParse(t) } catch { return [] }
  if (!Array.isArray(v)) return []
  const out: DocumentCardDraft[] = []
  for (const x of v) {
    if (!isObj(x)) continue
    const f = (vStr(x.front) ?? vStr(x.question) ?? '').trim()
    const k = (vStr(x.back) ?? vStr(x.answer) ?? '').trim()
    if (f && k) out.push({ front: f, back: k })
    if (out.length >= 12) break
  }
  return out
}

/** Páginas pedidas como «3», «3-5», «3,7,9» o «12–». undefined si no se entiende o no queda ninguna. */
export function parsePages(raw: string | undefined, count: number): number[] | undefined {
  const s = (raw ?? '').replace(/\s/g, '').replace(/[–—]/g, '-')
  if (!s) return undefined
  const out: number[] = []
  for (const part of s.split(',')) {
    const ends = part.split('-')
    const a = Number(ends[0])
    if (ends.length === 1 && ends[0] !== '' && Number.isInteger(a)) out.push(a)
    else if (ends.length === 2 && ends[0] !== '' && Number.isInteger(a)) {
      // extremos acotados a las páginas que hay (un «9223372036854775800-» desbordaba en Swift)
      const lo = Math.max(a, 1), hi = Math.min(ends[1] === '' ? count : Number(ends[1]), count)
      if (!Number.isFinite(hi)) return undefined
      for (let p = lo; p <= Math.min(hi, lo + 200); p++) out.push(p)
    } else return undefined
  }
  const valid = [...new Set(out.filter((p) => p >= 1 && p <= count))]
  return valid.length ? valid : undefined
}

// MARK: - Marcas

/** RGB (0…1) del marcador en papel (los de Swift). */
export const MARK_RGB: Record<DocumentMarkColor, [number, number, number]> = {
  yellow: [0.98, 0.84, 0.35],
  green: [0.55, 0.8, 0.55],
  blue: [0.52, 0.72, 0.95],
  pink: [0.96, 0.6, 0.72]
}

export function markCSS(c: DocumentMarkColor, alpha = 1): string {
  const [r, g, b] = MARK_RGB[c]
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`
}

function markKind(v: unknown): DocumentMarkKind {
  const s = (typeof v === 'string' ? v : 'highlight').toLowerCase()
  if (['underline', 'subrayar', 'subrayado'].includes(s)) return 'underline'
  if (['strike', 'strikeout', 'tachar'].includes(s)) return 'strike'
  if (['note', 'comment', 'nota', 'comentario', 'sticky'].includes(s)) return 'note'
  return (MARK_KINDS as readonly string[]).includes(s) ? (s as DocumentMarkKind) : 'highlight'
}

function markColor(v: unknown): DocumentMarkColor {
  const s = (typeof v === 'string' ? v : 'yellow').toLowerCase()
  if ((MARK_COLORS as readonly string[]).includes(s)) return s as DocumentMarkColor
  if (s === 'amarillo') return 'yellow'
  if (s === 'verde') return 'green'
  if (s === 'azul') return 'blue'
  if (['rosa', 'red', 'rojo', 'purple'].includes(s)) return 'pink'
  return 'yellow'
}

const clip = (s: string, n: number): string => (Array.from(s).length > n ? Array.from(s).slice(0, n).join('') : s)

/** Una marca leída con tolerancia (como el `init(from:)` de Swift): undefined solo si no es un objeto. */
export function decodeAnnotation(raw: unknown, fallbackId: () => string): DocumentAnnotation | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  const now = new Date().toISOString()
  const created = vDate(c.created) ?? now
  const rects = Array.isArray(c.rects)
    ? c.rects.filter((r): r is number[] => Array.isArray(r) && r.length === 4 && r.every((x) => typeof x === 'number' && Number.isFinite(x))).slice(0, 200)
    : []
  const a: DocumentAnnotation = {
    id: vStr(c.id) ?? fallbackId(),
    page: Math.max(1, Math.min(vInt(c.page) ?? 1, 100_000)),
    kind: markKind(c.kind),
    color: markColor(c.color),
    rects,
    text: clip(vStr(c.text) ?? '', 2000),
    author: c.author === 'aula' ? 'aula' : 'student',
    created,
    updated: vDate(c.updated) ?? created
  }
  const note = vStr(c.note)
  if (note !== undefined) a.note = clip(note, 20_000)
  return a
}

export function annotationHasNote(a: DocumentAnnotation): boolean {
  return (a.note ?? '').trim() !== ''
}

// MARK: - Peticiones de documentos

export function defaultDocumentStyle(paper: 'a4' | 'letter' = 'a4'): DocumentStyle {
  return {
    paper, fontSize: 11, color: true, serif: true, includeNotes: true, includeFormulas: true, includeGlossary: true, includeMistakes: false,
    includeAnswers: true, includeSolutions: true, cardsPerPage: 8, duplex: true, handout: false
  }
}

/** Tipo de documento a partir de lo que escriba la IA o la interfaz («guía», «chuleta», «practice exam»…). */
export function parseDocumentKind(raw: unknown): DocumentKind | undefined {
  const s = (typeof raw === 'string' ? raw : '').toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[_\- ]/g, '')
  if (['guide', 'studyguide', 'guia', 'guiadeestudio', 'book', 'handbook'].includes(s)) return 'guide'
  if (['summary', 'resumen', 'notes', 'apuntes', 'classsummary', 'lecturenotes', 'outline', 'custom', 'document', 'report', 'notas'].includes(s)) return 'summary'
  if (['cheatsheet', 'chuleta', 'formulasheet', 'hojadeformulas', 'formulas', 'onepager', 'crib', 'cribsheet', 'reference', 'referencecard'].includes(s)) return 'cheatsheet'
  if (['flashcards', 'cards', 'tarjetas', 'printablecards', 'fichas'].includes(s)) return 'flashcards'
  if (['exam', 'practiceexam', 'mockexam', 'test', 'quiz', 'examen', 'simulacro', 'worksheet', 'practice', 'ejercicios', 'exercises'].includes(s)) return 'exam'
  if (['slides', 'deck', 'presentation', 'diapositivas', 'presentacion', 'slideshow'].includes(s)) return 'slides'
  return (DOCUMENT_KINDS as readonly string[]).includes(s) ? (s as DocumentKind) : undefined
}

export function parseDocumentFormat(raw: unknown): DocumentFormat | undefined {
  const s = (typeof raw === 'string' ? raw : '').toLowerCase().replace(/^[. ]+|[. ]+$/g, '')
  if (s === 'pdf') return 'pdf'
  if (['docx', 'word', 'doc', 'office'].includes(s)) return 'docx'
  if (['md', 'markdown', 'text', 'txt'].includes(s)) return 'markdown'
  return (DOCUMENT_FORMATS as readonly string[]).includes(s) ? (s as DocumentFormat) : undefined
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 300).slice(0, 500) : [])

/** Una petición de documento validada (los valores fuera de rango se acotan como en Swift). Lanza si falta el tipo. */
export function parseDocumentRequest(raw: unknown): DocumentRequest {
  if (!isObj(raw)) throw new Error('Petición de documento no válida')
  const kind = parseDocumentKind(raw.kind)
  if (!kind) throw new Error('Tipo de documento no válido')
  const st = isObj(raw.style) ? raw.style : {}
  const base = defaultDocumentStyle(st.paper === 'letter' ? 'letter' : 'a4')
  const b = (k: keyof DocumentStyle): boolean => (typeof st[k] === 'boolean' ? (st[k] as boolean) : (base[k] as boolean))
  const fs = typeof st.fontSize === 'number' && Number.isFinite(st.fontSize) ? st.fontSize : base.fontSize
  const style: DocumentStyle = {
    paper: base.paper, fontSize: Math.min(13, Math.max(9, fs)), color: b('color'), serif: b('serif'), includeNotes: b('includeNotes'),
    includeFormulas: b('includeFormulas'), includeGlossary: b('includeGlossary'), includeMistakes: b('includeMistakes'), includeAnswers: b('includeAnswers'),
    includeSolutions: b('includeSolutions'), cardsPerPage: [6, 8, 10].includes(st.cardsPerPage as number) ? (st.cardsPerPage as number) : 8,
    duplex: b('duplex'), handout: b('handout')
  }
  const qc = vInt(st.questionCount)
  if (qc !== undefined && qc > 0) style.questionCount = Math.min(60, Math.max(1, qc))
  const min = vInt(st.minutes)
  if (min !== undefined && min > 0) style.minutes = Math.min(600, Math.max(5, min))
  const seed = vInt(st.seed)
  if (seed !== undefined && seed >= 0) style.seed = seed
  const sc = isObj(raw.scope) ? raw.scope : {}
  const scope: DocumentScope = { skillIDs: ids(sc.skillIDs), unitIDs: ids(sc.unitIDs), onlyDone: sc.onlyDone === true }
  const req: DocumentRequest = { kind, scope, style, format: parseDocumentFormat(raw.format) ?? 'pdf' }
  const s = (k: string, max: number): string | undefined => {
    const v = raw[k]
    return typeof v === 'string' && v.trim() ? clip(v, max) : undefined
  }
  const course = s('courseID', 200)
  if (course) req.courseID = course
  const title = s('title', 300), subtitle = s('subtitle', 300), content = s('content', 400_000), lang = s('lang', 12)
  if (title) req.title = title
  if (subtitle) req.subtitle = subtitle
  if (content) req.content = content
  if (lang) req.lang = lang
  return req
}

export function isWholeCourse(scope: DocumentScope): boolean {
  return scope.skillIDs.length === 0 && scope.unitIDs.length === 0 && !scope.onlyDone
}

/** Nombre de archivo seguro (sin «/», «:», comillas…; como mucho `max` caracteres). */
export function safeFileName(s: string, max = 90): string {
  let t = s.split(/[/\\:?%*|"<>\n\r\t]/).join('-').trim()
  while (t.startsWith('.')) t = t.slice(1)
  if (Array.from(t).length > max) t = Array.from(t).slice(0, max).join('').trim()
  return t || 'Aula'
}
