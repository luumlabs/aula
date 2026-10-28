// Piezas comunes de las herramientas: tarjeta con título, campo numérico tolerante, cifra con su etiqueta, estado guardado
// en el navegador y formato de números según el idioma de la interfaz.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import { Card, cx, toast, useTheme, type CardProps } from '@renderer/design'
import { formatFixed, formatNumber, parseNumber, texNumber, type NumberStyle } from './lib/num'

/** Coma decimal si la interfaz está en español. */
export function useComma(): boolean {
  const { i18n } = useTranslation()
  return (i18n.language || 'en').startsWith('es')
}

/** Formato de números de la herramienta (con la coma del idioma). */
export function useFmt() {
  const comma = useComma()
  return useMemo(
    () => ({
      comma,
      sep: comma ? ',' : '.',
      num: (x: number, style: Omit<NumberStyle, 'comma'> = {}) => formatNumber(x, { ...style, comma }),
      fixed: (x: number, d: number) => formatFixed(x, d, comma),
      tex: (x: number, style: Omit<NumberStyle, 'comma'> = {}) => texNumber(x, { ...style, comma }),
      parse: parseNumber
    }),
    [comma]
  )
}

/** Estado que se guarda en localStorage (por herramienta). Si no se puede leer o escribir, sigue en memoria. */
export function useStored<T>(key: string, initial: T | (() => T), validate?: (v: unknown) => v is T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw != null) {
        const parsed: unknown = JSON.parse(raw)
        if (!validate || validate(parsed)) return parsed as T
      }
    } catch {
      /* sin almacenamiento */
    }
    return typeof initial === 'function' ? (initial as () => T)() : initial
  })
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* lleno o bloqueado: se queda en memoria */
    }
  }, [key, value])
  return [value, setValue]
}

/** Copia al portapapeles con un aviso breve. */
export function useCopy() {
  const { t } = useTranslation('tools')
  return useCallback(
    (text: string) => {
      void navigator.clipboard
        ?.writeText(text)
        .then(() => toast.success(t('common.copied'), text.length < 80 ? text : undefined))
        .catch(() => toast.error(t('common.copyFailed')))
    },
    [t]
  )
}

/** Título de una tarjeta de herramienta (serif pequeño) con acciones a la derecha. */
export function CardTitle({ title, detail, actions, className }: { title: ReactNode; detail?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-start justify-between gap-3 mb-3', className)}>
      <div className="min-w-0">
        <h3 className="font-serif text-[19px] leading-6 tracking-[-0.2px] text-text">{title}</h3>
        {detail && <div className="t-footnote mt-0.5">{detail}</div>}
      </div>
      {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
    </div>
  )
}

/** Tarjeta con título (la burbuja estándar de las herramientas). */
export function Panel({ title, detail, actions, children, className, padded = true, ...rest }: { title?: ReactNode; detail?: ReactNode; actions?: ReactNode; children: ReactNode } & Omit<CardProps, 'title' | 'children'>) {
  return (
    <Card padded={padded} className={className} {...rest}>
      {title && <CardTitle title={title} detail={detail} actions={actions} />}
      {children}
    </Card>
  )
}

const fieldCls =
  'w-full bg-field border-[0.5px] border-line-strong/40 rounded-[10px] px-3 text-[14px] text-text placeholder:text-text3 outline-none transition focus:border-accent-line focus:shadow-[0_0_0_3px_var(--accent-wash)]'

/**
 * Campo para un número: guarda el texto tal como se escribe («1,» a medias) y avisa a quien lo usa con el valor leído
 * (o `null`). Admite coma o punto, notación científica y fracciones.
 */
export function NumField({ label, value, onChange, unit, placeholder, className, invalid, compact, hint, ariaLabel, mono }: {
  label?: ReactNode
  value: string
  onChange: (text: string, parsed: number | null) => void
  unit?: ReactNode
  placeholder?: string
  className?: string
  invalid?: boolean
  compact?: boolean
  hint?: ReactNode
  ariaLabel?: string
  mono?: boolean
}) {
  const parsed = value.trim() ? parseNumber(value) : null
  const bad = invalid ?? (value.trim() !== '' && parsed === null)
  return (
    <label className={cx('block min-w-0', className)}>
      {label && <span className="block t-ui font-medium text-text2 mb-1.5 truncate">{label}</span>}
      <span className="relative flex items-center">
        <input
          inputMode="decimal"
          aria-label={ariaLabel}
          aria-invalid={bad || undefined}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value, e.target.value.trim() ? parseNumber(e.target.value) : null)}
          className={cx(fieldCls, compact ? 'h-8' : 'h-9', 'tabular', mono && 'font-mono text-[13px]', unit != null && (typeof unit === 'string' && unit.length <= 2 ? 'pr-9' : 'pr-14'), bad && 'border-danger/60 focus:border-danger focus:shadow-[0_0_0_3px_var(--danger-soft)]')}
        />
        {unit != null && <span className="absolute right-3 t-ui text-text3 pointer-events-none">{unit}</span>}
      </span>
      {hint && <span className="block t-footnote mt-1">{hint}</span>}
    </label>
  )
}

/** Campo de texto libre con el mismo aspecto (fórmulas, ecuaciones). */
export function TextInput({ value, onChange, placeholder, className, label, onEnter, ariaLabel, invalid, mono, autoFocus }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  label?: ReactNode
  onEnter?: () => void
  ariaLabel?: string
  invalid?: boolean
  mono?: boolean
  autoFocus?: boolean
}) {
  return (
    <label className={cx('block min-w-0', className)}>
      {label && <span className="block t-ui font-medium text-text2 mb-1.5">{label}</span>}
      <input
        value={value}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault()
            onEnter()
          }
        }}
        className={cx(fieldCls, 'h-10', mono && 'font-mono text-[14px]', invalid && 'border-danger/60')}
      />
    </label>
  )
}

/** Cifra protagonista con su etiqueta (serif tabular), que entra subiendo. */
export function Stat({ label, value, unit, hint, tone, className, size = 'md' }: { label: ReactNode; value: ReactNode; unit?: ReactNode; hint?: ReactNode; tone?: string; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const fs = size === 'lg' ? 'text-[34px] leading-[40px]' : size === 'sm' ? 'text-[19px] leading-6' : 'text-[26px] leading-8'
  return (
    <div className={cx('min-w-0', className)}>
      <div className="t-footnote truncate">{label}</div>
      <motion.div key={String(typeof value === 'string' || typeof value === 'number' ? value : '')} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className={cx('font-serif tabular tracking-[-0.02em] truncate', fs)} style={tone ? { color: tone } : undefined}>
        {value}
        {unit && <span className="t-ui text-text3 ml-1 font-sans tracking-normal">{unit}</span>}
      </motion.div>
      {hint && <div className="t-caption mt-0.5">{hint}</div>}
    </div>
  )
}

/** Línea etiqueta · valor (para fichas y tablas compactas). */
export function KV({ k, v, hint }: { k: ReactNode; v: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="t-footnote">{k}</div>
      <div className="t-headline tabular mt-0.5 break-words">{v}</div>
      {hint && <div className="t-caption mt-0.5">{hint}</div>}
    </div>
  )
}

/** Mensaje de error amable dentro de una tarjeta. */
export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-2 rounded-[12px] bg-danger-soft px-3 py-2 t-ui text-danger">
      <span aria-hidden className="mt-[5px] w-1.5 h-1.5 rounded-[1px] bg-danger shrink-0" />
      <span className="min-w-0">{children}</span>
    </motion.div>
  )
}

/** Fila de ejemplos para rellenar un campo con un clic. */
export function Examples({ items, onPick, label }: { items: string[]; onPick: (v: string) => void; label?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {label && <span className="t-caption mr-1">{label}</span>}
      {items.map((x) => (
        <button key={x} onClick={() => onPick(x)} className="h-6 px-2.5 rounded-full bg-fill2 hover:bg-fill3 t-ui text-text2 hover:text-text transition-colors font-mono text-[12px]">
          {x}
        </button>
      ))}
    </div>
  )
}

/** Cifra que cuenta hasta su valor (serif tabular, con la coma del idioma). Quieta con «Reducir movimiento». */
export function CountUp({ value, decimals = 2, className, duration = 0.8 }: { value: number; decimals?: number; className?: string; duration?: number }) {
  const comma = useComma()
  const { reducedMotion } = useTheme()
  const mv = useMotionValue(value)
  const text = useTransform(mv, (v) => formatFixed(v, decimals, comma))
  useEffect(() => {
    if (reducedMotion || !Number.isFinite(value)) {
      mv.set(value)
      return
    }
    const c = animate(mv, value, { duration, ease: [0.2, 0.7, 0.2, 1] })
    return () => c.stop()
  }, [value, reducedMotion, duration, mv])
  return <motion.span className={cx('tabular', className)}>{text}</motion.span>
}

/** Tamaño de un elemento (para dibujar gráficas SVG a su medida). */
export function useElementSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}
