// Rejilla de pulsos y compases de una pista real (puro, determinista): tempo afinado a la centésima de BPM, primer pulso,
// primer tiempo fuerte (el compás empieza donde cambia la armonía), y por compás la energía, los graves y la novedad
// (para encontrar las secciones). Tempo constante: los temas producidos en un DAW lo tienen.
import { hannWindow, magnitudes } from './fft.ts'

export interface BarInfo {
  bar: number
  /** Inicio del compás (s, en la pista). */
  t: number
  rmsDb: number
  lowDb: number
  /** Cambio de timbre respecto al compás anterior (0…1, relativo al máximo). */
  novelty: number
}

export interface TrackGrid {
  bpm: number
  /** Duración de un pulso (s). */
  beat: number
  beatsPerBar: number
  /** Primer pulso (s) ≥ 0. */
  firstBeat: number
  /** Primer tiempo fuerte (s): inicio del compás 1. */
  downbeat: number
  duration: number
  /** Primer sonido (s): antes, silencio digital. */
  firstSound: number
  /** Último sonido (s): lo que sigue es silencio. */
  lastSound: number
  /** Fuerza de la rejilla: pico del plegado frente a la media (≥ 3 es una rejilla clara). */
  confidence: number
  bars: BarInfo[]
  /** Compases donde empieza una sección (los graves cambian y se mantienen: respiro, vuelta, cierre). */
  sections: number[]
}

const N = 2048
const HOP = 480
const BANDS = 24

interface Features {
  rate: number
  frames: number
  hopS: number
  /** Retraso de la ventana: un ataque sube el flujo cuando entra en su parte final (medido: 0,75 de la ventana). */
  lag: number
  onset: Float64Array
  low: Float64Array
  rms: Float64Array
  lowE: Float64Array
  bands: Float64Array[]
}

function features(x: Float32Array, rate: number): Features {
  const hop = Math.round((HOP * rate) / 48000)
  const frames = Math.max(1, Math.floor((x.length - N) / hop))
  const hann = hannWindow(N)
  const binHz = rate / N
  const lowTop = Math.ceil(150 / binHz)
  // bandas logarítmicas de 40 Hz a 16 kHz
  const edges = Array.from({ length: BANDS + 1 }, (_, i) => Math.round((40 * Math.pow(16000 / 40, i / BANDS)) / binHz))
  const onset = new Float64Array(frames)
  const low = new Float64Array(frames)
  const rms = new Float64Array(frames)
  const lowE = new Float64Array(frames)
  const bands: Float64Array[] = []
  let prev: Float64Array | null = null
  for (let f = 0; f < frames; f++) {
    const start = f * hop
    const mag = magnitudes(x, start, N, hann)
    const logm = mag.map((m) => Math.log1p(100 * m))
    let flux = 0
    let lflux = 0
    if (prev) {
      for (let k = 1; k < logm.length; k++) {
        const d = logm[k] - prev[k]
        if (d > 0) {
          flux += d
          if (k <= lowTop) lflux += d
        }
      }
    }
    onset[f] = flux
    low[f] = lflux
    let s = 0
    for (let i = start; i < start + hop; i++) s += x[i] * x[i]
    rms[f] = s / hop
    let le = 0
    for (let k = 1; k <= lowTop; k++) le += mag[k] * mag[k]
    lowE[f] = le
    const b = new Float64Array(BANDS)
    for (let j = 0; j < BANDS; j++) {
      let acc = 0
      const a = Math.max(1, edges[j])
      const z = Math.max(a + 1, edges[j + 1])
      for (let k = a; k < z && k < logm.length; k++) acc += logm[k]
      b[j] = acc / (z - a)
    }
    bands.push(b)
    prev = logm
  }
  // envolvente de ataques: menos su media local (medio segundo) y solo lo positivo
  const w = Math.round((0.5 * rate) / hop)
  const env = new Float64Array(frames)
  let acc = 0
  for (let f = 0; f < frames; f++) {
    acc += onset[f]
    if (f >= w) acc -= onset[f - w]
    const mean = acc / Math.min(f + 1, w)
    env[f] = Math.max(0, onset[f] - mean)
  }
  return { rate, frames, hopS: hop / rate, lag: (0.75 * N) / rate, onset: env, low, rms, lowE, bands }
}

/** Plegado de los ataques sobre el periodo: devuelve el mejor desfase y su fuerza. */
function fold(ft: Features, period: number, bins: number, src: Float64Array = ft.onset): { score: number; phase: number; mean: number } {
  const acc = new Float64Array(bins)
  for (let f = 0; f < ft.frames; f++) {
    const v = src[f]
    if (v <= 0) continue
    const t = f * ft.hopS + ft.lag
    const ph = (t % period) / period
    acc[Math.floor(ph * bins) % bins] += v
  }
  // suavizado circular de 3 casillas
  let best = 0
  let bi = 0
  let sum = 0
  for (let i = 0; i < bins; i++) {
    const s = acc[(i - 1 + bins) % bins] + acc[i] + acc[(i + 1) % bins]
    sum += acc[i]
    if (s > best) {
      best = s
      bi = i
    }
  }
  return { score: best, phase: ((bi + 0.5) / bins) * period, mean: (3 * sum) / bins }
}

export function analyzeTrack(x: Float32Array, rate: number, opts: { minBpm?: number; maxBpm?: number; beatsPerBar?: number } = {}): TrackGrid {
  const ft = features(x, rate)
  const minBpm = opts.minBpm ?? 95
  const maxBpm = opts.maxBpm ?? 140
  const beatsPerBar = opts.beatsPerBar ?? 4
  // 1) tempo: el plegado más afilado, primero a 0,05 BPM y luego a 0,002
  let bestBpm = minBpm
  let bestScore = -1
  for (let bpm = minBpm; bpm <= maxBpm + 1e-9; bpm += 0.05) {
    const s = fold(ft, 60 / bpm, 96).score
    if (s > bestScore) {
      bestScore = s
      bestBpm = bpm
    }
  }
  let fine = bestBpm
  let fineScore = -1
  for (let bpm = bestBpm - 0.06; bpm <= bestBpm + 0.06; bpm += 0.002) {
    const s = fold(ft, 60 / bpm, 256).score
    if (s > fineScore) {
      fineScore = s
      fine = bpm
    }
  }
  const beat = 60 / fine
  const f = fold(ft, beat, 512)
  // pulso o contratiempo: el pulso es donde pega el bombo; si los graves marcan una rejilla clara, mandan ellos (los
  // platos del contratiempo pueden pesar más en el plegado general)
  const lowF = fold(ft, beat, 512, ft.low)
  const firstBeat = (lowF.score / Math.max(1e-9, lowF.mean) >= 3 ? lowF.phase : f.phase) % beat
  const duration = x.length / rate
  // 2) tiempo fuerte: el desfase (de los 4) en el que más cambia el timbre de un pulso al siguiente
  const nBeats = Math.floor((duration - firstBeat) / beat)
  const spec: Float64Array[] = []
  for (let n = 0; n < nBeats; n++) {
    const a = Math.max(0, Math.floor((firstBeat + n * beat - ft.lag) / ft.hopS))
    const z = Math.min(ft.frames, Math.floor((firstBeat + (n + 1) * beat - ft.lag) / ft.hopS))
    const s = new Float64Array(BANDS)
    for (let k = a; k < z; k++) for (let j = 0; j < BANDS; j++) s[j] += ft.bands[k][j] / Math.max(1, z - a)
    spec.push(s)
  }
  const change = spec.map((s, n) => (n === 0 ? 0 : s.reduce((acc, v, j) => acc + Math.abs(v - spec[n - 1][j]), 0)))
  const phaseScore = Array.from({ length: beatsPerBar }, (_, k) => {
    let s = 0
    let c = 0
    for (let n = k; n < change.length; n += beatsPerBar) {
      s += change[n]
      c++
    }
    return c ? s / c : 0
  })
  const k = phaseScore.indexOf(Math.max(...phaseScore))
  const downbeat = firstBeat + k * beat
  // 3) compases: energía, graves y novedad (diferencia de timbre con el compás anterior)
  const barDur = beat * beatsPerBar
  const bars: BarInfo[] = []
  let prevSpec: Float64Array | null = null
  const novel: number[] = []
  for (let b = 1; downbeat + (b - 1) * barDur < duration; b++) {
    const t = downbeat + (b - 1) * barDur
    const a = Math.max(0, Math.floor((t - ft.lag) / ft.hopS))
    const z = Math.min(ft.frames, Math.floor((t + barDur - ft.lag) / ft.hopS))
    let e = 0
    let le = 0
    const s = new Float64Array(BANDS)
    for (let q = a; q < z; q++) {
      e += ft.rms[q]
      le += ft.lowE[q]
      for (let j = 0; j < BANDS; j++) s[j] += ft.bands[q][j]
    }
    const len = Math.max(1, z - a)
    for (let j = 0; j < BANDS; j++) s[j] /= len
    const nov = prevSpec ? s.reduce((acc, v, j) => acc + Math.abs(v - prevSpec![j]), 0) : 0
    novel.push(nov)
    prevSpec = s
    bars.push({ bar: b, t, rmsDb: 10 * Math.log10(e / len + 1e-12), lowDb: 10 * Math.log10(le / len + 1e-12), novelty: nov })
  }
  // el compás 1 es el primero que suena (algunos temas traen segundos de silencio delante)
  let silent = 0
  while (silent < bars.length - 1 && bars[silent].rmsDb < -60) silent++
  if (silent) {
    bars.splice(0, silent)
    novel.splice(0, silent)
    novel[0] = 0
    bars[0].novelty = 0
    bars.forEach((b, i) => (b.bar = i + 1))
  }
  const downbeat1 = downbeat + silent * barDur
  let firstSound = 0
  while (firstSound < x.length && Math.abs(x[firstSound]) < 1e-4) firstSound++
  const maxNov = Math.max(1e-9, ...novel)
  for (const b of bars) b.novelty = +(b.novelty / maxNov).toFixed(3)
  // 4) límites de sección, compás a compás: donde los graves cambian más de 2,5 dB y el cambio se mantiene en el compás
  //    siguiente (un respiro, una vuelta, el cierre); no hace falta que caigan en múltiplos de 4
  const low = bars.map((b) => b.lowDb)
  const sections = bars
    .filter((b, i) => i > 0 && i + 1 < bars.length && low[i] > -60 && low[i - 1] > -60 && Math.abs(low[i] - low[i - 1]) > 2.5 && Math.abs(low[i + 1] - low[i]) < 1.5)
    .map((b) => b.bar)
  // último sonido (s): después, silencio digital (la película acaba poco después, no en el final del archivo)
  let lastSound = x.length - 1
  while (lastSound > 0 && Math.abs(x[lastSound]) < 1e-3) lastSound--
  return {
    bpm: +fine.toFixed(3),
    beat,
    beatsPerBar,
    firstBeat,
    downbeat: downbeat1,
    firstSound: firstSound / rate,
    lastSound: lastSound / rate,
    duration,
    confidence: +(f.score / Math.max(1e-9, f.mean)).toFixed(2),
    bars,
    sections
  }
}
