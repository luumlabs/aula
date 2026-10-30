// Piezas de DSP para la banda sonora (Node, puro, sin dependencias): azar con semilla, osciladores con PolyBLEP, filtro
// de estado variable (TPT), buses estéreo, retardo ping-pong, reverberación FDN, saturación y seguidor de envolvente.
// Todo trabaja muestra a muestra sobre Float32Array a 48 kHz. Determinista: dos renders dan los mismos bytes.

export const SR = 48000

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x)
export const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12)
export const db = (x: number): number => Math.pow(10, x / 20)

/** Generador con semilla (mulberry32) en [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Ruido blanco en [−1, 1) con su propia semilla (cada nota tiene el suyo: el orden de render no cambia el sonido). */
export function noise(seed: number): () => number {
  const r = rng(seed)
  return () => 2 * r() - 1
}

/** Bus estéreo. */
export class Stereo {
  L: Float32Array
  R: Float32Array
  constructor(n: number) {
    this.L = new Float32Array(n)
    this.R = new Float32Array(n)
  }
  get length(): number {
    return this.L.length
  }
}

/** Ganancias de paneo de potencia constante, normalizadas para que el centro valga 1 en cada canal. */
export function panGains(pan: number): [number, number] {
  const a = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4
  return [Math.cos(a) * Math.SQRT2, Math.sin(a) * Math.SQRT2]
}

/** Suma una señal mono en un bus desde la muestra i0, con ganancia y paneo (opcionalmente un paneo que se mueve). */
export function mixMono(dst: Stereo, src: Float32Array, i0: number, gain: number, pan: number, panTo?: number): void {
  const n = dst.L.length
  const a = Math.max(0, -i0)
  const b = Math.min(src.length, n - i0)
  if (b <= a) return
  if (panTo === undefined || panTo === pan) {
    const [gl, gr] = panGains(pan)
    const l = gl * gain
    const r = gr * gain
    for (let k = a; k < b; k++) {
      const v = src[k]
      dst.L[i0 + k] += v * l
      dst.R[i0 + k] += v * r
    }
    return
  }
  for (let k = a; k < b; k++) {
    const p = pan + (panTo - pan) * (k / src.length)
    const [gl, gr] = panGains(p)
    const v = src[k] * gain
    dst.L[i0 + k] += v * gl
    dst.R[i0 + k] += v * gr
  }
}

/** Suma dos señales (izquierda y derecha) en un bus. */
export function mixStereo(dst: Stereo, l: Float32Array, r: Float32Array, i0: number, gain: number): void {
  const n = dst.L.length
  const a = Math.max(0, -i0)
  const b = Math.min(l.length, n - i0)
  for (let k = a; k < b; k++) {
    dst.L[i0 + k] += l[k] * gain
    dst.R[i0 + k] += r[k] * gain
  }
}

export function addInto(dst: Stereo, src: Stereo, gain = 1): void {
  for (let i = 0; i < dst.L.length; i++) {
    dst.L[i] += src.L[i] * gain
    dst.R[i] += src.R[i] * gain
  }
}

export function scale(s: Stereo, gain: number): void {
  for (let i = 0; i < s.L.length; i++) {
    s.L[i] *= gain
    s.R[i] *= gain
  }
}

/** Corrección de PolyBLEP para un diente de sierra (fase en [0, 1), incremento dt). */
export function blep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt
    return x + x - x * x - 1
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt
    return x * x + x + x + 1
  }
  return 0
}

/** Filtro de estado variable (Cytomic, trapezoidal): estable con el corte moviéndose. Salidas lp, bp, hp. */
export class Svf {
  private ic1 = 0
  private ic2 = 0
  private a1 = 0
  private a2 = 0
  private a3 = 0
  private k = 1
  lp = 0
  bp = 0
  hp = 0
  constructor(fc = 1000, q = 0.707) {
    this.set(fc, q)
  }
  set(fc: number, q: number): void {
    const g = Math.tan((Math.PI * clamp(fc, 10, SR * 0.47)) / SR)
    this.k = 1 / q
    this.a1 = 1 / (1 + g * (g + this.k))
    this.a2 = g * this.a1
    this.a3 = g * this.a2
  }
  tick(x: number): void {
    const v3 = x - this.ic2
    const v1 = this.a1 * this.ic1 + this.a2 * v3
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3
    this.ic1 = 2 * v1 - this.ic1
    this.ic2 = 2 * v2 - this.ic2
    this.lp = v2
    this.bp = v1
    this.hp = x - this.k * v1 - v2
  }
}

/** Filtro de un polo (paso bajo); `hp()` da el complementario. */
export class OnePole {
  private y = 0
  private a: number
  constructor(fc: number) {
    this.a = 1 - Math.exp((-2 * Math.PI * fc) / SR)
  }
  lp(x: number): number {
    this.y += this.a * (x - this.y)
    return this.y
  }
  hp(x: number): number {
    return x - this.lp(x)
  }
}

/** Paso alto de un polo sobre un bus entero (quita la continua y lo más grave). */
export function highpass(s: Stereo, fc: number): void {
  for (const ch of [s.L, s.R]) {
    const f = new OnePole(fc)
    for (let i = 0; i < ch.length; i++) ch[i] = f.hp(ch[i])
  }
}

/** Paso bajo resonante cuyo corte cambia con el tiempo (`cutoff(t)` en Hz, evaluado cada 16 muestras). */
export function sweepLowpass(s: Stereo, cutoff: (t: number) => number, q = 0.75): void {
  for (const ch of [s.L, s.R]) {
    const f = new Svf(cutoff(0), q)
    for (let i = 0; i < ch.length; i++) {
      if ((i & 15) === 0) f.set(cutoff(i / SR), q)
      f.tick(ch[i])
      ch[i] = f.lp
    }
  }
}

/** Estantería grave/aguda sencilla (EQ de mezcla): +gLow dB por debajo de fLow y +gHigh dB por encima de fHigh. */
export function tilt(s: Stereo, fLow: number, gLow: number, fHigh: number, gHigh: number): void {
  const kl = db(gLow) - 1
  const kh = db(gHigh) - 1
  for (const ch of [s.L, s.R]) {
    const lo = new OnePole(fLow)
    const hi = new OnePole(fHigh)
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i]
      const l = lo.lp(x)
      const h = x - hi.lp(x)
      ch[i] = x + kl * l + kh * h
    }
  }
}

/** Saturación suave (tanh) con la ganancia compensada para señales pequeñas. */
export function saturate(s: Stereo, drive: number): void {
  const k = 1 / Math.tanh(drive)
  for (const ch of [s.L, s.R]) for (let i = 0; i < ch.length; i++) ch[i] = Math.tanh(ch[i] * drive) * k
}

/** Eco ping-pong con filtro en la realimentación (como el v3): `time` en s. */
export function pingPong(src: Stereo, dst: Stereo, time: number, feedback: number, wet: number, damp = 0.45): void {
  const d = Math.max(1, Math.round(time * SR))
  const bl = new Float32Array(d)
  const br = new Float32Array(d)
  let p = 0
  let lpL = 0
  let lpR = 0
  for (let i = 0; i < src.L.length; i++) {
    const yl = bl[p]
    const yr = br[p]
    lpL += damp * (yl - lpL)
    lpR += damp * (yr - lpR)
    bl[p] = (src.L[i] + src.R[i]) * 0.5 + lpR * feedback
    br[p] = lpL * feedback
    dst.L[i] += yl * wet
    dst.R[i] += yr * wet
    p++
    if (p >= d) p = 0
  }
}

/** Reverberación por red de retardos realimentada (8 líneas, matriz de Householder, amortiguación por línea, difusores a
 *  la entrada y un poco de modulación): una sala amplia y suave, sin el «metal» de los peines sueltos. */
export function fdnReverb(src: Stereo, opts: { rt60: number; size?: number; damp?: number; predelay?: number; width?: number }): Stereo {
  const n = src.L.length
  const size = opts.size ?? 1
  const out = new Stereo(n)
  const base = [1433, 1601, 1867, 2053, 2251, 2399, 2617, 2797].map((x) => Math.round(x * size * (SR / 48000)))
  const lines = base.map((len) => new Float32Array(len + 64))
  const pos = new Int32Array(8)
  const gains = base.map((len) => Math.pow(10, (-3 * len) / (opts.rt60 * SR)))
  const dampCoef = opts.damp ?? 0.35
  const lp = new Float64Array(8)
  // difusores (pasa-todo) a la entrada, distintos para cada canal
  const apLen = [[142, 107, 379, 277], [151, 113, 389, 293]].map((v) => v.map((x) => Math.round(x * size)))
  const ap = apLen.map((v) => v.map((len) => ({ buf: new Float32Array(len), p: 0 })))
  const pre = Math.max(1, Math.round((opts.predelay ?? 0.02) * SR))
  const preL = new Float32Array(pre)
  const preR = new Float32Array(pre)
  let pp = 0
  const width = opts.width ?? 1
  const x = new Float64Array(8)
  for (let i = 0; i < n; i++) {
    let inL = preL[pp]
    let inR = preR[pp]
    preL[pp] = src.L[i]
    preR[pp] = src.R[i]
    pp = (pp + 1) % pre
    for (let c = 0; c < 2; c++) {
      let v = c === 0 ? inL : inR
      for (const a of ap[c]) {
        const y = a.buf[a.p]
        const w = v + y * 0.6
        a.buf[a.p] = w
        v = y - w * 0.6
        a.p = (a.p + 1) % a.buf.length
      }
      if (c === 0) inL = v
      else inR = v
    }
    // salida de cada línea (dos con lectura modulada, interpolación lineal)
    let sum = 0
    for (let k = 0; k < 8; k++) {
      const buf = lines[k]
      const len = base[k]
      let rd: number
      if (k === 2 || k === 5) {
        const mod = 6 * Math.sin((2 * Math.PI * (0.31 + 0.07 * k) * i) / SR)
        const fp = pos[k] - len + mod
        const ip = Math.floor(fp)
        const fr = fp - ip
        const i1 = ((ip % buf.length) + buf.length) % buf.length
        const i2 = (i1 + 1) % buf.length
        rd = buf[i1] * (1 - fr) + buf[i2] * fr
      } else rd = buf[(pos[k] - len + buf.length) % buf.length]
      lp[k] += (1 - dampCoef) * (rd - lp[k])
      x[k] = lp[k] * gains[k]
      sum += x[k]
    }
    const h = (2 / 8) * sum
    let oL = 0
    let oR = 0
    for (let k = 0; k < 8; k++) {
      const fb = x[k] - h + (k % 2 === 0 ? inL : inR) * 0.5
      lines[k][pos[k]] = fb
      pos[k] = (pos[k] + 1) % lines[k].length
      const o = x[k]
      if (k % 2 === 0) oL += o * (k % 4 === 0 ? 1 : -1)
      else oR += o * (k % 4 === 1 ? 1 : -1)
    }
    const m = (oL + oR) * 0.5
    const sd = (oL - oR) * 0.5 * width
    out.L[i] = (m + sd) * 0.5
    out.R[i] = (m - sd) * 0.5
  }
  return out
}

/** Envolvente (pico con ataque y caída en s) de la suma de canales: para el ducking de la música bajo los efectos. */
export function envelope(s: Stereo, attack: number, release: number): Float32Array {
  const a = Math.exp(-1 / (attack * SR))
  const r = Math.exp(-1 / (release * SR))
  const out = new Float32Array(s.L.length)
  let e = 0
  for (let i = 0; i < out.length; i++) {
    const v = Math.max(Math.abs(s.L[i]), Math.abs(s.R[i]))
    e = v > e ? v + (e - v) * a : v + (e - v) * r
    out[i] = e
  }
  return out
}

/** Valor eficaz (RMS) de un bus en [a, b) s. */
export function rms(s: Stereo, a = 0, b = Infinity): number {
  const i0 = Math.max(0, Math.floor(a * SR))
  const i1 = Math.min(s.L.length, Math.floor(b * SR))
  let acc = 0
  for (let i = i0; i < i1; i++) acc += s.L[i] * s.L[i] + s.R[i] * s.R[i]
  return Math.sqrt(acc / Math.max(1, 2 * (i1 - i0)))
}

export function peak(s: Stereo): number {
  let m = 0
  for (let i = 0; i < s.L.length; i++) m = Math.max(m, Math.abs(s.L[i]), Math.abs(s.R[i]))
  return m
}
