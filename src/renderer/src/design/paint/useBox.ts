// El tamaño de la caja donde va un dibujo (px de CSS), redondeado y con histéresis: al arrastrar la ventana no se redibuja
// en cada paso, solo cuando la caja cambia de verdad.
import { useLayoutEffect, useState, type RefObject } from 'react'

export interface Box {
  w: number
  h: number
}

const bucket = (v: number, step: number) => Math.max(step, Math.ceil(v / step) * step)

/** `step`: redondeo (px); `tol`: cuánto puede cambiar (fracción) antes de volver a medir de verdad. */
export function useBox(ref: RefObject<Element | null>, fixed?: Box, step = 8, tol = 0.06): Box | null {
  const [box, setBox] = useState<Box | null>(fixed ?? null)
  useLayoutEffect(() => {
    if (fixed) return
    const el = ref.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) return
      const next = { w: bucket(r.width, step), h: bucket(r.height, step) }
      const near = (a: number, c: number) => Math.abs(a - c) <= Math.max(step, a * tol)
      setBox((b) => (b && near(b.w, next.w) && near(b.h, next.h) ? b : next))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, fixed, step, tol])
  return fixed ?? box
}
