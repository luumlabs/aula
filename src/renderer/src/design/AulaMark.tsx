// La marca de Aula, a pincel como el icono (sumi-e «arco y horizonte»): un arco de un solo trazo que se posa abajo a la
// izquierda y se seca en hebras al bajar por la derecha, el horizonte a pincel y el medio sol de borde hecho a mano. Estados:
// disponible (medio sol en el horizonte; asoma al pasar el ratón), pensando (el sol respira y la puerta se ilumina), trabajando
// (el atardecer: un sol cruza el arco y se pone en ladrillo), listo (salta y suelta un anillo de luz), espera tu respuesta, en
// pausa y sin conexión (el arco partido). Todo con CSS (aulaMark.css): ningún fotograma cuesta JavaScript; los trazos se
// calculan una vez por grosor (paint/markPaths.ts, semilla fija). Sustituye a cualquier ilustración (vacíos, bienvenida, chat
// vacío) y es el indicador de que Aula está haciendo algo.
// Donde la marca es protagonista: `draw` (el pincel la dibuja al aparecer: el arco de un gesto y luego el horizonte, una vez
// por sesión), `alive` (en reposo, el sol respira muy despacio) y `boil` (la línea «hierve» casi sin verse, como un dibujo
// animado a mano). Lo vivo se para en calma, con la ventana oculta y con «Reducir movimiento».
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { markPaths } from './paint/markPaths'
import { useInkReveal, wasDrawn, type RevealPlan } from './paint/Ink'
import { useTheme } from './theme'
import './aulaMark.css'

export type MarkState = 'idle' | 'thinking' | 'working' | 'done' | 'waiting' | 'paused' | 'offline'

export function AulaMark({ size = 24, state = 'idle', className, hover = false, label, draw = false, alive = false, boil = false }: { size?: number; state?: MarkState; className?: string; hover?: boolean; label?: string; draw?: boolean; alive?: boolean; boil?: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const door = `aula-door-${uid}`
  const arch = state === 'waiting' ? 'var(--accent)' : state === 'paused' || state === 'offline' ? 'var(--text3)' : 'currentColor'
  const sun = state === 'paused' ? 'var(--text3)' : 'var(--sun)'
  // el pincel, más grueso en lo pequeño para que el arco se lea igual
  const weight = size <= 16 ? 2.9 : size <= 24 ? 2.7 : size <= 48 ? 2.5 : 2.3
  const offline = state === 'offline'
  const p = markPaths(weight, offline)
  const variants = boil ? [p, markPaths(weight, offline, 1), markPaths(weight, offline, 2)] : [p]
  const ref = useRef<SVGSVGElement>(null)
  // el gesto: el arco de una vez (más despacio arriba, donde el pincel gira) y, sin levantar mucho, el horizonte
  const plan = useMemo<RevealPlan[] | null>(() => {
    if (!draw) return null
    const arch: RevealPlan[] = p.archPace.map((pace, i) => ({ pace, ms: 780, at: i * 840 }))
    const end = arch.length * 840 - 60
    return [...arch, { pace: p.horizonPace, ms: 360, at: end - 120 }]
  }, [draw, p])
  const drawKey = `mark:${size}:${offline}`
  // el sol sale por la puerta cuando el pincel ha terminado (la primera vez que se dibuja)
  const { reducedMotion } = useTheme()
  useEffect(() => {
    const sunEl = ref.current?.querySelector<SVGPathElement>('.am-sun')
    if (!draw || reducedMotion || !sunEl || wasDrawn(drawKey) || typeof sunEl.animate !== 'function') return
    const a = sunEl.animate([{ transform: 'translateY(4px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 700, delay: 1180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'backwards' })
    return () => a.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, [])
  useInkReveal(ref, plan, { draw, drawKey, delay: 120 })
  const reach = weight * 2.1
  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={['aula-mark', className].filter(Boolean).join(' ')}
      data-state={state}
      data-hover={hover ? 'true' : undefined}
      data-alive={alive ? '' : undefined}
      data-boil={boil ? '' : undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ flexShrink: 0, overflow: 'visible' }}
    >
      <defs>
        <clipPath id={door}>
          <path d={p.door} />
        </clipPath>
        {draw && (
          <>
            <mask id={`${uid}-a`} maskUnits="userSpaceOnUse" x={-2} y={-2} width={28} height={28}>
              {p.archSpines.map((d, i) => (
                <path key={i} data-reveal d={d} fill="none" stroke="#fff" strokeWidth={reach} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 2" />
              ))}
            </mask>
            <mask id={`${uid}-h`} maskUnits="userSpaceOnUse" x={-2} y={-2} width={28} height={28}>
              <path data-reveal d={p.horizonSpine} fill="none" stroke="#fff" strokeWidth={reach} strokeLinecap="round" pathLength={1} strokeDasharray="1 2" />
            </mask>
          </>
        )}
      </defs>
      {state !== 'offline' && (
        <g clipPath={`url(#${door})`}>
          <circle className="am-glow" cx="12" cy="20.5" r="11" fill="var(--sun-glow)" />
          <path className="am-sun" d={p.sun} fill={sun} />
          <g className="am-orbit">
            <circle cx="12" cy="14" r="2.3" fill="var(--sun)" />
            <circle className="am-dusk" cx="12" cy="14" r="2.3" fill="var(--accent)" />
          </g>
        </g>
      )}
      <g mask={draw ? `url(#${uid}-a)` : undefined}>
        {variants.map((v, i) => (
          <path key={i} className={boil ? 'am-arch am-boil' : 'am-arch'} data-v={boil ? i : undefined} d={v.arch} fill={arch} />
        ))}
      </g>
      <g mask={draw ? `url(#${uid}-h)` : undefined}>
        {variants.map((v, i) => (
          <path key={i} className={boil ? 'am-horizon am-boil' : 'am-horizon'} data-v={boil ? i : undefined} d={v.horizon} fill={arch} />
        ))}
      </g>
      {state !== 'offline' && <circle className="am-ring" cx="12" cy="18" r="3.6" stroke="var(--sun)" strokeWidth={weight * 0.45} />}
    </svg>
  )
}

/** El estado de la marca para algo que trabaja: «trabajando» mientras `busy`, «listo» un momento al terminar y después «disponible»
 * (o `rest`). `thinking`: aún no ha empezado a hacer nada visible. */
export function useMarkPhase(busy: boolean, { thinking = false, rest = 'idle', doneMs = 1300 }: { thinking?: boolean; rest?: MarkState; doneMs?: number } = {}): MarkState {
  const [done, setDone] = useState(false)
  const was = useRef(busy)
  useEffect(() => {
    if (was.current && !busy) {
      setDone(true)
      const id = setTimeout(() => setDone(false), doneMs)
      was.current = busy
      return () => clearTimeout(id)
    }
    was.current = busy
    if (busy) setDone(false)
    return undefined
  }, [busy, doneMs])
  if (busy) return thinking ? 'thinking' : 'working'
  return done ? 'done' : rest
}
