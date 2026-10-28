// Sonoridad según ITU-R BS.1770-4 / EBU R128 (LUFS integrados con puertas), pico verdadero (sobremuestreo ×4) y un
// limitador con anticipación. Puro e isomorfo: lo usan la página del compositor y las pruebas.

/** Filtro bicuadrático (forma directa I). */
function biquad(x: Float32Array, b: number[], a: number[]): Float32Array {
  const y = new Float32Array(x.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let n = 0; n < x.length; n++) {
    const v = b[0] * x[n] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2
    x2 = x1
    x1 = x[n]
    y2 = y1
    y1 = v
    y[n] = v
  }
  return y
}

/** Coeficientes de la ponderación K para cualquier frecuencia (derivados como en libebur128). */
function kWeighting(rate: number): { shelf: [number[], number[]]; hp: [number[], number[]] } {
  let f0 = 1681.974450955533
  const G = 3.999843853973347
  let Q = 0.7071752369554196
  let K = Math.tan((Math.PI * f0) / rate)
  const Vh = Math.pow(10, G / 20)
  const Vb = Math.pow(Vh, 0.4996667741545416)
  let a0 = 1 + K / Q + K * K
  const shelf: [number[], number[]] = [
    [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]
  ]
  f0 = 38.13547087602444
  Q = 0.5003270373238773
  K = Math.tan((Math.PI * f0) / rate)
  a0 = 1 + K / Q + K * K
  const hp: [number[], number[]] = [
    [1, -2, 1],
    [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]
  ]
  return { shelf, hp }
}

/** Sonoridad integrada en LUFS (canales L/R con peso 1). */
export function integratedLoudness(channels: Float32Array[], rate: number): number {
  const { shelf, hp } = kWeighting(rate)
  const weighted = channels.map((c) => biquad(biquad(c, shelf[0], shelf[1]), hp[0], hp[1]))
  const block = Math.round(0.4 * rate)
  const step = Math.round(0.1 * rate)
  const len = weighted[0].length
  const powers: number[] = []
  for (let start = 0; start + block <= len; start += step) {
    let sum = 0
    for (const w of weighted) {
      let s = 0
      for (let i = start; i < start + block; i++) s += w[i] * w[i]
      sum += s / block
    }
    powers.push(sum)
  }
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p)
  const abs = powers.filter((p) => lufs(p) > -70)
  if (!abs.length) return -Infinity
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const relGate = lufs(mean(abs)) - 10
  const rel = abs.filter((p) => lufs(p) > relGate)
  return lufs(mean(rel))
}

const OS = 4
const TAPS_PER_PHASE = 24
/** Núcleo sinc con ventana de Kaiser para sobremuestrear ×4 (fases separadas). */
const PHASES: Float32Array[] = (() => {
  const half = (TAPS_PER_PHASE * OS) / 2
  const bessel = (x: number) => {
    let s = 1
    let t = 1
    for (let k = 1; k < 25; k++) {
      t *= (x / (2 * k)) ** 2
      s += t
    }
    return s
  }
  const beta = 8
  const phases = Array.from({ length: OS }, () => new Float32Array(TAPS_PER_PHASE))
  for (let i = 0; i < TAPS_PER_PHASE * OS; i++) {
    const n = i - half
    const x = n / OS
    const sinc = n === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
    const r = n / half
    const w = Math.abs(r) <= 1 ? bessel(beta * Math.sqrt(1 - r * r)) / bessel(beta) : 0
    phases[((i % OS) + OS) % OS][Math.floor(i / OS)] = sinc * w
  }
  return phases
})()

/** Pico verdadero en dBTP (máximo de la señal sobremuestreada ×4). */
export function truePeak(channels: Float32Array[]): number {
  let max = 0
  for (const x of channels) {
    for (let n = 0; n < x.length; n++) {
      const s = Math.abs(x[n])
      if (s > max) max = s
    }
    for (let n = TAPS_PER_PHASE; n < x.length; n++) {
      for (let p = 1; p < OS; p++) {
        const h = PHASES[p]
        let acc = 0
        for (let k = 0; k < TAPS_PER_PHASE; k++) acc += h[k] * x[n - k]
        const a = Math.abs(acc)
        if (a > max) max = a
      }
    }
  }
  return 20 * Math.log10(max || 1e-12)
}

export function samplePeak(channels: Float32Array[]): number {
  let max = 0
  for (const x of channels) for (let n = 0; n < x.length; n++) max = Math.max(max, Math.abs(x[n]))
  return 20 * Math.log10(max || 1e-12)
}

function applyGain(channels: Float32Array[], db: number): void {
  const g = Math.pow(10, db / 20)
  for (const c of channels) for (let i = 0; i < c.length; i++) c[i] *= g
}

/** Limitador con anticipación (enlazado en estéreo): ninguna muestra pasa de `ceilingDb`. Sin escalones (que suenan como
 *  un clic) ni bombeo: la ganancia baja en rampa durante la anticipación (mínimo deslizante + media de la misma ventana,
 *  así el pico queda justo debajo del techo) y vuelve despacio (`releaseS`). */
export function limit(channels: Float32Array[], rate: number, ceilingDb: number, lookS = 0.008, releaseS = 0.25): void {
  const ceiling = Math.pow(10, ceilingDb / 20)
  const len = channels[0].length
  const look = Math.max(1, Math.round(lookS * rate))
  const release = Math.exp(-1 / (releaseS * rate))
  const need = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    let peak = 0
    for (const c of channels) peak = Math.max(peak, Math.abs(c[i]))
    need[i] = peak > ceiling ? ceiling / peak : 1
  }
  // 1) mínimo de need en [i, i + look) con una cola monótona (O(n))
  const hold = new Float32Array(len)
  const q = new Int32Array(len)
  let head = 0
  let tail = 0
  let next = 0
  for (let i = 0; i < len; i++) {
    const end = Math.min(len, i + look)
    for (; next < end; next++) {
      while (tail > head && need[q[tail - 1]] >= need[next]) tail--
      q[tail++] = next
    }
    while (q[head] < i) head++
    hold[i] = need[q[head]]
  }
  // 2) media de hold en (i − look, i]: rampa suave que llega al valor necesario justo en el pico; 3) vuelta lenta
  const gain = new Float32Array(len)
  let acc = 0
  let g = 1
  for (let i = 0; i < len; i++) {
    acc += hold[i]
    if (i >= look) acc -= hold[i - look]
    const smooth = i >= look - 1 ? acc / look : Math.min(1, (acc + (look - 1 - i)) / look)
    // cada hold de la ventana ya es ≤ need[i], así que su media también: nunca pasa del techo
    const target = smooth
    g = target < g ? target : target + (g - target) * release
    gain[i] = g
  }
  for (const c of channels) for (let i = 0; i < len; i++) c[i] *= gain[i]
}

export interface MasterReport {
  lufs: number
  truePeak: number
  samplePeak: number
  gainDb: number
}

/** Lleva la mezcla a `targetLufs` con el pico verdadero por debajo de `tpCeiling` (iterando ganancia y limitador). */
export function master(channels: Float32Array[], rate: number, targetLufs = -14, tpCeiling = -1.5): MasterReport {
  let total = 0
  for (let pass = 0; pass < 4; pass++) {
    const l = integratedLoudness(channels, rate)
    const delta = targetLufs - l
    if (Math.abs(delta) < 0.05 && truePeak(channels) <= tpCeiling) break
    applyGain(channels, delta)
    total += delta
    limit(channels, rate, tpCeiling - 0.3 - pass * 0.3)
  }
  return { lufs: integratedLoudness(channels, rate), truePeak: truePeak(channels), samplePeak: samplePeak(channels), gainDb: total }
}
