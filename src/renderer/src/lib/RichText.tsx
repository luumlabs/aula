// Texto con Markdown y fórmulas ($…$ y $$…$$, KaTeX con \ce de química). `inline` lo deja en una línea (sin párrafos).
import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/contrib/mhchem'
import { AULA_KATEX_MACROS } from '@engine/content/tex'
import { cx } from '@renderer/design'

// las mismas macros que acepta el validador del contenido (\\SI, \\qty, \\mbox…)
const katexOptions = { throwOnError: false, strict: false, trust: false, output: 'htmlAndMathml' as const, macros: { ...AULA_KATEX_MACROS } }

/** Solo enlaces web o de correo: cualquier otra dirección (relativa, file:, //host…) se queda en texto. */
export function safeHref(url: string): string {
  return /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : ''
}

function Link({ href, children }: { href?: string; children?: React.ReactNode }) {
  if (!href) return <span className="text-accent-text">{children}</span>
  // target=_blank: la ventana de la app nunca navega; el proceso principal lo abre en el navegador del sistema
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent-text underline underline-offset-2">
      {children}
    </a>
  )
}

export const RichText = memo(function RichText({ text, inline, className }: { text: string; inline?: boolean; className?: string }) {
  if (!text) return null
  return (
    <span className={cx(inline ? 'aula-rich-inline' : 'aula-rich block', className)}>
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
