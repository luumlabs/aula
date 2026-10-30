// Instrumentos sintetizados (sin muestras), herederos de la paleta del v3 (Audio.swift): colchón de sierras PolyBLEP,
// marimba FM con eco, campana FM, bajo senoidal y percusión suave; y lo nuevo para que tenga pegada de anuncio: piano
// eléctrico FM para la noche, glockenspiel, pluck filtrado, bombo con chasquido, palmas, hats metálicos (seis
// osciladores cuadrados, como una caja de ritmos), redobles, platos, subidas, golpes y el aire de los movimientos.
// Cada función escribe una nota en un bus estéreo con su paneo y sus envíos (sala, reverb, eco).
import { blep, hz, mixMono, mixStereo, noise, OnePole, SR, Stereo, Svf } from './dsp.ts'

export interface Buses {
  pad: Stereo
  keys: Stereo
  bells: Stereo
  bass: Stereo
  kick: Stereo
  drums: Stereo
  fx: Stereo
  /** Envíos: reverb larga de la música, sala corta de la batería, eco ping-pong, y los de los efectos. */
  hall: Stereo
  room: Stereo
  echo: Stereo
  fxHall: Stereo
  fxEcho: Stereo
}

export function makeBuses(n: number): Buses {
  return {
    pad: new Stereo(n),
    keys: new Stereo(n),
    bells: new Stereo(n),
    bass: new Stereo(n),
    kick: new Stereo(n),
    drums: new Stereo(n),
    fx: new Stereo(n),
    hall: new Stereo(n),
    room: new Stereo(n),
    echo: new Stereo(n),
    fxHall: new Stereo(n),
    fxEcho: new Stereo(n)
  }
}

export interface Ctx {
  b: Buses
  /** Semilla nueva para cada nota con ruido (determinista y estable). */
  seed: () => number
  /** Segundo del vídeo en la muestra 0 de los buses (0; otro valor para sintetizar un efecto suelto en un bus corto). */
  offset?: number
  /** Ganancia de todo lo que se escribe con este contexto (el nivel de cada tipo de efecto). */
  gain?: number
  /** Notas que toca la música (agudas, de las teclas, campanas y reloj): los efectos afinados eligen las libres. */
  notes?: { t: number; end: number; midi: number }[]
}

/** Apunta una nota de la música (no de los efectos) para que los efectos no caigan en la misma. */
function logNote(ctx: Ctx, t: number, midi: number, len: number, fx: boolean): void {
  if (!fx && ctx.notes) ctx.notes.push({ t, end: t + Math.min(len, 0.5), midi })
}

export interface Sends {
  hall?: number
  room?: number
  echo?: number
}

const TAU = 2 * Math.PI

function buffer(secs: number): Float32Array {
  return new Float32Array(Math.max(1, Math.ceil(secs * SR)))
}

/** Escribe una nota mono en `bus` y sus envíos. */
/** Fundido de salida en las últimas muestras (30 ms o el 10 % de la nota): ninguna cola acaba en seco. */
function tailFade(x: Float32Array): void {
  // las que ya acaban en silencio (la subida, que corta en seco a propósito) se quedan como están
  if (Math.abs(x[x.length - 1]) < 1e-6) return
  const n = Math.min(Math.round(0.03 * SR), Math.floor(x.length * 0.1))
  for (let k = 0; k < n; k++) x[x.length - 1 - k] *= k / n
}

function put(ctx: Ctx, bus: Stereo, t: number, x: Float32Array, gain: number, pan: number, sends: Sends = {}, panTo?: number, fx = false): void {
  tailFade(x)
  const i0 = Math.round((t - (ctx.offset ?? 0)) * SR)
  gain *= ctx.gain ?? 1
  mixMono(bus, x, i0, gain, pan, panTo)
  if (sends.hall) mixMono(fx ? ctx.b.fxHall : ctx.b.hall, x, i0, gain * sends.hall, pan, panTo)
  if (sends.room) mixMono(ctx.b.room, x, i0, gain * sends.room, pan, panTo)
  if (sends.echo) mixMono(fx ? ctx.b.fxEcho : ctx.b.echo, x, i0, gain * sends.echo, pan, panTo)
}

function putStereo(ctx: Ctx, bus: Stereo, t: number, l: Float32Array, r: Float32Array, gain: number, sends: Sends = {}, fx = false): void {
  tailFade(l)
  tailFade(r)
  const i0 = Math.round((t - (ctx.offset ?? 0)) * SR)
  gain *= ctx.gain ?? 1
  mixStereo(bus, l, r, i0, gain)
  if (sends.hall) mixStereo(fx ? ctx.b.fxHall : ctx.b.hall, l, r, i0, gain * sends.hall)
  if (sends.room) mixStereo(ctx.b.room, l, r, i0, gain * sends.room)
  if (sends.echo) mixStereo(fx ? ctx.b.fxEcho : ctx.b.echo, l, r, i0, gain * sends.echo)
}

// ───────────────────────────── teclas y mazos ─────────────────────────────

export interface MalletOpts {
  decay?: number
  bright?: number
  sends?: Sends
  bus?: 'keys' | 'bells' | 'fx'
}

/** Marimba FM del v3 (portadora + moduladora 4:1 con índice que cae y un parcial de vidrio) con un golpe de mazo. */
export function marimba(ctx: Ctx, t: number, midi: number, vel: number, pan: number, o: MalletOpts = {}): void {
  const f = hz(midi)
  const decay = (o.decay ?? 0.5) * Math.pow(440 / f, 0.25)
  const bright = o.bright ?? 1
  const len = Math.min(3.2, decay * 6)
  const x = buffer(len)
  const nz = noise(ctx.seed())
  const knock = new Svf(f * 3, 2)
  for (let i = 0; i < x.length; i++) {
    const s = i / SR
    const idx = (1.9 * Math.exp(-s / 0.07) + 0.12) * bright
    const m = Math.sin(TAU * f * 4 * s)
    const c = Math.sin(TAU * f * s + idx * m)
    const g = Math.sin(TAU * f * 2 * s + 0.6 * m * Math.exp(-s / 0.04)) * Math.exp(-s / 0.16) * 0.22
    const a = s < 0.002 ? s / 0.002 : Math.exp(-s / decay)
    let k = 0
    if (s < 0.012) {
      knock.tick(nz())
      k = knock.bp * Math.exp(-s / 0.003) * 0.22 * bright
    }
    x[i] = ((c + g) * a + k) * 0.39
  }
  const bus = o.bus === 'fx' ? ctx.b.fx : o.bus === 'bells' ? ctx.b.bells : ctx.b.keys
  logNote(ctx, t, midi, decay * 2, o.bus === 'fx')
  put(ctx, bus, t, x, vel, pan, o.sends ?? { hall: 0.38, echo: 0.3 }, undefined, o.bus === 'fx')
}

/** Glockenspiel: barra metálica (parciales 1 · 2,76 · 5,40) con un golpe brillante. Para palabras, olas y conteos. */
export function glock(ctx: Ctx, t: number, midi: number, vel: number, pan: number, o: MalletOpts = {}): void {
  const f = hz(midi)
  const decay = (o.decay ?? 0.9) * Math.pow(880 / f, 0.2)
  const len = Math.min(4, decay * 5)
  const x = buffer(len)
  const bright = o.bright ?? 1
  for (let i = 0; i < x.length; i++) {
    const s = i / SR
    const a = s < 0.0015 ? s / 0.0015 : Math.exp(-s / decay)
    const p1 = Math.sin(TAU * f * s)
    const p2 = Math.sin(TAU * f * 2.76 * s) * Math.exp(-s / 0.22) * 0.32 * bright
    const p3 = Math.sin(TAU * f * 5.4 * s) * Math.exp(-s / 0.05) * 0.18 * bright
    const strike = Math.sin(TAU * f * 8.93 * s) * Math.exp(-s / 0.008) * 0.12 * bright
    x[i] = (p1 * a + (p2 + p3) * (s < 0.0015 ? s / 0.0015 : 1) + strike) * 0.32
  }
  const bus = o.bus === 'keys' ? ctx.b.keys : o.bus === 'bells' ? ctx.b.bells : ctx.b.fx
  logNote(ctx, t, midi, decay * 2, (o.bus ?? 'fx') === 'fx')
  put(ctx, bus, t, x, vel, pan, o.sends ?? { hall: 0.3, echo: 0.22 }, undefined, (o.bus ?? 'fx') === 'fx')
}

/** Campana FM inarmónica del v3 (moduladora 3,5:1), un poco abierta en estéreo y con un parcial de brillo. */
export function bell(ctx: Ctx, t: number, midi: number, vel: number, pan: number, o: { decay?: number; bus?: 'bells' | 'fx'; sends?: Sends } = {}): void {
  const f = hz(midi)
  const decay = o.decay ?? 1.9
  const len = Math.min(8, decay * 3.2)
  const l = buffer(len)
  const r = buffer(len)
  for (const [buf, det] of [[l, 0.9985], [r, 1.0015]] as const) {
    const ff = f * det
    for (let i = 0; i < buf.length; i++) {
      const s = i / SR
      const idx = 3.2 * Math.exp(-s / 0.9) + 0.3
      const c = Math.sin(TAU * ff * s + idx * Math.sin(TAU * ff * 3.5 * s))
      const sh = Math.sin(TAU * ff * 2.76 * s) * Math.exp(-s / 0.5) * 0.18
      const a = (s < 0.003 ? s / 0.003 : 1) * Math.exp(-s / decay)
      buf[i] = (c + sh) * a * 0.3
    }
  }
  const [gl, gr] = [Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2, Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2]
  for (let i = 0; i < l.length; i++) {
    l[i] *= gl
    r[i] *= gr
  }
  logNote(ctx, t, midi, decay, o.bus === 'fx')
  const fx = o.bus === 'fx'
  putStereo(ctx, fx ? ctx.b.fx : ctx.b.bells, t, l, r, vel, o.sends ?? { hall: 0.6, echo: 0.15 }, fx)
}

/** Piano eléctrico FM (la noche): portadora 1:1 con índice que cae despacio, la «púa» aguda y un trémolo estéreo. */
export function epiano(ctx: Ctx, t: number, midi: number, vel: number, dur: number, pan: number): void {
  const f = hz(midi)
  const rel = 0.35
  const len = Math.min(dur + rel, 5)
  const l = buffer(len)
  const r = buffer(len)
  for (let i = 0; i < l.length; i++) {
    const s = i / SR
    const idx = (1.15 * Math.exp(-s / 0.45) + 0.12) * (0.6 + 0.5 * vel)
    const c = Math.sin(TAU * f * s + idx * Math.sin(TAU * f * s))
    const tine = Math.sin(TAU * f * 14 * s) * Math.exp(-s / 0.025) * 0.1 * vel
    let a = (s < 0.003 ? s / 0.003 : 1) * Math.exp(-s / 1.6)
    if (s > dur) a *= Math.max(0, 1 - (s - dur) / rel)
    const v = (c + tine) * a * 0.3
    const trem = 0.5 + 0.5 * Math.sin(TAU * 4.2 * s)
    l[i] = v * (0.75 + 0.25 * trem)
    r[i] = v * (1 - 0.25 * trem)
  }
  const [gl, gr] = [Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2, Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2]
  for (let i = 0; i < l.length; i++) {
    l[i] *= gl
    r[i] *= gr
  }
  logNote(ctx, t, midi, dur, false)
  putStereo(ctx, ctx.b.keys, t, l, r, vel, { hall: 0.45, echo: 0.18 })
}

/** Pluck: dos sierras abiertas (±6 cents) por un paso bajo con envolvente rápida. El color del corto. */
export function pluck(ctx: Ctx, t: number, midi: number, vel: number, pan: number, o: { decay?: number; cutoff?: number; sends?: Sends; bus?: 'keys' | 'fx' } = {}): void {
  const f = hz(midi)
  const decay = o.decay ?? 0.32
  const len = Math.min(2.5, decay * 5)
  const x = buffer(len)
  const flt = new Svf(1000, 1.1)
  const d1 = f * 1.0035
  const d2 = f * 0.9965
  let p1 = 0.1
  let p2 = 0.6
  const top = o.cutoff ?? 5200
  for (let i = 0; i < x.length; i++) {
    const s = i / SR
    p1 += d1 / SR
    if (p1 >= 1) p1 -= 1
    p2 += d2 / SR
    if (p2 >= 1) p2 -= 1
    const saw = 2 * p1 - 1 - blep(p1, d1 / SR) + (2 * p2 - 1 - blep(p2, d2 / SR))
    if ((i & 7) === 0) flt.set(f * 1.2 + top * Math.exp(-s / 0.09) * (0.5 + 0.5 * vel), 1.1)
    flt.tick(saw * 0.5)
    const a = s < 0.002 ? s / 0.002 : Math.exp(-s / decay)
    x[i] = flt.lp * a * 0.42
  }
  logNote(ctx, t, midi, decay * 2, o.bus === 'fx')
  const fx = o.bus === 'fx'
  put(ctx, fx ? ctx.b.fx : ctx.b.keys, t, x, vel, pan, o.sends ?? { hall: 0.3, echo: 0.28 }, undefined, fx)
}

/** Colchón: cada nota, tres sierras PolyBLEP algo desafinadas por canal (fases distintas a cada lado), con ataque y
 *  caída suaves. El filtro que sigue la luz se aplica luego al bus entero. */
export function padChord(ctx: Ctx, t: number, notes: number[], dur: number, attack: number, release: number, amp: number): void {
  const len = dur + release
  const l = buffer(len)
  const r = buffer(len)
  const det = [0.9958, 1.0, 1.0047]
  notes.forEach((m, k) => {
    const f = hz(m)
    const w = k === 0 ? 1 : 0.8
    for (const [buf, side] of [[l, 0], [r, 1]] as const) {
      const ph = side === 0 ? [0.13, 0.57, 0.81] : [0.42, 0.05, 0.66]
      const inc = [0, 1, 2].map((j) => (f * det[(j + side) % 3] * (side ? 1.0006 : 0.9994)) / SR)
      for (let i = 0; i < buf.length; i++) {
        const s = i / SR
        let v = 0
        for (let j = 0; j < 3; j++) {
          ph[j] += inc[j]
          if (ph[j] >= 1) ph[j] -= 1
          v += 2 * ph[j] - 1 - blep(ph[j], inc[j])
        }
        let e: number
        if (s < attack) e = Math.sin(((Math.PI / 2) * s) / attack)
        else if (s < dur) e = 1
        else e = Math.max(0, Math.cos(((Math.PI / 2) * (s - dur)) / release))
        buf[i] += (v / 3) * e * w * 0.16
      }
    }
  })
  putStereo(ctx, ctx.b.pad, t, l, r, amp, { hall: 0.42 })
}

// ───────────────────────────── bajo ─────────────────────────────

/** Bajo: 'pulse' (corcheas con caída), 'sustain' (nota larga), 'synth' (sierra filtrada + sub, para el corto). */
export function bass(ctx: Ctx, t: number, midi: number, dur: number, vel: number, style: 'pulse' | 'sustain' | 'synth' | 'soft' = 'pulse', release?: number): void {
  const f = hz(midi)
  const rel = release ?? (style === 'sustain' ? 0.3 : 0.05)
  const x = buffer(dur + rel)
  const flt = new Svf(400, 1.2)
  let ph = 0
  for (let i = 0; i < x.length; i++) {
    const s = i / SR
    let a: number
    if (style === 'sustain') a = Math.min(1, s / 0.06)
    else if (style === 'soft') a = Math.min(1, s / 0.012) * Math.exp(-s / 0.22)
    else a = Math.min(1, s / 0.006) * Math.exp(-s / (style === 'synth' ? 0.3 : 0.24))
    if (s > dur) a *= Math.max(0, 1 - (s - dur) / rel)
    // armónicos (2.º y 3.º) para que el bajo se oiga también en altavoces pequeños, no solo como sub
    // 'soft' es el bajo senoidal del v3 (con un 25 % de segundo armónico)
    let v = style === 'soft' ? Math.sin(TAU * f * s) + 0.25 * Math.sin(2 * TAU * f * s) : style === 'sustain' ? Math.sin(TAU * f * s) + 0.3 * Math.sin(2 * TAU * f * s) + 0.08 * Math.sin(3 * TAU * f * s) : Math.sin(TAU * f * s) + 0.45 * Math.sin(2 * TAU * f * s) + 0.2 * Math.sin(3 * TAU * f * s)
    if (style === 'synth') {
      ph += f / SR
      if (ph >= 1) ph -= 1
      const saw = 2 * ph - 1 - blep(ph, f / SR)
      if ((i & 7) === 0) flt.set(f * 4 + 1800 * Math.exp(-s / 0.09), 1.4)
      flt.tick(saw)
      // poco fundamental y mucha sierra filtrada + octava: el bajo vive en 100–400 Hz, donde un móvil lo reproduce
      v = 0.5 * Math.sin(TAU * f * s) + 0.35 * Math.sin(2 * TAU * f * s) + 0.8 * flt.lp
    }
    x[i] = (style === 'soft' ? v * 0.8 : Math.tanh(v * (style === 'synth' ? 2.2 : 1.5))) * a * 0.42
  }
  put(ctx, ctx.b.bass, t, x, vel, 0)
}

// ───────────────────────────── batería ─────────────────────────────

/** Bombo: seno con caída de tono, cuerpo redondo y un chasquido corto (`punch` 0–1 lo endurece para el corto). */
export function kick(ctx: Ctx, t: number, vel: number, punch = 0.4): void {
  const x = buffer(0.55)
  const nz = noise(ctx.seed())
  const hp = new Svf(3000, 0.7)
  const f0 = 150 + 70 * punch
  const f1 = 50
  const tau = 0.032
  for (let i = 0; i < x.length; i++) {
    const s = i / SR
    const ph = TAU * (f1 * s + (f0 - f1) * tau * (1 - Math.exp(-s / tau)))
    // cuerpo largo y redondo como el bombo del v3 (0,26 s) cuando es suave; más corto y seco cuanto más pegada
    const body = Math.sin(ph) * Math.exp(-s / (0.26 - 0.08 * punch))
    hp.tick(nz())
    const click = hp.hp * Math.exp(-s / 0.0035) * (0.25 + 0.35 * punch)
    const a = s < 0.0015 ? s / 0.0015 : 1
    x[i] = Math.tanh((body + click) * (1.2 + 1.2 * punch)) * a * 0.62
  }
  put(ctx, ctx.b.kick, t, x, vel, 0)
}

/** Palmas: cuatro ráfagas de ruido en banda separadas ~9 ms y su cola. */
export function clap(ctx: Ctx, t: number, vel: number, pan = 0): void {
  const x = buffer(0.4)
  const nz = noise(ctx.seed())
  const bp = new Svf(1150, 0.9)
  const hp = new OnePole(400)
  for (let i = 0; i < x.length; i++) {
    const s = i / SR
    let e = 0
    for (let k = 0; k < 4; k++) {
      const d = s - k * 0.0095
      if (d >= 0) e = Math.max(e, Math.exp(-d / 0.0055) * (k === 3 ? 1 : 0.8))
    }
    e = Math.max(e, s > 0.028 ? Math.exp(-(s - 0.028) / 0.11) * 0.6 : 0)
    bp.tick(nz())
    x[i] = hp.hp(bp.bp) * e * 0.9
  }
  put(ctx, ctx.b.drums, t, x, vel, pan, { room: 0.35, hall: 0.12 })
}

/** Caja: tono de 190 Hz y ruido en agudo (para redobles y el contratiempo de la noche). */
export function snare(ctx: Ctx, t: number, vel: number, pan = 0, snappy = 1): void {
  const x = buffer(0.32)
  const nz = noise(ctx.seed())
  const hp = new Svf(1800, 0.7)
  for (let i = 0; i < x.length; i++) {
    const s = i / SR
    const tone = Math.sin(TAU * (185 * s + 60 * 0.01 * (1 - Math.exp(-s / 0.01)))) * Math.exp(-s / 0.05) * 0.55
    hp.tick(nz())
    const sn = hp.hp * Math.exp(-s / (0.09 * snappy)) * 0.7
    x[i] = (tone + sn) * (s < 0.001 ? s / 0.001 : 1) * 0.7
  }
  put(ctx, ctx.b.drums, t, x, vel, pan, { room: 0.3, hall: 0.08 })
}

/** Rim suave del v3 (ruido en banda de ~1,8 kHz) con un poco de madera. */
export function rim(ctx: Ctx, t: number, vel: number, pan = -0.1): void {
  const x = buffer(0.2)
  const nz = noise(ctx.seed())
  const bp = new Svf(1800, 1.6)
  for (let i = 0; i < x.length; i++) {
    const s = i / SR
    bp.tick(nz())
    const wood = Math.sin(TAU * 820 * s) * Math.exp(-s / 0.012) * 0.5
    x[i] = (bp.bp * Math.exp(-s / 0.045) + wood) * 0.5
  }
  put(ctx, ctx.b.drums, t, x, vel, pan, { room: 0.3, hall: 0.15 })
}

const HAT_FREQS = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0]

/** Hat metálico: seis cuadradas inarmónicas (como una caja de ritmos) con ruido, en agudo. */
export function hat(ctx: Ctx, t: number, vel: number, open = false, pan = 0.25): void {
  const len = open ? 0.45 : 0.09
  const x = buffer(len)
  const nz = noise(ctx.seed())
  const bp = new Svf(9500, 1.1)
  const hp = new Svf(7000, 0.7)
  const ph = HAT_FREQS.map((_, k) => (k * 0.37) % 1)
  const decay = open ? 0.16 : 0.028
  for (let i = 0; i < x.length; i++) {
    const s = i / SR
    let m = 0
    for (let k = 0; k < 6; k++) {
      ph[k] += (HAT_FREQS[k] * 1.55) / SR
      if (ph[k] >= 1) ph[k] -= 1
      m += ph[k] < 0.5 ? 1 : -1
    }
    bp.tick(m / 6 + nz() * 0.45)
    hp.tick(bp.bp)
    x[i] = hp.hp * Math.exp(-s / decay) * (s < 0.0008 ? s / 0.0008 : 1) * 0.6
  }
  put(ctx, ctx.b.drums, t, x, vel, pan, { room: 0.18 })
}

/** Shaker del v3: ruido en agudo con ataque suave. */
export function shaker(ctx: Ctx, t: number, vel: number, pan = 0.35): void {
  const x = buffer(0.12)
  const nz = noise(ctx.seed())
  const hp = new Svf(6500, 0.8)
  for (let i = 0; i < x.length; i++) {
    const s = i / SR
    hp.tick(nz())
    const a = s < 0.006 ? s / 0.006 : Math.exp(-(s - 0.006) / 0.032)
    x[i] = hp.hp * a * 0.24
  }
  put(ctx, ctx.b.drums, t, x, vel, pan, { room: 0.12 })
}

/** Plato (golpes y logo): metal largo y suave, filtrado en agudo. */
export function crash(ctx: Ctx, t: number, vel: number, o: { decay?: number; bus?: 'drums' | 'fx' } = {}): void {
  const decay = o.decay ?? 1.4
  const l = buffer(decay * 3)
  const r = buffer(decay * 3)
  for (const [buf, sd] of [[l, 0], [r, 1]] as const) {
    const nz = noise(ctx.seed())
    const bp = new Svf(7200 + sd * 900, 0.6)
    const hp = new Svf(3500, 0.7)
    const ph = HAT_FREQS.map((_, k) => (k * 0.21 + sd * 0.5) % 1)
    for (let i = 0; i < buf.length; i++) {
      const s = i / SR
      let m = 0
      for (let k = 0; k < 6; k++) {
        ph[k] += (HAT_FREQS[k] * (1.21 + 0.03 * sd)) / SR
        if (ph[k] >= 1) ph[k] -= 1
        m += ph[k] < 0.5 ? 1 : -1
      }
      bp.tick(m / 6 * 0.6 + nz())
      hp.tick(bp.bp)
      const a = (s < 0.002 ? s / 0.002 : 1) * (Math.exp(-s / decay) * 0.8 + Math.exp(-s / 0.08) * 0.6)
      buf[i] = hp.hp * a * 0.3
    }
  }
  const fx = o.bus === 'fx'
  putStereo(ctx, fx ? ctx.b.fx : ctx.b.drums, t, l, r, vel, { hall: 0.25 }, fx)
}

/** Tic-tac del reloj (la intro: «un examen en nueve días»): madera aguda afinada a una nota del acorde. */
export function clockTick(ctx: Ctx, t: number, midi: number, vel: number, pan: number): void {
  const f = hz(midi)
  const x = buffer(0.12)
  const nz = noise(ctx.seed())
  const bp = new Svf(f * 2, 4)
  for (let i = 0; i < x.length; i++) {
    const s = i / SR
    bp.tick(nz())
    const tone = Math.sin(TAU * f * s) * Math.exp(-s / 0.018)
    x[i] = (tone * 0.7 + bp.bp * Math.exp(-s / 0.006) * 0.5) * (s < 0.0005 ? s / 0.0005 : 1) * 0.5
  }
  logNote(ctx, t, midi, 0.1, false)
  put(ctx, ctx.b.drums, t, x, vel, pan, { room: 0.25, echo: 0.12 })
}

// ───────────────────────────── efectos ─────────────────────────────

/** Clic suave de interfaz: un «pop» afinado (nota del acorde, ~1–1,5 kHz) con un tic de aire y un golpe corto de cuerpo. */
export function uiClick(ctx: Ctx, t: number, midi: number, vel: number, pan: number): void {
  const f = hz(midi)
  const x = buffer(0.16)
  const nz = noise(ctx.seed())
  const hp = new Svf(4200, 0.8)
  let ph = 0
  for (let i = 0; i < x.length; i++) {
    const s = i / SR
    const ff = f * (1 + 0.5 * Math.exp(-s / 0.0025))
    ph += ff / SR
    const pop = Math.sin(TAU * ph) * Math.exp(-s / 0.022)
    hp.tick(nz())
    const air = hp.hp * Math.exp(-s / 0.0016) * 0.45
    const body = Math.sin(TAU * 240 * s) * Math.exp(-s / 0.011) * 0.45
    x[i] = (pop * 0.75 + air + body) * (s < 0.0004 ? s / 0.0004 : 1) * 0.55
  }
  put(ctx, ctx.b.fx, t, x, vel, pan, { hall: 0.12, echo: 0.1 }, undefined, true)
}

/** Pulsación de tecla: tic de plástico en banda (2–4 kHz), una resonancia apenas afinada y el cuerpo de la tecla. */
export function keyTick(ctx: Ctx, t: number, midi: number, vel: number, pan: number, heavy = false): void {
  const x = buffer(0.08)
  const r = noise(ctx.seed())
  const fc = 2200 + 1800 * (0.5 + 0.5 * r())
  const bp = new Svf(fc, 1.3)
  const res = new Svf(hz(midi), 22)
  for (let i = 0; i < x.length; i++) {
    const s = i / SR
    const n = r()
    bp.tick(n)
    res.tick(n * Math.exp(-s / 0.004))
    const body = Math.sin(TAU * (heavy ? 120 : 165) * s) * Math.exp(-s / 0.009) * (heavy ? 0.6 : 0.35)
    x[i] = (bp.bp * Math.exp(-s / (heavy ? 0.009 : 0.0055)) + res.bp * 2.2 + body) * (s < 0.0003 ? s / 0.0003 : 1) * 0.5
  }
  put(ctx, ctx.b.fx, t, x, vel, pan, { hall: 0.05 }, undefined, true)
}

/** Aire de un movimiento: ruido en banda que sube hasta la máxima velocidad (`crest`, s desde `t`) y baja después,
 *  cruzando el estéreo, con un silbido afinado (nota del acorde que sube una quinta) para que suene dentro de la música. */
/** Carácter del aire según el gesto del plano: 'air' (corte), 'focus' (rack focus: un tono que entra afinado, como un
 *  enfoque), 'whip' (barrido rápido, brillante y de lado a lado), 'push' (empujón de cámara: grave y redondo) o 'paper'
 *  (cambio de contenido: un roce de papel). Así «aire + palabra» no suena igual en cada plano. */
export type WhooshStyle = 'air' | 'focus' | 'whip' | 'push' | 'paper'

const WHOOSH: Record<WhooshStyle, { lo: number; hi: number; noise: number; tone: number; q: number; glide: number; oct: number }> = {
  air: { lo: 1, hi: 1, noise: 0.9, tone: 0.75, q: 9, glide: 1.5, oct: 0 },
  focus: { lo: 1.2, hi: 0.8, noise: 0.35, tone: 1.5, q: 14, glide: 2 / 3, oct: 0 },
  whip: { lo: 1.8, hi: 1.7, noise: 1.1, tone: 0.3, q: 6, glide: 1.5, oct: 0 },
  push: { lo: 0.45, hi: 0.35, noise: 0.8, tone: 0.9, q: 8, glide: 1.25, oct: -12 },
  paper: { lo: 3.2, hi: 0.9, noise: 0.7, tone: 0.2, q: 5, glide: 1.1, oct: 0 }
}

export function whoosh(ctx: Ctx, t: number, len: number, crest: number, size: number, midi: number, vel: number, panFrom: number, panTo: number, style: WhooshStyle = 'air'): void {
  const w = WHOOSH[style]
  const l = buffer(len)
  const r = buffer(len)
  const lo = (240 + 600 * (1 - size)) * w.lo
  const hi = (2100 + 2100 * (1 - size)) * w.hi
  const f0 = hz(midi + w.oct)
  for (const [buf, sd] of [[l, 0], [r, 1]] as const) {
    const nz = noise(ctx.seed())
    const bp = new Svf(lo, 0.9)
    const tone = new Svf(f0, w.q)
    for (let i = 0; i < buf.length; i++) {
      const s = i / SR
      // envolvente: sube con curva hasta la cresta y cae más deprisa
      const e = s < crest ? Math.pow(s / crest, 2.2) : Math.exp(-(s - crest) / (0.06 + 0.16 * size))
      const p = s < crest ? s / crest : 1 - Math.min(1, (s - crest) / Math.max(0.05, len - crest))
      if ((i & 15) === 0) {
        bp.set(Math.max(80, Math.min(lo * Math.pow(Math.max(1.01, hi / lo), p), 12000)) * (sd ? 1.1 : 1), 0.9)
        // 'focus' llega a su nota en la cresta (de una quinta abajo); los demás suben una quinta al pasar
        tone.set(style === 'focus' ? f0 * Math.pow(w.glide, 1 - Math.min(1, s / crest)) : f0 * Math.pow(w.glide, p), w.q)
      }
      const n = nz()
      bp.tick(n)
      tone.tick(n)
      buf[i] = (bp.bp * w.noise + tone.bp * w.tone) * e
    }
  }
  if (style === 'whip') {
    panFrom = Math.sign(panTo - panFrom || 1) * -0.9
    panTo = -panFrom
  }
  // paneo que se mueve (por canal, de un lado a otro)
  for (let i = 0; i < l.length; i++) {
    const pan = panFrom + (panTo - panFrom) * (i / l.length)
    const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4
    const gl = Math.cos(a) * Math.SQRT2
    const gr = Math.sin(a) * Math.SQRT2
    const m = (l[i] + r[i]) * 0.5
    const sd = (l[i] - r[i]) * 0.5
    l[i] = (m + sd * 0.4) * gl
    r[i] = (m - sd * 0.4) * gr
  }
  putStereo(ctx, ctx.b.fx, t, l, r, vel, { hall: 0.18 }, true)
}

/** Barrido de luz: ruido cuyo filtro se abre (amanecer) o se cierra (anochecer) a lo largo de `len`. */
export function lightSweep(ctx: Ctx, t: number, len: number, toLight: boolean, vel: number): void {
  const tail = 0.5
  const l = buffer(len + tail)
  const r = buffer(len + tail)
  for (const [buf, sd] of [[l, 0], [r, 1]] as const) {
    const nz = noise(ctx.seed())
    const f = new Svf(400, 1.4)
    for (let i = 0; i < buf.length; i++) {
      const s = i / SR
      const p = Math.min(1, s / len)
      const q = toLight ? p : 1 - p
      if ((i & 15) === 0) f.set((toLight ? 300 : 260) * Math.pow(toLight ? 30 : 26, q) * (sd ? 1.07 : 1), 1.4)
      f.tick(nz())
      const e = s < len ? Math.pow(Math.sin(Math.PI * Math.min(1, p * (toLight ? 0.62 : 0.8) + 0.02)), 1.5) * (toLight ? Math.pow(p, 0.6) : 1) : Math.exp(-(s - len) / 0.12) * (toLight ? 0.92 : 0.3)
      buf[i] = (toLight ? f.bp * 0.8 + f.lp * 0.2 : f.bp) * e * 0.8
    }
  }
  // medio abierto, no dos ruidos sueltos a cada lado
  for (let i = 0; i < l.length; i++) {
    const m = (l[i] + r[i]) * 0.5
    const sd = (l[i] - r[i]) * 0.5
    l[i] = m + sd * 0.5
    r[i] = m - sd * 0.5
  }
  putStereo(ctx, ctx.b.fx, t, l, r, vel, { hall: 0.5 }, true)
}

/** Subida: ruido que se abre, tres sierras que suben una octava por un filtro que se abre y un pulso que acelera;
 *  termina en seco en t + len (el golpe va justo ahí). */
export function riser(ctx: Ctx, t: number, len: number, midi: number, vel: number): void {
  const l = buffer(len)
  const r = buffer(len)
  const f0 = hz(midi)
  for (const [buf, sd] of [[l, 0], [r, 1]] as const) {
    const nz = noise(ctx.seed())
    const bp = new Svf(300, 1.6)
    const lp = new Svf(500, 1.2)
    const ph = [0.1, 0.4, 0.7].map((x) => (x + sd * 0.23) % 1)
    const det = sd ? [1.006, 0.997, 1.0] : [0.994, 1.003, 1.0]
    for (let i = 0; i < buf.length; i++) {
      const s = i / SR
      const p = s / len
      if ((i & 15) === 0) {
        bp.set(280 * Math.pow(26, p), 1.6)
        lp.set(500 * Math.pow(14, p), 1.4)
      }
      const f = f0 * Math.pow(2, p)
      let saw = 0
      for (let k = 0; k < 3; k++) {
        const inc = (f * det[k]) / SR
        ph[k] += inc
        if (ph[k] >= 1) ph[k] -= 1
        saw += 2 * ph[k] - 1 - blep(ph[k], inc)
      }
      lp.tick(saw / 3)
      bp.tick(nz())
      // corta en seco (6 ms) y la última muestra vale 0: el golpe va justo después
      const end = s > len - 0.006 ? Math.max(0, len - 1 / SR - s) / 0.006 : 1
      buf[i] = (bp.bp * 0.75 + lp.lp * 0.32) * Math.pow(p, 2.0) * end
    }
  }
  putStereo(ctx, ctx.b.fx, t, l, r, vel, { hall: 0.15 }, true)
}

/** Golpe grave: seno que cae de 72 a 40 Hz con saturación suave, un estallido de ruido y la cola en la sala. */
export function boom(ctx: Ctx, t: number, vel: number, o: { len?: number; bus?: 'fx' | 'kick' } = {}): void {
  const len = o.len ?? 2.4
  const x = buffer(len)
  const nz = noise(ctx.seed())
  const lp = new Svf(4800, 0.7)
  for (let i = 0; i < x.length; i++) {
    const s = i / SR
    const ph = TAU * (52 * s + 34 * 0.08 * (1 - Math.exp(-s / 0.08)))
    const body = Math.sin(ph) * Math.exp(-s / 0.45)
    lp.tick(nz())
    const burst = lp.lp * Math.exp(-s / 0.07) * 0.5
    x[i] = Math.tanh((body * 1.4 + burst) * 1.2) * (s < 0.002 ? s / 0.002 : 1) * 0.6
  }
  const fx = (o.bus ?? 'fx') === 'fx'
  put(ctx, fx ? ctx.b.fx : ctx.b.kick, t, x, vel, 0, { hall: 0.22 }, undefined, fx)
}

/** Aire al revés que crece hasta `t` (para entrar en una cartela o en el logo). */
export function reverseSwell(ctx: Ctx, t: number, len: number, vel: number, fc = 2400): void {
  const l = buffer(len)
  const r = buffer(len)
  for (const [buf, sd] of [[l, 0], [r, 1]] as const) {
    const nz = noise(ctx.seed())
    const f = new Svf(fc * (sd ? 1.08 : 1), 0.8)
    for (let i = 0; i < buf.length; i++) {
      const p = i / buf.length
      f.tick(nz())
      buf[i] = f.bp * Math.pow(p, 3) * (p > 0.985 ? (1 - p) / 0.015 : 1) * 0.6
    }
  }
  putStereo(ctx, ctx.b.fx, t - len, l, r, vel, { hall: 0.4 }, true)
}

/** Golpe sordo y corto bajo una cartela (un «tum» de 60 Hz). */
export function thump(ctx: Ctx, t: number, vel: number): void {
  const x = buffer(0.5)
  for (let i = 0; i < x.length; i++) {
    const s = i / SR
    x[i] = Math.sin(TAU * (58 * s + 30 * 0.03 * (1 - Math.exp(-s / 0.03)))) * Math.exp(-s / 0.16) * (s < 0.003 ? s / 0.003 : 1) * 0.55
  }
  put(ctx, ctx.b.fx, t, x, vel, 0, { hall: 0.1 }, undefined, true)
}

/** El roce de un pincel que subraya: ruido en banda que sube un poco de tono a lo largo del trazo, suave y seco. */
export function brushStroke(ctx: Ctx, t: number, len: number, vel: number, pan: number): void {
  const x = buffer(len + 0.05)
  const nz = noise(ctx.seed())
  const bp = new Svf(1400, 1.3)
  for (let i = 0; i < x.length; i++) {
    const s = i / SR
    const p = Math.min(1, s / len)
    if ((i & 15) === 0) bp.set(1300 * Math.pow(2.2, p), 1.3)
    bp.tick(nz())
    const e = Math.pow(Math.sin(Math.PI * Math.min(1, p * 0.9 + 0.05)), 0.8) * (s > len ? Math.exp(-(s - len) / 0.015) : 1)
    x[i] = bp.bp * e * 0.5
  }
  put(ctx, ctx.b.fx, t, x, vel, pan, { hall: 0.12 }, pan + 0.3, true)
}

/** El ataque de un golpe en banda ancha (lo que un móvil sí reproduce): una palmada de cuatro ráfagas, el chasquido de
 *  una caja y un metal corto y brillante. Va con el grave del golpe (boom). */
export function hitTransient(ctx: Ctx, t: number, vel: number, pan: number): void {
  const len = 0.6
  const l = buffer(len)
  const r = buffer(len)
  for (const [buf, sd] of [[l, 0], [r, 1]] as const) {
    const nz = noise(ctx.seed())
    const bp = new Svf(1300 + 200 * sd, 0.8)
    const hp = new Svf(2600, 0.7)
    const metal = new Svf(7500 + 600 * sd, 1.4)
    const ph = HAT_FREQS.map((_, k) => (k * 0.29 + sd * 0.4) % 1)
    for (let i = 0; i < buf.length; i++) {
      const s = i / SR
      const n = nz()
      // palmada: cuatro ráfagas separadas ~8 ms y su cola
      let e = 0
      for (let k = 0; k < 4; k++) {
        const d = s - k * 0.008
        if (d >= 0) e = Math.max(e, Math.exp(-d / 0.005))
      }
      e = Math.max(e, s > 0.024 ? Math.exp(-(s - 0.024) / 0.09) * 0.55 : 0)
      bp.tick(n)
      // caja: tono de 200 Hz y ruido agudo
      const tone = Math.sin(2 * Math.PI * 230 * s) * Math.exp(-s / 0.045) * 0.35
      hp.tick(n)
      const snap = hp.hp * Math.exp(-s / 0.07) * 0.6
      // metal corto: las cuadradas de los hats, brillantes, con caída de ~0,2 s
      let m = 0
      for (let k = 0; k < 6; k++) {
        ph[k] += (HAT_FREQS[k] * 1.4) / SR
        if (ph[k] >= 1) ph[k] -= 1
        m += ph[k] < 0.5 ? 1 : -1
      }
      metal.tick(m / 6 * 0.7 + n * 0.5)
      const met = metal.bp * Math.exp(-s / 0.2) * 0.7
      buf[i] = (bp.bp * e * 1.1 + tone + snap + met) * (s < 0.0008 ? s / 0.0008 : 1) * 0.6
    }
  }
  const [gl, gr] = [Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2, Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2]
  for (let i = 0; i < l.length; i++) {
    const mm = (l[i] + r[i]) * 0.5
    const sd = (l[i] - r[i]) * 0.5
    l[i] = (mm + sd * 0.5) * gl
    r[i] = (mm - sd * 0.5) * gr
  }
  putStereo(ctx, ctx.b.fx, t, l, r, vel, { hall: 0.3 }, true)
}
