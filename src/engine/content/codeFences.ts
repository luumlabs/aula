// El código dentro de un Markdown: vallas (``` y ~~~) y `código en línea`. Lo que trabaja sobre las fórmulas o la prosa
// (normalizar delimitadores, contar «$», limpiar la cola de lo que se está escribiendo) no debe tocar el código: un `$HOME`,
// un `x**2` o un `\(\d+\)` de una expresión regular son código, no Markdown. Puro.

export interface Fence {
  char: '`' | '~'
  size: number
  /** La etiqueta de la valla tal cual («python», «c++ title=a.cpp», «{r}»). */
  info: string
}

// Con cualquier sangría, y también dentro de una cita («> ```bash») o al abrir tras un marcador de lista («- ```bash», «1. ```py»).
const QUOTE = /^(?:\s*>)+ ?/
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s+/
const OPEN = /^\s*(`{3,}|~{3,})(.*)$/
const CLOSE = /^\s*(`{3,}|~{3,})\s*$/

/** Quita el prefijo de cita (y, en la línea que abre, el marcador de lista) para reconocer vallas anidadas. */
export function stripFenceContainer(line: string, opening = false): string {
  let s = line.replace(QUOTE, '')
  if (opening) s = s.replace(LIST_ITEM, '')
  return s
}

/** La valla que abre esta línea, si la abre (las de acentos graves no llevan acentos graves en la etiqueta). */
export function fenceOpening(line: string): Fence | undefined {
  const m = OPEN.exec(stripFenceContainer(line, true))
  if (!m) return undefined
  const char = m[1][0] as Fence['char']
  if (char === '`' && m[2].includes('`')) return undefined
  return { char, size: m[1].length, info: m[2].trim() }
}

/** ¿Cierra esta línea la valla abierta? (el mismo carácter, al menos tan largo y nada detrás). */
export function fenceCloses(line: string, open: Pick<Fence, 'char' | 'size'>): boolean {
  const m = CLOSE.exec(stripFenceContainer(line))
  return !!m && m[1][0] === open.char && m[1].length >= open.size
}

export interface FenceState {
  /** La valla que sigue abierta al final del texto, con el número de su línea de apertura (desde 0). */
  open?: Fence & { line: number }
  /** Cuántas líneas tiene el texto. */
  lines: number
  /** Dónde acaba (desde 0, sin el salto de línea) la última valla cerrada; 0 si no hay ninguna. */
  closedEnd: number
}

/** En qué valla acaba el texto (para lo que llega por partes en el chat). */
export function fenceState(text: string): FenceState {
  const lines = text.split('\n')
  let open: (Fence & { line: number }) | undefined
  let closedEnd = 0
  let pos = 0
  lines.forEach((line, i) => {
    if (open) {
      if (fenceCloses(line, open)) {
        open = undefined
        closedEnd = pos + line.length
      }
    } else {
      const f = fenceOpening(line)
      if (f) open = { ...f, line: i }
    }
    pos += line.length + 1
  })
  return { ...(open ? { open } : {}), lines: lines.length, closedEnd }
}

/** El final del párrafo que empieza en `from` (una línea en blanco lo corta: el código en línea no la cruza). */
function paragraphEnd(md: string, from: number, to: number): number {
  const re = /\n[ \t]*\n/g
  re.lastIndex = from
  const m = re.exec(md)
  return m && m.index < to ? m.index : to
}

/** Los `código en línea` de md[from, to): cada racha de n acentos graves se cierra con otra de exactamente n. */
function inlineCode(md: string, from: number, to: number, out: Array<[number, number]>): void {
  let i = from
  while (i < to) {
    const c = md[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c !== '`') {
      i++
      continue
    }
    let n = 0
    while (md[i + n] === '`') n++
    const end = paragraphEnd(md, i, to)
    let j = i + n
    let close = -1
    while (j < end) {
      if (md[j] !== '`') {
        j++
        continue
      }
      let m = 0
      while (md[j + m] === '`') m++
      if (m === n) {
        close = j
        break
      }
      j += m
    }
    if (close < 0) {
      i += n
      continue
    }
    out.push([i, close + n])
    i = close + n
  }
}

/**
 * Dónde hay código en un Markdown: [inicio, fin) de cada bloque con vallas (de la línea que abre a la que cierra; uno sin
 * cerrar llega hasta el final, como en CommonMark) y de cada `código en línea`, en orden.
 */
export function codeRanges(md: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let open: (Fence & { start: number }) | undefined
  let prose = 0
  let pos = 0
  for (const line of md.split('\n')) {
    const end = pos + line.length
    if (open) {
      if (fenceCloses(line, open)) {
        out.push([open.start, end])
        open = undefined
        prose = end
      }
    } else {
      const f = fenceOpening(line)
      if (f) {
        inlineCode(md, prose, pos, out)
        open = { ...f, start: pos }
      }
    }
    pos = end + 1
  }
  if (open) out.push([open.start, md.length])
  else inlineCode(md, prose, md.length, out)
  return out
}

/** El texto con el código cambiado por espacios (los saltos de línea se quedan): mismas posiciones, nada de código. */
export function maskCode(md: string): string {
  const ranges = codeRanges(md)
  if (!ranges.length) return md
  let out = ''
  let last = 0
  for (const [a, b] of ranges) {
    out += md.slice(last, a) + md.slice(a, b).replace(/[^\n]/g, ' ')
    last = b
  }
  return out + md.slice(last)
}

/** El texto sin el código (para contar lo que es de la prosa, como los «$» de las fórmulas). */
export function withoutCode(md: string): string {
  const ranges = codeRanges(md)
  if (!ranges.length) return md
  let out = ''
  let last = 0
  for (const [a, b] of ranges) {
    out += md.slice(last, a)
    last = b
  }
  return out + md.slice(last)
}

/** Aplica `fn` a la prosa sin tocar el código: cada trozo de código pasa por `fn` como una marca y vuelve tal cual. */
export function mapOutsideCode(md: string, fn: (prose: string) => string): string {
  const ranges = codeRanges(md)
  if (!ranges.length) return fn(md)
  const kept: string[] = []
  let masked = ''
  let last = 0
  ranges.forEach(([a, b], i) => {
    masked += md.slice(last, a) + `${i}`
    kept.push(md.slice(a, b))
    last = b
  })
  masked += md.slice(last)
  return fn(masked).replace(/(\d+)/g, (_, i: string) => kept[Number(i)] ?? '')
}

/** ¿Es este trozo de Markdown (de la línea que abre al final) un bloque con vallas que se cierra? Uno sangrado, también.
 *  Dentro de una cita, sus líneas llevan el «>» delante. */
export function isClosedFence(block: string): boolean {
  const lines = block.replace(/\n+$/, '').split('\n').map((l) => l.replace(/^(\s*>)+/, ''))
  const open = fenceOpening(lines[0] ?? '')
  if (!open) return true
  return lines.length > 1 && fenceCloses(lines[lines.length - 1], open)
}
