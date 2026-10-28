// Escenas dibujadas de algunas simulaciones de la biblioteca, sincronizadas con el reloj: el muelle con su masa (oscilador) y
// el circuito RC (las placas del condensador se cargan y la corriente circula). Encima de la gráfica, que sigue siendo la misma.
import { memo } from 'react'
import { INK, wash } from './colors'
import { simKey, type Env } from '../lib/simulation'

export const SCENE_PRESETS = new Set(['spring', 'rc'])

export const PresetScene = memo(function PresetScene({ preset, env, width }: { preset: string; env: Env; width: number }) {
  if (preset === 'spring') return <SpringScene env={env} width={width} />
  if (preset === 'rc') return <RCScene env={env} width={width} />
  return null
})

/** Muelle horizontal sujeto a la pared con la masa en x(t) = A·cos(ωt). */
function SpringScene({ env, width }: { env: Env; width: number }) {
  const H = 92
  const A = env.A ?? 0.6, w = env.w ?? 1, t = env.t ?? 0, m = env.m ?? 1
  const x = A * Math.cos(w * t)
  const wall = 26, eq = Math.max(160, width * 0.55), k = (width * 0.28) / 1.2
  const size = 34 + Math.min(22, m * 5)
  const mx = eq + x * k
  const left = mx - size / 2
  const y = H / 2 + 6
  // zigzag del muelle: 14 vueltas entre la pared y la masa
  const n = 14, span = left - wall - 10, amp = 9
  let d = `M${wall} ${y}L${wall + 6} ${y}`
  for (let i = 0; i < n; i++) d += `L${wall + 6 + (span * (i + 0.5)) / n} ${y + (i % 2 ? amp : -amp)}`
  d += `L${wall + 6 + span} ${y}L${left} ${y}`
  return (
    <svg width={width} height={H} className="block" aria-hidden>
      <line x1={wall} x2={width - 16} y1={y + size / 2 + 2} y2={y + size / 2 + 2} stroke="var(--line-strong)" strokeOpacity={0.5} />
      {Array.from({ length: 7 }, (_, i) => <line key={i} x1={wall} y1={y - 26 + i * 9} x2={wall - 8} y2={y - 20 + i * 9} stroke="var(--text3)" strokeWidth={1.2} />)}
      <line x1={wall} x2={wall} y1={y - 30} y2={y + size / 2 + 2} stroke="var(--text2)" strokeWidth={2} />
      <line x1={eq} x2={eq} y1={10} y2={y + size / 2 + 2} stroke="var(--text3)" strokeDasharray="3 4" />
      <text x={eq} y={9} textAnchor="middle" className="fill-text3" style={{ fontSize: 10.5 }}>x = 0</text>
      <path d={d} fill="none" stroke="var(--text2)" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <rect x={left} y={y - size / 2} width={size} height={size} rx={7} fill={wash(INK, 22)} stroke={INK} strokeWidth={1.8} />
      <text x={mx} y={y + 4} textAnchor="middle" className="fill-text" style={{ fontSize: 12, fontFamily: 'var(--font-serif)', fontStyle: 'italic' }}>m</text>
    </svg>
  )
}

/** Circuito RC: fuente, resistencia y condensador; las placas se cargan con V_C y los puntos de la corriente corren con I. */
function RCScene({ env, width }: { env: Env; width: number }) {
  const H = 112
  const V0 = env.V0 ?? 9, Vc = env.Vc ?? 0, I = env.I ?? 0, R = env.R ?? 10, t = env.t ?? 0
  const charge = V0 > 0 ? Math.max(0, Math.min(1, Vc / V0)) : 0
  const x0 = Math.max(24, width / 2 - 170), x1 = Math.min(width - 24, width / 2 + 170), y0 = 22, y1 = H - 18
  const bx = x0, rx = (x0 + x1) / 2, cx = x1
  // recorrido del circuito (sentido horario) para los puntos de la corriente
  const per = 2 * (x1 - x0) + 2 * (y1 - y0)
  const at = (s: number): [number, number] => {
    let u = ((s % per) + per) % per
    if (u < x1 - x0) return [x0 + u, y0]
    u -= x1 - x0
    if (u < y1 - y0) return [x1, y0 + u]
    u -= y1 - y0
    if (u < x1 - x0) return [x1 - u, y1]
    u -= x1 - x0
    return [x0, y1 - u]
  }
  const i0 = V0 / Math.max(1e-9, R)
  const flow = i0 > 0 ? I / i0 : 0
  const offset = t * 60 * Math.min(1, Math.max(0, flow)) + 0
  const dots = Math.round(per / 34)
  const signs = Math.round(charge * 5)
  const gapC = (cx: number, y: number): boolean => Math.abs(y - (y0 + y1) / 2) < 10 && Math.abs(cx - x1) < 1
  return (
    <svg width={width} height={H} className="block" aria-hidden>
      <g stroke="var(--text2)" strokeWidth={1.8} fill="none" strokeLinecap="round">
        {/* cables con huecos para la fuente (izquierda), la resistencia (arriba) y el condensador (derecha) */}
        <path d={`M${bx} ${(y0 + y1) / 2 - 10}V${y0}H${rx - 26}M${rx + 26} ${y0}H${cx}V${(y0 + y1) / 2 - 7}M${cx} ${(y0 + y1) / 2 + 7}V${y1}H${bx}V${(y0 + y1) / 2 + 10}`} />
        <path d={`M${rx - 26} ${y0}l5 -7l7 14l7 -14l7 14l7 -14l7 14l5 -7`} strokeLinejoin="round" />
        <line x1={bx - 12} x2={bx + 12} y1={(y0 + y1) / 2 - 10} y2={(y0 + y1) / 2 - 10} />
        <line x1={bx - 6} x2={bx + 6} y1={(y0 + y1) / 2 + 10} y2={(y0 + y1) / 2 + 10} strokeWidth={3} />
      </g>
      <line x1={cx - 16} x2={cx + 16} y1={(y0 + y1) / 2 - 7} y2={(y0 + y1) / 2 - 7} stroke={INK} strokeWidth={3} strokeLinecap="round" />
      <line x1={cx - 16} x2={cx + 16} y1={(y0 + y1) / 2 + 7} y2={(y0 + y1) / 2 + 7} stroke={INK} strokeWidth={3} strokeLinecap="round" />
      {Array.from({ length: signs }, (_, i) => (
        <g key={i} className="fill-text2" style={{ fontSize: 10, fontWeight: 700 }}>
          <text x={cx - 14 + i * 7} y={(y0 + y1) / 2 - 11} textAnchor="middle">+</text>
          <text x={cx - 14 + i * 7} y={(y0 + y1) / 2 + 19} textAnchor="middle">−</text>
        </g>
      ))}
      {flow > 0.01 && Array.from({ length: dots }, (_, i) => {
        const [x, y] = at(offset + (i * per) / dots)
        if (gapC(x, y)) return null
        return <circle key={i} cx={x} cy={y} r={2.4} fill={INK} opacity={0.35 + 0.6 * Math.min(1, flow)} />
      })}
      <text x={bx - 18} y={(y0 + y1) / 2 + 4} textAnchor="end" className="fill-text2" style={{ fontSize: 11.5, fontFamily: 'var(--font-serif)', fontStyle: 'italic' }}>V₀</text>
      <text x={rx} y={y0 - 10} textAnchor="middle" className="fill-text2" style={{ fontSize: 11.5, fontFamily: 'var(--font-serif)', fontStyle: 'italic' }}>R</text>
      <text x={cx + 22} y={(y0 + y1) / 2 + 4} className="fill-text2" style={{ fontSize: 11.5, fontFamily: 'var(--font-serif)', fontStyle: 'italic' }}>C</text>
    </svg>
  )
}

/** ¿El modelo tiene escena propia? (el preset y sus nombres siguen ahí aunque la IA haya cambiado rangos o textos). */
export function hasScene(preset: string | undefined, env: Env): boolean {
  if (!preset || !SCENE_PRESETS.has(preset)) return false
  if (preset === 'spring') return env.A !== undefined && env[simKey('w')] !== undefined
  return env.V0 !== undefined && env.Vc !== undefined
}
