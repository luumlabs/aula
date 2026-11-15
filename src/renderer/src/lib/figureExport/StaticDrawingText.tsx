// Markdown estático: ningún destino de enlace ni recurso participa en la pintura.
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import katex from 'katex'
import 'katex/contrib/mhchem'
import { safeHref, underlinedRichLink } from '../richTextLinks'
import { AULA_KATEX_MACROS } from '@engine/content/tex'

interface TextTree {
  type: string
  value?: string
  lang?: string
  children?: TextTree[]
  position?: { start: { offset?: number }; end: { offset?: number } }
}
const options = () => ({ throwOnError: true, strict: false as const, trust: false, maxExpand: 1000, maxSize: 20, output: 'htmlAndMathml' as const, macros: { ...AULA_KATEX_MACROS } })

interface TextBudget { nodes: number; mathBytes: number }
type MathMacros = { bounded: ReturnType<typeof options>['macros']; complete: ReturnType<typeof options>['macros'] }
function checkMath(value: string, displayMode: boolean, macros: MathMacros): { nodes: number; bytes: number } {
  if (/\\(?:includegraphics|href|url|html[A-Za-z]*)\b/.test(value)) throw new Error('Drawing math resources are unsupported')
  // Comparar evita que maxSize transforme silenciosamente una fórmula en otra más pequeña.
  const bounded = katex.renderToString(value, { ...options(), displayMode, macros: macros.bounded })
  const complete = katex.renderToString(value, { ...options(), maxSize: Infinity, displayMode, macros: macros.complete })
  const dimensions = [...complete.matchAll(/style="([^"]*)"/g)].flatMap((style) => [...style[1].matchAll(/(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?:em|ex|px|pt|cm|mm|in)\b/gi)])
  if (bounded !== complete || bounded.length > 256_000 || dimensions.some((match) => !Number.isFinite(Number(match[1])) || Math.abs(Number(match[1])) > 64)) throw new Error('Drawing math exceeds export limits')
  return { nodes: (bounded.match(/<[A-Za-z][^>]*>/g) ?? []).length, bytes: bounded.length }
}

function inspectTree(tree: TextTree, budget: TextBudget = { nodes: 0, mathBytes: 0 }): void {
  // Una tabla nueva por etiqueta; las expresiones sucesivas de esa etiqueta sí comparten sus definiciones.
  const macros: MathMacros = { bounded: { ...AULA_KATEX_MACROS }, complete: { ...AULA_KATEX_MACROS } }
  const visit = (node: TextTree, depth: number): void => {
    if (++budget.nodes > 10_000 || depth > 64) throw new Error('Drawing text exceeds export limits')
    if (['image', 'imageReference', 'html'].includes(node.type)) throw new Error('Drawing text resources are unsupported')
    if (node.type === 'math' || node.type === 'inlineMath' || (node.type === 'code' && node.lang === 'math')) {
      const output = checkMath(node.value ?? '', node.type !== 'inlineMath', macros)
      budget.nodes += output.nodes
      budget.mathBytes += output.bytes
      if (budget.nodes > 10_000 || budget.mathBytes > 2 * 1024 * 1024) throw new Error('Drawing math exceeds aggregate limits')
    }
    node.children?.forEach((child) => visit(child, depth + 1))
  }
  visit(tree, 0)
}
const staticTextGuard = () => (tree: TextTree): void => inspectTree(tree)

/** Presupuesta el HTML generado de toda la escena antes de crear nodos o superficies. */
export function preflightDrawingTexts(texts: readonly string[], geometryNodes = 0): void {
  const budget: TextBudget = { nodes: geometryNodes, mathBytes: 0 }
  if (budget.nodes > 10_000) throw new Error('Drawing DOM exceeds limits')
  const guard = () => (tree: TextTree): void => inspectTree(tree, budget)
  for (const text of texts) ReactMarkdown({ children: text, remarkPlugins: [remarkGfm, remarkMath, guard], skipHtml: true })
}

const flat = ({ children }: { children?: ReactNode }) => <>{children}</>
export function StaticDrawingText({ text, language, direction }: { text: string; language: string; direction: 'ltr' | 'rtl' }) {
  return <span lang={language} dir={direction} className="aula-rich-inline drawing-static-text">
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, staticTextGuard]} rehypePlugins={[[rehypeKatex, options()]]} skipHtml urlTransform={safeHref}
      components={{ a: ({ href, children }) => <span style={{ color: 'var(--accent-text)', ...(underlinedRichLink(href) ? { textDecoration: 'underline', textUnderlineOffset: 2 } : {}) }}>{children}</span>, img: () => { throw new Error('Drawing images are unsupported') }, p: flat, h1: flat, h2: flat, h3: flat }}>
      {text}
    </ReactMarkdown>
  </span>
}
