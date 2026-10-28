// La línea a mano en pantalla: un SVG con cada pincelada (silueta, huecos secos) y una máscara por trazo que la descubre a lo
// largo de su eje con el ritmo de la mano. Se dibuja UNA vez por sesión (cuando se ve por primera vez); luego está quieta.
// Con «Reducir movimiento», ya está dibujada. Solo se animan fotogramas mientras se dibuja (máscaras pequeñas); en reposo
// no cuesta nada.
import { useId, useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react'
import { cx } from '../cx'
import { useTheme } from '../theme'
import type { InkDrawing } from './drawings'

/** Lo que ya se dibujó en esta sesión (por clave): al volver a la pantalla está hecho, no se repite. */
const drawn = new Set<string>()

export function wasDrawn(key: string): boolean {
  return drawn.has(key)
}

export interface InkProps {
  drawing: InkDrawing | null
  /** Color de la tinta (CSS). */
  color?: string
  alpha?: number
  /** Dibujarse al aparecer (una vez por `drawKey`). */
  draw?: boolean
  drawKey?: string
  /** Espera antes de empezar (ms), contada desde que se ve. */
  delay?: number
  className?: string
  style?: CSSProperties
}

/** Lo que necesita la mano para recorrer un trazo: su ritmo, cuánto tarda y cuándo empieza (ms). */
export interface RevealPlan {
  pace: [number, number][]
  ms: number
  at: number
}

/**
 * Dibuja una vez lo que hay dentro de `ref`: cada `[data-reveal]` (un trazo de máscara con pathLength 1 y dasharray «1 2»)
 * se recorre con su ritmo cuando el dibujo se ve por primera vez. Una vez por `drawKey` y sesión; sin animar si no se puede.
 */
export function useInkReveal(ref: RefObject<Element | null>, plan: RevealPlan[] | null, { draw = true, drawKey, delay = 0 }: { draw?: boolean; drawKey?: string; delay?: number }): void {
  const { reducedMotion } = useTheme()
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !plan) return
    const reveals = Array.from(el.querySelectorAll<SVGPathElement>('[data-reveal]'))
    const show = () => reveals.forEach((p) => (p.style.strokeDashoffset = '0'))
    if (!draw || reducedMotion || (drawKey && drawn.has(drawKey)) || typeof (el as SVGElement).animate !== 'function') {
      show()
      return
    }
    // escondido hasta que se vea; entonces la mano lo recorre, trazo a trazo
    reveals.forEach((p) => (p.style.strokeDashoffset = '1'))
    const anims: Animation[] = []
    const start = () => {
      if (drawKey) drawn.add(drawKey)
      plan.forEach((s, i) => {
        const p = reveals[i]
        if (!p) return
        const kf = s.pace.map(([t, q]) => ({ offset: t, strokeDashoffset: String(1 - q) }))
        const a = p.animate(kf, { duration: s.ms, delay: delay + s.at, easing: 'linear', fill: 'both' })
        a.onfinish = () => {
          p.style.strokeDashoffset = '0'
          a.cancel()
        }
        anims.push(a)
      })
    }
    if (typeof IntersectionObserver === 'undefined') {
      start()
      return () => anims.forEach((a) => a.cancel())
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        start()
      },
      { threshold: 0.25 }
    )
    io.observe(el)
    return () => {
      io.disconnect()
      // si se desmonta a medias, la próxima vez ya está hecho (no se repite)
      anims.forEach((a) => a.cancel())
    }
  }, [ref, plan, draw, reducedMotion, drawKey, delay])
}

export function Ink({ drawing, color = 'var(--ink)', alpha = 1, draw = true, drawKey, delay = 0, className, style }: InkProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const svg = useRef<SVGSVGElement>(null)
  useInkReveal(svg, drawing ? drawing.strokes : null, { draw, drawKey, delay })

  if (!drawing) return <span aria-hidden className={cx('ink', className)} style={style} />
  const { w, h, strokes } = drawing
  return (
    <svg ref={svg} aria-hidden className={cx('ink', className)} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ color, opacity: alpha, ...style }}>
      <defs>
        {strokes.map((s, i) => (
          <mask key={i} id={`${uid}-${i}`} maskUnits="userSpaceOnUse" x={-20} y={-20} width={w + 40} height={h + 40}>
            <path data-reveal d={s.spine} fill="none" stroke="#fff" strokeWidth={s.reach} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 2" />
            {s.dry && <path d={s.dry} fill="none" stroke="#000" strokeWidth={s.dryWidth} strokeLinecap="round" />}
          </mask>
        ))}
      </defs>
      {strokes.map((s, i) => (
        <path key={i} d={s.d} fill="currentColor" mask={`url(#${uid}-${i})`} />
      ))}
    </svg>
  )
}
