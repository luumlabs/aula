// Piezas comunes de los bloques: texto de lectura, fórmula en pantalla, rótulos, pies, el marco de las figuras, la memoria
// de los bloques interactivos y los ganchos de movimiento (que respetan «Reducir movimiento» y la impresión).
import { memo, useEffect, useLayoutEffect, useMemo, useState, type ReactNode, type RefObject } from 'react'
import { motion, useInView } from 'motion/react'
import { useTranslation } from 'react-i18next'
import katex from 'katex'
import 'katex/contrib/mhchem'
import { AULA_KATEX_MACROS } from '@engine/content/tex'
import { create } from 'zustand'
import { cx, Icon, useTheme, type IconName } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import type { SourceRef } from '@shared/schema/common'
import type { BlockContext } from './types'
import { normalizeMath } from './text'

export const useBlocksT = () => useTranslation('blocks').t

/** ¿Se anima? No con «Reducir movimiento» ni al imprimir. */
export function useAnimate(ctx: BlockContext): boolean {
  const { reducedMotion } = useTheme()
  return !reducedMotion && ctx.mode !== 'print'
}

/** ¿Se ve ya en pantalla? (una vez). Al imprimir o sin movimiento, siempre. */
export function useSeen<T extends Element>(ref: RefObject<T | null>, ctx: BlockContext, margin = '-40px'): boolean {
  const animate = useAnimate(ctx)
  const inView = useInView(ref, { once: true, margin: margin as `${number}px` })
  return !animate || inView
}

/** Progreso 0 → 1 (suavizado) que arranca cuando `start` pasa a true; 1 directamente si no se anima. */
export function useProgress(start: boolean, animate: boolean, duration = 900, delay = 0): number {
  const [p, setP] = useState(animate ? 0 : 1)
  useEffect(() => {
    if (!animate) {
      setP(1)
      return
    }
    if (!start) return
    let raf = 0
    const t0 = performance.now() + delay
    const tick = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - t0) / duration))
      setP(1 - Math.pow(1 - k, 3))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [start, animate, duration, delay])
  return p
}

/** Ancho del elemento (se actualiza al cambiar de tamaño). */
export function useWidth<T extends HTMLElement>(ref: RefObject<T | null>, fallback = 640): number {
  const [w, setW] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(Math.round(el.clientWidth) || fallback)
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width
      if (cw) setW(Math.round(cw))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, fallback])
  return w
}

// MARK: Memoria de los bloques interactivos (pasos vistos, opción elegida…) mientras dura la sesión

interface MemoryState {
  values: Record<string, unknown>
  set: (key: string, v: unknown) => void
}
const useMemoryStore = create<MemoryState>((set) => ({ values: {}, set: (key, v) => set((s) => ({ values: { ...s.values, [key]: v } })) }))

/** Estado que sobrevive a volver a dibujar el bloque (al pasar de paso en la lección y volver). */
export function useBlockMemory<T>(ctx: BlockContext, blockId: string, kind: string, initial: T): [T, (v: T) => void] {
  const key = `${ctx.packId ?? '-'}/${ctx.skillId ?? '-'}/${blockId}/${kind}`
  const stored = useMemoryStore((s) => s.values[key]) as T | undefined
  const setter = useMemoryStore((s) => s.set)
  return [stored === undefined ? initial : stored, (v: T) => setter(key, v)]
}

// MARK: Texto

/** Texto de lectura (Markdown + fórmulas): serif 18/28 en la lección, cuerpo 15/22 en el chat. */
export function Prose({ text, ctx, className, size = 'reading' }: { text: string; ctx: BlockContext; className?: string; size?: 'reading' | 'body' | 'small' }) {
  const s = ctx.mode === 'chat' ? (size === 'small' ? 't-callout' : 't-body') : size === 'reading' ? 't-reading blk-reading' : size === 'body' ? 'font-serif text-[16.5px] leading-[26px] blk-reading' : 'text-[15px] leading-[23px]'
  return <RichText text={normalizeMath(text)} className={cx('blk-prose', s, className)} />
}


/** Una línea de texto con fórmulas en línea. */
export function Inline({ text, className }: { text: string; className?: string }) {
  return <RichText text={text} inline className={className} />
}

const katexCache = new Map<string, string>()

/** Fórmula con KaTeX (y \ce de química). `display` la centra en su propia línea. */
export const MathTex = memo(function MathTex({ tex, display = true, className }: { tex: string; display?: boolean; className?: string }) {
  const html = useMemo(() => {
    const key = `${display ? 'd' : 'i'}:${tex}`
    const hit = katexCache.get(key)
    if (hit !== undefined) return hit
    let out: string
    try {
      out = katex.renderToString(cleanTex(tex), { displayMode: display, throwOnError: false, strict: false, trust: false, output: 'htmlAndMathml', macros: { ...AULA_KATEX_MACROS } })
    } catch {
      out = ''
    }
    if (katexCache.size > 800) katexCache.clear()
    katexCache.set(key, out)
    return out
  }, [tex, display])
  if (!html) return <code className={cx('t-mono text-text2', className)}>{tex}</code>
  return <span className={cx(display ? 'block' : 'inline', className)} dangerouslySetInnerHTML={{ __html: html }} />
})

/** Quita los delimitadores que a veces trae la fórmula («$$…$$», «\[…\]»). */
export function cleanTex(tex: string): string {
  let t = tex.trim()
  if (t.startsWith('$$') && t.endsWith('$$') && t.length > 4) t = t.slice(2, -2)
  else if (t.startsWith('\\[') && t.endsWith('\\]')) t = t.slice(2, -2)
  else if (t.startsWith('$') && t.endsWith('$') && t.length > 2) t = t.slice(1, -1)
  return t.trim()
}

/** Etiqueta de figura: LaTeX si lo parece (\, ^, _ o $), texto si no. */
export function FigLabel({ text, className }: { text: string; className?: string }) {
  const t = text.trim()
  if (t.includes('$')) return <Inline text={t} className={cx('blk-fig-label', className)} />
  if (/[\\^_{}]/.test(t)) return <MathTex tex={t} display={false} className={cx('blk-fig-label', className)} />
  return <span className={cx('blk-fig-label', className)}>{t}</span>
}

/** Rótulo de un bloque («Definición», «Ejemplo resuelto»): icono y palabra en frase, seminegrita. */
export function Eyebrow({ icon, glyph, label, className, trailing }: { icon?: IconName; glyph?: ReactNode; label: ReactNode; className?: string; trailing?: ReactNode }) {
  return (
    <div className={cx('flex items-center gap-1.5 t-ui font-semibold', className)}>
      {glyph ?? (icon && <Icon name={icon} size={15} />)}
      <span>{label}</span>
      {trailing && <span className="ml-auto">{trailing}</span>}
    </div>
  )
}

/** Título de un bloque (serif). */
export function BlockTitle({ text, ctx, className }: { text?: string; ctx: BlockContext; className?: string }) {
  if (!text?.trim()) return null
  return (
    <div className={cx('font-serif font-medium text-text', ctx.mode === 'chat' ? 'text-[16px] leading-[22px]' : 'text-[19px] leading-[26px] tracking-[-0.1px]', className)}>
      <Inline text={text} />
    </div>
  )
}

/** Pie de figura o de tabla (con fórmulas). */
export function Caption({ text, className }: { text?: string; className?: string }) {
  if (!text?.trim()) return null
  return (
    <div className={cx('t-footnote text-text2 leading-[18px]', className)}>
      <Inline text={text} />
    </div>
  )
}

/**
 * Marco de una figura (gráfica, gráfico, recta, línea de tiempo): una burbuja de papel con título, herramientas y pie.
 * En el chat es más compacta; al imprimir, sin sombra.
 */
export function Figure({ ctx, title, tools, caption, children, className, eyebrow, bodyClassName }: { ctx: BlockContext; title?: string; tools?: ReactNode; caption?: ReactNode; children: ReactNode; className?: string; eyebrow?: ReactNode; bodyClassName?: string }) {
  const chat = ctx.mode === 'chat'
  const print = ctx.mode === 'print'
  return (
    <figure
      className={cx('group/fig relative m-0 bg-surface border-[0.5px] border-line', chat ? 'rounded-[16px] p-3' : 'rounded-[22px] p-5', className)}
      style={{ boxShadow: print || chat ? undefined : 'var(--e1)' }}
    >
      {(eyebrow || title || tools) && (
        <div className={cx('flex items-start gap-3', chat ? 'mb-2' : 'mb-3')}>
          <div className="min-w-0 flex-1">
            {eyebrow}
            <BlockTitle text={title} ctx={ctx} className={eyebrow ? 'mt-1' : undefined} />
          </div>
          {tools && !print && <div className="flex shrink-0 items-center gap-1">{tools}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
      {caption && <figcaption className="mt-3">{caption}</figcaption>}
    </figure>
  )
}

/** «Apuntes de clase · p. 12»: enlace al material citado si la pantalla sabe abrirlo. */
export function SourceLink({ source, ctx }: { source: SourceRef; ctx: BlockContext }) {
  const t = useBlocksT()
  const title = ctx.sourceTitle?.(source.source)
  const short = title && Array.from(title).length > 48 ? Array.from(title).slice(0, 48).join('') + '…' : title
  const page = source.page === undefined ? undefined : source.pageEnd !== undefined && source.pageEnd !== source.page ? t('source.pages', { from: source.page, to: source.pageEnd }) : t('source.page', { page: source.page })
  const text = short && page ? `${short} · ${page}` : short ?? (page ? `${t('source.yours')} · ${page}` : t('source.yours'))
  const open = ctx.onOpenSource && ctx.mode !== 'print' ? ctx.onOpenSource : undefined
  const body = (
    <>
      <Icon name="file-text" size={13} />
      <span className="truncate">{text}</span>
    </>
  )
  if (!open) return <span className="inline-flex max-w-full items-center gap-1.5 t-ui text-text2">{body}</span>
  return (
    <button type="button" onClick={() => open(source)} title={t('source.open')} className="inline-flex max-w-full items-center gap-1.5 t-ui text-accent-text rounded-[6px] hover:underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-accent-line">
      {body}
    </button>
  )
}

/** Hijos que entran uno tras otro cuando el grupo aparece en pantalla (los hijos usan `variants={enter}`). */
export function InViewStagger({ children, className, gap = 0.06, animate }: { children: ReactNode; className?: string; gap?: number; animate: boolean }) {
  if (!animate) return <div className={className}>{children}</div>
  return (
    <motion.div className={className} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-40px' }} variants={{ hidden: {}, show: { transition: { staggerChildren: gap } } }}>
      {children}
    </motion.div>
  )
}

/** Letra de una opción (A, B, C…). */
export const optionLetter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1))
