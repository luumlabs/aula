// Partes de una respuesta del chat y del tutor (port de AssistantParser.swift y TutorMessageParser): Markdown, un bloque visual
// de Aula (```aula-block {json}```) o unas mini diapositivas (```aula-slides {…}```). Lo inválido se descarta sin romper el resto
// y un bloque cortado a medias (mientras llega) se enseña como texto. Se leen también los lenguajes de versiones anteriores.
import type { JSONValue } from '@engine/base/json'
import { JSONRepair } from '@engine/base/jsonRepair'
import { ContentNormalizer } from '@engine/content/normalizer'
import { ContentValidator } from '@engine/content/validator'
import { decodeBlock, type Block } from '@shared/schema/blocks'
import { decodeDeck, type Deck } from '@shared/schema/cards'

export type AssistantPart = { kind: 'markdown'; text: string } | { kind: 'block'; block: Block } | { kind: 'slides'; deck: Deck }

export const AulaFence = {
  block: 'aula-block',
  slides: 'aula-slides',
  /** Lenguajes de los bloques que escribían las versiones anteriores (chats, notas y documentos ya guardados). */
  legacyBlocks: ['mimir-block', 'estudio-block'],
  legacySlides: ['mimir-slides', 'estudio-slides'],
  isBlock(lang: string): boolean {
    return lang.startsWith(AulaFence.block) || AulaFence.legacyBlocks.some((l) => lang.startsWith(l))
  },
  isSlides(lang: string): boolean {
    return lang.startsWith(AulaFence.slides) || AulaFence.legacySlides.some((l) => lang.startsWith(l))
  }
}

const defaultValidator = new ContentValidator()

/** Bloques y presentaciones ya analizados (por su JSON): mientras llega la respuesta el texto se vuelve a separar con cada trozo. */
const blockCache = new Map<string, Block | null>()
const deckCache = new Map<string, Deck | null>()

function hasErrors(issues: { severity: string }[]): boolean {
  return issues.some((i) => i.severity === 'error')
}

/** Un bloque del JSON que escribió la IA (normalizado como en las lecciones). */
export function decodeAIBlock(v: JSONValue): Block | undefined {
  return decodeBlock(ContentNormalizer.block(v))
}

export function parseBlock(raw: string, validator: ContentValidator = defaultValidator): Block | undefined {
  const hit = blockCache.get(raw)
  if (hit !== undefined) return hit ?? undefined
  let b: Block | undefined
  try {
    b = decodeAIBlock(JSONRepair.parse(raw))
  } catch {
    b = undefined
  }
  const ok = b !== undefined && !hasErrors(validator.checkBlock(b, 'chat'))
  if (blockCache.size > 300) blockCache.clear()
  blockCache.set(raw, ok ? b! : null)
  return ok ? b : undefined
}

/** Mini presentación: hasta 12 diapositivas; las que no tienen nada que enseñar se quitan. */
export function parseDeck(raw: string, validator: ContentValidator = defaultValidator): Deck | undefined {
  const hit = deckCache.get(raw)
  if (hit !== undefined) return hit ?? undefined
  let d: Deck | undefined
  try {
    let v = JSONRepair.parse(raw)
    if (Array.isArray(v)) v = { title: '', slides: v }
    d = decodeDeck(ContentNormalizer.deck(v))
  } catch {
    d = undefined
  }
  if (d) {
    const clean = (bs: Block[]): Block[] => bs.filter((b) => !hasErrors(validator.checkBlock(b, 'slide')))
    d.slides = d.slides.slice(0, 12).map((s) => ({ ...s, blocks: clean(s.blocks), right: clean(s.right) }))
      .filter((s) => s.blocks.length > 0 || s.right.length > 0 || (s.title ?? '') !== '')
    if (!d.slides.length) d = undefined
  }
  if (deckCache.size > 100) deckCache.clear()
  deckCache.set(raw, d ?? null)
  return d
}

/** Separa una respuesta en partes. */
export function messageParts(text: string, validator: ContentValidator = defaultValidator): AssistantPart[] {
  const out: AssistantPart[] = []
  let textLines: string[] = []
  let fence: 'block' | 'slides' | null = null
  let fenceLines: string[] = []
  let fenceOpen = ''
  const flushText = (): void => {
    const t = textLines.join('\n').trim()
    if (t) out.push({ kind: 'markdown', text: t })
    textLines = []
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (fence === null && trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim().toLowerCase()
      if (AulaFence.isBlock(lang)) { fence = 'block'; fenceLines = []; fenceOpen = line; continue }
      if (AulaFence.isSlides(lang)) { fence = 'slides'; fenceLines = []; fenceOpen = line; continue }
    }
    if (fence !== null) {
      if (trimmed.startsWith('```')) {
        const raw = fenceLines.join('\n')
        if (fence === 'block') {
          const b = parseBlock(raw, validator)
          if (b) { flushText(); out.push({ kind: 'block', block: b }) }
        } else {
          const d = parseDeck(raw, validator)
          if (d) { flushText(); out.push({ kind: 'slides', deck: d }) }
        }
        fence = null
      } else fenceLines.push(line)
      continue
    }
    textLines.push(line)
  }
  if (fence !== null) textLines.push(fenceOpen, ...fenceLines) // flujo cortado: se enseña como texto
  flushText()
  return out
}

/** Texto sin los bloques visuales (para copiar, la vista previa de la lista, la memoria y el historial de la IA). */
export function plainText(text: string): string {
  return messageParts(text).flatMap((p) => (p.kind === 'markdown' ? [p.text] : p.kind === 'slides' && p.deck.title ? [p.deck.title] : [])).join('\n\n')
}

/** Los bloques de una respuesta que no pasan el validador (para que la IA los corrija si hiciera falta). */
export function invalidFences(text: string, validator: ContentValidator = defaultValidator): string[] {
  const bad: string[] = []
  const re = /```([a-z-]+)[^\n]*\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const lang = m[1].toLowerCase()
    if (AulaFence.isBlock(lang) && !parseBlock(m[2], validator)) bad.push(m[2].slice(0, 200))
    if (AulaFence.isSlides(lang) && !parseDeck(m[2], validator)) bad.push(m[2].slice(0, 200))
  }
  return bad
}

export const AssistantMessageParser = { parts: messageParts, plain: plainText, block: parseBlock, deck: parseDeck }
