// Tarjetas de repaso y presentaciones (port de StudyModel/Cards.swift).
import { foldDiacritics, IDs } from '@engine/base/ids'
import type { JSONObject } from '@engine/base/json'
import { fallbackID, flexNum, flexStr, isObj, list, nested, pickKeys, prune, str, strings, type ItemID, type Obj } from './coding'
import { blocksField, encodeBlock, type Block } from './blocks'
import { decodeDrawing, decodeSourceRef, encodeDrawing, encodeSourceRef, type DrawingBlock, type SourceRef } from './common'
import { decodeFigurePart, encodeFigurePart, type FigurePart } from './visual'

export const FLASHCARD_KINDS = ['basic', 'cloze', 'reversible'] as const
/** basic: frente → reverso · cloze: frente con huecos {{c1::respuesta}} · reversible: se pregunta en ambos sentidos. */
export type FlashcardKind = (typeof FLASHCARD_KINDS)[number]

/** Figura de una tarjeta: imagen o dibujo con sus partes; `target` es la parte que se pregunta. */
export interface CardFigure {
  asset?: string
  drawing?: DrawingBlock
  alt: string
  credit?: string
  aspect?: number
  parts: FigurePart[]
  target: string
}

export interface Flashcard {
  id: ItemID
  skill?: ItemID
  kind: FlashcardKind
  /** Markdown con matemáticas. En las `cloze`: "La derivada de $x^2$ es {{c1::$2x$}}". */
  front: string
  back: string
  hint?: string
  tags: string[]
  source?: SourceRef
  /** Tarjeta de figura («oclusión de imagen»): el frente muestra la figura con una parte resaltada. */
  figure?: CardFigure
}

export const SLIDE_LAYOUTS = ['title', 'section', 'content', 'twoColumn', 'focus', 'quote', 'image', 'comparison'] as const
export type SlideLayout = (typeof SLIDE_LAYOUTS)[number]

export interface Slide {
  id: string
  layout: SlideLayout
  title?: string
  subtitle?: string
  blocks: Block[]
  /** Segunda columna (solo `twoColumn`). */
  right: Block[]
  /** Notas del orador / explicación ampliada. */
  notes?: string
  /** Imagen del curso (diseño `image`, o de apoyo en `content`). */
  image?: string
  /** Crédito de la imagen. */
  credit?: string
  /** Encabezados de las columnas (`comparison`). */
  leftTitle?: string
  rightTitle?: string
}

export interface Deck {
  id: ItemID
  title: string
  summary?: string
  slides: Slide[]
  /** Tema visual (`DECK_THEMES`): aula, minimal, academic, midnight, chalk. */
  theme?: string
  /** Transición entre diapositivas: "fade" (por defecto) | "slide" | "none". */
  transition?: string
}

/** Temas de presentación (colores, tipografía y fondo); la interfaz los dibuja. */
export const DECK_THEMES = ['aula', 'minimal', 'academic', 'midnight', 'chalk'] as const

export function canonicalDeckTheme(raw: string | undefined): string {
  const t = foldDiacritics((raw ?? '').toLowerCase()).replace(/ /g, '')
  switch (t) {
    case 'minimal': case 'clean': case 'white': case 'blanco': case 'minimalista': return 'minimal'
    case 'academic': case 'academico': case 'classic': case 'clasico': case 'serif': case 'paper': case 'papel': return 'academic'
    case 'midnight': case 'dark': case 'night': case 'oscuro': case 'noche': return 'midnight'
    case 'chalk': case 'chalkboard': case 'blackboard': case 'pizarra': case 'tiza': return 'chalk'
    default: return 'aula'
  }
}

export function parseSlideLayout(raw: unknown): SlideLayout {
  const s = (typeof raw === 'string' ? raw : 'content').toLowerCase().replace(/[_-]/g, '')
  switch (s) {
    case 'twocolumn': case 'twocolumns': case 'two': case 'columns': return 'twoColumn'
    case 'big': case 'focus': case 'formula': case 'figure': case 'equation': return 'focus'
    case 'image': case 'picture': case 'photo': case 'bigimage': case 'fullimage': case 'imagen': return 'image'
    case 'comparison': case 'compare': case 'versus': case 'vs': case 'comparacion': case 'comparación': return 'comparison'
    case 'cover': case 'titleslide': case 'portada': return 'title'
    default: return (SLIDE_LAYOUTS as readonly string[]).includes(s) ? (s as SlideLayout) : 'content'
  }
}

// MARK: Leer

export function decodeCardFigure(raw: unknown, d = 0): CardFigure | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  const parts = list(c, 'parts', decodeFigurePart, d).slice(0, 80)
  return prune({
    asset: str(c, 'asset'), drawing: nested(c, 'drawing', decodeDrawing, d), alt: flexStr(c, 'alt') ?? '', credit: str(c, 'credit'), aspect: flexNum(c, 'aspect'),
    parts, target: flexStr(c, 'target') ?? parts[0]?.id ?? ''
  })
}

export const cardTargetPart = (f: CardFigure): FigurePart | undefined => f.parts.find((p) => p.id === f.target)

export function decodeFlashcard(raw: unknown, d = 0, index?: number): Flashcard | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  const kindRaw = typeof c.kind === 'string' ? c.kind.toLowerCase() : 'basic'
  const figure = nested(c, 'figure', decodeCardFigure, d)
  let back = flexStr(c, 'back') ?? flexStr(c, 'answer') ?? ''
  // tarjeta de figura sin reverso escrito: el reverso es el nombre de la parte
  const target = figure ? cardTargetPart(figure) : undefined
  if (back === '' && target) back = `**${target.name}**` + (target.detail !== undefined ? `\n\n${target.detail}` : '')
  return prune({
    id: flexStr(c, 'id') ?? fallbackID(raw, index), skill: flexStr(c, 'skill'),
    kind: (FLASHCARD_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as FlashcardKind) : 'basic',
    front: flexStr(c, 'front') ?? flexStr(c, 'question') ?? '', back, hint: str(c, 'hint'), tags: strings(c, 'tags'),
    source: nested(c, 'source', decodeSourceRef, d), figure
  })
}

export function decodeSlide(raw: unknown, d = 0): Slide | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({
    id: flexStr(c, 'id') ?? IDs.short(5), layout: parseSlideLayout(c.layout), title: str(c, 'title'), subtitle: str(c, 'subtitle'),
    blocks: blocksField(c, 'blocks', d), right: blocksField(c, 'right', d), notes: str(c, 'notes'),
    image: str(c, 'image') ?? str(c, 'asset'), credit: str(c, 'credit'), leftTitle: str(c, 'leftTitle'), rightTitle: str(c, 'rightTitle')
  })
}

export function decodeDeck(raw: unknown, d = 0): Deck | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({
    id: flexStr(c, 'id') ?? IDs.short(6), title: flexStr(c, 'title') ?? 'Presentación', summary: str(c, 'summary'), slides: list(c, 'slides', decodeSlide, d),
    theme: str(c, 'theme'), transition: str(c, 'transition')
  })
}

// MARK: Escribir

export function encodeCardFigure(f: CardFigure): JSONObject {
  const out = pickKeys(f, ['asset', 'alt', 'credit', 'aspect', 'target'])
  if (f.drawing) out.drawing = encodeDrawing(f.drawing)
  out.parts = f.parts.map(encodeFigurePart)
  return out
}

export function encodeFlashcard(v: Flashcard): JSONObject {
  const out = pickKeys(v, ['id', 'skill', 'kind', 'front', 'back', 'hint', 'tags'])
  if (v.source) out.source = encodeSourceRef(v.source)
  if (v.figure) out.figure = encodeCardFigure(v.figure)
  return out
}

export function encodeSlide(v: Slide): JSONObject {
  const out = pickKeys(v, ['id', 'layout', 'title', 'subtitle', 'notes', 'image', 'credit', 'leftTitle', 'rightTitle'])
  out.blocks = v.blocks.map(encodeBlock)
  out.right = v.right.map(encodeBlock)
  return out
}

export function encodeDeck(v: Deck): JSONObject {
  const out = pickKeys(v, ['id', 'title', 'summary', 'theme', 'transition'])
  out.slides = v.slides.map(encodeSlide)
  return out
}

// MARK: Ayudas

/** Número de huecos de una tarjeta `cloze`. */
export function clozeCount(card: Flashcard): number {
  if (card.kind !== 'cloze') return 0
  return Math.max(1, card.front.split('{{c').length - 1)
}

/** Ancho / alto efectivo de la figura de una tarjeta. */
export { effectiveAspect as cardFigureAspect } from './visual'

export function makeFlashcard(p: Partial<Flashcard> & { front: string; back: string }): Flashcard {
  return prune({ id: IDs.short(6), kind: 'basic' as FlashcardKind, tags: [], ...p })
}
