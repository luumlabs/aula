// Fórmula con KaTeX (y \ce de química). Se renderiza a HTML una vez por texto; si el LaTeX no es válido se ve tal cual.
import { memo, useMemo } from 'react'
import katex from 'katex'
import 'katex/contrib/mhchem'
import { AULA_KATEX_MACROS } from '@engine/content/tex'
import { cx } from '@renderer/design'

const cache = new Map<string, string>()

function render(tex: string, display: boolean): string {
  const key = (display ? 'D' : 'I') + tex
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  let html: string
  try {
    html = katex.renderToString(tex, { throwOnError: false, displayMode: display, strict: false, trust: false, output: 'html', macros: { ...AULA_KATEX_MACROS } })
  } catch {
    html = tex.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
  }
  if (cache.size > 800) cache.clear()
  cache.set(key, html)
  return html
}

export const Tex = memo(function Tex({ tex, display, className, title }: { tex: string; display?: boolean; className?: string; title?: string }) {
  const html = useMemo(() => render(tex, !!display), [tex, display])
  return <span className={cx(display ? 'block aula-formula' : 'inline-block', className)} title={title} dangerouslySetInnerHTML={{ __html: html }} />
})
