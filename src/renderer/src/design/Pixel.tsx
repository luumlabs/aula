// Los personajes de Aula, dibujados a mano a partir de su pixel art (./pixel/brush): iconos de asignatura que cobran vida
// (cada uno con su historia: reposo de vez en cuando, la historia completa al pasar el ratón y una celebración al entrar
// en el curso), la loseta del curso, el indicador de carga a pincel, la llamita de la racha y la ráfaga de pintura de los
// logros. Formato de las historias: ./pixel/README.md.
import { memo, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { motion } from 'motion/react'
import { toneForHue } from './pixel/tones'
import { resolveIconId } from './pixel/resolve'
import { iconAnim } from './pixel/characters'
import { PixelPlayer, type Entrance, type PlayerOptions } from './pixel/player'
import type { CompiledAnim } from './pixel/anim'
import { useTheme } from './theme'
import { useAmbient } from './ambient'
import { Drawn } from './PixelSprites'

export type PixelAnimation = 'none' | 'drop' | 'dissolve'

/** Crea (y recrea al cambiar lo esencial) el reproductor de un personaje sobre su canvas. */
export function usePixelPlayer(ref: RefObject<HTMLCanvasElement | null>, anim: CompiledAnim, size: number, opts: Omit<PlayerOptions, 'anim' | 'size' | 'reduced' | 'dark'>, celebrate?: boolean | number): RefObject<PixelPlayer | null> {
  const { reducedMotion, dark } = useTheme()
  const player = useRef<PixelPlayer | null>(null)
  const first = useRef(true)
  useLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const p = new PixelPlayer(canvas, { ...opts, anim, size, reduced: reducedMotion, dark, celebrate: !!celebrate && opts.celebrate })
    player.current = p
    return () => {
      p.destroy()
      player.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim, size, reducedMotion, dark, opts.entrance])
  // celebrar otra vez cuando cambia el contador
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (celebrate) player.current?.play('celebrate')
  }, [celebrate])
  return player
}

/** El lienzo de un personaje: ocupa `size`×`size` y deja `margin` píxeles de aire alrededor para chispas y saltos. */
export function PixelCanvas({ canvasRef, anim, size, className }: { canvasRef: RefObject<HTMLCanvasElement | null>; anim: CompiledAnim; size: number; className?: string }) {
  const unit = size / anim.size
  return (
    <span aria-hidden className={className} style={{ position: 'relative', display: 'inline-block', verticalAlign: 'middle', width: size, height: size, flexShrink: 0 }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', left: -anim.margin * unit, top: -anim.margin * unit, width: anim.stride * unit, height: anim.stride * unit, pointerEvents: 'none' }}
      />
    </span>
  )
}

/**
 * Icono pixel-art de una asignatura, con vida propia: de vez en cuando hace algo pequeño (`idle`), al pasar el ratón por
 * encima (de él o de la fila/botón que lo contiene) cuenta su historia, y `celebrate` (true o un contador que cambia)
 * lanza su celebración (tras la entrada, si la hay).
 * - `animation="drop"`: las filas caen en su sitio (al aparecer en listas y tarjetas).
 * - `animation="dissolve"`: los píxeles se encienden uno a uno (al abrir un curso).
 */
export const PixelIcon = memo(function PixelIcon({ icon, hue, size = 32, title = '', animation = 'none', delay = 0, celebrate, idle = true, interactive = true }: { icon: string; hue?: number; size?: number; title?: string; animation?: PixelAnimation; delay?: number; celebrate?: boolean | number; idle?: boolean; interactive?: boolean }) {
  const id = resolveIconId(icon, title)
  const anim = iconAnim(id, toneForHue(hue))
  const ref = useRef<HTMLCanvasElement>(null)
  usePixelPlayer(ref, anim, size, { entrance: animation as Entrance, delay, celebrate: true, idle, hoverTarget: interactive ? undefined : null }, celebrate)
  return <PixelCanvas canvasRef={ref} anim={anim} size={size} />
})

/** Loseta del curso: plana, con el tono del curso al 16 % (22 % en oscuro). Da un saltito al pasar el ratón. */
export function CourseIcon({ icon, hue, size = 40, title = '', animation = 'none', className = '', radius, celebrate }: { icon: string; hue?: number; size?: number; title?: string; animation?: PixelAnimation; className?: string; radius?: number; celebrate?: boolean | number }) {
  const tone = toneForHue(hue)
  const { dark } = useTheme()
  return (
    <motion.div
      className={`relative grid place-items-center shrink-0 ${className}`}
      style={{ width: size, height: size, borderRadius: radius ?? Math.round(size * 0.27), background: `color-mix(in oklab, ${dark ? tone.fillDark : tone.fillLight} ${dark ? 22 : 16}%, transparent)` }}
      whileHover={{ y: -1.5 }}
      transition={{ type: 'spring', stiffness: 439, damping: 20 }}
    >
      <PixelIcon icon={icon} hue={hue} size={Math.round(size * 0.66)} title={title} animation={animation} celebrate={celebrate} />
    </motion.div>
  )
}

/** Gotas de pincel (contorno irregular, con semilla fija): para el indicador de carga. */
function dabPath(cx: number, cy: number, r: number, seed: number): string {
  const pts: string[] = []
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2
    const h = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453
    const k = 1 + ((h - Math.floor(h)) - 0.5) * 0.28
    pts.push(`${(cx + Math.cos(a) * r * k).toFixed(2)} ${(cy + Math.sin(a) * r * k * 0.92).toFixed(2)}`)
  }
  return `M${pts.join('L')}Z`
}
const SPIN_DABS = Array.from({ length: 8 }, (_, i) => {
  const a = -Math.PI / 2 + (i / 8) * Math.PI * 2
  return dabPath(12 + Math.cos(a) * 7.6, 12 + Math.sin(a) * 7.6, 2.3 + (i % 2) * 0.25, i + 1)
})

/** Indicador de carga: ocho toques de pincel en corro que se encienden uno tras otro. */
export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  const [step, setStep] = useState(0)
  // indica que algo se está haciendo: gira también en reposo, pero no con la ventana sin ver
  const moving = useAmbient('activity')
  useEffect(() => {
    if (!moving) return
    const id = setInterval(() => setStep((s) => (s + 1) % 8), 110)
    return () => clearInterval(id)
  }, [moving])
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-label="…" role="img">
      {SPIN_DABS.map((d, i) => {
        const dist = (step - i + 8) % 8
        const op = dist === 0 ? 1 : dist === 1 ? 0.6 : dist === 2 ? 0.34 : 0.14
        return <path key={i} d={d} fill="currentColor" opacity={op} />
      })}
    </svg>
  )
}

/** Llamita de la racha, dibujada a mano (dos fotogramas que se alternan: la punta se mece). Apagada, en grises. */
export function PixelFlame({ size = 28, lit = true }: { size?: number; lit?: boolean }) {
  const { reducedMotion, dark } = useTheme()
  const [frame, setFrame] = useState(0)
  const moving = useAmbient()
  useEffect(() => {
    if (!lit || reducedMotion || !moving) return
    const id = setInterval(() => setFrame((f) => 1 - f), 380)
    return () => clearInterval(id)
  }, [lit, reducedMotion, moving])
  const colors = lit
    ? { outer: 'var(--accent)', inner: dark ? 'var(--sun)' : '#e3a03a', core: '#ffe2a8' }
    : { outer: dark ? '#4a4642' : '#cfc8bf', inner: dark ? '#5e5954' : '#e2ddd5', core: dark ? '#6e6965' : '#f0ece6' }
  // el dibujo es algo más alto que ancho, como la llamita de antes (8 × 9)
  return (
    <span aria-hidden style={{ display: 'inline-grid', placeItems: 'center', width: size, height: (size * 9) / 8, flexShrink: 0 }}>
      <Drawn name="flame" colors={colors} frame={frame} size={(size * 9) / 8} />
    </span>
  )
}

/** Ráfaga de pintura (logro: dominar una habilidad, acertar seguido, terminar un simulacro): gotas que salen del elemento. */
export function pixelBurst(from: Element | { x: number; y: number }, opts: { count?: number; colors?: string[] } = {}): void {
  if (document.documentElement.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const p = 'getBoundingClientRect' in from ? from.getBoundingClientRect() : null
  const x0 = p ? p.left + p.width / 2 : (from as { x: number }).x
  const y0 = p ? p.top + p.height / 2 : (from as { y: number }).y
  const colors = opts.colors ?? ['var(--accent)', 'var(--sun)', 'var(--accent-text)', '#ffe2a8']
  const n = opts.count ?? 14
  const r = () => 38 + Math.round(Math.random() * 24)
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div')
    const s = 5 + Math.round(Math.random() * 4)
    // una gota de pintura: borde irregular, un poco alargada en la dirección en que sale
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.4
    el.style.cssText = `position:fixed;left:${x0}px;top:${y0}px;width:${s * 1.25}px;height:${s}px;background:${colors[i % colors.length]};border-radius:${r()}% ${r()}% ${r()}% ${r()}% / ${r()}% ${r()}% ${r()}% ${r()}%;z-index:200;pointer-events:none`
    document.body.appendChild(el)
    const dist = 34 + Math.random() * 46
    const dx = Math.cos(a) * dist
    const dy = Math.sin(a) * dist - 18
    const rot = (a * 180) / Math.PI
    const anim = el.animate(
      [
        { transform: `translate(-50%,-50%) rotate(${rot}deg) scale(0.6, 1)`, opacity: 1 },
        { transform: `translate(calc(-50% + ${dx * 0.7}px), calc(-50% + ${dy * 0.7}px)) rotate(${rot}deg) scale(1.15, 0.9)`, opacity: 1, offset: 0.6 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 26}px)) rotate(${rot + 40}deg) scale(0.7)`, opacity: 0 }
      ],
      { duration: 700 + Math.random() * 300, easing: 'cubic-bezier(.2,.7,.2,1)' }
    )
    anim.onfinish = () => el.remove()
  }
}

export { toneForHue }
