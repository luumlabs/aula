// Pasos de lectura de una lección (port de LessonPlanner en LessonPlayer.swift): agrupa los bloques en páginas cómodas;
// los bloques interactivos cierran la página. Y la versión «Solo leer» (las preguntas se convierten en explicaciones).
import type { Block } from '@shared/schema/blocks'
import { textBlock } from '@shared/schema/blocks'

export type Gate = 'none' | 'predict' | 'spot' | 'tryit'

export interface LessonPage {
  index: number
  blocks: Block[]
  gate: Gate
  /** Título corto (para el índice): el primer encabezado o el tipo del primer bloque. Puede llevar $LaTeX$. */
  title: string
  /** Minutos estimados de lectura y práctica. */
  minutes: number
}

function weight(b: Block): number {
  switch (b.type) {
    case 'text': return Math.max(120, b.md.length)
    case 'callout': return Math.max(150, b.md.length)
    case 'math': return 150
    case 'table': case 'compare': case 'formulas': case 'steps': case 'diagram': case 'drawing': case 'chart': case 'plot': case 'timeline': case 'image': case 'numberline': return 420
    default: return 200
  }
}

const clip = (s: string): string => {
  const t = s.trim()
  return t.length > 70 ? `${t.slice(0, 68)}…` : t
}

/** Primer encabezado («# …», «## …») de un texto. */
export function headingOf(md: string): string | undefined {
  for (const line of md.split('\n').slice(0, 8)) {
    const m = /^#{1,6}\s+(.+)$/.exec(line.trim())
    if (m) return m[1].trim()
  }
  return undefined
}

export interface TitleWords {
  step: (n: number) => string
  example: string
  predict: string
  spot: string
  tryit: string
  recap: string
  explore: string
  formulas: string
  plot: string
}

export function pageTitle(blocks: Block[], index: number, w: TitleWords): string {
  for (const b of blocks) if (b.type === 'text') {
    const h = headingOf(b.md)
    if (h) return clip(h)
  }
  const first = blocks[0]
  if (!first) return w.step(index + 1)
  switch (first.type) {
    case 'example': return first.title?.trim() ? clip(first.title) : w.example
    case 'predict': return w.predict
    case 'spot': return w.spot
    case 'tryit': return first.title?.trim() ? clip(first.title) : w.tryit
    case 'recap': return first.title?.trim() ? clip(first.title) : w.recap
    case 'explore': return first.title?.trim() ? clip(first.title) : w.explore
    case 'callout': return first.title?.trim() ? clip(first.title) : w.step(index + 1)
    case 'formulas': return first.title?.trim() ? clip(first.title) : w.formulas
    case 'plot': return first.title?.trim() ? clip(first.title) : w.plot
    case 'text': {
      const plain = first.md.replace(/[#*_`>]/g, '').trim()
      const sentence = plain.split(/[.:;!?\n]/)[0]?.trim() ?? ''
      return sentence ? clip(sentence) : w.step(index + 1)
    }
    default: return w.step(index + 1)
  }
}

/** Minutos: lectura a 200 palabras por minuto y algo más en lo interactivo. */
export function pageMinutes(blocks: Block[]): number {
  let words = 0, extra = 0
  for (const b of blocks) {
    const text = JSON.stringify(b).replace(/"[a-zA-Z]+":/g, ' ')
    words += text.split(/\s+/).length * 0.6
    switch (b.type) {
      case 'predict': extra += 0.6; break
      case 'spot': extra += 0.8; break
      case 'tryit': extra += 1.5 * Math.max(1, b.exerciseIDs.length + b.inline.length); break
      case 'example': extra += 0.4 * b.steps.length; break
      case 'explore': extra += 1.5; break
      case 'plot': case 'chart': case 'diagram': case 'drawing': case 'table': case 'image': extra += 0.5; break
      default: break
    }
  }
  return Math.max(0.5, words / 200 + extra)
}

/** Agrupa los bloques en páginas: lo interactivo (pregunta, error, ejercicios) cierra la página. */
export function lessonPages(blocks: Block[], w: TitleWords): LessonPage[] {
  const raw: { blocks: Block[]; gate: Gate }[] = []
  let cur: Block[] = []
  let budget = 0
  const close = (gate: Gate = 'none'): void => {
    if (cur.length) raw.push({ blocks: cur, gate })
    cur = []
    budget = 0
  }
  for (const b of blocks) {
    switch (b.type) {
      case 'predict': cur.push(b); close('predict'); break
      case 'spot': cur.push(b); close('spot'); break
      case 'tryit':
        if (budget > 700) close()
        cur.push(b)
        close('tryit')
        break
      case 'example': case 'explore': case 'labeled': case 'simulation': case 'model3d': case 'map':
        if (budget > 500) close()
        cur.push(b)
        close()
        break
      case 'recap':
        close()
        cur.push(b)
        close()
        break
      default:
        if (b.type === 'text' && b.md.trimStart().startsWith('#') && cur.length && budget > 150) {
          close()
          cur.push(b)
          budget += weight(b)
          break
        }
        cur.push(b)
        budget += weight(b)
        if (budget >= 900) close()
    }
  }
  close()
  return raw.map((p, index) => ({ index, blocks: p.blocks, gate: p.gate, title: pageTitle(p.blocks, index, w), minutes: pageMinutes(p.blocks) }))
}

/** «Solo leer»: las preguntas se convierten en explicaciones y los ejercicios se quitan. */
export function readingBlocks(source: Block[]): Block[] {
  return source.flatMap((b): Block[] => {
    switch (b.type) {
      case 'predict': {
        const answers = b.options.filter((o) => o.correct).flatMap((o) => [o.md, o.why ?? ''])
        const text = [b.question, ...answers, b.explanation ?? ''].filter((x) => x.trim()).join('\n\n')
        return text ? [textBlock(text, b.id)] : []
      }
      case 'spot': {
        const text = [b.intro, ...b.lines, b.explanation].filter((x) => x.trim()).join('\n\n')
        return text ? [textBlock(text, b.id)] : []
      }
      case 'tryit':
        return []
      default:
        return [b]
    }
  })
}
