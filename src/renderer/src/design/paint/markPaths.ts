// La marca de Aula a pincel (el icono sumi-e «arco y horizonte»): un arco de un solo trazo que se posa abajo a la izquierda
// y se seca en hebras al bajar por la derecha, la línea del horizonte a pincel y el medio sol de borde hecho a mano.
// Geometría pura (unidades del viewBox de 24 × 24) con semilla fija: el mismo dibujo siempre; se calcula una vez por grosor.
import { dryBrush, pressureProfile, toPathData, type Pt } from './brush'
import { handPace } from './drawings'
import { createNoise } from './noise'
import { rngFrom, seedOf } from './random'

export interface MarkPaths {
  /** El arco (varios trazos: el cuerpo y las hebras secas). */
  arch: string
  /** La línea del horizonte. */
  horizon: string
  /** El sol, de borde hecho a mano. */
  sun: string
  /** La puerta (recorte del sol): el hueco del arco por encima del horizonte. */
  door: string
  /** Grosor del arco (unidades del viewBox). */
  weight: number
  /** Los ejes por los que pasa el pincel (para que la marca se dibuje): uno por trazo del arco y el del horizonte. */
  archSpines: string[]
  horizonSpine: string
  /** El ritmo de la mano por cada eje (para dibujarse). */
  archPace: [number, number][][]
  horizonPace: [number, number][]
}

/** Horizonte y patas del arco, como en la marca de siempre. */
export const HORIZON_Y = 20.5

const cache = new Map<string, MarkPaths>()

function archPath(gap: boolean): Pt[][] {
  const pts: Pt[] = []
  // pata izquierda (de abajo arriba), medio círculo por arriba (centro 12,10.5; radio 7) y pata derecha (de arriba abajo)
  for (let y = HORIZON_Y + 0.15; y >= 10.5; y -= 0.5) pts.push({ x: 5, y })
  const arc: Pt[] = []
  for (let k = 0; k <= 48; k++) {
    const a = Math.PI + (k / 48) * Math.PI
    arc.push({ x: 12 + Math.cos(a) * 7, y: 10.5 + Math.sin(a) * 7 })
  }
  const right: Pt[] = []
  for (let y = 10.5; y <= HORIZON_Y - 0.35; y += 0.5) right.push({ x: 19, y })
  if (!gap) return [[...pts, ...arc, ...right]]
  // sin conexión: el arco se interrumpe arriba (dos trazos)
  return [
    [...pts, ...arc.slice(0, 19)],
    [...arc.slice(29), ...right]
  ]
}

const spineOf = (pts: Pt[]) => 'M' + pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')

/**
 * Los trazos de la marca para un grosor de arco (`weight`, en unidades del viewBox). `gap`: el arco partido (sin conexión).
 * `variant` (0, 1, 2…): otro dibujo del mismo gesto, con el temblor y las hebras un pelo distintos (el «line boil»).
 */
export function markPaths(weight: number, gap = false, variant = 0): MarkPaths {
  const key = `${weight}:${gap}:${variant}`
  const hit = cache.get(key)
  if (hit) return hit
  const seed = seedOf('aula-mark')
  const noise = createNoise(seed + variant * 7919)
  const rng = rngFrom(seed + variant * 104729)
  const brush = { width: weight, tremor: weight * 0.035, tremorScale: 12, jitter: 0.07, step: 0.2 }
  const strokes = archPath(gap)
  const arch: Pt[][] = []
  strokes.forEach((s, i) => {
    const last = i === strokes.length - 1
    // se posa cargado y romo; la pata derecha baja secándose
    const base = pressureProfile(0.9, 0.04, last ? 0.72 : 0.97, last ? 0.55 : 0.8)
    // al doblar arriba el pincel gira y adelgaza un poco
    const pressure = (t: number) => base(t) * (gap ? 1 : 1 - 0.14 * Math.exp(-(((t - 0.55) / 0.13) ** 2)))
    arch.push(...dryBrush(s, { ...brush, pressure }, noise, rng, last ? 0.8 : 0.995, last ? 4 : 1))
  })
  const horizon: Pt[] = []
  for (let k = 0; k <= 40; k++) {
    const t = k / 40
    horizon.push({ x: 2.3 + 19.6 * t, y: HORIZON_Y + 0.25 - 0.18 * Math.sin(Math.PI * t) - 0.1 * t })
  }
  const hz = dryBrush(horizon, { width: weight * 0.5, tremor: weight * 0.03, tremorScale: 14, jitter: 0.1, step: 0.2, pressure: pressureProfile(0.75, 0.04, 0.58, 0.3) }, noise, rng, 0.7, 3)
  // el sol: un círculo recortado a mano (ondula despacio, sin picos), siempre el mismo
  const sr = rngFrom(seed ^ 77)
  const [p1, p2, p3] = [sr() * 6.28, sr() * 6.28, sr() * 6.28]
  const sunPoly: Pt[] = []
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2
    const r = 3.6 * (1 + 0.03 * Math.sin(2 * a + p1) + 0.018 * Math.sin(3 * a + p2) + 0.008 * Math.sin(7 * a + p3))
    sunPoly.push({ x: 12 + Math.cos(a) * r, y: HORIZON_Y + Math.sin(a) * r * 0.97 })
  }
  // la puerta: el hueco del arco (el borde de dentro del trazo) hasta el horizonte
  const inset = weight * 0.42
  const xl = 5 + inset
  const xr = 19 - inset
  const r = 7 - inset
  const door = `M${xl.toFixed(2)} ${HORIZON_Y}V10.5A${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${xr.toFixed(2)} 10.5V${HORIZON_Y}Z`
  const out = { arch: toPathData(arch), horizon: toPathData(hz), sun: toPathData([sunPoly]), door, weight, archSpines: strokes.map(spineOf), horizonSpine: spineOf(horizon), archPace: strokes.map((st) => handPace(st.map((q) => ({ x: q.x * 10, y: q.y * 10 })))), horizonPace: handPace(horizon.map((q) => ({ x: q.x * 10, y: q.y * 10 }))) }
  cache.set(key, out)
  return out
}
