// Tipos compartidos por bloques, ejercicios y cursos: citas de fuentes, avisos de calidad, dibujos y fórmulas
// (de StudyModel/Coding.swift y Blocks.swift).
import type { JSONObject } from '@engine/base/json'
import {
  bool, enumOf, flexStr, int, isObj, list, num, pickKeys, prune, str, strictPoints, vInt, vStr, type ItemID, type Obj
} from './coding'

/** Referencia a un pasaje de las fuentes del usuario («el libro, p. 83»). */
export interface SourceRef {
  /** Id de la fuente en el curso. */
  source: ItemID
  page?: number
  pageEnd?: number
  /** Id del fragmento. */
  chunk?: string
  /** Cita corta textual. */
  quote?: string
}

/** Decodificación estricta (sin `init(from:)` propio en Swift): un campo con el tipo equivocado invalida la referencia. */
export function decodeSourceRef(raw: unknown): SourceRef | undefined {
  if (!isObj(raw)) return undefined
  const source = vStr(raw.source)
  if (source === undefined) return undefined
  const optInt = (k: string): number | undefined | null => (raw[k] === undefined || raw[k] === null ? undefined : vInt(raw[k]) ?? null)
  const optStr = (k: string): string | undefined | null => (raw[k] === undefined || raw[k] === null ? undefined : vStr(raw[k]) ?? null)
  const page = optInt('page'), pageEnd = optInt('pageEnd'), chunk = optStr('chunk'), quote = optStr('quote')
  if (page === null || pageEnd === null || chunk === null || quote === null) return undefined
  return prune({ source, page, pageEnd, chunk, quote })
}

export const encodeSourceRef = (v: SourceRef): JSONObject => pickKeys(v, ['source', 'page', 'pageEnd', 'chunk', 'quote'])

/** Texto de la cita («p. 12», «p. 12–14», «fuente»). */
export function sourceRefLabel(r: SourceRef, words: { page: string; source: string } = { page: 'p.', source: 'fuente' }): string {
  if (r.page !== undefined) {
    if (r.pageEnd !== undefined && r.pageEnd !== r.page) return `${words.page} ${r.page}–${r.pageEnd}`
    return `${words.page} ${r.page}`
  }
  return words.source
}

export const ISSUE_SEVERITIES = ['error', 'warning', 'info'] as const
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number]

/** Avisos de calidad de un contenido (los produce el validador; se muestran en «Revisar»). */
export interface ContentIssue {
  severity: IssueSeverity
  /** "lesson[3]" · "exercises.e12.answer" */
  path: string
  message: string
}

export function decodeContentIssue(raw: unknown): ContentIssue | undefined {
  if (!isObj(raw)) return undefined
  const severity = enumOf(raw, 'severity', ISSUE_SEVERITIES)
  const path = str(raw, 'path'), message = str(raw, 'message')
  if (!severity || path === undefined || message === undefined) return undefined
  return { severity, path, message }
}

export const encodeContentIssue = (v: ContentIssue): JSONObject => pickKeys(v, ['severity', 'path', 'message'])
export const contentIssueID = (v: ContentIssue): string => `${v.severity}|${v.path}|${v.message}`

// MARK: Dibujo vectorial

export const DRAW_KINDS = ['line', 'arrow', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'arc', 'text', 'dot', 'angle', 'rightAngle', 'curve', 'tick'] as const
export type DrawKind = (typeof DRAW_KINDS)[number]

/** Elemento de un dibujo vectorial libre. Coordenadas en el lienzo (0,0 = esquina superior izquierda). */
export interface DrawItem {
  kind: DrawKind
  x1?: number; y1?: number; x2?: number; y2?: number
  x?: number; y?: number; w?: number; h?: number
  cx?: number; cy?: number; r?: number; rx?: number; ry?: number
  /** Grados (0° = derecha, antihorario como en matemáticas). */
  start?: number
  end?: number
  /** [[x,y],…] */
  points?: number[][]
  /** Texto o LaTeX ($…$) para `text` y etiquetas. */
  text?: string
  size?: number
  anchor?: string
  stroke?: string
  fill?: string
  width?: number
  dashed?: boolean
  opacity?: number
  label?: string
}

const DRAW_NUMBERS = ['x1', 'y1', 'x2', 'y2', 'x', 'y', 'w', 'h', 'cx', 'cy', 'r', 'rx', 'ry', 'start', 'end', 'size', 'width', 'opacity'] as const

export function decodeDrawItem(raw: unknown): DrawItem | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  const out: DrawItem = { kind: enumOf(c, 'kind', DRAW_KINDS) ?? 'line' }
  for (const k of DRAW_NUMBERS) { const v = num(c, k); if (v !== undefined) out[k] = v }
  const pts = strictPoints(c, 'points'); if (pts) out.points = pts
  const text = flexStr(c, 'text'); if (text !== undefined) out.text = text
  for (const k of ['anchor', 'stroke', 'fill', 'label'] as const) { const v = str(c, k); if (v !== undefined) out[k] = v }
  const dashed = bool(c, 'dashed'); if (dashed !== undefined) out.dashed = dashed
  return out
}

export const encodeDrawItem = (v: DrawItem): JSONObject =>
  pickKeys(v, ['kind', ...DRAW_NUMBERS, 'points', 'text', 'anchor', 'stroke', 'fill', 'dashed', 'label'])

export interface DrawingBlock {
  width: number
  height: number
  items: DrawItem[]
  caption?: string
  title?: string
}

export function decodeDrawing(raw: unknown, d = 0): DrawingBlock | undefined {
  if (!isObj(raw)) return undefined
  return prune({ width: num(raw, 'width') ?? 400, height: num(raw, 'height') ?? 300, items: list(raw, 'items', decodeDrawItem, d), caption: str(raw, 'caption'), title: str(raw, 'title') })
}

export function encodeDrawing(v: DrawingBlock): JSONObject {
  const out = pickKeys(v, ['width', 'height', 'caption', 'title'])
  out.items = v.items.map(encodeDrawItem)
  return out
}

// MARK: Fórmulas

export interface FormulaVar {
  /** LaTeX corto: "v_0". */
  symbol: string
  meaning: string
  unit?: string
}

export interface FormulaItem {
  name: string
  tex: string
  /** Cuándo se usa / condiciones. */
  when?: string
  vars: FormulaVar[]
}

export function decodeFormulaVar(raw: unknown): FormulaVar | undefined {
  if (!isObj(raw)) return undefined
  return prune({ symbol: flexStr(raw, 'symbol') ?? '', meaning: flexStr(raw, 'meaning') ?? '', unit: str(raw, 'unit') })
}

export function decodeFormulaItem(raw: unknown, d = 0): FormulaItem | undefined {
  if (!isObj(raw)) return undefined
  return prune({ name: flexStr(raw, 'name') ?? '', tex: flexStr(raw, 'tex') ?? flexStr(raw, 'latex') ?? '', when: str(raw, 'when'), vars: list(raw, 'vars', decodeFormulaVar, d) })
}

export const encodeFormulaVar = (v: FormulaVar): JSONObject => pickKeys(v, ['symbol', 'meaning', 'unit'])

export function encodeFormulaItem(v: FormulaItem): JSONObject {
  const out = pickKeys(v, ['name', 'tex', 'when'])
  out.vars = v.vars.map(encodeFormulaVar)
  return out
}

export function makeFormulaItem(name: string, tex: string, more: Partial<FormulaItem> = {}): FormulaItem {
  return prune({ name, tex, vars: [], ...more })
}

/** Entero acotado de un campo (como `ContentLimits.clamp(c.value(.k, def), lo, hi)`). */
export function clampedInt(o: Obj, k: string, def: number, lo: number, hi: number): number {
  return Math.min(Math.max(int(o, k) ?? def, lo), hi)
}

/** Número acotado de un campo (los NaN, imposibles en JSON, irían a `fallback`). */
export function clampedNum(o: Obj, k: string, def: number, lo: number, hi: number): number {
  return Math.min(Math.max(num(o, k) ?? def, lo), hi)
}
