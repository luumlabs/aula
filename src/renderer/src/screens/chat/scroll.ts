// Desplazamiento de la conversación que no pelea con quien lee: mientras estás abajo, sigue a lo que llega (sin animación por
// fotograma, que da tirones); en cuanto subes (rueda, arrastre, teclado), te deja tranquilo y aparece «Ir al final».
// Al enviar un mensaje vuelve abajo.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** ¿Está la vista pegada al final? (con un margen para el redondeo y los últimos píxeles). */
export function isNearBottom(scrollTop: number, clientHeight: number, scrollHeight: number, margin = 48): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= margin
}

export interface StickToBottom {
  /** Sigue al final (false si quien lee subió). */
  stuck: boolean
  /** Vuelve al final (suave) y lo sigue otra vez. */
  toBottom: (smooth?: boolean) => void
}

export function useStickToBottom(scroller: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>, resetKey?: unknown): StickToBottom {
  const stuckRef = useRef(true)
  /** Hasta cuándo los desplazamientos son nuestros (ir al final suave): no sueltan. */
  const ours = useRef(0)
  const [stuck, setStuck] = useState(true)
  const set = useCallback((v: boolean) => {
    if (stuckRef.current === v) return
    stuckRef.current = v
    setStuck(v)
  }, [])

  const toBottom = useCallback((smooth = true) => {
    const el = scroller.current
    set(true)
    ours.current = performance.now() + 900
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [scroller, set])

  // otra conversación: al final, sin animación
  useLayoutEffect(() => {
    const el = scroller.current
    stuckRef.current = true
    setStuck(true)
    if (el) el.scrollTop = el.scrollHeight
  }, [resetKey, scroller])

  useEffect(() => {
    const el = scroller.current
    const inner = content.current
    if (!el || !inner) return
    // la intención de subir se ve antes que el desplazamiento: se suelta en el acto (aunque el texto siga llegando)
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        ours.current = 0
        set(false)
      }
    }
    let touchY = 0
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? 0
    }
    const onTouchMove = (e: TouchEvent) => {
      if ((e.touches[0]?.clientY ?? 0) > touchY) set(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (['PageUp', 'ArrowUp', 'Home'].includes(e.key)) set(false)
    }
    // al volver abajo a mano (o con la barra), se pega otra vez
    const onScroll = () => {
      if (isNearBottom(el.scrollTop, el.clientHeight, el.scrollHeight)) set(true)
      else if (performance.now() > ours.current) set(false)
    }
    const follow = () => {
      if (!stuckRef.current) return
      ours.current = Math.max(ours.current, performance.now() + 80)
      el.scrollTop = el.scrollHeight
    }
    const ro = new ResizeObserver(follow)
    ro.observe(inner)
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('keydown', onKey)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('keydown', onKey)
      el.removeEventListener('scroll', onScroll)
    }
  }, [scroller, content, set])

  return { stuck, toBottom }
}
