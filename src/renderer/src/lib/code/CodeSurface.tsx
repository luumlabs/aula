// La superficie única del código: una tarjeta con el nombre del lenguaje y «Copiar», el código coloreado (highlight.js, que
// se carga aparte y solo cuando la tarjeta se acerca a la vista), números de línea desde 3 líneas, desplazamiento de lado
// para las líneas largas y, si la hay, la salida del programa. La usan el bloque `code` y cualquier ``` de un texto con
// Markdown (respuestas del chat y del tutor, enunciados y opciones del simulacro, soluciones, lecciones), para que el código
// se vea igual en todas partes. El código en línea (`así`) sigue siendo una pastilla del texto.
import { createContext, memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { codeLanguageInfo } from '@engine/content/codeLanguages'
import { cx, Icon, IconButton, toast } from '@renderer/design'
import { useHighlight, useNearView } from './useHighlight'
import './code.css'

/** El chat y el tutor piden tarjetas compactas para el código de sus textos (como su bloque `code`). */
export const CompactCode = createContext(false)

/** Dentro de un control (una opción, una tarjeta que se gira…) la tarjeta no lleva botones propios ni foco. */
const INTERACTIVE = 'button, a[href], label, summary, [role="button"], [role="radio"], [role="checkbox"], [role="option"], [role="switch"], [role="tab"]'

export interface CodeSurfaceProps {
  code: string
  /** El lenguaje tal como lo escribió el curso o la valla («py», «c++17», «Python 3»…); sin él se adivina para colorear. */
  language?: string
  /** Lo que imprime el programa, en su propio panel. */
  output?: string
  /** Chat, tutor y opciones: letra y márgenes más pequeños. */
  compact?: boolean
  /** Va dentro de un control (una opción de test): sin «Copiar» ni foco propio. */
  embedded?: boolean
  /** Sin «Copiar» (el papel). */
  copyable?: boolean
  /** Se está escribiendo (el chat en vivo): la última línea aún no ha terminado. */
  live?: boolean
  onCopy?: () => void
  className?: string
}

/** Los números de línea («1\n2\n3…»): van en el CSS (`attr`), fuera del texto que se selecciona, se busca o se lee. */
const lineNumbers = (n: number): string => Array.from({ length: n }, (_, i) => i + 1).join('\n')

/** Una línea más larga que esto se parte en papel (y entonces los números se quitan: ya no casarían). */
const WIDE_LINE = 80

export const CodeSurface = memo(function CodeSurface({ code, language, output, compact = false, embedded = false, copyable = true, live = false, onCopy, className }: CodeSurfaceProps) {
  const { t } = useTranslation('blocks')
  const root = useRef<HTMLDivElement>(null)
  const labelId = useId()
  // dentro de un control que no es un <button> (un role="button" que gira la tarjeta…): se descubre al montarse, antes de pintar
  const [inControl, setInControl] = useState(false)
  useLayoutEffect(() => {
    if (!embedded) setInControl(!!root.current?.parentElement?.closest(INTERACTIVE))
  }, [embedded])
  const quiet = embedded || inControl

  const text = useMemo(() => code.replace(/\s+$/, ''), [code])
  const info = useMemo(() => codeLanguageInfo(language), [language])
  const label = 'name' in info.label ? info.label.name : t(`code.${info.label.generic}`)
  // en vivo, las líneas terminadas se colorean y la que se está escribiendo va tal cual (no se rehace todo a cada letra)
  const cut = live ? text.lastIndexOf('\n') + 1 : text.length
  const head = text.slice(0, cut)
  const tail = text.slice(cut)
  const { lines, wide } = useMemo(() => {
    const all = text ? text.split('\n') : []
    return { lines: all.length, wide: all.some((l) => l.length > WIDE_LINE) }
  }, [text])
  // en vivo no se numeran las líneas hasta cerrar la valla: evita el salto lateral al llegar la línea 3
  const numbered = !live && lines >= 3

  // se colorea lo que tiene gramática (o, sin lenguaje dicho, lo que se adivine), cuando se acerca a la vista
  const near = useNearView(root, live)
  const colorable = info.language ? info.language !== 'plaintext' : !info.declared && !live
  const { result, pending } = useHighlight(head, info.language, near && colorable && head.trim() !== '', live)

  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async (e: MouseEvent): Promise<void> => {
    // en una tarjeta que se gira o una opción, copiar no hace lo del control
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      onCopy?.()
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1400)
    } catch {
      toast.error(t('code.copyFailed'))
    }
  }

  // las flechas y Inicio/Fin en una caja desplazable con foco son para mover el código, no para pasar la página de la lección
  const onScrollKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
    if (e.currentTarget.scrollWidth > e.currentTarget.clientWidth) e.stopPropagation()
  }

  return (
    <div
      ref={root}
      dir="ltr"
      role={quiet ? undefined : 'group'}
      aria-labelledby={quiet ? undefined : labelId}
      aria-busy={pending || undefined}
      data-code-language={result?.language ?? info.language ?? 'none'}
      data-wide={wide || undefined}
      className={cx('aula-code', compact && 'aula-code-compact', quiet && 'aula-code-embedded', live && 'aula-code-live', className)}
    >
      {!quiet && (
        <div className="aula-code-head">
          <Icon name="code" size={14} className="aula-code-icon" />
          <span id={labelId} className="aula-code-label">{label}</span>
          {copyable && (
            <>
              <IconButton label={copied ? t('code.copied') : t('code.copy')} size="sm" onClick={(e) => void copy(e)} className={cx('aula-code-copy', copied && 'text-success')}>
                <Icon name={copied ? 'check' : 'copy'} size={14} />
              </IconButton>
              <span role="status" className="sr-only">{copied ? t('code.copied') : ''}</span>
            </>
          )}
        </div>
      )}
      <div className="aula-code-body">
        {numbered && <span aria-hidden className="aula-code-gutter" data-lines={lineNumbers(lines)} />}
        <div className="aula-code-scroll" tabIndex={quiet ? -1 : undefined} onKeyDown={onScrollKeyDown}>
          <pre className="aula-code-pre" translate="no">
            <code className={cx('aula-code-text', result && 'hljs')}>
              {result ? <span dangerouslySetInnerHTML={{ __html: result.html }} /> : head}
              {tail}
            </code>
          </pre>
        </div>
      </div>
      {output?.trim() && (
        <div className="aula-code-output">
          <div className="aula-code-output-label">
            <Icon name="terminal" size={12} />
            {t('code.output')}
          </div>
          <pre translate="no">{output.replace(/\s+$/, '')}</pre>
        </div>
      )}
    </div>
  )
})
