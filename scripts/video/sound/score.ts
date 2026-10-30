// La banda sonora entera desde una hoja de efectos: armonía → arreglo → efectos → mezcla → máster. Devuelve el estéreo a
// 48 kHz, la música y los efectos por separado (para el análisis) y un informe con acordes, colocaciones y niveles.
import { arrange } from './arrange.ts'
import { SR, Stereo } from './dsp.ts'
import { harmonize, type BarHarmony } from './harmony.ts'
import { mixdown, type MixReport } from './mix.ts'
import { renderEvents, resolveEvents, type Placement } from './sfx.ts'
import { barTime, parseSheet, snap16, type Sheet } from './sheet.ts'
import { makeBuses, type Ctx } from './voices.ts'

export interface SoundReport {
  name: string
  mode: Sheet['mode']
  bpm: number
  duration: number
  bars: { bar: number; t: number; kind: string; chord: string }[]
  sections: { bar: number; t: number; kind: string; chords: string[] }[]
  placements: Placement[]
  gaps: [number, number][]
  mix: MixReport
  renderMs: number
}

export interface Soundtrack {
  channels: [Float32Array, Float32Array]
  sampleRate: number
  music: Stereo
  fx: Stereo
  sheet: Sheet
  harmony: BarHarmony[]
  /** Notas agudas que toca la música (las usan los efectos afinados para no esconderse detrás de una igual). */
  notes: NonNullable<Ctx['notes']>
  report: SoundReport
}

/** Luz 0 (noche) … 1 (día) en cada instante: la siguen el filtro del colchón y su brillo. Manda la luz que marca la
 *  hoja ('light'); sin ella, el carácter de las secciones. La intro va en penumbra que se abre, la subida se abre del
 *  todo y el final se cierra despacio. */
export function lightCurve(sh: Sheet, H: BarHarmony[]): (t: number) => number {
  const lights = sh.events.filter((e) => e.type === 'light')
  const kindLight = (k: string) => (k === 'night' ? 0 : k === 'break' ? 0.5 : k === 'card' ? -1 : 1)
  const base = (t: number): number => {
    if (lights.length) {
      // estado antes del primer cambio: el contrario de a donde va el primero
      let v = lights[0].to === 'light' ? 0 : 1
      for (const e of lights) {
        if (t < e.t) break
        const p = Math.min(1, (t - e.t) / e.dur)
        const s = p * p * (3 - 2 * p)
        const to = e.to === 'light' ? 1 : 0
        v = v + (to - v) * s
      }
      return v
    }
    let v = 1
    for (const h of H) {
      if (h.t > t) break
      const kl = kindLight(h.kind)
      if (kl >= 0) v = kl
    }
    return v
  }
  return (t: number) => {
    const b = t < sh.downbeat ? 0 : Math.floor((t - sh.downbeat) / sh.bar)
    const h = H[Math.max(0, Math.min(H.length - 1, b))]
    let v = base(t)
    if (h.kind === 'intro') v = Math.min(v, 0.28 + 0.3 * ((h.pos + (t - h.t) / sh.bar) / h.len))
    if (h.kind === 'rise') v = Math.max(v, 0.6 + 0.4 * ((h.pos + (t - h.t) / sh.bar) / h.len))
    if (h.kind === 'end') v = Math.min(v, 1 - 0.35 * Math.min(1, (t - barTime(sh, h.bar - h.pos)) / (sh.bar * 4)))
    // el corto no se apaga de noche: el colchón se queda medio abierto
    return Math.max(sh.mode === 'short' ? 0.45 : 0, Math.min(1, v))
  }
}

/** Dónde la película sube subgraves y brillo: en el drop y en la subida (con rampas de medio compás); el corto, siempre. */
export function boostCurve(sh: Sheet, H: BarHarmony[]): (t: number) => number {
  if (sh.mode === 'short') return () => 1
  // el drop y el compás que lo sigue (la ráfaga), y la subida
  const spans = H.filter((h, i) => h.kind === 'drop' || h.kind === 'rise' || H[i - 1]?.kind === 'drop').map((h) => [h.t, h.t + sh.bar] as const)
  const ramp = sh.bar / 2
  return (t: number) => {
    let v = 0
    for (const [a, b] of spans) {
      if (t >= a && t < b) return 1
      if (t >= a - 0.05 && t < a) v = Math.max(v, 1 - (a - t) / 0.05)
      if (t >= b && t < b + ramp) v = Math.max(v, 1 - (t - b) / ramp)
    }
    return v
  }
}

/** Nivel de la música por secciones (dB), con rampas de 0,3 s: la película sube un poco la primera noche (Learn) y la
 *  subida final; el corto sube el montaje y la noche tras el drop, para que no queden por debajo del gancho. */
export function liftCurve(sh: Sheet, H: BarHarmony[]): (t: number) => number {
  const of = (h: BarHarmony) => {
    if (sh.mode === 'short') return h.kind === 'day' ? 1.5 : h.kind === 'night' ? 2 : h.kind === 'rise' ? 2 : h.kind === 'intro' ? 1 : 0
    return h.kind === 'rise' ? 1.5 : h.kind === 'night' && h.variant === 0 ? 1 : 0
  }
  return (t: number) => {
    const b = t < sh.downbeat ? 0 : Math.floor((t - sh.downbeat) / sh.bar)
    const h = H[Math.max(0, Math.min(H.length - 1, b))]
    const prev = H[Math.max(0, b - 1)]
    const x = t - h.t
    return x < 0.3 && prev ? of(prev) + (of(h) - of(prev)) * (x / 0.3) : of(h)
  }
}

/** −2 dB por encima de 4 kHz en las secciones de día de la película (fuera del drop y la subida), con rampas de 0,3 s:
 *  el día también cálido, como el v3. */
export function warmCurve(sh: Sheet, H: BarHarmony[], boost: (t: number) => number): (t: number) => number {
  if (sh.mode === 'short') return () => 0
  const day = (h: BarHarmony | undefined) => (h && h.kind === 'day' ? 1 : 0)
  return (t: number) => {
    const b = t < sh.downbeat ? 0 : Math.floor((t - sh.downbeat) / sh.bar)
    const h = H[Math.max(0, Math.min(H.length - 1, b))]
    const prev = H[b - 1]
    const x = t - h.t
    const d = x < 0.3 ? day(prev) + (day(h) - day(prev)) * (x / 0.3) : day(h)
    return -2 * d * (1 - boost(t))
  }
}

export function renderSoundtrack(input: unknown): Soundtrack {
  const t0 = performance.now()
  const sh = parseSheet(input)
  const n = Math.ceil(sh.duration * SR)
  const H = harmonize(sh)
  const b = makeBuses(n)
  let s = sh.seed * 1000 + 1
  const ctx: Ctx = { b, seed: () => (s = (s * 1103515245 + 12345) >>> 0), notes: [] }
  // los golpes fuertes (los de la hoja y los que añade la forma), encajados a tempo como sonarán
  const strong = resolveEvents(sh, H).filter((e) => e.type === 'impact' || e.type === 'flash' || e.type === 'logo').map((e) => snap16(sh, e.t))
  const plan = arrange(ctx, sh, H, strong)
  const placements = renderEvents(ctx, sh, H)
  const light = lightCurve(sh, H)
  const hits = placements.filter((p) => p.type === 'impact' || p.type === 'flash' || p.type === 'logo').map((p) => p.hit)
  const boost = boostCurve(sh, H)
  const out = mixdown(sh, b, plan, light, boost, hits, liftCurve(sh, H), warmCurve(sh, H, boost))
  const sections = sh.sections.map((x) => ({ bar: x.bar, t: +barTime(sh, x.bar).toFixed(3), kind: x.kind, chords: H.filter((h) => h.bar >= x.bar && sh.sections.find((y) => y.bar > x.bar && y.bar <= h.bar) === undefined).map((h) => h.symbol) }))
  const report: SoundReport = {
    name: sh.name,
    mode: sh.mode,
    bpm: sh.bpm,
    duration: sh.duration,
    bars: H.filter((h) => h.t < sh.duration).map((h) => ({ bar: h.bar, t: +h.t.toFixed(3), kind: h.kind, chord: h.symbol })),
    sections,
    placements,
    gaps: plan.gaps.map(([a, c]) => [+a.toFixed(3), +c.toFixed(3)]),
    mix: out.report,
    renderMs: Math.round(performance.now() - t0)
  }
  return { channels: [out.mix.L, out.mix.R], sampleRate: SR, music: out.music, fx: out.fx, sheet: sh, harmony: H, notes: ctx.notes ?? [], report }
}
