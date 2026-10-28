// LaTeX dentro del contenido: fragmentos matemáticos de un Markdown y si se pueden dibujar. La app Swift usaba su tipógrafo
// (SwiftMath/AulaTeX); aquí manda KaTeX con mhchem, el mismo que dibuja la interfaz: si KaTeX no lo entiende, el estudiante
// vería un error rojo, así que es un error a corregir.
import katex from 'katex'
import 'katex/contrib/mhchem'
import { parseRichText, type ContentIssue, type Inline, type RichBlock } from '@shared/schema'

/** Todos los fragmentos matemáticos ($…$, $$…$$, \(…\), \[…\]) de un texto. */
export function mathSpans(md: string): string[] {
  const out: string[] = []
  const walkInline = (items: readonly Inline[]): void => {
    for (const i of items) {
      if (i.kind === 'math') out.push(i.tex)
      else if (i.kind === 'bold' || i.kind === 'italic' || i.kind === 'strike' || i.kind === 'highlight' || i.kind === 'link') walkInline(i.children)
    }
  }
  const walkBlocks = (bs: readonly RichBlock[]): void => {
    for (const b of bs) {
      switch (b.kind) {
        case 'heading': case 'paragraph': walkInline(b.inlines); break
        case 'list': b.items.forEach(walkBlocks); break
        case 'quote': walkBlocks(b.blocks); break
        case 'displayMath': out.push(b.tex); break
        case 'table': b.header.forEach(walkInline); b.rows.forEach((r) => r.forEach(walkInline)); break
        default: break
      }
    }
  }
  walkBlocks(parseRichText(md))
  return out
}

/** ¿Llaves sin cerrar o de más? (las escapadas `\{ \}` no cuentan) */
export function unbalancedBraces(t: string): boolean {
  let depth = 0, escaped = false
  for (const ch of t) {
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '{') depth += 1
    else if (ch === '}') { depth -= 1; if (depth < 0) return true }
  }
  return depth !== 0
}

/** Límites de una fórmula antes de dársela al tipógrafo. undefined = dentro de los límites. */
export function texTooComplex(t: string): string | undefined {
  const n = Array.from(t).length
  if (n > 3000) return `la fórmula es demasiado larga (${n} caracteres; máximo 3000): divídela`
  let depth = 0, max = 0
  for (const ch of t) { if (ch === '{') { depth += 1; max = Math.max(max, depth) } else if (ch === '}') depth -= 1 }
  if (max > 40) return `tiene demasiados niveles de llaves anidadas (${max}; máximo 40)`
  return undefined
}

/**
 * Órdenes de LaTeX que la app Swift dibujaba (su guía de autoría las promete) y KaTeX no trae: se definen como macros. La
 * interfaz debe pasar las mismas a KaTeX (`macros: AULA_KATEX_MACROS`) para dibujar lo que el validador acepta.
 */
export const AULA_KATEX_MACROS: Readonly<Record<string, string>> = {
  '\\mbox': '\\text{#1}',
  '\\SI': '#1\\,\\mathrm{#2}',
  '\\si': '\\mathrm{#1}',
  '\\qty': '#1\\,\\mathrm{#2}',
  '\\unit': '\\mathrm{#1}',
  '\\num': '#1'
}

/** Lo que dice KaTeX de la fórmula: undefined si se dibuja; si no, el motivo. */
export function katexError(t: string): string | undefined {
  try {
    // en modo de pantalla: los entornos `align` solo existen ahí (y una fórmula en línea que los usa sale en su propia línea)
    katex.renderToString(t, { throwOnError: true, strict: 'ignore', trust: false, output: 'html', maxExpand: 500, maxSize: 50, displayMode: true, macros: { ...AULA_KATEX_MACROS } })
    return undefined
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err)
    return m.replace(/^KaTeX parse error:\s*/, '')
  }
}

const clip = (t: string): string => Array.from(t).slice(0, 60).join('')

/** Problemas de una fórmula: error si no se puede dibujar; aviso si se dibuja pero conviene corregirla (`\over`, `$$` vacío…). */
export function texProblems(t: string, path: string): ContentIssue[] {
  const tooComplex = texTooComplex(t)
  if (tooComplex) return [{ severity: 'error', path, message: `LaTeX no válido «${clip(t)}»: ${tooComplex}` }]
  if (unbalancedBraces(t)) return [{ severity: 'error', path, message: `LaTeX no válido «${clip(t)}»: las llaves { } no están equilibradas` }]
  const err = katexError(t)
  if (err) return [{ severity: 'error', path, message: `LaTeX no válido «${clip(t)}»: ${err}` }]
  if (/\\over(?![a-zA-Z])/.test(t)) return [{ severity: 'warning', path, message: `LaTeX «${clip(t)}»: usa \\frac{a}{b} en lugar de \\over.` }]
  return []
}

/** Problemas de LaTeX de un texto con Markdown. */
export function latexIssues(md: string, path: string): ContentIssue[] {
  const issues: ContentIssue[] = []
  const dollars = Array.from(md.split('\\$').join('')).filter((c) => c === '$').length
  if (dollars % 2 === 1 && !md.includes('US$')) issues.push({ severity: 'warning', path, message: 'Cantidad impar de «$»: ¿falta cerrar una fórmula? Usa «\\$» para un signo de dinero.' })
  for (const span of mathSpans(md)) {
    const t = span.trim()
    if (!t) { issues.push({ severity: 'error', path, message: 'Fórmula vacía «$$».' }); continue }
    issues.push(...texProblems(t, path))
  }
  return issues
}

/** Parte una fórmula por sus `\quad` / `\qquad` de primer nivel (fuera de llaves y entornos), para que una línea con
 * varias igualdades («csc θ = 1/sin θ \quad sec θ = …») se reparta en renglones en lugar de salirse de la tarjeta. */
export function splitFormula(tex: string): string[] {
  const parts: string[] = []
  let depth = 0
  let env = 0
  let start = 0
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i]
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+)/.exec(tex.slice(i))
      if (!m) { i++; continue }
      const name = m[1]
      if (name === 'begin') env++
      else if (name === 'end') env = Math.max(0, env - 1)
      else if ((name === 'quad' || name === 'qquad') && depth === 0 && env === 0) {
        parts.push(tex.slice(start, i))
        start = i + m[0].length
      }
      i += m[0].length - 1
    } else if (c === '{') depth++
    else if (c === '}') depth = Math.max(0, depth - 1)
  }
  parts.push(tex.slice(start))
  const clean = parts.map((p) => p.trim()).filter(Boolean)
  return clean.length ? clean : [tex]
}
