// Comprobaciones del sonido ya mezclado: dónde empieza de verdad cada efecto (en su bus) y si se oye sobre la música
// (relación efecto/música en las bandas donde está la energía del efecto, durante el efecto). Las usan las pruebas y la
// lámina de revisión.
import { fft } from '../audio/fft.ts'
import { db, scale, SR, type Stereo } from './dsp.ts'
import { FX_DB } from './mix.ts'
import type { Soundtrack } from './score.ts'
import { renderEvent, resolveEvents, type Placement, type Scheduled } from './sfx.ts'
import { makeBuses } from './voices.ts'

/** Envolvente de amplitud mono a 1 ms. */
export function envelopeMs(s: Stereo): Float32Array {
  const hop = SR / 1000
  const out = new Float32Array(Math.floor(s.L.length / hop))
  for (let k = 0; k < out.length; k++) {
    let m = 0
    for (let i = k * hop; i < (k + 1) * hop; i++) m = Math.max(m, Math.abs(s.L[i] + s.R[i]) * 0.5)
    out[k] = m
  }
  return out
}

/** Instante medido (s, desde el inicio de `env`) del golpe que se oye de un efecto: el ataque (la mayor subida de la
 *  envolvente), la cresta del aire (whoosh) o el corte en seco (final de la subida). `near` es dónde buscar. */
export function measureHit(env: Float32Array, type: Placement['type'], near: number): number | null {
  const ms = (t: number) => Math.max(2, Math.min(env.length - 3, Math.round(t * 1000)))
  if (type === 'light') return null
  if (type === 'whoosh') {
    // la cresta de la envolvente suavizada (15 ms): el ruido no tiene un pico de una muestra
    let best = -1
    let at = 0
    for (let k = ms(near - 0.15); k <= ms(near + 0.1); k++) {
      let v = 0
      for (let j = -7; j <= 7; j++) v += env[Math.max(0, Math.min(env.length - 1, k + j))]
      if (v > best) [best, at] = [v, k]
    }
    return at / 1000
  }
  if (type === 'rise') {
    let best = 0
    let at = ms(near)
    for (let k = ms(near - 0.05); k <= ms(near + 0.05); k++) {
      const d = env[k - 2] - env[k + 2]
      if (d > best) [best, at] = [d, k]
    }
    return at / 1000
  }
  let best = 0
  let at = ms(near)
  for (let k = ms(near - 0.03); k <= ms(near + 0.03); k++) {
    const d = env[k + 1] + env[k + 2] - env[k - 1] - env[k - 2]
    if (d > best) [best, at] = [d, k]
  }
  return at / 1000
}

/** Vuelve a sintetizar un efecto SOLO (en un bus corto, con su nivel en la mezcla y sin colas de reverb) y mide dónde
 *  cae su golpe, en segundos del vídeo. */
export function isolate(st: Soundtrack, e: Scheduled, p: Placement): { hit: number | null; fx: Stereo; offset: number } {
  const a = Math.min(p.span[0], e.t) - 0.3
  const b = Math.max(p.span[1], e.t + e.dur) + 0.3
  const buses = makeBuses(Math.ceil((b - a) * SR))
  let s = 99
  renderEvent({ b: buses, seed: () => (s = (s * 1103515245 + 12345) >>> 0), offset: a, notes: st.notes }, st.sheet, st.harmony, e)
  scale(buses.fx, db(FX_DB))
  const m = measureHit(envelopeMs(buses.fx), p.type, p.hit - a)
  return { hit: m === null ? null : a + m, fx: buses.fx, offset: a }
}

/** Ventana (s) en la que se juzga si un efecto se oye. */
export function judgeWindow(p: Placement): [number, number] {
  switch (p.type) {
    case 'click':
    case 'keys':
      return [p.hit, p.hit + 0.05]
    case 'word':
      return [p.hit, p.hit + 0.1]
    case 'whoosh':
      return [p.hit - 0.12, p.hit + 0.04]
    case 'rise':
      return [p.hit - 0.4, p.hit]
    case 'light':
      return [p.span[0] + (p.span[1] - p.span[0]) * 0.3, p.span[0] + (p.span[1] - p.span[0]) * 0.6]
    case 'arp':
    case 'count':
      return [p.hit, Math.min(p.span[1], p.hit + 0.6)]
    default:
      return [p.hit, p.hit + 0.25]
  }
}

/** Espectro de potencia medio en [a, b] s (`offset`: segundo del vídeo en la muestra 0 de `s`). */
function spectrum(s: Stereo, a: number, b: number, offset = 0, n = 2048): Float64Array {
  const acc = new Float64Array(n / 2)
  const hop = n / 4
  const i0 = Math.max(0, Math.round((a - offset) * SR) - n / 2)
  const i1 = Math.min(s.L.length - n, Math.round((b - offset) * SR) - n / 2)
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  let frames = 0
  for (let i = i0; i <= Math.max(i0, i1); i += hop) {
    for (let k = 0; k < n; k++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / n)
      re[k] = ((s.L[i + k] ?? 0) + (s.R[i + k] ?? 0)) * 0.5 * w
      im[k] = 0
    }
    fft(re, im)
    for (let k = 0; k < n / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k]
    frames++
  }
  for (let k = 0; k < acc.length; k++) acc[k] /= Math.max(1, frames)
  return acc
}

/** Ponderación A (potencia) de la frecuencia f: el oído apenas cuenta lo muy grave (el «tum» de 60 Hz bajo una
 *  campana no es lo que hace que se oiga). */
function aWeight(f: number): number {
  const f2 = f * f
  const ra = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2))
  return (ra * 1.2589) ** 2
}

/** Relación efecto/música (dB) en las bandas que reúnen el 80 % de la energía del efecto (ponderada A, como se oye)
 *  durante su ventana. `fx` es el efecto solo (con `offset`), así cada uno se juzga por su propio sonido y no por los que
 *  coinciden con él. */
export function audibility(music: Stereo, fx: Stereo, p: Placement, offset = 0): number {
  const [a, b] = judgeWindow(p)
  const n = 2048
  const F = spectrum(fx, a, b, offset, n).map((v, k) => v * aWeight((k * SR) / n))
  const M = spectrum(music, a, b, 0, n).map((v, k) => v * aWeight((k * SR) / n))
  const idx = Array.from(F.keys()).filter((k) => k > 1).sort((x, y) => F[y] - F[x])
  const total = idx.reduce((s, k) => s + F[k], 0)
  let fs = 0
  let ms = 0
  for (const k of idx) {
    fs += F[k]
    ms += M[k]
    if (fs >= 0.8 * total) break
  }
  return 10 * Math.log10((fs + 1e-20) / (ms + 1e-20))
}

export interface EventCheck {
  type: string
  t: number
  hit: number
  measured: number | null
  errorMs: number | null
  snrDb: number
  label?: string
  auto: boolean
}

/** Cada efecto: su golpe medido aislado (y el error frente a donde debía caer) y si se oye sobre la música. */
export function checkEvents(st: Soundtrack): EventCheck[] {
  const scheduled = resolveEvents(st.sheet, st.harmony)
  return st.report.placements.map((p, k) => {
    const iso = isolate(st, scheduled[k], p)
    const m = iso.hit
    return { type: p.type, t: p.t, hit: +p.hit.toFixed(4), measured: m === null ? null : +m.toFixed(4), errorMs: m === null ? null : +((m - p.hit) * 1000).toFixed(1), snrDb: +audibility(st.music, iso.fx, p, iso.offset).toFixed(1), label: p.label, auto: p.auto }
  })
}
