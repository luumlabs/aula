// Código con resaltado (highlight.js con los lenguajes de clase), botón de copiar, números de línea y la salida del programa.
import { useMemo, useState } from 'react'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import latex from 'highlight.js/lib/languages/latex'
import markdown from 'highlight.js/lib/languages/markdown'
import matlab from 'highlight.js/lib/languages/matlab'
import php from 'highlight.js/lib/languages/php'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import r from 'highlight.js/lib/languages/r'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { cx, Icon, IconButton, toast } from '@renderer/design'
import type { BlockOf } from '@shared/schema/blocks'
import type { BlockProps } from './types'
import { Caption, useBlocksT } from './shared'

const LANGS = { bash, c, cpp, csharp, css, go, java, javascript, json, kotlin, latex, markdown, matlab, php, plaintext, python, r, ruby, rust, sql, swift, typescript, xml, yaml }
for (const [name, def] of Object.entries(LANGS)) if (!hljs.getLanguage(name)) hljs.registerLanguage(name, def)

/** Nombre del lenguaje que entiende highlight.js («py» → python, «html» → xml, «c++» → cpp…); undefined si no se conoce. */
export function codeLanguage(raw: string | undefined): string | undefined {
  const s = (raw ?? '').trim().toLowerCase()
  if (!s) return undefined
  const alias: Record<string, string> = {
    py: 'python', python3: 'python', js: 'javascript', node: 'javascript', ts: 'typescript', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
    'c++': 'cpp', cc: 'cpp', 'c#': 'csharp', cs: 'csharp', html: 'xml', svg: 'xml', tex: 'latex', md: 'markdown', yml: 'yaml', octave: 'matlab', rb: 'ruby', rs: 'rust', kt: 'kotlin', text: 'plaintext', txt: 'plaintext', pseudocode: 'plaintext', pseudocódigo: 'plaintext'
  }
  const name = alias[s] ?? s
  return hljs.getLanguage(name) ? name : undefined
}

/** HTML resaltado (highlight.js escapa el texto). Sin lenguaje conocido, se intenta adivinar entre los de clase. */
function highlight(code: string, lang: string | undefined): { html: string; lang?: string } {
  try {
    if (lang) return { html: hljs.highlight(code, { language: lang, ignoreIllegals: true }).value, lang }
    if (code.length > 20_000) return { html: escapeHtml(code) }
    const auto = hljs.highlightAuto(code, ['python', 'javascript', 'java', 'cpp', 'c', 'sql', 'bash', 'r', 'matlab', 'typescript'])
    return auto.relevance >= 5 ? { html: auto.value, lang: auto.language } : { html: escapeHtml(code) }
  } catch {
    return { html: escapeHtml(code) }
  }
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

const LABELS: Record<string, string> = { cpp: 'C++', csharp: 'C#', javascript: 'JavaScript', typescript: 'TypeScript', xml: 'HTML', latex: 'LaTeX', matlab: 'MATLAB', sql: 'SQL', php: 'PHP', json: 'JSON', yaml: 'YAML', css: 'CSS', plaintext: '' }
const langLabel = (lang: string | undefined, raw: string | undefined): string => (lang ? (LABELS[lang] ?? lang.charAt(0).toUpperCase() + lang.slice(1)) : (raw ?? '').trim())

export function CodeBlockView({ block, ctx }: BlockProps<BlockOf<'code'>>) {
  const t = useBlocksT()
  const [copied, setCopied] = useState(false)
  const code = block.code.replace(/\s+$/, '')
  const { html, lang } = useMemo(() => highlight(code, codeLanguage(block.language)), [code, block.language])
  const lines = useMemo(() => code.split('\n').length, [code])
  const numbered = lines > 3 && ctx.mode !== 'chat'
  const label = langLabel(lang, block.language)
  const chat = ctx.mode === 'chat'
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(block.code)
      setCopied(true)
      ctx.onInteract?.(block.id, 'code.copy')
      setTimeout(() => setCopied(false), 1400)
    } catch {
      toast.error(t('code.copyFailed'))
    }
  }
  return (
    <div>
      <div className={cx('overflow-hidden border-[0.5px] border-line bg-sunken', chat ? 'rounded-[12px]' : 'rounded-[16px]')}>
        <div className="flex h-9 items-center gap-2 border-b-[0.5px] border-line-soft pl-4 pr-1.5">
          <Icon name="code" size={14} className="text-text3" />
          <span className="t-caption uppercase tracking-[0.6px] text-text3">{label || t('code.code')}</span>
          {ctx.mode !== 'print' && (
            <IconButton label={copied ? t('code.copied') : t('code.copy')} size="sm" onClick={() => void copy()} className={cx('ml-auto', copied && 'text-success')}>
              <Icon name={copied ? 'check' : 'copy'} size={14} />
            </IconButton>
          )}
        </div>
        <div className="overflow-x-auto">
          <pre className={cx('blk-code m-0 flex t-mono text-text', chat ? 'px-3 py-2.5 text-[12.5px] leading-[19px]' : 'px-4 py-3.5 text-[13px] leading-[21px]')}>
            {numbered && (
              <span aria-hidden className="mr-4 select-none text-right text-text3/70 tabular">
                {Array.from({ length: lines }, (_, i) => (
                  <span key={i} className="block">{i + 1}</span>
                ))}
              </span>
            )}
            <code className="block min-w-0 flex-1 whitespace-pre" dangerouslySetInnerHTML={{ __html: html }} />
          </pre>
        </div>
        {block.output?.trim() && (
          <div className="border-t-[0.5px] border-line-soft bg-surface/60 px-4 py-3">
            <div className="t-caption mb-1 flex items-center gap-1.5 uppercase tracking-[0.6px] text-text3">
              <Icon name="terminal" size={12} />
              {t('code.output')}
            </div>
            <pre className="m-0 whitespace-pre-wrap t-mono text-[12.5px] leading-[19px] text-text2">{block.output.replace(/\s+$/, '')}</pre>
          </div>
        )}
      </div>
      <Caption text={block.caption} className="mt-2 px-1" />
    </div>
  )
}
