// Instrumentos de síntesis para OfflineAudioContext (sin muestras). Cada función programa una nota en `t`.
// Todo el azar viene de un generador con semilla: dos renders suenan igual.

export interface Bus {
  ac: OfflineAudioContext
  /** Seco (va directo al máster). */
  dry: AudioNode
  /** Envío a la reverberación. */
  wet: AudioNode
  rand: () => number
}

export const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12)

function out(b: Bus, pan: number, send: number): GainNode {
  const g = b.ac.createGain()
  const p = b.ac.createStereoPanner()
  p.pan.value = Math.max(-1, Math.min(1, pan))
  g.connect(p)
  p.connect(b.dry)
  if (send > 0) {
    const s = b.ac.createGain()
    s.gain.value = send
    p.connect(s)
    s.connect(b.wet)
  }
  return g
}

/** Piano cálido: parciales algo inarmónicos que se apagan antes cuanto más agudos. */
export function piano(b: Bus, t: number, midi: number, vel: number, dur: number, pan = 0): void {
  const f = hz(midi)
  const o = out(b, pan, 0.35)
  const B = 0.00035
  const bright = 0.55 + 0.45 * vel
  for (let k = 1; k <= 7; k++) {
    const fk = f * k * Math.sqrt(1 + B * k * k)
    if (fk > 16000) break
    const osc = b.ac.createOscillator()
    osc.frequency.value = fk
    const g = b.ac.createGain()
    const amp = (vel * 0.22 * Math.pow(bright, k - 1)) / Math.pow(k, 1.15)
    const decay = (2.6 / (1 + 0.55 * (k - 1))) * (220 / Math.max(110, f)) ** 0.35
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(amp, t + 0.004)
    g.gain.setTargetAtTime(0, t + 0.004, decay / 3.2)
    g.gain.setTargetAtTime(0, t + dur, 0.09)
    osc.connect(g)
    g.connect(o)
    osc.start(t)
    osc.stop(t + dur + 0.8)
  }
}

/** Marimba FM: portadora senoidal con un modulador ×4 cuyo índice cae enseguida (golpe de madera, cola redonda). */
export function marimba(b: Bus, t: number, midi: number, vel: number, pan = 0, send = 0.3): void {
  const f = hz(midi)
  const o = out(b, pan, send)
  const car = b.ac.createOscillator()
  car.frequency.value = f
  const mod = b.ac.createOscillator()
  mod.frequency.value = f * 4
  const index = b.ac.createGain()
  index.gain.setValueAtTime(f * 2.2 * vel, t)
  index.gain.setTargetAtTime(0, t, 0.018)
  mod.connect(index)
  index.connect(car.frequency)
  const g = b.ac.createGain()
  const decay = 0.55 * Math.pow(440 / f, 0.3)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(0.3 * vel, t + 0.002)
  g.gain.setTargetAtTime(0, t + 0.002, decay / 3)
  car.connect(g)
  g.connect(o)
  car.start(t)
  mod.start(t)
  car.stop(t + decay * 2.5)
  mod.stop(t + decay * 2.5)
}

/** Pulsado: diente de sierra con un filtro que se cierra muy deprisa (cuerda pulsada sintética). */
export function pluck(b: Bus, t: number, midi: number, vel: number, pan = 0, bright = 1): void {
  const f = hz(midi)
  const o = out(b, pan, 0.3)
  const osc = b.ac.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.value = f
  const lp = b.ac.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 2
  lp.frequency.setValueAtTime(Math.min(12000, f * 10 * bright), t)
  lp.frequency.setTargetAtTime(f * 1.2, t, 0.06)
  const g = b.ac.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(0.16 * vel, t + 0.003)
  g.gain.setTargetAtTime(0, t + 0.003, 0.22)
  osc.connect(lp)
  lp.connect(g)
  g.connect(o)
  osc.start(t)
  osc.stop(t + 1.4)
}

/** Colchón de sierras desafinadas con un filtro cuyo brillo sigue «la luz» (0 noche … 1 mediodía). */
export function pad(b: Bus, t: number, notes: number[], dur: number, level: number, light: number): void {
  const lp = b.ac.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 0.5
  const top = 450 + 1500 * light
  lp.frequency.setValueAtTime(top * 0.6, t)
  lp.frequency.linearRampToValueAtTime(top, t + dur * 0.6)
  lp.frequency.linearRampToValueAtTime(top * 0.7, t + dur + 1.2)
  const g = b.ac.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(level, t + Math.min(0.9, dur * 0.35))
  g.gain.setValueAtTime(level, t + dur)
  g.gain.linearRampToValueAtTime(0, t + dur + 1.3)
  lp.connect(g)
  g.connect(b.dry)
  const send = b.ac.createGain()
  send.gain.value = 0.5
  g.connect(send)
  send.connect(b.wet)
  notes.forEach((n, i) => {
    for (const detune of [-8, 7]) {
      const o = b.ac.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = hz(n)
      o.detune.value = detune + i * 0.7
      const og = b.ac.createGain()
      og.gain.value = 0.045
      const p = b.ac.createStereoPanner()
      p.pan.value = detune < 0 ? -0.5 : 0.5
      o.connect(og)
      og.connect(p)
      p.connect(lp)
      o.start(t)
      o.stop(t + dur + 1.5)
    }
  })
}

export function bass(b: Bus, t: number, midi: number, dur: number, level = 0.3): void {
  const o = b.ac.createOscillator()
  o.frequency.value = hz(midi)
  const o2 = b.ac.createOscillator()
  o2.type = 'triangle'
  o2.frequency.value = hz(midi) * 2
  const g = b.ac.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(level, t + 0.015)
  g.gain.setTargetAtTime(level * 0.6, t + 0.02, 0.35)
  g.gain.setTargetAtTime(0, t + Math.max(0.05, dur - 0.05), 0.07)
  const g2 = b.ac.createGain()
  g2.gain.value = 0.1
  o.connect(g)
  o2.connect(g2)
  g2.connect(g)
  g.connect(b.dry)
  o.start(t)
  o2.start(t)
  o.stop(t + dur + 0.5)
  o2.stop(t + dur + 0.5)
}

/** Campana (parciales de campana) para el motivo resuelto. */
export function bell(b: Bus, t: number, midi: number, vel: number, pan = 0): void {
  const o = out(b, pan, 0.45)
  for (const [ratio, amp, dec] of [
    [1, 1, 1.8],
    [2.0, 0.35, 1.1],
    [3.01, 0.18, 0.7],
    [4.17, 0.08, 0.4]
  ] as const) {
    const osc = b.ac.createOscillator()
    osc.frequency.value = hz(midi) * ratio
    const g = b.ac.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(vel * 0.12 * amp, t + 0.003)
    g.gain.setTargetAtTime(0, t + 0.003, dec / 3)
    osc.connect(g)
    g.connect(o)
    osc.start(t)
    osc.stop(t + dec * 2)
  }
}

const noiseCache = new WeakMap<OfflineAudioContext, AudioBuffer>()
function noise(b: Bus): AudioBuffer {
  let buf = noiseCache.get(b.ac)
  if (!buf) {
    buf = b.ac.createBuffer(1, b.ac.sampleRate * 2, b.ac.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = b.rand() * 2 - 1
    noiseCache.set(b.ac, buf)
  }
  return buf
}

/** Ráfaga de ruido filtrado (base de shaker, palmas, «tic», oleadas). */
function burst(b: Bus, t: number, type: BiquadFilterType, freq: number, q: number, level: number, decay: number, pan = 0, send = 0.15): void {
  const src = b.ac.createBufferSource()
  src.buffer = noise(b)
  const f = b.ac.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  const g = b.ac.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(level, t + 0.002)
  g.gain.setTargetAtTime(0, t + 0.002, decay)
  src.connect(f)
  f.connect(g)
  g.connect(out(b, pan, send))
  // empieza en un punto distinto del ruido cada vez (determinista)
  src.start(t, b.rand() * 1.5, decay * 8 + 0.05)
}

export function kick(b: Bus, t: number, level = 0.45): void {
  const o = b.ac.createOscillator()
  o.frequency.setValueAtTime(120, t)
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12)
  const g = b.ac.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(level, t + 0.004)
  g.gain.setTargetAtTime(0, t + 0.01, 0.09)
  o.connect(g)
  g.connect(b.dry)
  o.start(t)
  o.stop(t + 0.8)
}

export function shaker(b: Bus, t: number, level: number, pan = 0.3): void {
  burst(b, t, 'highpass', 7000, 0.7, level * 0.12, 0.018, pan, 0.05)
}

export function clap(b: Bus, t: number, level: number): void {
  for (const [dt, l] of [
    [0, 0.6],
    [0.011, 0.5],
    [0.022, 1]
  ] as const)
    burst(b, t + dt, 'bandpass', 1400, 1.4, level * 0.22 * l, dt < 0.02 ? 0.006 : 0.05, -0.1, 0.35)
}

/** El «tic» de madera de cada clic. */
export function tick(b: Bus, t: number, level: number): void {
  const o = b.ac.createOscillator()
  o.frequency.value = 1850
  const g = b.ac.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(level * 0.12, t + 0.001)
  g.gain.setTargetAtTime(0, t + 0.001, 0.012)
  o.connect(g)
  g.connect(out(b, 0.1, 0.1))
  o.start(t)
  o.stop(t + 0.15)
  burst(b, t, 'bandpass', 3200, 2, level * 0.08, 0.008, 0.1, 0.1)
}

/** Oleada: ruido que sube de color hasta el corte. */
export function swell(b: Bus, t: number, len: number): void {
  const src = b.ac.createBufferSource()
  src.buffer = noise(b)
  src.loop = true
  const bp = b.ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 1.1
  bp.frequency.setValueAtTime(350, t - len)
  bp.frequency.exponentialRampToValueAtTime(5200, t)
  const g = b.ac.createGain()
  g.gain.setValueAtTime(0, t - len)
  g.gain.linearRampToValueAtTime(0.055, t - 0.02)
  g.gain.linearRampToValueAtTime(0, t + 0.12)
  src.connect(bp)
  bp.connect(g)
  g.connect(b.dry)
  g.connect(b.wet)
  src.start(Math.max(0, t - len))
  src.stop(t + 0.2)
}

/** Golpe grave y redondo para los cortes grandes. */
export function hit(b: Bus, t: number, level = 0.5): void {
  const o = b.ac.createOscillator()
  o.frequency.setValueAtTime(110, t)
  o.frequency.exponentialRampToValueAtTime(42, t + 0.35)
  const g = b.ac.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(level, t + 0.006)
  g.gain.setTargetAtTime(0, t + 0.01, 0.22)
  o.connect(g)
  g.connect(b.dry)
  g.connect(b.wet)
  o.start(t)
  o.stop(t + 1.5)
}

export function impulse(ac: OfflineAudioContext, secs: number, rand: () => number): AudioBuffer {
  const buf = ac.createBuffer(2, Math.ceil(secs * ac.sampleRate), ac.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < d.length; i++) {
      const x = i / ac.sampleRate
      const k = 0.15 + 0.6 * Math.exp(-x * 1.8)
      lp = lp + k * (rand() * 2 - 1 - lp)
      d[i] = lp * Math.exp(-x * (6.9 / secs)) * (i < 0.012 * ac.sampleRate ? 0 : 1)
    }
  }
  return buf
}

// ───────────── efectos de los personajes pixel art ─────────────

/** Latido: «lub-dub», dos golpes graves y cortos. */
export function heartbeat(b: Bus, t: number, level: number): void {
  for (const [dt, f, l] of [
    [0, 62, 1],
    [0.13, 75, 0.7]
  ] as const) {
    const o = b.ac.createOscillator()
    o.frequency.setValueAtTime(f * 1.6, t + dt)
    o.frequency.exponentialRampToValueAtTime(f, t + dt + 0.05)
    const g = b.ac.createGain()
    g.gain.setValueAtTime(0, t + dt)
    g.gain.linearRampToValueAtTime(level * 0.55 * l, t + dt + 0.008)
    g.gain.setTargetAtTime(0, t + dt + 0.01, 0.05)
    o.connect(g)
    g.connect(out(b, 0, 0.1))
    o.start(t + dt)
    o.stop(t + dt + 0.4)
  }
}

/** Pitido de monitor plano: un seno de 1 kHz sostenido. */
export function flatline(b: Bus, t: number, dur: number, level: number): void {
  const o = b.ac.createOscillator()
  o.frequency.value = 1000
  const g = b.ac.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(level * 0.06, t + 0.01)
  g.gain.setValueAtTime(level * 0.06, t + dur)
  g.gain.linearRampToValueAtTime(0, t + dur + 0.03)
  o.connect(g)
  g.connect(out(b, 0, 0.15))
  o.start(t)
  o.stop(t + dur + 0.05)
}

/** Descarga: ráfaga de ruido áspero y un chirrido que baja. */
export function zap(b: Bus, t: number, level: number): void {
  burst(b, t, 'bandpass', 2600, 0.8, level * 0.25, 0.05, 0, 0.2)
  const o = b.ac.createOscillator()
  o.type = 'sawtooth'
  o.frequency.setValueAtTime(1800, t)
  o.frequency.exponentialRampToValueAtTime(120, t + 0.18)
  const g = b.ac.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(level * 0.08, t + 0.004)
  g.gain.setTargetAtTime(0, t + 0.02, 0.05)
  o.connect(g)
  g.connect(out(b, 0, 0.2))
  o.start(t)
  o.stop(t + 0.35)
}

/** Risita: blips FM cortos que suben. `step` = cuántos lleva (cada uno un poco más agudo). */
export function giggle(b: Bus, t: number, step: number, level: number): void {
  const f = 520 * Math.pow(2, (step % 5) * 0.14)
  const car = b.ac.createOscillator()
  car.frequency.setValueAtTime(f, t)
  car.frequency.exponentialRampToValueAtTime(f * 1.25, t + 0.07)
  const mod = b.ac.createOscillator()
  mod.frequency.value = f * 2
  const idx = b.ac.createGain()
  idx.gain.setValueAtTime(f * 0.8, t)
  idx.gain.setTargetAtTime(0, t, 0.03)
  mod.connect(idx)
  idx.connect(car.frequency)
  const g = b.ac.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(level * 0.12, t + 0.005)
  g.gain.setTargetAtTime(0, t + 0.04, 0.03)
  car.connect(g)
  g.connect(out(b, 0.1, 0.2))
  car.start(t)
  mod.start(t)
  car.stop(t + 0.25)
  mod.stop(t + 0.25)
}

/** Burbuja: seno muy corto que sube deprisa. */
export function bubble(b: Bus, t: number, level: number, pitch = 1): void {
  const o = b.ac.createOscillator()
  o.frequency.setValueAtTime(380 * pitch, t)
  o.frequency.exponentialRampToValueAtTime(1300 * pitch, t + 0.06)
  const g = b.ac.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(level * 0.1, t + 0.004)
  g.gain.setTargetAtTime(0, t + 0.03, 0.02)
  o.connect(g)
  g.connect(out(b, (pitch - 1) * 2, 0.25))
  o.start(t)
  o.stop(t + 0.2)
}

/** Gota: «plip» (baja y sube). */
export function plip(b: Bus, t: number, level: number): void {
  const o = b.ac.createOscillator()
  o.frequency.setValueAtTime(1500, t)
  o.frequency.exponentialRampToValueAtTime(700, t + 0.03)
  o.frequency.exponentialRampToValueAtTime(1700, t + 0.09)
  const g = b.ac.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(level * 0.1, t + 0.003)
  g.gain.setTargetAtTime(0, t + 0.05, 0.03)
  o.connect(g)
  g.connect(out(b, 0, 0.3))
  o.start(t)
  o.stop(t + 0.25)
}

/** Vaivén de líquido: ruido filtrado que barre. */
export function slosh(b: Bus, t: number, level: number, right: boolean): void {
  burst(b, t, 'lowpass', 900, 0.7, level * 0.12, 0.09, right ? 0.4 : -0.4, 0.2)
}

/** Soplo / humo. */
export function puffSound(b: Bus, t: number, level: number): void {
  burst(b, t, 'bandpass', 700, 0.6, level * 0.1, 0.07, 0, 0.3)
}

/** Destello: campanita aguda. */
export function sparkle(b: Bus, t: number, level: number, k = 0): void {
  const o = b.ac.createOscillator()
  o.frequency.value = 2400 * Math.pow(2, (k % 4) / 12 * 3)
  const g = b.ac.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(level * 0.05, t + 0.002)
  g.gain.setTargetAtTime(0, t + 0.002, 0.08)
  o.connect(g)
  g.connect(out(b, 0.3, 0.5))
  o.start(t)
  o.stop(t + 0.5)
}

/** Nota musical suelta (pentatónica). */
export function blip(b: Bus, t: number, level: number, k = 0): void {
  const scale = [0, 2, 4, 7, 9]
  marimba(b, t, 76 + scale[k % 5] + 12 * Math.floor(k / 5), level * 0.6, 0.2, 0.2)
}

/** Moneda: dos notas de campana rápidas. */
export function coin(b: Bus, t: number, level: number): void {
  bell(b, t, 88, level * 0.6, 0.2)
  bell(b, t + 0.07, 93, level * 0.6, 0.2)
}

/** Golpe seco (¡pum!). */
export function pop(b: Bus, t: number, level: number): void {
  kick(b, t, level * 0.3)
  burst(b, t, 'highpass', 1500, 0.7, level * 0.1, 0.02, 0, 0.1)
}
