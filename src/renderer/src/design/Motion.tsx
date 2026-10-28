// Movimiento suave: flotar (despacio y poco), aparecer al entrar en pantalla y el punto «en vivo» (sol).
import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { useTheme } from './theme'
import { trackAnimations } from './ambient'
import './motion.css'

/**
 * Flotar sin coste por fotograma: una animación web (WAAPI) de las propiedades `translate`/`rotate`, que corre en el
 * compositor (antes era un bucle de motion en JavaScript que ocupaba el hilo principal 120 veces por segundo). No pisa el
 * `transform` que motion usa para levantar la tarjeta al pasar el ratón. Con «Reducir movimiento» no flota.
 */
export function useFloat(ref: RefObject<HTMLElement | null>, { amplitude = 3, duration = 8, phase = 0, rotate = 0, enabled = true }: { amplitude?: number; duration?: number; phase?: number; rotate?: number; enabled?: boolean } = {}): void {
  const { reducedMotion } = useTheme()
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled || reducedMotion || typeof el.animate !== 'function') return
    const opts: KeyframeAnimationOptions = { duration: duration * 1000, iterations: Infinity, easing: 'ease-in-out', delay: phase * 1000 }
    const anims = [el.animate([{ translate: '0 0' }, { translate: `0 ${-amplitude}px` }, { translate: '0 0' }], opts)]
    if (rotate) anims.push(el.animate([{ rotate: '0deg' }, { rotate: `${rotate}deg` }, { rotate: '0deg' }], opts))
    // quieto cuando la ventana no se ve o nadie la usa (ambient.ts)
    const untrack = trackAnimations(anims, 'decor')
    return () => {
      untrack()
      anims.forEach((a) => a.cancel())
    }
  }, [ref, amplitude, duration, phase, rotate, enabled, reducedMotion])
}

/** Flota muy despacio. Para lo que debe llamar la atención sin molestar (calendario, examen cercano). */
export function Floating({ children, amplitude = 3, duration = 8, rotate = 0, phase = 0, ...rest }: { children: ReactNode; amplitude?: number; duration?: number; rotate?: number; phase?: number } & HTMLMotionProps<'div'>) {
  const ref = useRef<HTMLDivElement>(null)
  useFloat(ref, { amplitude, duration, phase, rotate })
  return (
    <motion.div ref={ref} {...rest}>
      {children}
    </motion.div>
  )
}

/** Aparece (subiendo 8 px) cuando entra en la vista. */
export function Reveal({ children, delay = 0, ...rest }: { children: ReactNode; delay?: number } & HTMLMotionProps<'div'>) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-30px' }} transition={{ duration: 0.4, delay, ease: [0.2, 0.7, 0.2, 1] }} {...rest}>
      {children}
    </motion.div>
  )
}

/** Punto «en vivo» del color del sol (Aula trabajando, algo urgente). Late solo mientras alguien usa la app; con `activity`
 *  (algo que está pasando ahora: un inicio de sesión, el tiempo de un simulacro) late también en reposo, nunca con la ventana
 *  sin ver (ambient.css). */
export function LiveDot({ color = 'var(--sun)', size = 7, activity }: { color?: string; size?: number; activity?: boolean }) {
  const { reducedMotion } = useTheme()
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} aria-hidden>
      {!reducedMotion && <span className="live-dot-pulse absolute inset-0 rounded-full" data-activity={activity ? '' : undefined} style={{ background: color }} />}
      <span className="relative rounded-full" style={{ background: color, width: size, height: size }} />
    </span>
  )
}
