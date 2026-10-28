// Pestañas en cápsula (como «Resumen · Aprender · Practicar…»): la píldora elegida se desliza.
// La píldora es UNA sola, hermana de los botones y antes que ellos (así nunca pinta encima de una etiqueta: A4-P1-6), y se
// mueve con `x` y `width` medidos del botón activo. Sin `layoutId`: motion guarda cada `layoutId` en un mapa global que no
// se vacía, y uno distinto por montaje retenía la pantalla entera que se fue (A5-P1-1).
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { cx } from './cx'
import { spring } from './tokens'
import { useTheme } from './theme'

export interface TabItem<T extends string> {
  id: T
  label: ReactNode
  icon?: ReactNode
  badge?: number
}

/** Dónde va la píldora: el hueco del botón activo dentro de la cápsula (o nada si no hay ninguno activo). */
export interface PillBox {
  x: number
  w: number
}

/** La caja del botón activo, o `null`; devuelve la anterior si no cambió (para no volver a pintar). */
export function measurePill(list: HTMLElement | null, prev: PillBox | null): PillBox | null {
  const btn = list?.querySelector<HTMLElement>(':scope > [role="tab"][aria-selected="true"]')
  if (!btn) return null
  const next = { x: btn.offsetLeft, w: btn.offsetWidth }
  return prev && prev.x === next.x && prev.w === next.w ? prev : next
}

export function SegmentedTabs<T extends string>({ items, value, onChange, size = 'md', className, fill }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md' | 'lg'; className?: string; fill?: boolean }) {
  const { reducedMotion } = useTheme()
  const list = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<PillBox | null>(null)
  const h = size === 'sm' ? 'h-7 text-[12.5px] px-3' : size === 'lg' ? 'h-9 text-[14px] px-4' : 'h-8 text-[13px] px-3.5'
  const ids = items.map((it) => it.id).join('\u0000')
  // se mide antes de pintar (sin parpadeo) y otra vez si cambia el tamaño de la cápsula o de una etiqueta (idioma, texto al 130 %)
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    const measure = () => setPill((p) => measurePill(el, p))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    for (const b of el.querySelectorAll(':scope > [role="tab"]')) ro.observe(b)
    return () => ro.disconnect()
  }, [value, ids, size, fill])
  return (
    <div ref={list} role="tablist" className={cx('relative isolate inline-flex items-center gap-0.5 rounded-full bg-fill2 p-[3px] no-drag', fill && 'w-full', className)}>
      {pill && (
        <motion.span
          aria-hidden
          data-tab-pill
          className="pointer-events-none absolute left-0 top-[3px] bottom-[3px] rounded-full bg-raised shadow-[var(--e1)] border-[0.5px] border-line"
          initial={false}
          animate={{ x: pill.x, width: pill.w }}
          transition={reducedMotion ? { duration: 0 } : spring.snappy}
        />
      )}
      {items.map((it) => {
        const active = it.id === value
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.id)}
            className={cx('relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-colors outline-none', h, fill && 'flex-1', active ? 'text-text' : 'text-text2 hover:text-text')}
          >
            <span className="relative inline-flex items-center gap-1.5">
              {it.icon}
              {it.label}
              {it.badge ? <span className="t-caption tabular text-accent-text">{it.badge}</span> : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}
