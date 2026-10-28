// «Luz tras el cristal»: la mancha de luz mate que vive detrás de una burbuja (en lugar de una raya de color a la izquierda).
// Deriva despacio con CSS (en el compositor) y, con el ratón encima, se acerca al puntero con una transición de `translate`.
// Un único elemento animado por tarjeta; fuera de pantalla se pausa (un IntersectionObserver compartido) y sin ratón no hay
// ningún trabajo por fotograma. Con «Reducir movimiento» queda quieta. El contenedor debe ser `relative` + `isolate`.
import { useEffect, useRef, type CSSProperties } from 'react'
import { useTheme } from './theme'
import { cx } from './cx'
import { lightOffset } from './glassLightMath'
import './glassLight.css'

export interface GlassLightProps {
  /** Color de identidad (un tono de curso, `var(--success)`…): se apaga a un pastel mate. */
  color: string
  size?: 'md' | 'sm'
  /** Sin deriva (solo reacciona al ratón): para listas largas de fichas pequeñas. */
  still?: boolean
  /** Desfase de la deriva para que varias tarjetas juntas no se muevan a la vez. */
  phase?: number
  className?: string
}

export function GlassLight({ color, size = 'md', still, phase = 0, className }: GlassLightProps) {
  const { reducedMotion } = useTheme()
  const host = useRef<HTMLSpanElement>(null)
  const blob = useRef<HTMLSpanElement>(null)

  // Pausa la deriva fuera de pantalla
  useEffect(() => {
    const el = host.current
    if (!el || still || reducedMotion) return
    return watchVisibility(el)
  }, [still, reducedMotion])

  // Se acerca al puntero: escucha en la tarjeta (el padre); como mucho un cambio de estilo por fotograma y solo con el ratón encima
  useEffect(() => {
    const el = host.current
    const card = el?.parentElement
    const b = blob.current
    if (!el || !card || !b || reducedMotion) return
    let rect: DOMRect | null = null
    let center = { x: 0, y: 0 }
    let frame = 0
    let px = 0
    let py = 0
    const apply = () => {
      frame = 0
      if (!rect) return
      const o = lightOffset({ x: px - rect.left, y: py - rect.top }, { width: rect.width, height: rect.height }, center)
      b.style.translate = `${o.x.toFixed(1)}px ${o.y.toFixed(1)}px`
    }
    const enter = (e: PointerEvent) => {
      // se mide una vez al entrar (no en cada movimiento): la tarjeta y el centro en reposo de la luz
      rect = card.getBoundingClientRect()
      center = { x: b.offsetLeft + b.offsetWidth / 2, y: b.offsetTop + b.offsetHeight / 2 }
      el.setAttribute('data-near', '')
      move(e)
    }
    const move = (e: PointerEvent) => {
      px = e.clientX
      py = e.clientY
      if (!frame) frame = requestAnimationFrame(apply)
    }
    const leave = () => {
      rect = null
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      el.removeAttribute('data-near')
      b.style.translate = ''
    }
    card.addEventListener('pointerenter', enter)
    card.addEventListener('pointermove', move, { passive: true })
    card.addEventListener('pointerleave', leave)
    return () => {
      card.removeEventListener('pointerenter', enter)
      card.removeEventListener('pointermove', move)
      card.removeEventListener('pointerleave', leave)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [reducedMotion])

  const style = { ['--gl' as string]: color, ['--gl-delay' as string]: `${-(phase % 23) - 3}s` } as CSSProperties
  return (
    <span ref={host} aria-hidden className={cx('glass-light', className)} data-size={size === 'sm' ? 'sm' : undefined} data-still={still ? '' : undefined} style={style}>
      <span ref={blob} className="glass-light__blob" />
    </span>
  )
}

// Un solo IntersectionObserver para todas las luces: marca `data-off` en las que no se ven.
let observer: IntersectionObserver | null = null
function watchVisibility(el: Element): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => {}
  const io = sharedObserver()
  io.observe(el)
  return () => io.unobserve(el)
}
// aparte: si el observador se creara dentro de watchVisibility, su función compartiría el ámbito con `el` y retendría para
// siempre la primera luz (y toda su pantalla, ya desmontada)
function sharedObserver(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) e.target.toggleAttribute('data-off', !e.isIntersecting)
    },
    { rootMargin: '80px' }
  )
  return observer
}
