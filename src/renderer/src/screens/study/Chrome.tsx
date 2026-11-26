// El marco de los modos de estudio: la columna de lectura que llena la pantalla, la cápsula flotante de arriba (salir,
// qué se estudia, progreso) y la barra flotante de abajo con las acciones. Escape sale (si hay texto seleccionado, primero
// lo suelta). El texto de la columna se puede seleccionar (copiar, consultar, traducir); el idioma del curso no lo declara la
// columna (también lleva botones y avisos de la interfaz) sino el texto del curso (RichText, lib/contentLanguage.ts).
import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { cx, Icon, IconButton, spring, Tooltip, useTheme, type IconName } from '@renderer/design'
import { isTypingTarget } from '@renderer/exercises/normalize'
import { dropSelection } from './reading'
import { TutorButton } from './TutorButton'
import { useTutor } from './tutorStore'
import { useCompact } from '@renderer/app/shell/CompactTabs'

export function StudyFrame({ capsule, bottom, children, onExit, wide, reading, scrollKey, className }: {
  capsule: ReactNode
  bottom?: ReactNode
  children: ReactNode
  onExit: () => void
  /** Columna ancha (simulacro, resúmenes). */
  wide?: boolean
  /** Columna de lectura de libro (la lección): unos 70 caracteres por línea, directamente sobre el papel. */
  reading?: boolean
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
      if (dropSelection(window.getSelection())) return
      exit.current()
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [scrollKey])
  useKeyboardReveal(scroller)
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
      {/* lo que se desplaza se pierde bajo las cápsulas: el mismo papel (con su grano) que se desvanece, no una franja lisa más clara */}
      <div aria-hidden className="paper-grain pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-paper [mask-image:linear-gradient(to_bottom,black_45%,transparent)]" />
      <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center px-6 phone:px-3">{capsule}</div>
      <div ref={scroller} onClickCapture={revealAnswer} className="@container flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* se selecciona el texto, no lo que se arrastra o gira (lienzos) */}
        <div className={cx('aula-notebook selectable relative mx-auto w-full shrink-0 px-6 pt-[76px] [&_canvas]:select-none', bottom ? 'pb-4' : 'pb-36', wide ? 'max-w-[1080px]' : reading ? 'max-w-[700px]' : 'max-w-[800px]', className)}>
          {children}
        </div>
        {/* las acciones, pegadas justo debajo de lo que se estudia (no al fondo de la ventana); si lo de arriba es largo, se
            quedan sujetas abajo con su velo de papel */}
        <AnimatePresence>
          {bottom && (
            <motion.div
              key="bottom"
              data-study-bottom
              // en el teléfono la sesión llega hasta abajo (sin pestañas): la barra queda por encima de la de inicio, y siempre
              // abajo del todo (mt-auto), no flotando a media pantalla bajo un ejercicio corto ni saltando de uno a otro
              className="pointer-events-none sticky bottom-0 z-20 flex shrink-0 justify-center px-6 pt-6 pb-5 phone:mt-auto phone:px-3 phone:pb-[calc(env(safe-area-inset-bottom,0px)+12px)]"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={spring.smooth}
            >
              <div aria-hidden className="paper-grain absolute inset-x-0 bottom-0 h-full bg-paper [mask-image:linear-gradient(to_top,black_55%,transparent)]" />
              <div className="relative flex max-w-full justify-center phone:w-full">{bottom}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/**
 * Con el teclado de la pantalla abierto, lo que se escribe no queda bajo la barra de abajo: el campo con foco y lo suyo de
 * debajo (la vista previa «Lo leo como…» y la fila de símbolos, `[data-answer-block]`) se desplazan lo justo para verse
 * encima de ella, también mientras crecen al escribir. Sin teclado (el escritorio) no hace nada.
 */
function useKeyboardReveal(scroller: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const box = scroller.current
    if (!box) return
    const root = document.documentElement
    let frame = 0
    const reveal = (): void => {
      frame = 0
      const field = document.activeElement
      if (!root.classList.contains('kb-open') || !(field instanceof HTMLElement) || !box.contains(field)) return
      const block = field.closest<HTMLElement>('[data-answer-block]') ?? field
      const bar = box.querySelector<HTMLElement>('[data-study-bottom]')
      const view = box.getBoundingClientRect()
      const limit = view.bottom - (bar?.getBoundingClientRect().height ?? 0) - 8
      const hidden = block.getBoundingClientRect().bottom - limit
      if (hidden <= 0) return
      // sin que el campo se vaya bajo la cápsula de arriba
      const room = field.getBoundingClientRect().top - (view.top + 76)
      const by = Math.min(hidden, Math.max(0, room))
      if (by > 2) box.scrollBy({ top: by })
    }
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(reveal)
    }
    const classes = new MutationObserver(schedule)
    classes.observe(root, { attributes: true, attributeFilter: ['class'] })
    const grows = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    if (box.firstElementChild) grows?.observe(box.firstElementChild)
    grows?.observe(box)
    box.addEventListener('focusin', schedule)
    return () => {
      classes.disconnect()
      grows?.disconnect()
      box.removeEventListener('focusin', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [scroller])
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

/** La cápsula de arriba: salir · icono y nombre del modo · lo que va en medio (progreso) · extras y, con `tutor`, la puerta fija
 *  al tutor (aprender, practicar, tarjetas y errores; nunca en el simulacro). En el teléfono no cabe todo: el nombre se queda
 *  en su icono (si hay algo más que enseñar), el progreso en su versión breve (`brief`, «3 de 9») y los botones de la derecha
 *  siempre a la vista; si aun así no cabe, la cápsula se desliza de lado en vez de dejarlos fuera de la pantalla. */
export function TopCapsule({ icon, label, onExit, children, brief, trailing, tutor }: { icon: IconName; label: ReactNode; onExit: () => void; children?: ReactNode; brief?: ReactNode; trailing?: ReactNode; tutor?: boolean }) {
  const { t } = useTranslation('study')
  const compact = useCompact()
  // sin nada publicado (aún no hay ejercicio ni paso a la vista) no hay puerta: ni el separador
  const canAsk = useTutor((s) => !!s.published)
  const extras = tutor && canAsk ? (
    <>
      {trailing}
      <TutorButton className="rounded-full!" />
    </>
  ) : trailing
  const middle = compact && brief ? brief : children
  // en el teléfono, con progreso o botones al lado, el nombre solo lo oye el lector de pantalla
  const iconOnly = compact && !!(middle || extras)
  return (
    <GlassCapsule className={compact ? 'overflow-x-auto no-scrollbar' : undefined}>
      <Tooltip label={t('chrome.exit')} side="bottom">
        <IconButton label={t('chrome.exit')} size="sm" onClick={onExit} className="rounded-full!">
          <Icon name="close" size={15} />
        </IconButton>
      </Tooltip>
      <span className={cx('flex min-w-0 items-center gap-1.5 pl-1 t-ui font-semibold text-text', iconOnly ? 'shrink-0 pr-1' : 'pr-2')}>
        <Icon name={icon} size={15} className="shrink-0 text-text2" />
        <span className={iconOnly ? 'sr-only' : 'max-w-[260px] truncate'}>{label}</span>
      </span>
      {/* con texto grande o ventana estrecha encoge (con «…») solo el título: el progreso y los botones de la derecha no encogen,
          así el contador nunca se monta sobre ellos (A4-P2-17: «16 mi♫») */}
      {middle && (
        <>
          <span className="h-5 w-[0.5px] shrink-0 bg-line" aria-hidden />
          <span className={cx('flex items-center gap-2 px-2', compact ? 'min-w-0' : 'shrink-0')}>{middle}</span>
        </>
      )}
      {extras && (
        <>
          <span className="h-5 w-[0.5px] shrink-0 bg-line" aria-hidden />
          <span className="flex shrink-0 items-center gap-1 pl-1">{extras}</span>
        </>
      )}
    </GlassCapsule>
  )
}

export type DotState = 'todo' | 'done' | 'warn' | 'wrong' | 'locked'

/** Puntos de progreso: el actual se alarga y siempre va en ladrillo; los hechos, con la tinta del curso. Se ven de 7 px, pero cada
 *  uno se pulsa en una zona de 24 px (§2.9). Con muchos, «3 / 16». */
export function ProgressDots({ states, current, ink = 'var(--accent)', onPick, max = 16 }: { states: DotState[]; current: number; ink?: string; onPick?: (i: number) => void; max?: number }) {
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
    <span className="-mx-1 flex shrink-0 items-center" role="group" aria-label={t('common.nOfM', { n: current + 1, m: states.length })}>
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
            // con el dedo, cada punto se pulsa en 44 px sin cambiar cómo se ve
            className="touch-target relative grid h-6 place-items-center disabled:cursor-default"
            style={{ width: on ? 32 : 24 }}
          >
            <motion.span
              aria-hidden
              layout={!reducedMotion}
              transition={spring.snappy}
              className="block h-[7px] rounded-full"
              style={{ width: on ? 20 : 7, background: on ? 'var(--accent)' : color, opacity: s === 'locked' ? 0.7 : 1 }}
            />
          </motion.button>
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
      <span className="relative h-[5px] w-[120px] overflow-hidden rounded-full bg-fill2 phone:w-12">
        <motion.span className="absolute inset-y-0 left-0 rounded-full bg-accent" initial={false} animate={{ width: `${pct * 100}%` }} transition={spring.smooth} />
      </span>
      <span className="t-ui tabular text-text2 whitespace-nowrap">{label}</span>
    </span>
  )
}

/** Separador vertical fino dentro de una cápsula. */
export const CapsuleDivider = () => <span className="mx-1 h-5 w-[0.5px] bg-line" aria-hidden />
