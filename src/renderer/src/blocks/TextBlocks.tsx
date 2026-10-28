// Bloques de texto: texto, fórmula en pantalla, avisos (definición, teorema, «Ojo», error común…), cita de los materiales,
// procedimiento con línea de progreso y «Lo esencial» con marcas que se dibujan.
import { useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { Sigma } from 'lucide-react'
import { cx, GlassLight, PixelCheck, useTheme, type IconName } from '@renderer/design'
import type { BlockOf, CalloutKind } from '@shared/schema/blocks'
import type { BlockProps } from './types'
import { BlockTitle, Eyebrow, Inline, MathTex, Prose, SourceLink, useAnimate, useBlocksT, useSeen } from './shared'
import { inkColor } from './colors'

export function TextBlockView({ block, ctx }: BlockProps<BlockOf<'text'>>) {
  return <Prose text={block.md} ctx={ctx} />
}

/** Etiqueta con forma de número de ecuación: «(1)», «2.3», «(A)». */
const EQ_NUMBER = /^\(?\s*([0-9]+(?:\.[0-9]+)*[a-z]?|[A-Z])\s*\)?$/

export function MathBlockView({ block, ctx }: BlockProps<BlockOf<'math'>>) {
  const label = block.label?.trim()
  const number = label && EQ_NUMBER.test(label) ? label.replace(EQ_NUMBER, '($1)') : undefined
  const chat = ctx.mode === 'chat'
  return (
    <div className={cx('flex flex-col items-center', chat ? 'py-1' : 'py-2')}>
      {label && !number && <div className="t-ui font-semibold text-text2 mb-1.5 text-center"><Inline text={label} /></div>}
      <div className="relative flex w-full items-center">
        <MathTex tex={block.tex} className={cx('blk-math min-w-0 flex-1 text-text', chat && 'blk-math-compact')} />
        {number && <span className="shrink-0 pl-4 font-serif text-[16px] tabular text-text3">{number}</span>}
      </div>
      {block.note?.trim() && (
        <div className="t-callout text-text2 mt-2 text-center max-w-[560px]">
          <Inline text={block.note} />
        </div>
      )}
    </div>
  )
}

// MARK: Avisos

interface CalloutLook {
  icon?: IconName
  glyph?: ReactNode
  /** Color del icono, la palabra y la raya. */
  tint: string
  /** Fondo: los de estado, su relleno suave; los de contenido, neutro. */
  soft: string
  bar: string
}

function calloutLook(kind: CalloutKind): CalloutLook {
  const neutral = { tint: 'var(--text2)', soft: 'var(--fill1)', bar: 'var(--line-strong)' }
  switch (kind) {
    case 'note': return { icon: 'info', tint: 'var(--info)', soft: 'var(--info-soft)', bar: 'var(--info)' }
    case 'tip': return { icon: 'lightbulb', tint: 'var(--success)', soft: 'var(--success-soft)', bar: 'var(--success)' }
    case 'warning': return { icon: 'alert', tint: 'var(--warning)', soft: 'var(--warning-soft)', bar: 'var(--warning)' }
    case 'mistake': return { icon: 'mistakes', tint: 'var(--danger)', soft: 'var(--danger-soft)', bar: 'var(--danger)' }
    case 'question': return { icon: 'help', tint: 'var(--info)', soft: 'var(--info-soft)', bar: 'var(--info)' }
    case 'examTip': return { icon: 'exam', tint: 'var(--accent-text)', soft: 'var(--accent-wash)', bar: 'var(--accent)' }
    case 'definition': return { icon: 'book', ...neutral }
    case 'theorem': return { glyph: <Sigma size={15} strokeWidth={2} />, ...neutral }
    case 'remember': return { icon: 'pin', ...neutral }
    case 'example': return { icon: 'checklist', ...neutral }
    case 'source': return { icon: 'quote', ...neutral }
  }
}

export function CalloutBlockView({ block, ctx }: BlockProps<BlockOf<'callout'>>) {
  const t = useBlocksT()
  const look = calloutLook(block.kind)
  const title = block.title?.trim()
  const chat = ctx.mode === 'chat'
  return (
    <aside className={cx('relative isolate overflow-hidden', chat ? 'rounded-[12px] py-2.5 pl-4 pr-3' : 'rounded-[16px] py-4 pl-5 pr-5')} style={{ background: look.soft }} aria-label={t(`callout.${block.kind}`)}>
      {/* la luz del tipo de nota tras el cristal (antes, una raya de color a la izquierda) */}
      <GlassLight color={look.bar} size={chat ? 'sm' : 'md'} still={chat} />
      <div style={{ color: look.tint }}>
        <Eyebrow icon={look.icon} glyph={look.glyph} label={t(`callout.${block.kind}`)} className="mb-1" />
      </div>
      {title && <div className={cx('font-serif font-medium text-text mt-1', chat ? 'text-[15px]' : 'text-[17.5px] leading-[25px]')}><Inline text={title} /></div>}
      <div className="mt-1">
        <Prose text={block.md} ctx={ctx} size="body" />
      </div>
    </aside>
  )
}

// MARK: Cita de los materiales

export function QuoteBlockView({ block, ctx }: BlockProps<BlockOf<'quote'>>) {
  const chat = ctx.mode === 'chat'
  return (
    <blockquote className={cx('relative m-0', chat ? 'pl-4' : 'pl-6 pr-2')}>
      <span aria-hidden className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-line-strong/50" />
      {!chat && (
        <span aria-hidden className="pointer-events-none absolute -left-1 -top-5 select-none font-serif text-[64px] leading-none text-accent/25">
          “
        </span>
      )}
      <div className="italic text-text">
        <Prose text={block.md} ctx={ctx} />
      </div>
      {(block.author || block.source) && (
        <footer className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          {block.author && <span className="font-serif italic text-[15px] text-text2">— {block.author}</span>}
          {block.source && <SourceLink source={block.source} ctx={ctx} />}
        </footer>
      )}
    </blockquote>
  )
}

// MARK: Procedimiento

export function StepsBlockView({ block, ctx }: BlockProps<BlockOf<'steps'>>) {
  const { dark } = useTheme()
  const ink = inkColor(ctx.hue, dark)
  const animate = useAnimate(ctx)
  const [reached, setReached] = useState(animate ? 0 : block.steps.length)
  const chat = ctx.mode === 'chat'
  return (
    <section>
      <BlockTitle text={block.title} ctx={ctx} className="mb-3" />
      <ol className="m-0 list-none p-0">
        {block.steps.map((s, i) => {
          const on = i < reached
          const last = i === block.steps.length - 1
          return (
            <motion.li
              key={i}
              className="relative flex gap-4"
              initial={animate ? { opacity: 0, x: -6 } : false}
              whileInView={animate ? { opacity: 1, x: 0 } : undefined}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.4, ease: [0.2, 0.7, 0.2, 1] }}
              onViewportEnter={() => setReached((r) => Math.max(r, i + 1))}
            >
              <div className="relative flex w-7 shrink-0 flex-col items-center">
                <span
                  className="relative z-[1] grid h-7 w-7 place-items-center rounded-full font-serif text-[15px] tabular transition-colors duration-500"
                  style={{ background: on ? `color-mix(in oklab, ${ink} 16%, var(--surface))` : 'var(--surface)', color: on ? ink : 'var(--text3)', boxShadow: `inset 0 0 0 1px ${on ? `color-mix(in oklab, ${ink} 45%, transparent)` : 'var(--line)'}` }}
                >
                  {i + 1}
                </span>
                {!last && (
                  <span aria-hidden className="relative mt-1 mb-1 w-[2px] flex-1 overflow-hidden rounded-full bg-fill2">
                    <motion.span className="absolute inset-0 origin-top rounded-full" style={{ background: ink }} initial={false} animate={{ scaleY: i + 1 < reached ? 1 : 0 }} transition={{ duration: animate ? 0.7 : 0, ease: [0.2, 0.7, 0.2, 1] }} />
                  </span>
                )}
              </div>
              <div className={cx('min-w-0 flex-1', last ? 'pb-0' : chat ? 'pb-3' : 'pb-5')}>
                {s.title && <div className={cx('font-semibold text-text', chat ? 't-callout' : 't-headline mt-[3px] mb-0.5')}><Inline text={s.title} /></div>}
                <div className={s.title ? undefined : 'mt-[1px]'}>
                  <Prose text={s.md} ctx={ctx} size="body" />
                </div>
              </div>
            </motion.li>
          )
        })}
      </ol>
    </section>
  )
}

// MARK: Lo esencial

export function RecapBlockView({ block, ctx }: BlockProps<BlockOf<'recap'>>) {
  const t = useBlocksT()
  const ref = useRef<HTMLDivElement>(null)
  const seen = useSeen(ref, ctx, '-80px')
  const chat = ctx.mode === 'chat'
  return (
    <section ref={ref} className={cx('relative isolate overflow-hidden bg-surface border-[0.5px] border-line', chat ? 'rounded-[14px] p-3 pl-4' : 'rounded-[22px] p-6 pl-7')} style={{ boxShadow: ctx.mode === 'lesson' ? 'var(--e1)' : undefined }}>
      <GlassLight color="var(--success)" size={chat ? 'sm' : 'md'} still={chat} />
      <div className={cx('font-serif text-text', chat ? 'text-[16px] font-medium' : 't-title2')}>
        <Inline text={block.title?.trim() || t('recap.title')} />
      </div>
      <ul className={cx('m-0 list-none p-0 flex flex-col', chat ? 'mt-2 gap-1.5' : 'mt-4 gap-3')}>
        {block.points.map((p, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="mt-[7px] grid h-4 w-5 shrink-0 place-items-center" aria-hidden>
              {seen ? <PixelCheck size={16} delay={0.15 + i * 0.16} /> : <span className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <Prose text={p} ctx={ctx} size="body" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
