// El marco de los modos de estudio: la columna de lectura que llena la pantalla, la cápsula flotante de arriba (salir,
// qué se estudia, progreso) y la barra flotante de abajo con las acciones. Escape sale.
import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { cx, Icon, IconButton, spring, Tooltip, useTheme, type IconName } from '@renderer/design'
import { isTypingTarget } from '@renderer/exercises/normalize'

export function StudyFrame({ capsule, bottom, children, onExit, wide, scrollKey, className }: {
  capsule: ReactNode
  bottom?: ReactNode
  children: ReactNode
  onExit: () => void
  /** Columna ancha (simulacro, resúmenes). */
  wide?: boolean
  /** Al cambiar, vuelve arriba (cambio de página o de ejercicio). */
  scrollKey?: string | number
  className?: string
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const exit = useRef(onExit)
  exit.current = onExit
  useEffect(() => {
    const fn = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (isTypingTarget(document.activeElement as HTMLElement | null)) {
        ;(document.activeElement as HTMLElement).blur()
        return
      }
      exit.current()
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [scrollKey])
  const { reducedMotion } = useTheme()
  // Al responder dentro de un bloque (predecir, detectar el error…), lo que contesta Aula aparece debajo: si queda tapado por
  // la barra de abajo, se desplaza lo justo para verlo (sin perder de vista el principio del bloque).
  const revealAnswer = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement
    if (!target.closest('button, [role="radio"], [role="option"], label')) return
    const block = target.closest<HTMLElement>('[data-block], [data-exercise]')
    const box = scroller.current
    if (!block || !box) return
    window.setTimeout(() => {
      const view = box.getBoundingClientRect()
      const r = block.getBoundingClientRect()
      const hidden = r.bottom - (view.bottom - (bottom ? 128 : 24))
      if (hidden <= 0) return
      const room = r.top - (view.top + 84)
      const by = Math.min(hidden, Math.max(0, room))
      if (by > 4) box.scrollBy({ top: by, behavior: reducedMotion ? 'auto' : 'smooth' })
    }, 420)
  }
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* velo de papel (un solo color que se desvanece) tras las cápsulas: el texto no se lee a través de ellas */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-[linear-gradient(to_bottom,var(--paper)_45%,transparent)]" />
      {bottom && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-[linear-gradient(to_top,var(--paper)_40%,transparent)]" />}
      <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center px-6">{capsule}</div>
      <div ref={scroller} onClickCapture={revealAnswer} className="@container min-h-0 flex-1 overflow-y-auto">
        <div className={cx('mx-auto w-full px-6 pt-[76px] pb-36', wide ? 'max-w-[1080px]' : 'max-w-[800px]', className)}>{children}</div>
      </div>
      <AnimatePresence>
        {bottom && (
          <motion.div
            key="bottom"
            className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-6"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={spring.smooth}
          >
            {bottom}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Cápsula de vidrio (arriba: progreso; abajo: acciones). */
export function GlassCapsule({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      layout
      transition={spring.smooth}
      className={cx('pointer-events-auto flex max-w-full items-center gap-1 rounded-full border-[0.5px] border-line material-bar p-1.5 shadow-[var(--e3)]', className)}
    >
      {children}
    </motion.div>
  )
}

/** La cápsula de arriba: salir · icono y nombre del modo · lo que va en medio (progreso) · extras. */
export function TopCapsule({ icon, label, onExit, children, trailing }: { icon: IconName; label: ReactNode; onExit: () => void; children?: ReactNode; trailing?: ReactNode }) {
  const { t } = useTranslation('study')
  return (
    <GlassCapsule>
      <Tooltip label={t('chrome.exit')} side="bottom">
        <IconButton label={t('chrome.exit')} size="sm" onClick={onExit} className="rounded-full!">
          <Icon name="close" size={15} />
        </IconButton>
      </Tooltip>
      <span className="flex min-w-0 items-center gap-1.5 pl-1 pr-2 t-ui font-semibold text-text">
        <Icon name={icon} size={15} className="shrink-0 text-text2" />
        <span className="max-w-[260px] truncate">{label}</span>
      </span>
      {/* con texto grande o ventana estrecha encoge (con «…») solo el título: el progreso y los botones de la derecha no encogen,
          así el contador nunca se monta sobre ellos (A4-P2-17: «16 mi♫») */}
      {children && (
        <>
          <span className="h-5 w-[0.5px] shrink-0 bg-line" aria-hidden />
          <span className="flex shrink-0 items-center gap-2 px-2">{children}</span>
        </>
      )}
      {trailing && (
        <>
          <span className="h-5 w-[0.5px] shrink-0 bg-line" aria-hidden />
          <span className="flex shrink-0 items-center gap-1 pl-1">{trailing}</span>
        </>
      )}
    </GlassCapsule>
  )
}

export type DotState = 'todo' | 'done' | 'warn' | 'wrong' | 'locked'

/** Puntos de progreso: el actual se alarga y siempre va en ladrillo; los hechos, con la tinta del curso. Con muchos, «3 / 40». */
export function ProgressDots({ states, current, ink = 'var(--accent)', onPick, max = 24 }: { states: DotState[]; current: number; ink?: string; onPick?: (i: number) => void; max?: number }) {
  const { reducedMotion } = useTheme()
  const { t } = useTranslation('study')
  if (states.length > max)
    return (
      <span className="t-ui tabular text-text2">
        {current + 1} / {states.length}
      </span>
    )
  return (
    // cada punto dice cuál es («3 of 8»): antes eran botones sin nombre con rol de elemento de lista (A4-P2-12)
    <span className="flex shrink-0 items-center gap-[5px]" role="group" aria-label={t('common.nOfM', { n: current + 1, m: states.length })}>
      {states.map((s, i) => {
        const on = i === current
        const color = s === 'done' ? ink : s === 'warn' ? 'var(--warning)' : s === 'wrong' ? 'var(--danger)' : on ? 'var(--accent)' : s === 'locked' ? 'var(--fill3)' : 'var(--fill4)'
        return (
          <motion.button
            key={i}
            type="button"
            tabIndex={-1}
            aria-label={t('common.nOfM', { n: i + 1, m: states.length })}
            aria-current={on ? 'step' : undefined}
            disabled={!onPick || s === 'locked'}
            onClick={() => onPick?.(i)}
            layout={!reducedMotion}
            transition={spring.snappy}
            className="h-[7px] rounded-full disabled:cursor-default"
            style={{ width: on ? 20 : 7, background: on ? 'var(--accent)' : color, opacity: s === 'locked' ? 0.7 : 1 }}
          />
        )
      })}
    </span>
  )
}

/** Barra de progreso fina de la cápsula (con «3 de 10»). */
export function CapsuleProgress({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(1, value / total) : 0
  return (
    <span className="flex items-center gap-2.5">
      <span className="relative h-[5px] w-[120px] overflow-hidden rounded-full bg-fill2">
        <motion.span className="absolute inset-y-0 left-0 rounded-full bg-accent" initial={false} animate={{ width: `${pct * 100}%` }} transition={spring.smooth} />
      </span>
      <span className="t-ui tabular text-text2 whitespace-nowrap">{label}</span>
    </span>
  )
}

/** Separador vertical fino dentro de una cápsula. */
export const CapsuleDivider = () => <span className="mx-1 h-5 w-[0.5px] bg-line" aria-hidden />
