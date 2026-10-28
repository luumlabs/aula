// Gesto de zoom y desplazamiento para figuras, diagramas y mapas: pellizcar o Ctrl + rueda para ampliar alrededor del cursor,
// arrastrar para mover (solo si hay algo que mover) y botones −/+ con transición suave. Distingue un clic de un arrastre.
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from 'react'
import { clampTransform, makeTransform, MAX_SCALE, panBy, sameSize, zoomAround, type Size, type ViewTransform } from '../lib/viewTransform'

export interface PanZoom {
  t: ViewTransform
  /** Hay transición (botones) o no (gesto en curso). */
  smooth: boolean
  dragging: boolean
  /** ¿Se puede mover (contenido mayor que la ventana)? */
  pannable: boolean
  zoomBy: (factor: number) => void
  reset: () => void
  /** El último gesto fue un arrastre (no cuenta como clic). */
  wasDrag: () => boolean
  bind: {
    onPointerDown: (e: RPointerEvent<HTMLElement>) => void
    onPointerMove: (e: RPointerEvent<HTMLElement>) => void
    onPointerUp: (e: RPointerEvent<HTMLElement>) => void
    onPointerCancel: (e: RPointerEvent<HTMLElement>) => void
  }
}

export function usePanZoom(viewRef: RefObject<HTMLElement | null>, fitted: Size, viewport: Size, opts: { enabled?: boolean; maxScale?: number } = {}): PanZoom {
  const enabled = opts.enabled ?? true
  const maxScale = opts.maxScale ?? MAX_SCALE
  const [t, setT] = useState<ViewTransform>(() => makeTransform(fitted, viewport))
  const [smooth, setSmooth] = useState(false)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ id: number; sx: number; sy: number; from: { x: number; y: number }; moved: boolean } | null>(null)
  const lastDrag = useRef(false)
  const tRef = useRef(t)
  tRef.current = t

  // la ventana o la figura cambian de tamaño: se vuelve a encuadrar
  useEffect(() => {
    if (!sameSize(t.fitted, fitted) || !sameSize(t.viewport, viewport)) setT(makeTransform(fitted, viewport))
  }, [fitted, viewport, t.fitted, t.viewport])

  const zoomBy = useCallback((factor: number) => {
    setSmooth(true)
    setT((cur) => zoomAround(cur, cur.scale * factor, cur.viewport.width / 2, cur.viewport.height / 2, maxScale))
  }, [maxScale])
  const reset = useCallback(() => {
    setSmooth(true)
    setT((cur) => makeTransform(cur.fitted, cur.viewport))
  }, [])

  // Ctrl + rueda (y el pellizco del trackpad, que llega así): zoom alrededor del cursor. La rueda sola desplaza la página.
  useEffect(() => {
    const el = viewRef.current
    if (!el || !enabled) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const k = Math.exp(-e.deltaY * 0.0045)
      setSmooth(false)
      setT((cur) => zoomAround(cur, cur.scale * k, e.clientX - r.left, e.clientY - r.top, maxScale))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [viewRef, enabled, maxScale])

  const pannable = t.fitted.width * t.scale > t.viewport.width + 1 || t.fitted.height * t.scale > t.viewport.height + 1

  const bind = {
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      lastDrag.current = false
      if (!enabled || e.button !== 0) return
      drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, from: { x: tRef.current.x, y: tRef.current.y }, moved: false }
    },
    onPointerMove: (e: RPointerEvent<HTMLElement>) => {
      const d = drag.current
      if (!d || d.id !== e.pointerId) return
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy
      if (!d.moved && Math.hypot(dx, dy) < 4) return
      const cur = tRef.current
      if (!(cur.fitted.width * cur.scale > cur.viewport.width + 1 || cur.fitted.height * cur.scale > cur.viewport.height + 1)) return
      if (!d.moved) {
        d.moved = true
        setDragging(true)
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* el puntero ya no existe */ }
      }
      setSmooth(false)
      setT(panBy(cur, dx, dy, d.from))
    },
    onPointerUp: (e: RPointerEvent<HTMLElement>) => {
      const d = drag.current
      if (d && d.id === e.pointerId) lastDrag.current = d.moved
      drag.current = null
      setDragging(false)
    },
    onPointerCancel: () => {
      drag.current = null
      setDragging(false)
    }
  }
  return { t: clampTransform(t, maxScale), smooth, dragging, pannable, zoomBy, reset, wasDrag: () => lastDrag.current, bind }
}
