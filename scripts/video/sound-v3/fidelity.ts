// Compara una banda sonora generada con la de referencia (p. ej. el audio de aula-intro-web.mp4 del v3): desfase,
// correlación de la forma de onda y de la envolvente, espectro por bandas, sonoridad y el instante de cada golpe.
//   node scripts/video/sound-v3/fidelity.ts <nuestra.wav> <referencia.wav|.mp4> [--hits v3.timeline.json] [--png lámina.png] [--json informe.json]
// Un .mp4 se decodifica con CoreAudio (afconvert) en la caché, fuera del repositorio.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { hannWindow, magnitudes } from '../audio/fft.ts'
import { integratedLoudness, truePeak } from '../audio/loudness.ts'
import { readWav } from '../audio/track.ts'
import { profile } from '../sound/profile.ts'
import { hex, Raster } from '../sound/raster.ts'

export function load(file: string): { rate: number; channels: Float32Array[] } {
  if (!/\.(mp4|m4a|mov)$/i.test(file)) return readWav(readFileSync(file))
  const dir = join(process.env.VT_CACHE || join(tmpdir(), 'aula-video-cache'), 'fidelity')
  mkdirSync(dir, { recursive: true })
  const wav = join(dir, basename(file).replace(/\.\w+$/, '') + '.wav')
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEF32@48000', file, wav], { stdio: 'pipe' })
  return readWav(readFileSync(wav))
}

const mono = (ch: Float32Array[]) => ch[0].map((v, i) => (v + (ch[1] ?? ch[0])[i]) * 0.5)

/** Envolvente RMS cada `hop` muestras. */
function env(x: Float32Array, hop: number): Float64Array {
  const out = new Float64Array(Math.floor(x.length / hop))
  for (let k = 0; k < out.length; k++) {
    let e = 0
    for (let i = k * hop; i < (k + 1) * hop; i++) e += x[i] * x[i]
    out[k] = Math.sqrt(e / hop)
  }
  return out
}

function corr(a: ArrayLike<number>, b: ArrayLike<number>, lag = 0): number {
  let sab = 0
  let saa = 0
  let sbb = 0
  let ma = 0
  let mb = 0
  const n = Math.min(a.length, b.length - lag)
  for (let i = Math.max(0, -lag); i < n; i++) {
    ma += a[i]
    mb += b[i + lag]
  }
  const cnt = n - Math.max(0, -lag)
  ma /= cnt
  mb /= cnt
  for (let i = Math.max(0, -lag); i < n; i++) {
    const x = a[i] - ma
    const y = b[i + lag] - mb
    sab += x * y
    saa += x * x
    sbb += y * y
  }
  return sab / Math.sqrt(saa * sbb)
}

/** Desfase (muestras) de `b` respecto a `a`: el máximo de la correlación de envolventes (1 ms) y luego fino (muestras). */
export function offset(a: Float32Array, b: Float32Array, rate: number): number {
  const hop = rate / 1000
  const ea = env(a, hop)
  const eb = env(b, hop)
  let best = -2
  let lag = 0
  for (let l = -200; l <= 200; l++) {
    const c = corr(ea, eb, l)
    if (c > best) [best, lag] = [c, l]
  }
  // fino: correlación de muestras en ±2 ms alrededor (sobre 20 s)
  const seg = (x: Float32Array, s: number) => x.subarray(s, s + 20 * rate)
  let fine = lag * hop
  let bestF = -2
  for (let l = lag * hop - 2 * hop; l <= lag * hop + 2 * hop; l++) {
    const s = 30 * rate
    const c = corr(seg(a, s), b.subarray(s + l, s + l + 20 * rate))
    if (c > bestF) [bestF, fine] = [c, l]
  }
  return fine
}

function lowpass(x: Float32Array, fc: number, rate: number): Float32Array {
  const a = 1 - Math.exp((-2 * Math.PI * fc) / rate)
  const y = new Float32Array(x.length)
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < x.length; i++) {
    s1 += a * (x[i] - s1)
    s2 += a * (s1 - s2)
    y[i] = s2
  }
  return y
}

/** Ataque medido cerca de t (s): la mayor subida de la envolvente de 1 ms en ±80 ms. */
function hitNear(e: Float64Array, t: number): number {
  const k0 = Math.round(t * 1000)
  let best = -Infinity
  let at = k0
  for (let k = Math.max(3, k0 - 80); k <= Math.min(e.length - 4, k0 + 80); k++) {
    const d = e[k + 1] + e[k + 2] + e[k + 3] - e[k - 1] - e[k - 2] - e[k - 3]
    if (d > best) [best, at] = [d, k]
  }
  return at / 1000
}

export interface Fidelity {
  offsetMs: number
  seconds: [number, number]
  lufs: [number, number]
  truePeak: [number, number]
  gainDb: number
  waveformCorrelation: number
  waveformCorrelationBelow4k: number
  envelopeCorrelation: number
  bands: Record<string, [number, number]>
  centroid: [number, number]
  hits: { t: number; label: string; ours: number; ref: number; deltaMs: number }[]
}

export function compare(ours: { rate: number; channels: Float32Array[] }, ref: { rate: number; channels: Float32Array[] }, hits: { t: number; label: string }[] = []): Fidelity {
  const R = ours.rate
  const a = mono(ours.channels)
  const b0 = mono(ref.channels)
  const off = offset(a, b0, R)
  // la referencia alineada con la nuestra
  const b = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) b[i] = b0[i + off] ?? 0
  const refAligned = ref.channels.map((c) => {
    const y = new Float32Array(a.length)
    for (let i = 0; i < a.length; i++) y[i] = c[i + off] ?? 0
    return y
  })
  const pa = profile(ours.channels, R)
  const pb = profile(refAligned, R)
  const ea = env(a, R / 1000)
  const eb = env(b, R / 1000)
  const e10a = env(a, R / 100)
  const e10b = env(b, R / 100)
  const la = integratedLoudness(ours.channels, R)
  const lb = integratedLoudness(refAligned, R)
  // forma de onda: con la ganancia igualada (la sonoridad), en todo el espectro y por debajo de 4 kHz
  const g = Math.pow(10, (la - lb) / 20)
  const bg = b.map((v) => v * g)
  const bands: Fidelity['bands'] = {}
  for (const k of Object.keys(pa.bands)) bands[k] = [pa.bands[k], pb.bands[k]]
  return {
    offsetMs: +((off / R) * 1000).toFixed(2),
    seconds: [+(a.length / R).toFixed(2), +(b0.length / R).toFixed(2)],
    lufs: [+la.toFixed(2), +lb.toFixed(2)],
    truePeak: [+truePeak(ours.channels).toFixed(2), +truePeak(refAligned).toFixed(2)],
    gainDb: +(la - lb).toFixed(2),
    waveformCorrelation: +corr(a, bg).toFixed(4),
    waveformCorrelationBelow4k: +corr(lowpass(a, 4000, R), lowpass(bg, 4000, R)).toFixed(4),
    envelopeCorrelation: +corr(e10a, e10b).toFixed(4),
    bands,
    centroid: [pa.centroid, pb.centroid],
    hits: hits.map(({ t, label }) => {
      const x = hitNear(ea, t)
      const y = hitNear(eb, t)
      return { t, label, ours: +x.toFixed(3), ref: +y.toFixed(3), deltaMs: +((y - x) * 1000).toFixed(1) }
    })
  }
}

/** Lámina: los dos espectrogramas (arriba el nuestro, abajo la referencia) y sus envolventes superpuestas. */
export function fidelityPng(ours: { rate: number; channels: Float32Array[] }, ref: { rate: number; channels: Float32Array[] }, offSamples: number, title: string): Buffer {
  const R = ours.rate
  const a = mono(ours.channels)
  const b0 = mono(ref.channels)
  const b = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) b[i] = b0[i + offSamples] ?? 0
  const secs = a.length / R
  const pps = Math.max(12, Math.min(40, 2200 / secs))
  const cols = Math.ceil(secs * pps)
  const left = 120
  const specH = 260
  const W = left + cols + 20
  const H = 60 + 2 * (specH + 40) + 160
  const r = new Raster(W, H, hex('#fcfcfb'))
  const ramp = ['#fcfcfb', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'].map(hex)
  const col = (v: number) => {
    const x = Math.max(0, Math.min(1, v)) * (ramp.length - 1)
    const i = Math.min(ramp.length - 2, Math.floor(x))
    const f = x - i
    return [0, 1, 2].map((k) => ramp[i][k] + (ramp[i + 1][k] - ramp[i][k]) * f) as [number, number, number]
  }
  const n = 2048
  const hann = hannWindow(n)
  r.text(left, 16, title, hex('#0b0b0b'), 2)
  const draw = (x: Float32Array, y0: number, label: string) => {
    r.text(8, y0 + specH / 2 - 7, label, hex('#0b0b0b'), 2)
    const rows = Array.from({ length: specH }, (_, y) => (30 * Math.pow(16000 / 30, 1 - y / (specH - 1)) * n) / R)
    const spec: number[][] = []
    let max = -Infinity
    for (let c = 0; c < cols; c++) {
      const m = magnitudes(x, Math.max(0, Math.round((c / pps) * R) - n / 2), n, hann)
      const colv = rows.map((bb) => 20 * Math.log10((m[Math.floor(bb)] ?? 0) + 1e-9))
      for (const v of colv) max = Math.max(max, v)
      spec.push(colv)
    }
    for (let c = 0; c < cols; c++) for (let y = 0; y < specH; y++) r.px(left + c, y0 + y, col((spec[c][y] - (max - 70)) / 70))
  }
  draw(a, 50, 'ours')
  draw(b, 50 + specH + 40, 'v3 ref')
  // envolventes (10 ms, dB) superpuestas
  const yE = 50 + 2 * (specH + 40)
  const e1 = env(a, R / 100)
  const e2 = env(b, R / 100)
  const toY = (v: number) => yE + 130 * (1 - Math.max(0, 1 + (20 * Math.log10(v + 1e-9)) / 50))
  r.text(8, yE + 58, 'envelope', hex('#0b0b0b'), 2)
  for (let c = 0; c < cols; c++) {
    const k = Math.floor((c / pps) * 100)
    r.px(left + c, toY(e2[k] ?? 0), hex('#eb6834'))
    r.px(left + c, toY(e1[k] ?? 0), hex('#2a78d6'))
  }
  r.text(left, yE + 140, 'blue = ours (sound-v3 adapter, v3 timeline) · orange = v3 reference (aula-intro-web.mp4, AAC 64 kb/s), aligned', hex('#52514e'), 2)
  return r.png()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined)
  const [oursF, refF] = args.filter((x, i) => !x.startsWith('--') && !['--hits', '--png', '--json'].includes(args[i - 1]))
  const ours = load(oursF)
  const ref = load(refF)
  let hits: { t: number; label: string }[] = []
  const tlF = opt('--hits')
  if (tlF) {
    const tl = JSON.parse(readFileSync(tlF, 'utf8'))
    const bar = 240 / tl.bpm
    hits = [
      { t: tl.meet, label: 'meet' },
      ...tl.chapters.map((c: { bar: number; textAt: number; n: number }) => ({ t: c.bar * bar + c.textAt, label: `card ${c.n}` })),
      ...tl.clicks.map((t: number) => ({ t, label: 'click' })),
      ...tl.iconWaves.map((t: number) => ({ t, label: 'icons' })),
      { t: tl.logo, label: 'logo' }
    ]
  }
  const res = compare(ours, ref, hits)
  console.log(JSON.stringify(res, null, 1))
  const json = opt('--json')
  if (json) writeFileSync(json, JSON.stringify(res, null, 1) + '\n')
  const png = opt('--png')
  if (png) writeFileSync(png, fidelityPng(ours, ref, Math.round((res.offsetMs / 1000) * ours.rate), `Aula · v3 soundtrack fidelity · offset ${res.offsetMs} ms · envelope r = ${res.envelopeCorrelation} · waveform r = ${res.waveformCorrelation}`))
}
