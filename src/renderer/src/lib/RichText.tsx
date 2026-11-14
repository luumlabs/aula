// Texto con Markdown y fórmulas ($…$ y $$…$$, KaTeX con \ce de química). `inline` lo deja en una línea (sin párrafos).
import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/contrib/mhchem'
import { AULA_KATEX_MACROS } from '@engine/content/tex'
import { cx } from '@renderer/design'
import { useContentLang } from './contentLanguage'

// copiar texto con fórmulas da su LaTeX ($…$ y $$…$$), no el texto doble de KaTeX (HTML + MathML); escucha en el documento,
// así que sin él (las pruebas) no se carga
if (typeof document !== 'undefined') void import('katex/contrib/copy-tex').catch(() => undefined)

// las mismas macros que acepta el validador del contenido (\\SI, \\qty, \\mbox…)
const katexOptions = { throwOnError: false, strict: false, trust: false, output: 'htmlAndMathml' as const, macros: { ...AULA_KATEX_MACROS } }

/** Las citas del lector («p. 3») llevan a su página dentro de la app: `#aula-page-<n>` (las atiende el panel de Aula). */
const PAGE_ANCHOR = /^#aula-page-\d{1,4}$/

/** Solo enlaces web o de correo, y las citas de página del lector: cualquier otra dirección (relativa, file:, //host…) se
 *  queda en texto. */
export function safeHref(url: string): string {
  const u = url.trim()
  return /^(https?:|mailto:)/i.test(u) || PAGE_ANCHOR.test(u) ? u : ''
}

function Link({ href, children }: { href?: string; children?: React.ReactNode }) {
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

/** En la pantalla de estudio el texto va en el idioma del curso (`lang`, y `dir` si se escribe de derecha a izquierda); `ui`
 *  lo deja en el de la interfaz (un aviso de Aula que se pinta con Markdown). */
export const RichText = memo(function RichText({ text, inline, className, ui }: { text: string; inline?: boolean; className?: string; ui?: boolean }) {
  const course = useContentLang()
  const content = ui ? {} : course
  if (!text) return null
  return (
    <span lang={content.lang} dir={content.dir} className={cx(inline ? 'aula-rich-inline' : 'aula-rich block', content.className, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, katexOptions]]}
        skipHtml
        urlTransform={safeHref}
        components={
          inline
            ? { a: Link, p: ({ children }) => <>{children}</>, h1: ({ children }) => <>{children}</>, h2: ({ children }) => <>{children}</>, h3: ({ children }) => <>{children}</> }
            : { a: Link }
        }
      >
        {text}
      </ReactMarkdown>
    </span>
  )
})
