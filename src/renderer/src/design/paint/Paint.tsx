// El dibujo a mano en la interfaz: líneas de tinta, pluma o lápiz (vectores que se DIBUJAN una vez al aparecer, con el ritmo
// de una mano) y rellenos planos de borde cortado a mano (máscaras con grano de papel, hechas una vez en un hilo aparte).
// Van siempre detrás del contenido o a su alrededor; el texto, los campos y los ejercicios no se dibujan.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { cx } from '../cx'
import { paintKey, peekPaint, requestPaint } from './cache'
import { Ink } from './Ink'
import { arrowInk, borderInk, burstInk, checkInk, coverLineInk, raysInk, ringInk, strikeInk, tileInk, underlineInk, type InkDrawing } from './drawings'
import type { Pt } from './brush'
import { seedOf } from './random'
import type { PaintKind, PaintSpec } from './recipes'
import { useBox, type Box } from './useBox'
import './paint.css'

// ───────────── Rellenos (máscaras) ─────────────

/** Píxeles de máscara por px de CSS: 2× como poco (nítido en retina), 3× si la pantalla lo pide. */
function scaleFor(w: number, h: number): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const want = Math.max(2, Math.min(3, dpr))
  return Math.max(1, Math.min(want, Math.sqrt(900_000 / Math.max(1, w * h))))
}

/** La máscara lista (o null mientras se hace); `instant` si ya estaba hecha al montar (sin fundido). */
function usePaintURL(spec: PaintSpec | null): { url: string | null; instant: boolean } {
  const key = spec ? paintKey(spec) : ''
  const [state, setState] = useState(() => {
    const url = spec ? peekPaint(spec) ?? null : null
    return { key, url, instant: !!url }
  })
  useEffect(() => {
    if (!spec) return
    const now = peekPaint(spec)
    if (now) {
      setState((s) => (s.url === now ? s : { key, url: now, instant: s.key !== key || s.instant }))
      return
    }
    let alive = true
    requestPaint(spec).then(
      (url) => alive && setState({ key, url, instant: false }),
      () => {}
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la clave resume el pedido
  }, [key])
  return state.key === key ? state : { url: null, instant: false }
}

export interface PaintProps {
  kind: PaintKind
  /** Lo que identifica el dibujo (un id de curso, un nombre): misma semilla, mismo dibujo en cada arranque. */
  seed: string | number
  /** Color del relleno (CSS). */
  color: string
  /** Tamaño fijo (px de CSS); sin él, se mide la caja. */
  size?: Box
  alpha?: number
  className?: string
  style?: CSSProperties
}

/** Un relleno plano cortado a mano (portada, losa), posicionado por quien lo usa. */
export function Paint({ kind, seed, color, size, alpha = 1, className, style }: PaintProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const box = useBox(ref, size)
  const { url, instant } = usePaintURL(box ? { kind, seed: seedOf(String(seed)), w: box.w, h: box.h, scale: scaleFor(box.w, box.h) } : null)
  return (
    <span
      ref={ref}
      aria-hidden
      className={cx('paint', className)}
      data-kind={kind}
      data-ready={url ? '' : undefined}
      data-instant={instant ? '' : undefined}
      style={{ ['--paint' as string]: color, ['--paint-alpha' as string]: alpha, ...(url ? { maskImage: `url(${url})`, WebkitMaskImage: `url(${url})` } : null), ...style }}
    />
  )
}

// ───────────── Líneas (vectores que se dibujan) ─────────────

interface InkBoxProps {
  make: (box: Box) => InkDrawing
  /** Para no recalcular: lo que cambia el dibujo además del tamaño. */
  deps: unknown[]
  color?: string
  alpha?: number
  drawKey?: string
  draw?: boolean
  delay?: number
  size?: Box
  className?: string
  style?: CSSProperties
}

/** Una línea dibujada que ocupa su caja (se mide; la posición la da quien la usa). */
function InkBox({ make, deps, color, alpha, drawKey, draw = true, delay, size, className, style }: InkBoxProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const box = useBox(ref, size, 4, 0.04)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` resume lo que cambia el dibujo
  const drawing = useMemo(() => (box ? make(box) : null), [box?.w, box?.h, ...deps])
  return (
    <span ref={ref} aria-hidden className={cx('ink-box', className)} style={style}>
      <Ink drawing={drawing} color={color} alpha={alpha} draw={draw} drawKey={drawKey} delay={delay} />
    </span>
  )
}

/**
 * Subrayado a pincel bajo un título importante (uno por pantalla como mucho): se posa, corre y se levanta abriéndose en
 * hebras secas. Se dibuja una vez por sesión, con el ritmo de la mano; con «Reducir movimiento», ya está.
 */
export function BrushUnderline({ children, seed, color = 'var(--pigment-brick)', alpha = 1, delay = 250, className }: { children: ReactNode; seed: string | number; color?: string; alpha?: number; delay?: number; className?: string }) {
  return (
    <span className={cx('brush-underline', className)}>
      {children}
      <InkBox make={(b) => underlineInk(b.w, b.h, seed)} deps={[seed]} color={color} alpha={alpha} drawKey={`underline:${seed}`} delay={delay} className="brush-underline__stroke" />
    </span>
  )
}

/** Rodeado a mano (el día de hoy): algo más de una vuelta que no cierra donde empezó; se dibuja una vez por sesión. */
export function InkRing({ seed, size, color = 'var(--pigment-brick)', delay = 200, className, children }: { seed: string | number; size: number; color?: string; delay?: number; className?: string; children?: ReactNode }) {
  const line = Math.max(1.6, size * 0.065)
  const drawing = useMemo(() => ringInk(size, seed, line), [size, seed, line])
  return (
    <span className={cx('ink-ring', className)} style={{ width: size, height: size }}>
      <Ink drawing={drawing} color={color} drawKey={`ring:${seed}:${size}`} delay={delay} className="ink-ring__line" />
      <span className="relative">{children}</span>
    </span>
  )
}

/**
 * Losa dibujada tras un icono: su contorno de pluma (se dibuja una vez) y, algo desplazado, el relleno plano cortado a mano
 * que entra cuando la línea ya va por la mitad.
 */
export function DrawnTile({ seed, size, radius = Math.round(size * 0.28), fill, ink, inkAlpha = 0.8, className, children }: { seed: string | number; size: number; radius?: number; fill: string; ink: string; inkAlpha?: number; className?: string; children?: ReactNode }) {
  const line = Math.max(1.3, size * 0.022)
  const drawing = useMemo(() => tileInk(size, radius + 3, line, seed), [size, radius, line, seed])
  return (
    <span className={cx('drawn-tile', className)} style={{ width: size, height: size, borderRadius: radius }}>
      <Paint kind="tile" seed={seed} color={fill} size={{ w: size, h: size }} className="drawn-tile__fill" />
      <Ink drawing={drawing} color={ink} alpha={inkAlpha} drawKey={`tile:${seed}`} className="drawn-tile__line" />
      {children}
    </span>
  )
}

/**
 * Borde dibujado a mano para una burbuja destacada: dos trazos de pluma que salen de la misma esquina y se cruzan al
 * encontrarse. Va encima, sin tapar nada (es una línea fina).
 */
export function DrawnBorder({ seed, color = 'var(--ink)', alpha = 0.55, radius = 22, line = 1.3, delay = 0, className }: { seed: string | number; color?: string; alpha?: number; radius?: number; line?: number; delay?: number; className?: string }) {
  return <InkBox make={(b) => borderInk(b.w, b.h, radius, line, seed)} deps={[seed, radius, line]} color={color} alpha={alpha} drawKey={`border:${seed}`} delay={delay} className={cx('drawn-border', className)} />
}

/** Portada de curso: el relleno plano del tono cortado a mano y, por su corte, la línea de tinta que se dibuja de izquierda a derecha. */
export function CoverBand({ seed, fill, ink, inkAlpha = 0.8 }: { seed: string | number; fill: string; ink: string; inkAlpha?: number }) {
  return (
    <>
      <Paint kind="band" seed={seed} color={fill} className="inset-0 -z-10" />
      <InkBox make={(b) => coverLineInk(b.w, b.h, seed)} deps={[seed]} color={ink} alpha={inkAlpha} drawKey={`cover:${seed}`} delay={420} className="inset-0 -z-10" />
    </>
  )
}

/** Tachado a mano sobre algo hecho (una tarea del plan): se dibuja una vez, al quedar hecho. */
export function InkStrike({ seed, color = 'var(--pigment-brick)', alpha = 0.85, className, children }: { seed: string | number; color?: string; alpha?: number; className?: string; children: ReactNode }) {
  return (
    <span className={cx('ink-strike', className)}>
      {children}
      <InkBox make={(b) => strikeInk(b.w, b.h, seed)} deps={[seed]} color={color} alpha={alpha} drawKey={`strike:${seed}`} delay={150} className="ink-strike__line" />
    </span>
  )
}

/** Visto bueno a mano (tamaño fijo). */
export function InkCheck({ seed, size = 18, color = 'var(--success)', className }: { seed: string | number; size?: number; color?: string; className?: string }) {
  const drawing = useMemo(() => checkInk(size, seed), [size, seed])
  return <Ink drawing={drawing} color={color} drawKey={`check:${seed}`} delay={120} className={cx('ink-fixed', className)} style={{ width: size, height: size }} />
}

/** Rayitas de alegría alrededor de algo que se celebra (un logro): se dibujan una tras otra al aparecer. */
export function InkBurst({ seed, size, color = 'var(--pigment-brick)', delay = 380, className }: { seed: string | number; size: number; color?: string; delay?: number; className?: string }) {
  const drawing = useMemo(() => burstInk(size, size, seed), [size, seed])
  return <Ink drawing={drawing} color={color} drawKey={`burst:${seed}`} delay={delay} className={cx('ink-fixed', className)} style={{ width: size, height: size }} />
}

/** Rayos a lápiz alrededor del sol de la marca (vacíos): un amanecer esbozado. `size`: el de la marca. */
export function PencilRays({ seed, size, color = 'var(--graphite)', alpha = 0.75, delay = 900, className }: { seed: string | number; size: number; color?: string; alpha?: number; delay?: number; className?: string }) {
  const box = Math.round(size * 1.9)
  // el sol de la marca está en (12, 20,5) de un viewBox de 24: el centro de los rayos va ahí
  const cx0 = box / 2
  const cy0 = (box - size) / 2 + (size * 20.5) / 24
  const drawing = useMemo(() => raysInk(box, box, seed, cx0, cy0, 5), [box, seed, cx0, cy0])
  return <Ink drawing={drawing} color={color} alpha={alpha} drawKey={`rays:${seed}`} delay={delay} className={cx('ink-fixed', className)} style={{ width: box, height: box }} />
}

/** Flecha a mano dentro de una caja de `w`×`h`, de `from` a `to` (px de la caja). */
export function InkArrow({ seed, w, h, from, to, loop = true, color = 'var(--pigment-brick)', alpha = 0.9, delay = 0, className, style }: { seed: string | number; w: number; h: number; from: Pt; to: Pt; loop?: boolean; color?: string; alpha?: number; delay?: number; className?: string; style?: CSSProperties }) {
  const drawing = useMemo(() => arrowInk(w, h, seed, from, to, loop), [w, h, seed, from.x, from.y, to.x, to.y, loop]) // eslint-disable-line react-hooks/exhaustive-deps
  return <Ink drawing={drawing} color={color} alpha={alpha} drawKey={`arrow:${seed}`} delay={delay} className={cx('ink-fixed', className)} style={{ width: w, height: h, ...style }} />
}
