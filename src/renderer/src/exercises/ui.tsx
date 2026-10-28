// Piezas comunes de los ejercicios: fórmula con KaTeX (y \ce de química), la tarjeta de opción que se levanta, la palabra
// de estado con su icono y la tecla de atajo.
import { memo, useMemo, type ReactNode } from 'react'
import { motion } from 'motion/react'
import katex from 'katex'
import 'katex/contrib/mhchem'
import { AULA_KATEX_MACROS } from '@engine/content/tex'
import { cx, GlassLight, Icon, spring, useTheme, type IconName } from '@renderer/design'

const cache = new Map<string, string>()

/** Fórmula con KaTeX. Si no se puede dibujar, el texto tal cual. */
export const Tex = memo(function Tex({ tex, display = false, className }: { tex: string; display?: boolean; className?: string }) {
  const html = useMemo(() => {
    const key = `${display ? 'd' : 'i'}:${tex}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    let out = ''
    try {
      out = katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: false, trust: false, output: 'html', macros: { ...AULA_KATEX_MACROS } })
    } catch {
      out = ''
    }
    if (cache.size > 600) cache.clear()
    cache.set(key, out)
    return out
  }, [tex, display])
  if (!html) return <span className={cx('t-mono text-text2', className)}>{tex}</span>
  return <span className={cx(display ? 'block' : 'inline-block', className)} dangerouslySetInnerHTML={{ __html: html }} />
})

export type Mark = 'none' | 'right' | 'wrong' | 'dimmed'

/** Tecla de atajo pequeña junto a una opción o un botón. */
export function KeyCap({ children, className, active }: { children: ReactNode; className?: string; active?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-grid h-[22px] min-w-[22px] place-items-center rounded-[7px] px-1 text-[12px] font-semibold tabular transition-colors',
        active ? 'bg-accent text-on-accent' : 'bg-fill2 text-text2',
        className
      )}
    >
      {children}
    </span>
  )
}

/** Tarjeta de opción: se levanta al pasar el ratón, la elegida con el velo de la luz y, tras comprobar, verde o rojo. */
export function OptionCard({
  selected, mark = 'none', locked, onSelect, children, detail, letter, multi, className, index = 0, role = 'radio'
}: {
  selected: boolean
  mark?: Mark
  locked?: boolean
  onSelect?: () => void
  children: ReactNode
  detail?: ReactNode
  letter?: string
  multi?: boolean
  className?: string
  index?: number
  role?: 'radio' | 'checkbox' | 'button'
}) {
  const { reducedMotion } = useTheme()
  const tone = mark === 'right' ? 'var(--success)' : mark === 'wrong' ? 'var(--danger)' : null
  const bg = tone ? `color-mix(in oklab, ${tone} 10%, var(--surface))` : selected ? 'color-mix(in oklab, var(--accent) 9%, var(--surface))' : 'var(--surface)'
  const border = tone ? `color-mix(in oklab, ${tone} 55%, transparent)` : selected ? 'var(--accent-line)' : 'var(--line)'
  return (
    <motion.button
      type="button"
      role={role}
      aria-checked={role === 'button' ? undefined : selected}
      aria-disabled={locked || undefined}
      onClick={locked ? undefined : onSelect}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: mark === 'dimmed' ? 0.55 : 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 8) * 0.04, ease: [0.2, 0.7, 0.2, 1] }}
      whileHover={!locked && !reducedMotion ? { y: -2, boxShadow: 'var(--e2)', transition: spring.snappy } : undefined}
      whileTap={!locked ? { scale: 0.985, transition: spring.snappy } : undefined}
      className={cx(
        'group relative flex w-full items-start gap-3 rounded-[16px] border px-4 py-3.5 text-left outline-none transition-[background-color,border-color] duration-200',
        'focus-visible:ring-2 focus-visible:ring-accent-line',
        locked && 'cursor-default',
        className
      )}
      style={{ background: bg, borderColor: border, boxShadow: 'var(--e1)' }}
    >
      {letter !== undefined && (
        <span
          aria-hidden
          className={cx(
            'mt-[1px] inline-grid h-[26px] min-w-[26px] shrink-0 place-items-center rounded-[8px] text-[13px] font-semibold tabular transition-colors',
            mark === 'right' ? 'bg-success text-white dark:text-black' : mark === 'wrong' ? 'bg-danger text-white dark:text-black' : selected ? 'bg-accent text-on-accent' : 'bg-fill2 text-text2 group-hover:bg-fill3'
          )}
        >
          {mark === 'right' ? <Icon name="check" size={14} /> : mark === 'wrong' ? <Icon name="close" size={13} /> : letter}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block py-[2px] t-body text-text">{children}</span>
        {detail}
      </span>
      {letter === undefined && (
        <span
          aria-hidden
          className={cx('mt-1 grid h-[18px] w-[18px] shrink-0 place-items-center border-[1.5px] transition-colors', multi ? 'rounded-[5px]' : 'rounded-full')}
          style={{ borderColor: selected ? 'var(--accent)' : 'var(--line-strong)', background: selected ? 'var(--accent)' : 'transparent' }}
        >
          {selected && (multi ? <Icon name="check" size={11} className="text-on-accent" /> : <span className="h-[6px] w-[6px] rounded-full bg-on-accent" />)}
        </span>
      )}
    </motion.button>
  )
}

/** Palabra de estado con su icono, en su color (nunca una caja de color). */
export function StatusWord({ tone, icon, children, className }: { tone: 'success' | 'warning' | 'danger' | 'neutral'; icon: IconName; children: ReactNode; className?: string }) {
  const color = tone === 'neutral' ? 'var(--text2)' : `var(--${tone})`
  return (
    <span className={cx('inline-flex items-center gap-1.5 t-headline', className)} style={{ color }}>
      <Icon name={icon} size={17} />
      {children}
    </span>
  )
}

/** La explicación en una burbuja suave con la luz mate del color del resultado detrás (antes, una raya fina a la izquierda). */
export function ToneRule({ color, children, className }: { color: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('relative isolate overflow-hidden rounded-[14px] px-3.5 py-2.5', className)} style={{ background: `color-mix(in oklab, ${color} 6%, transparent)` }}>
      <GlassLight color={color} size="sm" still />
      {children}
    </div>
  )
}
