// La música y el sonido del corto, originales y sintetizados aquí mismo (Web Audio sin tiempo real): piano de fieltro,
// cuerdas, campanas, viento y papel. Sigue la historia: re menor en la noche, fa mayor cuando se derrama el color.
import { hash, rng } from './engine/core.ts'
import { integratedLoudness, master, truePeak } from '../video/audio/loudness.ts'
import { END, LEN, N_SHOTS, S0 } from './timing.ts'

export interface Score { channels: Float32Array[]; sampleRate: number; lufs: number; peak: number }

const RATE = 48000
const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12)

function noiseBuffer(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const buf = ctx.createBuffer(2, Math.round(seconds * RATE), RATE)
  for (let ch = 0; ch < 2; ch++) {
    const r = rng(seed + ch * 101)
    const d = buf.getChannelData(ch)
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1
  }
  return buf
}

function reverbIR(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const buf = ctx.createBuffer(2, Math.round(seconds * RATE), RATE)
  for (let ch = 0; ch < 2; ch++) {
    const r = rng(seed + ch * 7)
    const d = buf.getChannelData(ch)
    for (let i = 0; i < d.length; i++) {
      const t = i / d.length
      d[i] = (r() * 2 - 1) * Math.pow(1 - t, 2.6) * (t < 0.004 ? t / 0.004 : 1)
    }
  }
  return buf
}

export async function renderScore(duration: number): Promise<Score> {
  const ctx = new OfflineAudioContext(2, Math.round((duration + 0.5) * RATE), RATE)
  const out = ctx.createGain()
  out.gain.value = 0.9
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -16
  comp.ratio.value = 2.5
  comp.attack.value = 0.02
  comp.release.value = 0.3
  out.connect(comp).connect(ctx.destination)
  const dry = ctx.createGain()
  dry.connect(out)
  const wet = ctx.createGain()
  wet.gain.value = 0.34
  const verb = ctx.createConvolver()
  verb.buffer = reverbIR(ctx, 3.6, 5)
  wet.connect(verb).connect(out)
  const bus = (g: number, send = 1): GainNode => {
    const n = ctx.createGain()
    n.gain.value = g
    n.connect(dry)
    const s = ctx.createGain()
    s.gain.value = send
    n.connect(s).connect(wet)
    return n
  }
  const pan = (to: AudioNode, p: number): StereoPannerNode => {
    const n = ctx.createStereoPanner()
    n.pan.value = p
    n.connect(to)
    return n
  }
  const PIANO = bus(0.5, 1)
  const PAD = bus(0.2, 1.1)
  const BELL = bus(0.16, 1.4)
  const LOW = bus(0.5, 0.3)
  const AIR = bus(0.5, 0.5)

  /** Piano de fieltro: parciales que se apagan, con un golpecito de macillo. */
  const piano = (t: number, midi: number, vel = 0.6, dur = 3.2, p = 0): void => {
    if (t < 0 || t > duration) return
    const f = hz(midi)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vel, t + 0.008)
    g.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.25)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(900 + vel * 3600, t)
    lp.frequency.exponentialRampToValueAtTime(500, t + dur)
    lp.connect(g).connect(pan(PIANO, p))
    ;[[1, 1, 'sine'], [2.001, 0.42, 'sine'], [3.003, 0.16, 'triangle'], [4.01, 0.06, 'sine']].forEach(([m, a, type], i) => {
      const o = ctx.createOscillator()
      o.type = type as OscillatorType
      o.frequency.value = f * (m as number)
      o.detune.value = (hash(midi * 7 + i, 3) - 0.5) * 7
      const og = ctx.createGain()
      og.gain.value = a as number
      o.connect(og).connect(lp)
      o.start(t)
      o.stop(t + dur + 0.05)
    })
  }
  /** Cuerdas: sierras desafinadas tras un filtro, con ataque lento. */
  const pad = (t: number, notes: number[], dur: number, vel = 0.5, attack = 1.4, bright = 900): void => {
    for (const midi of notes) {
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(vel / notes.length, t + attack)
      g.gain.setValueAtTime(vel / notes.length, t + Math.max(attack, dur - 1.6))
      g.gain.linearRampToValueAtTime(0.0001, t + dur)
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(bright * 0.6, t)
      lp.frequency.linearRampToValueAtTime(bright, t + attack)
      lp.Q.value = 0.4
      lp.connect(g).connect(pan(PAD, (hash(midi, 9) - 0.5) * 0.7))
      for (const cents of [-7, 6]) {
        const o = ctx.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = hz(midi)
        o.detune.value = cents
        o.connect(lp)
        o.start(t)
        o.stop(t + dur + 0.1)
      }
    }
  }
  /** Campana: dos senos, uno fuera de la serie, con cola larga. */
  const bell = (t: number, midi: number, vel = 0.5, dur = 3.4, p = 0): void => {
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vel, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    g.connect(pan(BELL, p))
    ;[[1, 1], [2.76, 0.32], [5.4, 0.1]].forEach(([m, a]) => {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = hz(midi) * m
      const og = ctx.createGain()
      og.gain.value = a
      o.connect(og).connect(g)
      o.start(t)
      o.stop(t + dur + 0.05)
    })
  }
  /** Golpe grave (el corazón, el apagón, la floración). */
  const thump = (t: number, vel = 0.6, f0 = 70, f1 = 38, dur = 0.5): void => {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(f1, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vel, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(LOW)
    o.start(t)
    o.stop(t + dur + 0.05)
  }
  const NOISE = noiseBuffer(ctx, 6, 41)
  /** Ruido filtrado con una curva de volumen: viento, papel, barridos. */
  const air = (t: number, dur: number, curve: [number, number][], f0: number, f1: number, q = 0.8, type: BiquadFilterType = 'bandpass', p0 = 0, p1 = 0): void => {
    const src = ctx.createBufferSource()
    src.buffer = NOISE
    src.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = type
    bp.Q.value = q
    bp.frequency.setValueAtTime(f0, t)
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    for (const [at, v] of curve) g.gain.linearRampToValueAtTime(Math.max(0.0001, v), t + at * dur)
    const pn = ctx.createStereoPanner()
    pn.pan.setValueAtTime(p0, t)
    pn.pan.linearRampToValueAtTime(p1, t + dur)
    src.connect(bp).connect(g).connect(pn).connect(AIR)
    src.start(t, hash(Math.round(t * 100), 5) * 4)
    src.stop(t + dur + 0.05)
  }
  const flutter = (t: number, vel = 0.2, p = 0): void => air(t, 0.16 + hash(Math.round(t * 50), 7) * 0.2, [[0.1, vel], [1, 0]], 2400 + hash(Math.round(t * 50), 8) * 3000, 1200, 1.4, 'bandpass', p, -p)

  /** Trueno: el chasquido, el golpe y un rumor grave que se aleja. */
  const thunder = (t: number, vel = 1): void => {
    air(t, 0.22, [[0.05, 0.8 * vel], [1, 0]], 4200, 900, 0.6, 'highpass')
    air(t + 0.04, 2.8, [[0.03, 0.95 * vel], [0.25, 0.5 * vel], [1, 0]], 240, 55, 0.5, 'lowpass', -0.3, 0.3)
    thump(t + 0.03, 0.95 * vel, 95, 27, 1.8)
  }
  /** El canto de la ballena: un seno que sube y cae, con mucha sala. */
  const whaleCall = (t: number, f0: number, f1: number, f2: number, dur = 2.6, vel = 0.34): void => {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.45)
    o.frequency.exponentialRampToValueAtTime(f2, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(vel, t + dur * 0.3)
    g.gain.linearRampToValueAtTime(vel * 0.7, t + dur * 0.7)
    g.gain.linearRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(pan(BELL, 0.35))
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  // ── Acto I · la noche (0–9) ──
  // un re grave que respira
  ;[38, 45].forEach((m, i) => {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = hz(m)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, 0)
    g.gain.linearRampToValueAtTime(i ? 0.12 : 0.3, 3)
    g.gain.setValueAtTime(i ? 0.12 : 0.3, 12.3)
    g.gain.linearRampToValueAtTime(0.0001, 12.7)
    g.gain.linearRampToValueAtTime(i ? 0.08 : 0.2, 15)
    g.gain.linearRampToValueAtTime(0.0001, 30.4)
    o.connect(g).connect(LOW)
    o.start(0)
    o.stop(31)
  })
  pad(1.4, [50, 57, 65], 11, 0.5, 3, 700)
  piano(2.2, 69, 0.34, 4.5, 0.2)
  piano(4.3, 65, 0.3, 4.5, -0.2)
  piano(5.6, 74, 0.42, 5, 0.1)
  piano(6.4, 73, 0.3, 4, 0.25)
  piano(7.8, 70, 0.3, 5, -0.15)
  // ── la tormenta (7–18) ──
  air(6.6, 11.6, [[0.1, 0.05], [0.5, 0.42], [0.85, 0.75], [1, 0.25]], 300, 1300, 0.7, 'bandpass', -0.4, 0.4)
  air(8, 10, [[0.2, 0.02], [0.8, 0.3], [1, 0.1]], 2500, 5200, 1.2, 'bandpass', 0.5, -0.5)
  pad(9, [50, 51, 57, 62], 8.8, 0.62, 4, 1300)
  for (let i = 0; i < 46; i++) flutter(7.2 + Math.pow(i / 46, 0.7) * 10.6, 0.1 + (i / 46) * 0.22, hash(i, 21) * 1.6 - 0.8)
  // el corazón, cada vez más deprisa
  let hb = 10
  for (let i = 0; hb < 17.6; i++) {
    thump(hb, 0.5, 64, 40, 0.3)
    thump(hb + 0.17, 0.32, 58, 38, 0.26)
    hb += 0.95 - Math.min(0.42, i * 0.045)
  }
  // la lámpara se apaga
  thump(12.5, 0.95, 90, 30, 1.4)
  piano(12.52, 38, 0.6, 6)
  piano(12.52, 26, 0.5, 6)

  // los relámpagos y la gran ola
  thunder(13.27, 0.9)
  thunder(15.62, 1)
  air(14.4, 2.9, [[0.5, 0.35], [0.95, 0.95], [1, 0.2]], 70, 280, 0.6, 'lowpass', 0.6, 0)
  air(16.85, 1.25, [[0.1, 0.9], [1, 0]], 5200, 700, 0.5, 'highpass')
  thump(17.05, 1, 80, 26, 1.7)

  // ── Acto II · el arco (18–30,4) ──
  air(18, 12, [[0.05, 0.22], [0.7, 0.08], [1, 0.03]], 500, 320, 0.6, 'bandpass', 0.3, -0.2)
  const theme: [number, number, number][] = [[18.8, 62, 0.4], [19.8, 65, 0.42], [20.8, 69, 0.46], [22.0, 67, 0.4], [22.9, 65, 0.4], [23.9, 64, 0.38], [24.9, 62, 0.42], [25.9, 69, 0.46], [26.5, 72, 0.5]]
  theme.forEach(([t, m, v], i) => piano(t, m, v, 4.2, i % 2 ? 0.15 : -0.15))
  pad(18.6, [50, 57, 65], 2.8, 0.4, 1.4, 800)
  pad(21, [46, 53, 62, 65], 2.6, 0.42, 1.2, 850)
  pad(23.2, [41, 53, 60, 69], 2.4, 0.44, 1.2, 900)
  pad(25.2, [48, 55, 64, 67], 2.4, 0.46, 1.2, 950)
  // el umbral: sube
  pad(27, [46, 58, 62, 65, 70], 1.9, 0.56, 0.8, 1300)
  pad(28.5, [48, 60, 64, 67, 72], 2.1, 0.66, 0.8, 1700)
  for (let i = 0; i < 26; i++) {
    const t = 27 + Math.pow(i / 26, 0.8) * 3.3
    const run = [58, 62, 65, 70, 74, 77, 60, 64, 67, 72, 76, 79]
    piano(t, run[i % run.length] + (i > 13 ? 0 : -12), 0.28 + (i / 26) * 0.26, 1.6, hash(i, 31) - 0.5)
  }
  air(28.4, 2.05, [[0.7, 0.3], [0.98, 0.75], [1, 0]], 700, 7000, 1.1, 'highpass')
  for (let i = 0; i < 9; i++) thump(28.6 + i * 0.2, 0.3 + i * 0.03, 60, 44, 0.16)

  // ── la floración (30,45): fa mayor ──
  const B = 30.45
  thump(B, 1, 110, 34, 2.2)
  air(B, 3.4, [[0.02, 0.6], [0.3, 0.2], [1, 0]], 6000, 1500, 0.5, 'highpass')
  pad(B, [41, 53, 60, 65, 69, 72], 5.2, 0.95, 0.12, 2600)
  ;[77, 81, 84, 89, 93, 96].forEach((m, i) => bell(B + i * 0.11, m, 0.5 - i * 0.04, 4.5, i % 2 ? 0.4 : -0.4))
  piano(B, 53, 0.7, 5)
  piano(B, 41, 0.7, 6)

  // ── Acto III · la escalera (31,6–41,3): arpegios que suben ──
  const E = 0.2778
  const chords: number[][] = [
    [53, 60, 65, 69, 72, 69, 65, 60], [52, 60, 64, 67, 72, 67, 64, 60], [50, 57, 62, 65, 69, 65, 62, 57], [46, 53, 58, 62, 65, 62, 58, 53],
    [53, 60, 65, 69, 72, 69, 65, 60], [48, 55, 60, 64, 67, 64, 60, 55]
  ]
  const padChords: number[][] = [[41, 53, 60, 69], [40, 52, 60, 67], [38, 50, 57, 65], [34, 46, 53, 62], [41, 53, 60, 69], [36, 48, 55, 64]]
  let at = 31.9
  for (let bar = 0; bar < 4; bar++) {
    const c = chords[bar % chords.length]
    pad(at, padChords[bar % padChords.length], E * 8 + 0.9, 0.5, 0.5, 1500)
    c.forEach((m, i) => piano(at + i * E, m + (i === 4 ? 12 : 0), 0.3 + (i === 0 ? 0.14 : 0) + (i === 4 ? 0.08 : 0), 2.2, (i / 7 - 0.5) * 0.8))
    at += E * 8
  }
  // la ballena
  whaleCall(34.3, 190, 330, 240)
  whaleCall(38.2, 240, 410, 300, 2.9, 0.3)
  // las campanas cuentan los días que quedan
  const scale = [77, 79, 81, 82, 84, 86, 88, 89, 93]
  for (let d = 0; d < 9; d++) bell(32.0 + d * (9.3 / 9), scale[d], 0.34 + d * 0.02, 3, d % 2 ? 0.3 : -0.3)
  pad(40.4, [41, 53, 60, 65, 69, 77], 2.6, 0.7, 0.7, 2600)
  air(40.6, 1.2, [[0.9, 0.4], [1, 0]], 900, 6000, 0.9, 'highpass')

  // ── el día del examen (41,6–49,6): calma ──
  pad(41.8, [41, 53, 60, 67, 69], 7.6, 0.4, 1.6, 1100)
  piano(42.4, 72, 0.34, 4, 0.2)
  piano(43.4, 69, 0.32, 4, -0.2)
  piano(44.4, 65, 0.34, 5, 0.1)
  flutter(44.95, 0.16, 0)
  air(46.0, 0.8, [[0.2, 0.28], [1, 0]], 1800, 5200, 1.2, 'bandpass', -0.3, 0.4)
  ;[53, 60, 65, 67, 72].forEach((m, i) => piano(46.82 + i * 0.03, m, 0.44, 5.5, (i - 2) * 0.2))
  bell(46.85, 84, 0.36, 4)

  // ── Aula (49,6–72): el tema, en mayor ──
  ;[53, 57, 60, 65, 69, 72, 77].forEach((m, i) => piano(49.95 + i * 0.24, m, 0.3 + i * 0.03, 3.5, (i / 6 - 0.5) * 0.8))
  pad(49.8, [41, 53, 60, 65, 69], 4.6, 0.5, 1.6, 1500)
  bell(52.0, 89, 0.5, 4.5)
  bell(52.0, 77, 0.4, 4.5)
  thump(52.0, 0.5, 70, 40, 1.2)
  const prog: number[][] = [[41, 53, 60, 69, 72], [38, 50, 57, 65, 69], [34, 46, 53, 62, 65], [36, 48, 55, 64, 67]]
  const tune: number[][] = [[77, 76, 72], [74, 72, 69], [70, 74, 77], [79, 76, 72]]
  // una pantalla, un acorde: vueltas a fa · re menor · si bemol · do, cada una un poco más llena
  for (let i = 0; i < N_SHOTS; i++) {
    const t = S0 + i * LEN
    const c = prog[i % 4]
    const lap = Math.floor(i / 4)
    pad(t, c, LEN + 0.55, 0.5 + lap * 0.05, 0.45, 1500 + lap * 280)
    air(t - 0.1, 0.7, [[0.3, 0.2], [1, 0]], 1200, 4200, 1, 'bandpass', 0.6, -0.4)
    piano(t, c[0], 0.5, 4)
    if (lap > 0) piano(t, c[0] - 12, 0.4, 4)
    c.slice(1).forEach((m, k) => piano(t + 0.16 + k * 0.2, m + (lap >= 3 ? 12 : 0), 0.3 + lap * 0.025, 3, (k - 1.5) * 0.25))
    tune[i % 4].forEach((m, k) => piano(t + 1.02 + k * 0.4, m + (lap === 4 ? 12 : 0), 0.4 + lap * 0.025, 3.2, 0.2))
    if (lap > 0) bell(t, c[3] + 24, 0.2 + lap * 0.04, 3, i % 2 ? 0.4 : -0.4)
    if (lap >= 2) thump(t, 0.3 + lap * 0.03, 66, 42, 0.5)
  }
  // el final: si bemol, do, fa
  pad(END, [34, 46, 53, 62, 65], 1.4, 0.6, 0.4, 1700)
  pad(END + 1.2, [36, 48, 55, 64, 67], 1.4, 0.62, 0.4, 1800)
  pad(END + 2.4, [41, 53, 60, 65, 69, 72], 3.4, 0.7, 0.5, 2000)
  piano(END + 2.4, 41, 0.6, 5)
  ;[65, 69, 72, 77, 81].forEach((m, i) => piano(END + 2.4 + i * 0.16, m, 0.44, 4.5, (i - 2) * 0.2))
  bell(END + 2.42, 89, 0.5, 5)
  bell(END + 3.1, 96, 0.3, 4.5, 0.3)
  thump(END + 2.4, 0.6, 70, 40, 1.4)
  // las hojas que vuelven y forman el arco
  for (let i = 0; i < 36; i++) flutter(END + 0.15 + Math.pow(i / 36, 0.8) * 2.2, 0.09 + (i / 36) * 0.12, hash(i, 91) * 1.6 - 0.8)
  air(END + 0.2, 2.25, [[0.8, 0.26], [0.98, 0.5], [1, 0]], 500, 5200, 1, 'highpass')
  // la coda
  ;[[4.4, 72], [4.9, 77], [5.4, 81], [6.0, 84], [6.7, 89]].forEach(([d, m], i) => piano(END + d, m, 0.4, 4, (i - 2) * 0.15))
  pad(END + 5.6, [41, 53, 60, 65, 69, 72], 3.9, 0.6, 1.2, 1900)
  piano(END + 6.7, 41, 0.55, 4)
  bell(END + 6.72, 101, 0.3, 4)

  const rendered = await ctx.startRendering()
  const n = Math.round(duration * RATE)
  const channels = [rendered.getChannelData(0).slice(0, n), rendered.getChannelData(1).slice(0, n)]
  // fundido final
  const fade = Math.round(1.1 * RATE)
  for (const c of channels) for (let i = 0; i < fade; i++) c[n - 1 - i] *= i / fade
  master(channels, RATE, -15, -2.8)
  return { channels, sampleRate: RATE, lufs: +integratedLoudness(channels, RATE).toFixed(2), peak: +truePeak(channels).toFixed(2) }
}
