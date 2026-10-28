// Resaltados sin tocar el DOM: rangos de texto (un subrayado guardado, una coincidencia de la búsqueda) pintados con la API de
// resaltados de CSS (`::highlight(...)`). Se buscan sin acentos ni mayúsculas y con los espacios y saltos de línea flexibles.
import type { DocumentMarkColor } from '@shared/documents'
import { foldKeep } from '../lib'

interface TextMap {
  /** Texto plegado sin espacios (los trozos de la capa de texto de pdf.js no siempre los traen, o traen de más). */
  text: string
  /** Para cada carácter de `text`: el nodo y la posición en él. */
  at: { node: Text; offset: number }[]
}

function textMap(root: Element): TextMap {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let text = ''
  const at: TextMap['at'] = []
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const folded = foldKeep(n.data)
    for (let i = 0; i < folded.length; i++) {
      const ch = folded[i]
      if (/\s/.test(ch)) continue
      text += ch
      at.push({ node: n, offset: i })
    }
  }
  return { text, at }
}

const squash = (s: string): string => foldKeep(s).replace(/\s+/g, '')

/** Rangos de cada aparición de `query` dentro de `root` (como mucho `limit`). */
export function findRanges(root: Element, query: string, limit = 200): Range[] {
  const q = squash(query)
  if (!q) return []
  const map = textMap(root)
  const out: Range[] = []
  let from = 0
  while (out.length < limit) {
    const i = map.text.indexOf(q, from)
    if (i < 0) break
    const a = map.at[i], b = map.at[i + q.length - 1]
    if (!a || !b) break
    try {
      const r = document.createRange()
      r.setStart(a.node, a.offset)
      r.setEnd(b.node, Math.min(b.offset + 1, b.node.length))
      out.push(r)
    } catch { /* nodo que ya no está */ }
    from = i + q.length
  }
  return out
}

/** El primer rango de una cita guardada (sus primeras palabras si la cita entera no aparece igual). */
export function quoteRange(root: Element, quote: string): Range | undefined {
  const exact = findRanges(root, quote, 1)[0]
  if (exact) return exact
  const words = foldKeep(quote).split(/\s+/).filter(Boolean)
  if (words.length >= 6) {
    const head = findRanges(root, words.slice(0, 4).join(' '), 1)[0]
    const tail = findRanges(root, words.slice(-3).join(' '), 50).find((r) => head && r.compareBoundaryPoints(Range.START_TO_START, head) > 0)
    if (head && tail) {
      const r = document.createRange()
      r.setStart(head.startContainer, head.startOffset)
      r.setEnd(tail.endContainer, tail.endOffset)
      return r
    }
  }
  return words.length > 4 ? findRanges(root, words.slice(0, 6).join(' '), 1)[0] : undefined
}

type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void }
type HighlightCtor = new (...ranges: Range[]) => { priority: number }

function registry(): { reg: HighlightRegistry; H: HighlightCtor } | undefined {
  const css = (globalThis as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS
  const H = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight
  return css?.highlights && H ? { reg: css.highlights, H } : undefined
}

/** Pinta (o quita, con una lista vacía) un grupo de rangos con un nombre de `::highlight`. */
export function paint(name: string, ranges: Range[], priority = 0): void {
  const r = registry()
  if (!r) return
  if (!ranges.length) { r.reg.delete(name); return }
  const h = new r.H(...ranges)
  h.priority = priority
  r.reg.set(name, h)
}

export const MARK_HIGHLIGHT = (kind: 'highlight' | 'underline' | 'strike', color: DocumentMarkColor): string => `aula-${kind}-${color}`
