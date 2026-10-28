// Piezas comunes de los bloques visuales: cabecera (etiqueta + título serif), pie, crédito, barra de vidrio flotante,
// controles de zoom y ganchos (medidas, visibilidad).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon, cx, toneForHue, useTheme, type IconName } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { fmtPercent } from '@renderer/lib/format'
import '../visual.css'

/** Cabecera del bloque: etiqueta pequeña con icono, título serif y acciones a la derecha (bajan si no caben). */
export function BlockHeader({ icon, eyebrow, title, actions, className }: { icon: IconName; eyebrow: string; title?: string; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-end justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 t-footnote font-medium text-text3">
          <Icon name={icon} size={13} />
          <span>{eyebrow}</span>
        </div>
        {title && (
          <h3 className="font-serif text-[19px] leading-[26px] font-medium text-text mt-0.5 tracking-[-0.2px]">
            <RichText text={title} inline />
          </h3>
        )}
      </div>
      {actions && <div className="flex items-center gap-1.5 flex-wrap">{actions}</div>}
    </div>
  )
}

export function Caption({ text }: { text?: string }) {
  if (!text) return null
  return (
    <p className="t-footnote text-text2 leading-[18px]">
      <RichText text={text} inline />
    </p>
  )
}

export function Credit({ text }: { text?: string }) {
  const { t } = useTranslation('visual')
  if (!text) return null
  return (
    <p className="t-caption text-text3 flex items-start gap-1.5" aria-label={t('credit', { text })}>
      <Icon name="quote" size={11} className="mt-[1px]" />
      <span className="line-clamp-2">{text}</span>
    </p>
  )
}

/** Barra de controles que flota sobre un lienzo (vidrio claro, cápsula). */
export function GlassBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('inline-flex items-center gap-0.5 rounded-full px-1 py-0.5 bg-raised/85 backdrop-blur-md border-[0.5px] border-line shadow-[var(--e1)] text-text', className)}>
      {children}
    </div>
  )
}

/** Botón pequeño de una barra de vidrio. */
export function GlassButton({ label, onClick, disabled, children, active }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx('inline-grid place-items-center h-6 min-w-6 px-1 rounded-full t-caption font-semibold text-text2 hover:text-text hover:bg-fill2 disabled:opacity-35 transition-colors', active && 'bg-fill2 text-text')}
    >
      {children}
    </button>
  )
}

/** −  100 %  + (el porcentaje vuelve a la vista entera). */
export function ZoomControls({ scale, onZoom, onReset, max = 6 }: { scale: number; onZoom: (factor: number) => void; onReset: () => void; max?: number }) {
  const { t } = useTranslation('visual')
  return (
    <GlassBar>
      <GlassButton label={t('zoomOut')} onClick={() => onZoom(1 / 1.5)} disabled={scale <= 1.001}>
        <Icon name="minus" size={13} />
      </GlassButton>
      <GlassButton label={t('zoomFit')} onClick={onReset}>
        <span className="tabular min-w-[38px] text-center">{fmtPercent(scale)}</span>
      </GlassButton>
      <GlassButton label={t('zoomIn')} onClick={() => onZoom(1.5)} disabled={scale >= max - 0.01}>
        <Icon name="plus" size={13} />
      </GlassButton>
    </GlassBar>
  )
}

/** Ancho y alto de un elemento (ResizeObserver). */
export function useSize<T extends HTMLElement>(): [RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = (): void => {
      const r = el.getBoundingClientRect()
      setSize((s) => (Math.abs(s.width - r.width) > 0.5 || Math.abs(s.height - r.height) > 0.5 ? { width: r.width, height: r.height } : s))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}

/** ¿El elemento se ve? (para no animar ni dibujar a 60 fps fuera de la pantalla). `once`: se queda en true la primera vez. */
export function useInView<T extends Element>(ref: RefObject<T | null>, once = false, margin = '0px'): boolean {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        const v = entries.some((e) => e.isIntersecting)
        if (once) {
          if (v) {
            setSeen(true)
            io.disconnect()
          }
        } else setSeen(v)
      },
      { rootMargin: margin }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref, once, margin])
  return seen
}

/** Pista sobre el lienzo (abajo a la izquierda): «Arrastra para girar…». */
export function CanvasHint({ children }: { children: ReactNode }) {
  return <div className="pointer-events-none absolute left-2.5 bottom-2 t-caption text-text3 bg-raised/70 backdrop-blur-sm rounded-full px-2 py-0.5">{children}</div>
}

/** Recuadro del lienzo (pozo de papel con esquinas de burbuja). */
export const canvasWell = 'relative isolate overflow-hidden rounded-[18px] bg-sunken border-[0.5px] border-line'

/** La tinta del curso (`ctx.hue`) para los colores de datos «accent» de la figura; sin curso, el ladrillo de Aula. */
export function useInk(hue: number | undefined): CSSProperties | undefined {
  const { dark } = useTheme()
  if (hue === undefined || !Number.isFinite(hue)) return undefined
  const t = toneForHue(hue)
  return { ['--viz-accent' as string]: dark ? t.inkDark : t.inkLight } as CSSProperties
}
