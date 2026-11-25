// Texto con Markdown y fórmulas ($…$ y $$…$$, KaTeX con \ce de química). `inline` lo deja en una línea (sin párrafos).
// Aula no usa emojis: lo que escribe la IA o llega de una plataforma se pinta sin ellos (los símbolos, como texto); lo que
// escribió el propio estudiante (`own`) se deja tal cual. Un bloque de código (```) sale en la misma tarjeta que el bloque
// `code` (CodeSurface); el `código en línea` es una pastilla del texto.
import { createContext, memo, useContext, useMemo, type ReactNode } from 'react'
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/contrib/mhchem'
import { AULA_KATEX_MACROS } from '@engine/content/tex'
import { isClosedFence, mapOutsideCode } from '@engine/content/codeFences'
import { tameEmoji } from '@engine/base/emoji'
import { cx } from '@renderer/design'
import { CodeSurface, CompactCode } from './code/CodeSurface'
import { useContentLang } from './contentLanguage'
import { PAGE_ANCHOR, safeHref } from './richTextLinks'
export { safeHref } from './richTextLinks'

// copiar texto con fórmulas da su LaTeX ($…$ y $$…$$), no el texto doble de KaTeX (HTML + MathML); escucha en el documento,
// así que sin él (las pruebas) no se carga
if (typeof document !== 'undefined') void import('katex/contrib/copy-tex').catch(() => undefined)

// las mismas macros que acepta el validador del contenido (\\SI, \\qty, \\mbox…)
const katexOptions = { throwOnError: false, strict: false, trust: false, output: 'htmlAndMathml' as const, macros: { ...AULA_KATEX_MACROS } }
// la vuelta de una nota al pie: una flecha de texto (la de serie, «↩», se pinta como emoji en iOS)
const remarkRehypeOptions = { footnoteBackContent: '↑' }

function Link({ href, children }: { href?: string; children?: ReactNode }) {
  if (!href) return <span className="text-accent-text">{children}</span>
  // una cita de página: sin target, nunca sale de la app (el panel del lector la intercepta y va a esa página)
  if (PAGE_ANCHOR.test(href)) return <a href={href} className="text-accent-text">{children}</a>
  // target=_blank: la ventana de la app nunca navega; el proceso principal lo abre en el navegador del sistema
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent-text underline underline-offset-2">
      {children}
    </a>
  )
}

type HastElement = NonNullable<ExtraProps['node']>
type HastChild = HastElement['children'][number]

/** El texto de unos nodos (el código llega como texto suelto). */
const textOf = (nodes: readonly HastChild[]): string => nodes.map((n) => (n.type === 'text' ? n.value : n.type === 'element' ? textOf(n.children) : '')).join('')

/** Lo que el código de un texto necesita saber: el Markdown del que sale, si llega en vivo y si va en una línea (un control). */
interface FenceEnv {
  source: string
  live: boolean
  inline: boolean
}
const FenceEnvContext = createContext<FenceEnv>({ source: '', live: false, inline: false })

/** Un bloque de código del Markdown (``` o sangrado): la misma tarjeta que el bloque `code`. */
function FencedCode({ node }: ExtraProps) {
  const env = useContext(FenceEnvContext)
  const compact = useContext(CompactCode)
  const code = node?.children.find((c): c is HastElement => c.type === 'element' && c.tagName === 'code')
  const classes = code?.properties.className
  const language = (Array.isArray(classes) ? classes : []).map(String).find((c) => c.startsWith('language-'))?.slice('language-'.length)
  const text = code ? textOf(code.children).replace(/\n$/, '') : ''
  const from = node?.position?.start.offset
  const to = node?.position?.end.offset
  const closed = from === undefined || to === undefined || isClosedFence(env.source.slice(from, to))
  // un trozo suelto de un bloque (un hueco de completar lo partió en dos textos): el código en su letra, sin tarjeta a medias
  if (env.inline && !closed && !env.live) return text ? <code className="aula-code-loose">{text}</code> : null
  return <CodeSurface code={text} language={language} compact={env.inline || compact} embedded={env.inline} live={env.live && !closed} />
}

/** Un párrafo o un título dentro de una línea: solo su contenido. */
const Unwrapped = ({ children }: { children?: ReactNode }) => <>{children}</>

// Fijos (fuera del componente): si cambiaran a cada dibujo, React rehará la tarjeta del código entera con cada letra que llega
const BLOCK_COMPONENTS: Components = { a: Link, pre: FencedCode }
const INLINE_COMPONENTS: Components = { a: Link, pre: FencedCode, p: Unwrapped, h1: Unwrapped, h2: Unwrapped, h3: Unwrapped }

/** En la pantalla de estudio el texto va en el idioma del curso (`lang`, y `dir` si se escribe de derecha a izquierda); `ui`
 *  lo deja en el de la interfaz (un aviso de Aula que se pinta con Markdown). `own`: lo escribió el estudiante (sus emojis se
 *  quedan). `live`: se está escribiendo (el chat): un bloque de código sin cerrar va coloreando sus líneas terminadas. */
export const RichText = memo(function RichText({ text, inline, className, ui, own, live = false }: { text: string; inline?: boolean; className?: string; ui?: boolean; own?: boolean; live?: boolean }) {
  const course = useContentLang()
  const content = ui ? {} : course
  const shown = useMemo(() => (own ? text : mapOutsideCode(text, tameEmoji)), [text, own])
  const env = useMemo<FenceEnv>(() => ({ source: shown, live, inline: !!inline }), [shown, live, inline])
  if (!text) return null
  return (
    <span lang={content.lang} dir={content.dir} className={cx(inline ? 'aula-rich-inline' : 'aula-rich block', content.className, className)}>
      <FenceEnvContext.Provider value={env}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[[rehypeKatex, katexOptions]]}
          remarkRehypeOptions={remarkRehypeOptions}
          skipHtml
          urlTransform={safeHref}
          components={inline ? INLINE_COMPONENTS : BLOCK_COMPONENTS}
        >
          {shown}
        </ReactMarkdown>
      </FenceEnvContext.Provider>
    </span>
  )
})
