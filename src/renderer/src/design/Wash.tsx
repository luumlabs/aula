// Una aguada: manchas de acuarela con borde de agua y grano de pigmento, pintadas por el navegador (del estilo de Faro).
// No es una imagen ni un resplandor: son formas simples pasadas por un filtro (ruido que deforma el contorno, el borde
// donde el agua se secó con más pigmento, y el grano del papel que se come parte del color). Se pinta una vez y se queda
// QUIETA (decisión del dueño: nada que se mueva detrás de las tarjetas). Va detrás del contenido, en pocos sitios: el
// saludo de Hoy (el cielo de la hora que es), el chat vacío y la bienvenida.
import { useId } from 'react'
import { cx } from './cx'
import './wash.css'

export type WashTone = 'sky' | 'light' | 'sand' | 'rose'
export type WashScene = 'dawn' | 'noon' | 'dusk' | 'night' | 'still'

interface Blot { cx: number; cy: number; rx: number; ry: number; tone: WashTone; strength: number; rotate?: number }

const SCENES: Record<WashScene, Blot[][]> = {
  // la mañana: la luz entra por un lado y el cielo aún está pálido
  dawn: [
    [{ cx: 250, cy: 150, rx: 300, ry: 92, tone: 'sky', strength: 0.42, rotate: -4 }, { cx: 640, cy: 176, rx: 260, ry: 70, tone: 'sand', strength: 0.34, rotate: 3 }],
    [{ cx: 610, cy: 78, rx: 170, ry: 74, tone: 'light', strength: 0.55, rotate: -8 }, { cx: 420, cy: 96, rx: 150, ry: 46, tone: 'rose', strength: 0.3, rotate: 6 }]
  ],
  // pleno día: cielo claro y arena, casi sin luz propia
  noon: [
    [{ cx: 300, cy: 160, rx: 320, ry: 80, tone: 'sky', strength: 0.4, rotate: -2 }, { cx: 660, cy: 182, rx: 240, ry: 60, tone: 'sky', strength: 0.26, rotate: 3 }],
    [{ cx: 560, cy: 84, rx: 200, ry: 60, tone: 'sand', strength: 0.42, rotate: -5 }, { cx: 300, cy: 70, rx: 120, ry: 36, tone: 'light', strength: 0.24, rotate: 4 }]
  ],
  // la tarde: el cielo se vuelve rosa y la luz baja
  dusk: [
    [{ cx: 260, cy: 170, rx: 310, ry: 78, tone: 'sky', strength: 0.42, rotate: -3 }, { cx: 620, cy: 150, rx: 250, ry: 70, tone: 'rose', strength: 0.46, rotate: 4 }],
    [{ cx: 560, cy: 92, rx: 190, ry: 56, tone: 'light', strength: 0.52, rotate: -6 }, { cx: 300, cy: 84, rx: 170, ry: 44, tone: 'rose', strength: 0.32, rotate: 5 }]
  ],
  // la noche: cielo hondo y una mancha pequeña de luz (el flexo encendido)
  night: [
    [{ cx: 280, cy: 150, rx: 330, ry: 96, tone: 'sky', strength: 0.6, rotate: -3 }, { cx: 650, cy: 170, rx: 260, ry: 78, tone: 'sky', strength: 0.46, rotate: 4 }],
    [{ cx: 470, cy: 84, rx: 220, ry: 60, tone: 'sky', strength: 0.32, rotate: 3 }, { cx: 640, cy: 70, rx: 70, ry: 30, tone: 'light', strength: 0.55, rotate: -8 }]
  ],
  // una sola mancha tranquila: detrás de un saludo o de un vacío
  still: [
    [{ cx: 400, cy: 120, rx: 250, ry: 84, tone: 'sand', strength: 0.5, rotate: -3 }],
    [{ cx: 470, cy: 104, rx: 150, ry: 56, tone: 'light', strength: 0.42, rotate: 7 }]
  ]
}

/** El cielo de una hora del día (0–23). */
export function washSceneFor(hour: number): WashScene {
  return hour >= 6 && hour < 11 ? 'dawn' : hour >= 11 && hour < 17 ? 'noon' : hour >= 17 && hour < 21 ? 'dusk' : 'night'
}

export function Wash({ scene = 'still', seed = 4, fade = 'bottom', className }: { scene?: WashScene; seed?: number; /** Hacia dónde se desvanece. */ fade?: 'bottom' | 'around' | 'none'; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  return (
    <div className={cx('wash', className)} data-fade={fade} aria-hidden="true">
      {SCENES[scene].map((blots, i) => (
        <div key={i} className="wash-layer">
          <svg viewBox="0 0 800 240" preserveAspectRatio="xMidYMid slice">
            <defs>
              <filter id={`${uid}w${i}`} x="-25%" y="-40%" width="150%" height="180%" colorInterpolationFilters="sRGB">
                <feTurbulence type="fractalNoise" baseFrequency="0.011 0.019" numOctaves="3" seed={seed + i * 11} result="warp" />
                <feDisplacementMap in="SourceGraphic" in2="warp" scale="58" xChannelSelector="R" yChannelSelector="G" result="shape" />
                {/* un desenfoque muy corto: el borde del agua, no un resplandor */}
                <feGaussianBlur in="shape" stdDeviation="2.4" result="soft" />
                <feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves="2" seed={seed + i * 5 + 3} result="grain" />
                <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.25 1.32" result="pigment" />
                <feComposite in="soft" in2="pigment" operator="in" />
              </filter>
            </defs>
            <g filter={`url(#${uid}w${i})`}>
              {blots.map((b, k) => (
                <g key={k} transform={`rotate(${b.rotate ?? 0} ${b.cx} ${b.cy})`}>
                  {/* el cuerpo de la mancha y, encima, su borde: donde el agua se secó queda más pigmento */}
                  <ellipse cx={b.cx} cy={b.cy} rx={b.rx} ry={b.ry} fill={`var(--wash-${b.tone})`} opacity={b.strength} />
                  <ellipse cx={b.cx} cy={b.cy} rx={b.rx * 0.97} ry={b.ry * 0.94} fill="none" stroke={`var(--wash-${b.tone})`} strokeWidth="7" opacity={b.strength * 0.55} />
                </g>
              ))}
            </g>
          </svg>
        </div>
      ))}
    </div>
  )
}
