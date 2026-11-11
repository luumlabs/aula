// Dibujos a tinta y acuarela, pintados por código: la misma mano que Faro (una línea con pulso y aguadas que se salen de
// ella) pero con los motivos de Aula: su arco con la luz dentro y los objetos del estudio. No son imágenes: son trazos
// simples pasados por filtros (ruido que hace temblar la línea, el borde del agua, el pigmento irregular). La tinta se
// dibuja UNA vez al aparecer y el dibujo se queda quieto. Solo el arco «vivo» (`ArchLight live`, el grande de Hoy) se
// mueve, y solo mientras el ratón está encima: despacio, por capas, y vuelve a su sitio.
import { useEffect, useId, useRef, type PointerEvent, type ReactNode } from 'react'
import { cx } from './cx'
import { useTheme } from './theme'
import './inkArt.css'

export type ArchLightScene = 'dawn' | 'noon' | 'dusk' | 'night'
export type InkSpotName = 'books' | 'cards' | 'pencil' | 'flask' | 'calendar' | 'lamp'

/** La luz del arco a una hora del día (0–23). */
export function archLightFor(hour: number): ArchLightScene {
  return hour >= 6 && hour < 11 ? 'dawn' : hour >= 11 && hour < 17 ? 'noon' : hour >= 17 && hour < 21 ? 'dusk' : 'night'
}

/** Escala de los filtros: unidades del dibujo (caja de 240) frente al lienzo de 1024 con el que se afinaron. */
const K = 0.26
const n = (v: number): number => Number(v.toFixed(4))

function Filters({ uid, seed }: { uid: string; seed: number }) {
  return (
    <defs>
      {/* aguada suelta: una mancha que se corre lejos de su forma */}
      <filter id={`${uid}-wash`} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency={`${n(0.012 / K)} ${n(0.018 / K)}`} numOctaves="3" seed={seed + 10} result="warp" />
        <feDisplacementMap in="SourceGraphic" in2="warp" scale={n(46 * K)} xChannelSelector="R" yChannelSelector="G" result="shape" />
        <feGaussianBlur in="shape" stdDeviation={n(15 * K)} result="soft" />
        <feTurbulence type="fractalNoise" baseFrequency={`${n(0.006 / K)} ${n(0.012 / K)}`} numOctaves="2" seed={seed + 4} result="noise" />
        <feColorMatrix in="noise" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -0.45 1.12" result="pigment" />
        <feComposite in="soft" in2="pigment" operator="in" />
      </filter>
      {/* relleno: el color de una forma, que no respeta del todo la línea */}
      <filter id={`${uid}-fill`} x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency={`${n(0.02 / K)} ${n(0.03 / K)}`} numOctaves="2" seed={seed + 2} result="warp" />
        <feDisplacementMap in="SourceGraphic" in2="warp" scale={n(24 * K)} xChannelSelector="R" yChannelSelector="G" result="shape" />
        <feGaussianBlur in="shape" stdDeviation={n(3.4 * K)} result="soft" />
        <feTurbulence type="fractalNoise" baseFrequency={`${n(0.009 / K)} ${n(0.014 / K)}`} numOctaves="2" seed={seed + 7} result="noise" />
        <feColorMatrix in="noise" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -0.5 1.22" result="pigment" />
        <feComposite in="soft" in2="pigment" operator="in" />
      </filter>
      {/* la tinta: el pulso de una mano */}
      <filter id={`${uid}-hand`} x="-15%" y="-15%" width="130%" height="130%">
        <feTurbulence type="fractalNoise" baseFrequency={n(0.011 / K)} numOctaves="2" seed={seed + 8} result="warp" />
        <feDisplacementMap in="SourceGraphic" in2="warp" scale={n(13 * K)} xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </defs>
  )
}

interface Drawing { /** Manchas sueltas (detrás de todo). */ wash?: ReactNode; /** Colores de las formas. */ fill: ReactNode; /** La línea. */ ink: ReactNode }
/** El arco por piezas, para poder mover cada una a su profundidad. */
interface ArchParts { wash: ReactNode; sky: ReactNode; ground: ReactNode; light: ReactNode; ink: ReactNode; lightInk: ReactNode }

/** Hacia dónde se inclina el dibujo según dónde está el puntero dentro de su caja: de -1 (izquierda/arriba) a 1. */
export function leanFrom(box: { left: number; top: number; width: number; height: number }, x: number, y: number): { x: number; y: number } {
  const clamp = (v: number): number => Math.max(-1, Math.min(1, v))
  if (box.width <= 0 || box.height <= 0) return { x: 0, y: 0 }
  return { x: clamp(((x - box.left) / box.width) * 2 - 1), y: clamp(((y - box.top) / box.height) * 2 - 1) }
}

function Frame({ drawing, seed, className, label }: { drawing: Drawing; seed: number; className?: string; label?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  return (
    <svg viewBox="0 0 240 200" className={cx('ink-art', className)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <Filters uid={uid} seed={seed} />
      <g className="ink-art-color">
        {drawing.wash && <g filter={`url(#${uid}-wash)`}>{drawing.wash}</g>}
        <g filter={`url(#${uid}-fill)`}>{drawing.fill}</g>
      </g>
      <g className="ink-art-line" filter={`url(#${uid}-hand)`}>{drawing.ink}</g>
    </svg>
  )
}

/** Un trazo de tinta: se dibuja una vez (`pathLength` 1 para que el CSS lo recorra entero). */
function L({ d, o, i = 0, w }: { d: string; o?: number; /** Orden en que se dibuja. */ i?: number; w?: number }) {
  return <path d={d} pathLength={1} opacity={o} strokeWidth={w} style={{ animationDelay: `${i * 90}ms` }} />
}
/** Puntos de tinta (un toque de la punta): `x y` separados por comas. */
const dots = (points: string): string => points.split(',').map((p) => `M${p.trim()} l0.1 0`).join(' ')

const GROUND = 168
const arch = (cx: number, top: number, w: number, bottom: number): string => {
  const r = w / 2
  return `M${cx - r} ${bottom} L${cx - r} ${top + r} A${r} ${r} 0 0 1 ${cx + r} ${top + r} L${cx + r} ${bottom}`
}
/** La banda del arco (entre el arco de fuera y el de dentro), para el color. */
const band = (cx: number, top: number, w: number, t: number, bottom: number): string => {
  const r = w / 2
  return `${arch(cx, top, w, bottom)} L${cx + r - t} ${bottom} L${cx + r - t} ${top + r} A${r - t} ${r - t} 0 0 0 ${cx - r + t} ${top + r} L${cx - r + t} ${bottom} Z`
}

const SKY: Record<ArchLightScene, { sky: string; far: string; depth: number }> = {
  dawn: { sky: 'var(--wc-sky-dawn)', far: 'var(--wc-glow)', depth: 0.5 },
  noon: { sky: 'var(--wc-sky-noon)', far: 'var(--wc-glow)', depth: 0.5 },
  dusk: { sky: 'var(--wc-sky-dusk)', far: 'var(--wc-sun)', depth: 0.5 },
  night: { sky: 'var(--wc-sky-night)', far: 'var(--wc-slate)', depth: 0.8 }
}

function archParts(scene: ArchLightScene): ArchParts {
  const cx = 120
  const g = GROUND
  const { sky, far, depth } = SKY[scene]
  const high = g - 66
  const light =
    scene === 'night' ? (
      <>
        <circle cx={cx + 13} cy={high - 2} r="14" fill="var(--wc-paper)" opacity="0.95" />
        <circle cx={cx + 13} cy={high - 2} r="13" fill="var(--wc-glow)" opacity="0.55" />
      </>
    ) : scene === 'noon' ? (
      <circle cx={cx + 2} cy={high + 6} r="17" fill="var(--wc-sun)" opacity="0.9" />
    ) : (
      <path d={`M${cx - 27} ${g} A27 27 0 0 1 ${cx + 27} ${g} Z`} fill={scene === 'dusk' ? 'var(--wc-ember)' : 'var(--wc-sun)'} opacity="0.92" />
    )
  const lightInk =
    scene === 'night' ? (
      <>
        <circle cx={cx + 10} cy={high - 4} r="12" pathLength={1} style={{ animationDelay: '270ms' }} />
        <L d={dots(`${cx - 22} 106, ${cx - 10} 132, ${cx - 26} 146, ${cx + 24} 138`)} w={4} i={4} />
      </>
    ) : scene === 'noon' ? (
      <circle cx={cx} cy={high + 4} r="15" pathLength={1} style={{ animationDelay: '270ms' }} />
    ) : (
      <L d={`M${cx - 24} ${g - 1} A24 24 0 0 1 ${cx + 24} ${g - 1}`} i={3} />
    )
  return {
    wash: <ellipse cx={cx + 6} cy="100" rx="96" ry="62" fill={far} opacity="0.22" />,
    sky: (
      <>
        <path d={`M${cx - 44} ${g} L${cx - 44} 96 A44 44 0 0 1 ${cx + 44} 96 L${cx + 44} ${g} Z`} fill={sky} opacity={depth} />
        <path d={band(cx + 2, 46, 132, 30, g)} fill="var(--wc-brick)" opacity="0.8" />
      </>
    ),
    ground: <ellipse cx={cx} cy={g + 8} rx="96" ry="7" fill="var(--wc-sand)" opacity="0.9" />,
    light,
    ink: (
      <>
        <L d={arch(cx, 44, 134, g)} i={0} />
        <L d={arch(cx, 76, 76, g)} i={1} />
        <L d={`M14 ${g + 2} Q70 ${g - 3} ${cx} ${g + 1} T226 ${g}`} o={0.8} i={2} />
      </>
    ),
    lightInk
  }
}

/** El arco quieto: todas las piezas en un solo dibujo. */
function archDrawing(scene: ArchLightScene): Drawing {
  const p = archParts(scene)
  return { wash: p.wash, fill: <>{p.sky}{p.light}{p.ground}</>, ink: <>{p.ink}{p.lightInk}</> }
}

/**
 * El arco vivo: cuatro láminas apiladas (la aguada, el color, la luz con su trazo y la tinta). Mientras el ratón está
 * encima, cada una se aparta a su profundidad siguiendo al puntero con mucho retraso y la luz del arco sube (inkArt.css):
 * cámara lenta, sin bucles. Aquí solo se apunta dónde está el puntero, una vez por fotograma como mucho.
 */
function LiveArch({ scene, seed, className, label }: { scene: ArchLightScene; seed: number; className?: string; label?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const ref = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const p = archParts(scene)
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  const lean = (e: PointerEvent<HTMLDivElement>): void => {
    const el = ref.current
    if (!el || e.pointerType === 'touch') return
    const { x, y } = leanFrom(el.getBoundingClientRect(), e.clientX, e.clientY)
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty('--ix', x.toFixed(3))
      el.style.setProperty('--iy', y.toFixed(3))
    })
  }
  const enter = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'touch') return
    ref.current?.setAttribute('data-live', '')
    lean(e)
  }
  const leave = (): void => {
    const el = ref.current
    if (!el) return
    cancelAnimationFrame(frame.current)
    el.removeAttribute('data-live')
    el.style.setProperty('--ix', '0')
    el.style.setProperty('--iy', '0')
  }
  const layer = (name: string, tint: boolean, body: ReactNode, defs = false): ReactNode => (
    <svg viewBox="0 0 240 200" className={cx('ink-art ink-live-layer', `ink-live-${name}`, tint && 'ink-live-tint')} aria-hidden>
      {defs && <Filters uid={uid} seed={seed} />}
      {body}
    </svg>
  )
  return (
    <div ref={ref} className={cx('ink-live', className)} data-scene={scene} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} onPointerEnter={enter} onPointerMove={lean} onPointerLeave={leave}>
      {layer('wash', true, <g className="ink-art-color" filter={`url(#${uid}-wash)`}>{p.wash}</g>, true)}
      {layer('fill', true, <g className="ink-art-color" filter={`url(#${uid}-fill)`}>{p.sky}{p.ground}</g>)}
      {layer(
        'light',
        true,
        <>
          <g className="ink-art-color" filter={`url(#${uid}-fill)`}>{p.light}</g>
          <g className="ink-art-line" filter={`url(#${uid}-hand)`}>{p.lightInk}</g>
        </>
      )}
      {layer('ink', false, <g className="ink-art-line" filter={`url(#${uid}-hand)`}>{p.ink}</g>)}
    </div>
  )
}

const SPOTS: Record<InkSpotName, Drawing> = {
  // tres libros apilados
  books: {
    fill: (
      <>
        <rect x="52" y="128" width="140" height="30" fill="var(--wc-brick)" opacity="0.8" />
        <rect x="66" y="100" width="112" height="27" fill="var(--wc-slate)" opacity="0.85" />
        <rect x="58" y="76" width="126" height="23" fill="var(--wc-sun)" opacity="0.8" />
        <ellipse cx="122" cy="168" rx="100" ry="7" fill="var(--wc-sand)" opacity="0.9" />
      </>
    ),
    ink: (
      <>
        <L d="M48 160 L48 131 L192 129 L193 160" i={0} />
        <L d="M70 131 L70 160" o={0.6} i={1} />
        <L d="M62 129 L63 102 L180 101 L180 129" i={1} />
        <L d="M160 102 L160 128" o={0.6} i={2} />
        <L d="M54 101 L55 78 L188 76 L188 100" i={2} />
        <L d="M76 78 L76 100" o={0.6} i={3} />
        <L d="M24 162 Q80 158 122 161 T220 160" o={0.8} i={3} />
      </>
    )
  },
  // dos tarjetas de repaso
  cards: {
    fill: (
      <>
        <rect x="44" y="60" width="118" height="84" rx="8" fill="var(--wc-sand)" opacity="0.95" transform="rotate(-9 103 102)" />
        <rect x="84" y="72" width="118" height="84" rx="8" fill="var(--wc-rose)" opacity="0.8" transform="rotate(7 143 114)" />
      </>
    ),
    ink: (
      <>
        <rect x="42" y="58" width="120" height="86" rx="9" transform="rotate(-9 102 101)" pathLength={1} />
        <rect x="82" y="70" width="120" height="86" rx="9" transform="rotate(7 142 113)" pathLength={1} style={{ animationDelay: '120ms' }} />
        <L d="M104 100 L176 108" i={3} />
        <L d="M102 120 L150 126" o={0.6} i={4} />
        <L d="M30 170 Q90 164 130 168 T214 166" o={0.8} i={3} />
      </>
    )
  },
  // un lápiz y su primer trazo
  pencil: {
    fill: (
      <>
        <path d="M62 150 L160 52 L180 72 L82 170 Z" fill="var(--wc-sun)" opacity="0.85" />
        <path d="M160 52 L172 40 L192 60 L180 72 Z" fill="var(--wc-rose)" opacity="0.9" />
        <path d="M150 168 Q176 150 204 164" fill="none" stroke="var(--wc-brick)" strokeWidth="10" opacity="0.5" />
      </>
    ),
    ink: (
      <>
        <L d="M60 148 L158 50 L182 74 L84 172 Z" i={0} />
        <L d="M158 50 L171 37 L195 61 L182 74" i={1} />
        <L d="M60 148 L46 186 L84 172" i={2} />
        <path d="M52 170 L46 186 L62 180 Z" className="ink-art-solid" pathLength={1} />
        <L d="M72 160 L170 62" o={0.5} i={3} />
        <L d="M108 186 Q130 176 148 184 T196 178" o={0.7} i={5} />
      </>
    )
  },
  // un matraz con algo dentro
  flask: {
    fill: (
      <>
        <path d="M84 132 L74 160 Q72 170 84 170 L160 170 Q172 170 168 160 L156 132 Z" fill="var(--wc-sage)" opacity="0.95" />
        <circle cx="150" cy="60" r="16" fill="var(--wc-sun)" opacity="0.5" />
        <ellipse cx="122" cy="178" rx="92" ry="6" fill="var(--wc-sand)" opacity="0.9" />
      </>
    ),
    ink: (
      <>
        <L d="M104 40 L104 88 L70 160 Q64 174 80 174 L162 174 Q178 174 172 160 L138 88 L138 40" i={0} />
        <L d="M96 40 L146 40" i={2} />
        <L d="M86 130 Q120 122 156 132" o={0.7} i={3} />
        <circle cx="112" cy="150" r="4" pathLength={1} style={{ animationDelay: '360ms' }} />
        <circle cx="134" cy="142" r="3" pathLength={1} style={{ animationDelay: '420ms' }} />
        <circle cx="124" cy="112" r="2.5" opacity="0.7" pathLength={1} style={{ animationDelay: '480ms' }} />
        <L d="M26 176 Q80 172 122 175 T218 174" o={0.8} i={2} />
      </>
    )
  },
  // una hoja de calendario con un día rodeado
  calendar: {
    fill: (
      <>
        <rect x="58" y="52" width="128" height="30" fill="var(--wc-brick)" opacity="0.8" />
        <rect x="60" y="84" width="124" height="80" fill="var(--wc-sand)" opacity="0.7" />
        <circle cx="146" cy="130" r="14" fill="var(--wc-sun)" opacity="0.8" />
      </>
    ),
    ink: (
      <>
        <rect x="54" y="50" width="134" height="118" rx="8" pathLength={1} />
        <L d="M55 84 L187 82" i={2} />
        <L d="M86 40 L86 60 M156 40 L156 60" i={3} />
        <L d={dots('78 106, 100 106, 122 106, 144 106, 166 106, 78 128, 100 128, 122 128, 166 128, 78 150, 100 150, 122 150')} w={5} i={4} />
        <circle cx="145" cy="129" r="12" className="ink-art-accent" pathLength={1} style={{ animationDelay: '540ms' }} />
      </>
    )
  },
  // el flexo encendido sobre la mesa
  lamp: {
    wash: <path d="M150 70 L224 176 L96 176 Z" fill="var(--wc-glow)" opacity="0.55" />,
    fill: (
      <>
        <path d="M118 48 L166 40 L176 74 L132 86 Z" fill="var(--wc-brick)" opacity="0.85" />
        <ellipse cx="74" cy="174" rx="34" ry="7" fill="var(--wc-slate)" opacity="0.9" />
      </>
    ),
    ink: (
      <>
        <L d="M74 170 L60 104 L126 62" i={1} />
        <L d="M116 46 L168 38 L180 76 L130 90 Z" i={2} />
        <L d="M44 172 Q74 160 104 172 Z" i={0} />
        <circle cx="60" cy="104" r="5" pathLength={1} style={{ animationDelay: '300ms' }} />
        <L d="M20 176 Q90 172 130 175 T226 174" o={0.8} i={0} />
      </>
    )
  }
}

const SEEDS: Record<InkSpotName, number> = { books: 6, cards: 9, pencil: 12, flask: 15, calendar: 18, lamp: 21 }

/** El arco de Aula con la luz dentro: amanece, es mediodía, atardece o es de noche. Con `live`, se mueve despacio
 *  mientras el ratón está encima (con «Reducir movimiento», se queda quieto). */
export function ArchLight({ scene, className, label, live }: { scene: ArchLightScene; className?: string; label?: string; live?: boolean }) {
  const { reducedMotion } = useTheme()
  if (live && !reducedMotion) return <LiveArch scene={scene} seed={3 + scene.length} className={className} label={label} />
  return <Frame drawing={archDrawing(scene)} seed={3 + scene.length} className={className} label={label} />
}

/** Un objeto del estudio dibujado a tinta: para cabeceras y pantallas vacías. */
export function InkSpot({ name, className, label }: { name: InkSpotName; className?: string; label?: string }) {
  return <Frame drawing={SPOTS[name]} seed={SEEDS[name]} className={className} label={label} />
}
