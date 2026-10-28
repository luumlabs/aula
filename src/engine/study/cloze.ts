// Texto de una tarjeta cloze («{{c1::respuesta}}», «{{c1::respuesta::pista}}») con los huecos ocultos o resueltos. Fuera de las
// fórmulas, en Markdown: «**[…]**» / «**respuesta**». Dentro de una fórmula ($…$, $$…$$, \(…\), \[…\]) el Markdown no existe —
// «**[…]**» dentro de \ce{…} salía como puntos —, así que el hueco es TeX: {\boxed{\,?\,}} oculto y {\boxed{respuesta}} resuelto
// ({\boxed{\ce{respuesta}}} dentro de \ce, para que «H2O» siga siendo H₂O). Las fórmulas se reconocen con las reglas del lector
// de Markdown de la app (un «$» seguido de espacio no abre fórmula: «US$ 5»). Puro.

/** Dónde cae un hueco. */
type Place = 'text' | 'math' | 'ce'

/** Un hueco leído: dónde termina y su respuesta (sin la pista). */
interface Cloze { end: number; answer: string }

/** Una fórmula: sus delimitadores y dónde está su contenido. */
interface MathSpan { open: string; close: string; from: number; to: number }

const OPEN = /^\{\{c\d+::/
const isWS = (c: string | undefined): boolean => c !== undefined && /\s/.test(c)
const isDigit = (c: string | undefined): boolean => c !== undefined && /\d/.test(c)

/** Posición del «::» de la pista fuera de llaves (-1 si no hay). */
function topLevelSeparator(s: string): number {
  let depth = 0
  for (let i = 0; i < s.length - 1; i++) {
    const c = s[i]
    if (c === '\\') { i++; continue }
    if (c === '{') depth++
    else if (c === '}') depth = Math.max(0, depth - 1)
    else if (c === ':' && s[i + 1] === ':' && depth === 0) return i
  }
  return -1
}

/**
 * Lee el hueco que empieza en `at` («{{c1::…}}»). Cuenta las llaves de dentro: «{{c1::\frac{1}{2}}}» es «\frac{1}{2}» (con el
 * primer «}}» quedaba «\frac{1}{2»). undefined si no está bien cerrado.
 */
function readCloze(s: string, at: number): Cloze | undefined {
  const m = OPEN.exec(s.slice(at))
  if (!m) return undefined
  const start = at + m[0].length
  let depth = 0
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') { i++; continue }
    if (c === '{') depth++
    else if (c === '}') {
      if (depth > 0) { depth--; continue }
      if (s[i + 1] !== '}') return undefined
      let answer = s.slice(start, i)
      const hint = topLevelSeparator(answer)
      if (hint >= 0) answer = answer.slice(0, hint) // {{c1::respuesta::pista}}
      return { end: i + 2, answer }
    }
  }
  return undefined
}

/** Cierre de un «$…$» que abre en `at`, con la regla del lector de Markdown (ni espacio tras el «$» ni antes del cierre). */
function inlineMathEnd(s: string, at: number): number | undefined {
  const first = s[at + 1]
  if (first === undefined || isWS(first) || first === '$') return undefined
  for (let j = at + 1; j < s.length; j++) {
    const c = s[j]
    if (c === '\\') { j++; continue }
    if (c !== '$') continue
    if (isWS(s[j - 1])) return undefined
    if (isDigit(s[j + 1])) continue // «$5 y $6»: no es un cierre
    return j
  }
  return undefined
}

/** La fórmula que empieza en `i`, si la hay. */
function mathSpanAt(s: string, i: number): MathSpan | undefined {
  const pair = (open: string, close: string): MathSpan | undefined => {
    const to = s.indexOf(close, i + open.length)
    return to >= 0 ? { open, close, from: i + open.length, to } : undefined
  }
  if (s.startsWith('$$', i)) return pair('$$', '$$')
  if (s[i] === '$') { const to = inlineMathEnd(s, i); return to === undefined ? undefined : { open: '$', close: '$', from: i + 1, to } }
  if (s.startsWith('\\(', i)) return pair('\\(', '\\)')
  if (s.startsWith('\\[', i)) return pair('\\[', '\\]')
  return undefined
}

/** El hueco escrito para su sitio. */
function placeholder(place: Place, answer: string, revealed: boolean): string {
  switch (place) {
    case 'text': return revealed ? `**${answer}**` : '**[…]**'
    // entre llaves: «x^{{c1::2}}» queda «x^{\\boxed{…}}» (sin ellas, «x^\\boxed{…}» no se puede dibujar)
    case 'math': return revealed ? `{\\boxed{${answer}}}` : '{\\boxed{\\,?\\,}}'
    case 'ce': return revealed ? `{\\boxed{\\ce{${answer}}}}` : '{\\boxed{\\,?\\,}}'
  }
}

/** El contenido de una fórmula con sus huecos en TeX (sabiendo si cada uno cae dentro de un \ce{…}). */
function renderMath(tex: string, revealed: boolean): string {
  let out = ''
  let depth = 0
  const ce: number[] = [] // profundidad de llaves a la que abrió cada \ce{
  let i = 0
  while (i < tex.length) {
    if (tex.startsWith('{{c', i) && OPEN.test(tex.slice(i))) {
      const cz = readCloze(tex, i)
      if (!cz) return out + tex.slice(i)
      out += placeholder(ce.length ? 'ce' : 'math', cz.answer, revealed)
      i = cz.end
      continue
    }
    const c = tex[i]
    if (c === '\\') {
      const open = /^\\ce\s*\{/.exec(tex.slice(i))?.[0]
      if (open) { out += open; ce.push(depth); depth++; i += open.length; continue }
      out += tex.slice(i, i + 2)
      i += 2
      continue
    }
    if (c === '{') depth++
    else if (c === '}') { depth = Math.max(0, depth - 1); if (ce.length && ce[ce.length - 1] === depth) ce.pop() }
    out += c
    i++
  }
  return out
}

/** Texto de una tarjeta cloze con los huecos ocultos o resueltos (en fórmulas, con TeX que KaTeX y mhchem entienden). */
export function renderCloze(front: string, revealed: boolean): string {
  let out = ''
  let i = 0
  while (i < front.length) {
    if (front.startsWith('{{c', i) && OPEN.test(front.slice(i))) {
      const cz = readCloze(front, i)
      if (!cz) return out + front.slice(i) // hueco sin cerrar: el resto tal cual
      out += placeholder('text', cz.answer, revealed)
      i = cz.end
      continue
    }
    const span = mathSpanAt(front, i)
    if (span) {
      out += span.open + renderMath(front.slice(span.from, span.to), revealed) + span.close
      i = span.to + span.close.length
      continue
    }
    if (front[i] === '\\') { out += front.slice(i, i + 2); i += 2; continue }
    out += front[i]
    i++
  }
  return out
}
