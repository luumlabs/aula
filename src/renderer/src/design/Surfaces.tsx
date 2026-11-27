// Superficies: el papel es sólido. «Group» es la lista agrupada (el contenedor por defecto); «Card» es un objeto
// (un examen, un permiso, un documento) que puede levantarse al pasar el ratón o flotar suavemente.
import { forwardRef, useCallback, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { cx } from './cx'
import { enter, spring } from './tokens'
import { useTheme } from './theme'
import { PigmentMark } from './PigmentMark'
import { useFloat } from './Motion'

export interface CardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children?: ReactNode
  interactive?: boolean
  /** Flota muy despacio (2–3 px), para lo que debe llamar la atención sin molestar: el calendario, un examen cercano. */
  floating?: boolean
  padded?: boolean | 'sm' | 'lg'
  enterAnim?: boolean
  /** Color de identidad (el tono del curso, de un evento…): una luz mate de ese color se mueve detrás de la burbuja, como tras
   *  un cristal esmerilado, y se acerca al ratón. (Antes era una raya de 3 px a la izquierda.) */
  mark?: string
  /** Luz compacta (fichas bajas en listas, como la agenda). */
  markSize?: 'md' | 'sm'
  elevation?: 1 | 2 | 3
  /** Velo plano muy suave con un color de identidad (el tono de un curso). Nunca degradados de varios colores. */
  wash?: string
  /** `bubble`: la burbuja de siempre (un objeto: un examen, una flashcard, un ejercicio). `sheet`: sobre el papel, sin fondo ni
   *  sombra, con un filete arriba (una sección de la página, no un objeto). */
  variant?: 'bubble' | 'sheet'
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { children, interactive, floating, padded = true, enterAnim, mark, markSize = 'md', elevation = 1, wash, variant = 'bubble', className, style, onKeyDown, ...rest },
  ref
) {
  const { reducedMotion } = useTheme()
  const own = useRef<HTMLDivElement | null>(null)
  useFloat(own, { amplitude: 3, duration: 8, enabled: !!floating })
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      own.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) ref.current = el
    },
    [ref]
  )
  const sheet = variant === 'sheet'
  // la hoja no lleva relleno a los lados: su texto se alinea con el resto de la página; en el teléfono, la holgada encoge
  // (con 28 px por lado el texto de dentro se quedaba en una columna)
  const pad = padded === false ? '' : sheet ? 'pt-5 pb-2' : padded === 'sm' ? 'p-4' : padded === 'lg' ? 'p-7 phone:p-5' : 'p-5'
  const shadowClass = sheet ? '' : elevation === 3 ? 'shadow-[var(--e3)]' : elevation === 2 ? 'shadow-[var(--e2)]' : 'shadow-[var(--e1)]'
  // una tarjeta que se pulsa es un botón: se enfoca con Tab y se abre con Intro o Espacio, como `Row` (A4-P1-4). Solo
  // reacciona a las teclas sobre ella misma, no sobre un campo o un botón de dentro.
  const clickable = typeof rest.onClick === 'function'
  const keys = clickable
    ? {
        role: rest.role ?? 'button',
        tabIndex: rest.tabIndex ?? 0,
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
          onKeyDown?.(e)
          if (e.defaultPrevented || e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.currentTarget.click()
          }
        }
      }
    : { onKeyDown }
  return (
    <motion.div
      ref={setRef}
      variants={enterAnim ? enter : undefined}
      className={cx(
        'relative',
        sheet ? 'border-t border-rule' : 'rounded-[22px] bg-surface border-[0.5px] border-line',
        shadowClass,
        mark && !sheet && 'isolate',
        pad,
        interactive && 'cursor-default',
        interactive && !sheet && 'transition-shadow duration-150 hover:shadow-[var(--e2)]',
        className
      )}
      style={{ ...(wash && !sheet ? { backgroundImage: `linear-gradient(color-mix(in oklab, ${wash} 9%, transparent), color-mix(in oklab, ${wash} 9%, transparent))` } : {}), ...style }}
      whileHover={interactive && !sheet && !reducedMotion ? { y: -2, transition: spring.snappy } : undefined}
      whileTap={interactive && clickable ? { scale: 0.985, transition: spring.snappy } : undefined}
      {...rest}
      {...keys}
    >
      {/* sobre el papel no hay muestra de pigmento: caería debajo del texto */}
      {mark && !sheet && <PigmentMark color={mark} size={markSize} />}
      {children}
    </motion.div>
  )
})

/** Filete: una línea fina de tinta sobre el papel que separa partes de una página (en vez de otra tarjeta). */
export function Rule({ className }: { className?: string }) {
  return <hr className={cx('m-0 h-px border-0 bg-rule', className)} />
}

/** Sección de una página: filete arriba, título serif, un detalle opcional y una acción a la derecha. `size="sm"` para las
 *  notas de la columna del margen. Entra con la página (`enter`). El título le da nombre a la sección. */
export function Section({ title, detail, action, size = 'md', children, className, rule = true, labelledBy }: {
  title?: ReactNode
  detail?: ReactNode
  action?: ReactNode
  size?: 'md' | 'sm'
  children?: ReactNode
  className?: string
  /** Sin filete (la primera sección de una columna). */
  rule?: boolean
  /** Id del título (si no, uno propio). */
  labelledBy?: string
}) {
  const auto = useId()
  const headId = title ? (labelledBy ?? auto) : undefined
  return (
    <motion.section variants={enter} aria-labelledby={headId ?? labelledBy} className={cx(rule && 'border-t border-rule', size === 'sm' ? 'pt-4 pb-5' : 'pt-6 pb-7', className)}>
      {(title || action) && (
        <div className={cx('flex items-baseline justify-between gap-4', size === 'sm' ? 'mb-2' : 'mb-3')}>
          <div className="min-w-0">
            {title && <h2 id={headId} className={size === 'sm' ? 'font-serif text-[calc(17rem/15)] leading-[calc(22rem/15)] font-medium tracking-[-0.1px] text-text' : 't-title2 text-text'}>{title}</h2>}
            {detail && <div className="t-footnote mt-0.5">{detail}</div>}
          </div>
          {action && <div className="shrink-0 t-ui">{action}</div>}
        </div>
      )}
      {children}
    </motion.section>
  )
}

/** Lista agrupada con separadores que empiezan donde empieza el texto. Con `plain`, sin caja: solo las filas con su filete
 *  (dentro de una tarjeta, para no meter una caja dentro de otra). */
export function Group({ children, className, inset = 52, plain }: { children: ReactNode; className?: string; inset?: number; plain?: boolean }) {
  return (
    <div className={cx(plain ? 'list-plain' : 'list-group overflow-hidden', className)} style={{ ['--row-inset' as string]: `${inset}px` }}>
      {children}
    </div>
  )
}

export interface RowProps extends Omit<HTMLMotionProps<'div'>, 'children' | 'title'> {
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  chevron?: boolean
  onClick?: () => void
  selected?: boolean
  mark?: string
  index?: number
}

/** Fila de lista (52 px con dos líneas). El separador se dibuja arriba salvo en la primera. */
export function Row({ leading, title, subtitle, trailing, chevron, onClick, selected, mark, index = 0, className, ...rest }: RowProps) {
  return (
    <motion.div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick()
        }
      }}
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay: Math.min(index, 6) * 0.016, ease: [0.2, 0.7, 0.2, 1] }}
      className={cx(
        'group/row relative flex min-h-[52px] items-center gap-3 px-4 py-2.5 outline-none transition-colors',
        onClick && 'hover:bg-fill1 active:bg-fill2 focus-visible:bg-fill1',
        selected && 'bg-accent-wash',
        mark && 'isolate',
        'before:absolute before:top-0 before:right-0 before:h-[0.5px] before:bg-[var(--row-line,var(--line-soft))] before:left-[var(--row-inset)] first:before:hidden',
        className
      )}
      {...rest}
    >
      {mark && <PigmentMark color={mark} size="sm" />}
      {leading && <div className="flex w-7 shrink-0 justify-center text-text2">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="t-callout text-text truncate">{title}</div>
        {subtitle && <div className="t-ui text-text2 truncate">{subtitle}</div>}
      </div>
      {trailing && <div className="t-number-inline text-text2 shrink-0">{trailing}</div>}
      {chevron && <ChevronRightSmall />}
    </motion.div>
  )
}

function ChevronRightSmall() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text3 shrink-0 transition-transform group-hover/row:translate-x-0.5" aria-hidden>
      <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
    </svg>
  )
}

/** Encabezado de pantalla (título serif) y de sección. */
export function PageHeader({ eyebrow, title, subtitle, actions, className }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <motion.header className={cx('flex items-end justify-between gap-6 flex-wrap', className)} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
      <div className="min-w-0">
        {eyebrow && <div className="t-eyebrow mb-2">{eyebrow}</div>}
        <h1 className="t-title1 text-text">{title}</h1>
        {subtitle && <p className="t-body text-text2 mt-1.5 max-w-[640px]">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </motion.header>
  )
}

export function SectionTitle({ title, detail, action, className }: { title: ReactNode; detail?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-end justify-between gap-4 mb-2.5', className)}>
      <div className="min-w-0">
        <h2 className="t-title2 text-text">{title}</h2>
        {detail && <div className="t-footnote mt-0.5">{detail}</div>}
      </div>
      {action && <div className="shrink-0 t-ui">{action}</div>}
    </div>
  )
}
