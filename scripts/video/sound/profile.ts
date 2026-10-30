// Perfil objetivo de una mezcla, para compararla con la referencia que le gusta al dueño (el audio del v3): reparto por
// bandas, centroide y brillo, densidad de golpes, dinámica (LRA, PLR, cresta), estéreo y cuánto sobresalen los efectos en
// sus instantes. Puro (Node): node scripts/video/sound/profile.ts a.wav [b.wav …] da una tabla.
import { fft } from '../audio/fft.ts'
import { integratedLoudness, truePeak } from '../audio/loudness.ts'

export const BANDS: [string, number, number][] = [
  ['sub', 20, 60],
  ['bass', 60, 250],
  ['lowmid', 250, 500],
  ['mid', 500, 2000],
  ['highmid', 2000, 6000],
  ['high', 6000, 16000]
]

export interface Profile {
  seconds: number
  lufs: number
  truePeak: number
  /** Pico verdadero − sonoridad integrada (dB). */
  plr: number
  /** Rango de sonoridad: percentiles 10–95 de la sonoridad a corto plazo (3 s). */
  lra: number
  /** Mediana del factor de cresta en ventanas de 50 ms (dB). */
  crest: number
  /** Energía de cada banda respecto al total (dB). */
  bands: Record<string, number>
  /** Centroide espectral (Hz) y % de la energía por encima de 2 kHz. */
  centroid: number
  brightness: number
  /** Golpes por segundo (flujo espectral con umbral adaptativo), en todo el espectro, en graves (< 200 Hz) y en agudos (> 2 kHz). */
  onsets: { all: number; low: number; high: number }
  /** Estéreo: energía de lados respecto al centro (dB) y correlación entre canales. */
  sideDb: number
  correlation: number
}

const N = 2048
const HOP = 512

/** Espectros de potencia (mono) cada HOP muestras. */
function spectra(ch: Float32Array[], rate: number, cb: (k: number, p: Float64Array) => void): number {
  const n = ch[0].length
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  const p = new Float64Array(N / 2)
  const hann = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N))
  let k = 0
  for (let s = 0; s + N <= n; s += HOP, k++) {
    for (let i = 0; i < N; i++) {
      let v = 0
      for (const c of ch) v += c[s + i]
      re[i] = (v / ch.length) * hann[i]
      im[i] = 0
    }
    fft(re, im)
    for (let i = 0; i < N / 2; i++) p[i] = re[i] * re[i] + im[i] * im[i]
    cb(k, p)
  }
  return k
}

/** Golpes por segundo en las bandas [lo, hi) Hz: picos del flujo espectral logarítmico sobre su mediana local. */
function onsetRate(flux: Float64Array, rate: number): number {
  const fps = rate / HOP
  const w = Math.round(fps * 0.5)
  const minGap = Math.round(fps * 0.05)
  let count = 0
  let last = -Infinity
  const win: number[] = []
  for (let k = 1; k < flux.length - 1; k++) {
    win.length = 0
    for (let j = Math.max(0, k - w); j < Math.min(flux.length, k + w); j++) win.push(flux[j])
    win.sort((a, b) => a - b)
    const med = win[win.length >> 1]
    const thr = med * 1.5 + 1e-3
    if (flux[k] > thr && flux[k] >= flux[k - 1] && flux[k] > flux[k + 1] && k - last >= minGap) {
      count++
      last = k
    }
  }
  return count / (flux.length / fps)
}

export function profile(ch: Float32Array[], rate: number): Profile {
  const n = ch[0].length
  const seconds = n / rate
  const lufs = integratedLoudness(ch, rate)
  const tp = truePeak(ch)
  // sonoridad a corto plazo (3 s, cada 1 s)
  const st: number[] = []
  for (let s = 0; s + 3 * rate <= n; s += rate) {
    const v = integratedLoudness(ch.map((c) => c.subarray(s, s + 3 * rate)), rate)
    if (Number.isFinite(v)) st.push(v)
  }
  st.sort((a, b) => a - b)
  const q = (p: number) => st[Math.floor(p * (st.length - 1))] ?? 0
  // cresta en 50 ms
  const cw = Math.round(0.05 * rate)
  const crests: number[] = []
  for (let s = 0; s + cw <= n; s += cw) {
    let pk = 0
    let e = 0
    for (let i = s; i < s + cw; i++) {
      const v = (ch[0][i] + (ch[1] ?? ch[0])[i]) * 0.5
      pk = Math.max(pk, Math.abs(v))
      e += v * v
    }
    const r = Math.sqrt(e / cw)
    if (r > 1e-4) crests.push(20 * Math.log10(pk / r))
  }
  crests.sort((a, b) => a - b)
  // espectro medio y flujo por bandas
  const acc = new Float64Array(N / 2)
  const frames = Math.floor((n - N) / HOP) + 1
  const fluxAll = new Float64Array(frames)
  const fluxLow = new Float64Array(frames)
  const fluxHigh = new Float64Array(frames)
  const prev = new Float64Array(N / 2)
  const binHz = rate / N
  spectra(ch, rate, (k, p) => {
    for (let i = 0; i < N / 2; i++) {
      acc[i] += p[i]
      const l = Math.log10(p[i] + 1e-10)
      const d = Math.max(0, l - prev[i])
      prev[i] = l
      if (k === 0) continue
      const f = i * binHz
      if (f >= 30 && f < 16000) fluxAll[k] += d
      if (f >= 30 && f < 200) fluxLow[k] += d
      if (f >= 2000 && f < 16000) fluxHigh[k] += d
    }
  })
  let total = 0
  let cen = 0
  let above = 0
  for (let i = 1; i < N / 2; i++) {
    const f = i * binHz
    if (f < 20 || f > 16000) continue
    total += acc[i]
    cen += acc[i] * f
    if (f >= 2000) above += acc[i]
  }
  const bands: Record<string, number> = {}
  for (const [name, lo, hi] of BANDS) {
    let e = 0
    for (let i = 1; i < N / 2; i++) if (i * binHz >= lo && i * binHz < hi) e += acc[i]
    bands[name] = +(10 * Math.log10(e / total)).toFixed(1)
  }
  // estéreo
  let mm = 0
  let ss = 0
  let lr = 0
  let ll = 0
  let rr = 0
  const R = ch[1] ?? ch[0]
  for (let i = 0; i < n; i++) {
    const l = ch[0][i]
    const r = R[i]
    mm += ((l + r) / 2) ** 2
    ss += ((l - r) / 2) ** 2
    lr += l * r
    ll += l * l
    rr += r * r
  }
  return {
    seconds: +seconds.toFixed(2),
    lufs: +lufs.toFixed(2),
    truePeak: +tp.toFixed(2),
    plr: +(tp - lufs).toFixed(1),
    lra: +(q(0.95) - q(0.1)).toFixed(1),
    crest: +(crests[crests.length >> 1] ?? 0).toFixed(1),
    bands,
    centroid: Math.round(cen / total),
    brightness: +((100 * above) / total).toFixed(1),
    onsets: { all: +onsetRate(fluxAll, rate).toFixed(2), low: +onsetRate(fluxLow, rate).toFixed(2), high: +onsetRate(fluxHigh, rate).toFixed(2) },
    sideDb: +(10 * Math.log10(ss / mm)).toFixed(1),
    correlation: +(lr / Math.sqrt(ll * rr)).toFixed(3)
  }
}

/** Cuánto sube la sonoridad (ventanas de 100 ms, ponderación K aproximada por energía) en cada instante `t` respecto a
 *  la mediana de su entorno (±2 s, sin los 300 ms alrededor): lo que sobresale un efecto en la mezcla. Mediana en dB. */
export function eventLift(ch: Float32Array[], rate: number, times: number[]): number {
  const w = Math.round(0.1 * rate)
  const level = (t: number) => {
    const i0 = Math.max(0, Math.round(t * rate))
    let e = 0
    for (const c of ch) for (let i = i0; i < Math.min(c.length, i0 + w); i++) e += c[i] * c[i]
    return 10 * Math.log10(e / (w * ch.length) + 1e-12)
  }
  const lifts: number[] = []
  for (const t of times) {
    const around: number[] = []
    for (let x = t - 2; x <= t + 2; x += 0.1) if (Math.abs(x - t) > 0.3 && x >= 0 && x * rate < ch[0].length - w) around.push(level(x))
    if (!around.length) continue
    around.sort((a, b) => a - b)
    lifts.push(level(t) - around[around.length >> 1])
  }
  lifts.sort((a, b) => a - b)
  return +(lifts[lifts.length >> 1] ?? 0).toFixed(1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs')
  const { readWav } = await import('../audio/track.ts')
  for (const f of process.argv.slice(2)) {
    const w = readWav(readFileSync(f))
    console.log(f.split('/').pop(), JSON.stringify(profile(w.channels, w.rate)))
  }
}

/** Paso alto a `fc` Hz (dos polos, Butterworth): lo que suena en el altavoz de un móvil. */
export function phoneBand(ch: Float32Array[], rate: number, fc = 300): Float32Array[] {
  const w = Math.tan((Math.PI * fc) / rate)
  const q = Math.SQRT1_2
  const a0 = 1 + w / q + w * w
  const b = [1 / a0, -2 / a0, 1 / a0]
  const a1 = (2 * (w * w - 1)) / a0
  const a2 = (1 - w / q + w * w) / a0
  return ch.map((x) => {
    const y = new Float32Array(x.length)
    let x1 = 0
    let x2 = 0
    let y1 = 0
    let y2 = 0
    for (let i = 0; i < x.length; i++) {
      const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a1 * y1 - a2 * y2
      x2 = x1
      x1 = x[i]
      y2 = y1
      y1 = v
      y[i] = v
    }
    return y
  })
}

/** Nivel (dB RMS, canales sumados) de `ch` en [a, b) s. */
export function levelDb(ch: Float32Array[], rate: number, a: number, b: number): number {
  const i0 = Math.max(0, Math.round(a * rate))
  const i1 = Math.min(ch[0].length, Math.round(b * rate))
  let e = 0
  for (const c of ch) for (let i = i0; i < i1; i++) e += c[i] * c[i]
  return 10 * Math.log10(e / Math.max(1, (i1 - i0) * ch.length) + 1e-12)
}

export interface HitCheck {
  t: number
  label: string
  /** dB por encima de 300 Hz: de 300 a 50 ms antes del golpe, los 250 ms después y los 350 ms siguientes (las ventanas
   *  del crítico). */
  before: number
  after: number
  after2: number
  /** after − before (lo que sube el golpe en un móvil). */
  rise: number
}

/** La prueba del móvil: cuánto sube cada golpe por encima de 300 Hz y la sonoridad de cada sección en esa banda. */
export function phoneCheck(ch: Float32Array[], rate: number, hits: { t: number; label: string }[], sections: { t: number; end: number; label: string }[]): { hits: HitCheck[]; sections: { label: string; t: number; lufs: number }[] } {
  const hp = phoneBand(ch, rate)
  return {
    hits: hits.map(({ t, label }) => {
      const before = levelDb(hp, rate, t - 0.3, t - 0.05)
      const after = levelDb(hp, rate, t, t + 0.25)
      const after2 = levelDb(hp, rate, t + 0.25, t + 0.6)
      return { t, label, before: +before.toFixed(1), after: +after.toFixed(1), after2: +after2.toFixed(1), rise: +(after - before).toFixed(1) }
    }),
    sections: sections.map(({ t, end, label }) => ({ label, t, lufs: +integratedLoudness(hp.map((c) => c.subarray(Math.round(t * rate), Math.round(end * rate))), rate).toFixed(1) }))
  }
}
