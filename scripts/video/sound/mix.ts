// Mezcla: el colchón con el filtro que sigue la luz y el bombeo del bombo, ecos y reverberaciones, cada bus a su
// sonoridad, el respiro antes del drop, la música que se aparta un poco bajo cada efecto (ducking) y el máster a
// −14 LUFS con el pico verdadero por debajo de −2,5 dBTP (el AAC sube hasta ~0,7 dB: queda ≤ −1,5 dBTP en el archivo).
import { integratedLoudness, samplePeak, truePeak, type MasterReport } from '../audio/loudness.ts'
import { addInto, db, envelope, fdnReverb, highpass, pingPong, saturate, scale, SR, Stereo, Svf, sweepLowpass, tilt } from './dsp.ts'
import { integratedLoudness as lufsOf, limit } from '../audio/loudness.ts'
import type { Plan } from './arrange.ts'
import type { Sheet } from './sheet.ts'
import type { Buses } from './voices.ts'

/** Sonoridad de cada bus antes del máster (LUFS integrados de lo que suena). La suma queda hacia −19 LUFS. */
export const STEM_LUFS: Record<'film' | 'short', Record<string, number>> = {
  // la película con el reparto del v3 (teclas y colchón delante, bajo cerca, percusión 4 dB por debajo, reverb a 5–6)
  film: { pad: -23.5, keys: -23.5, bells: -26, bass: -24, kick: -27.5, drums: -29.5, hall: -29, room: -35 },
  short: { pad: -28, keys: -25, bells: -27, bass: -24.5, kick: -23.5, drums: -25.5, hall: -30.5, room: -33 }
}

/** Ganancia de los efectos respecto a la música normalizada (dB). */
export const FX_DB = -9

export interface MixReport {
  stems: Record<string, { lufs: number; gainDb: number }>
  master: MasterReport
  fxLufs: number
  musicLufs: number
  duckMaxDb: number
}

export interface MixOut {
  mix: Stereo
  music: Stereo
  fx: Stereo
  report: MixReport
}

/** Curva de ganancia del bombeo (cada golpe de bombo hunde el colchón y el bajo y los suelta en ~150 ms). */
export function pumpCurve(n: number, kicks: Plan['kicks']): Float32Array {
  const g = new Float32Array(n).fill(1)
  const len = Math.round(0.45 * SR)
  for (const k of kicks) {
    const i0 = Math.round(k.t * SR)
    for (let j = 0; j < len; j++) {
      const i = i0 + j
      if (i < 0 || i >= n) continue
      const x = j / SR
      const shape = x < 0.004 ? x / 0.004 : Math.exp(-(x - 0.004) / 0.12)
      g[i] *= 1 - k.depth * shape
    }
  }
  return g
}

/** Ganancia 0 en los respiros (con rampas de 4 ms). */
export function gateCurve(n: number, gaps: Plan['gaps']): Float32Array {
  const g = new Float32Array(n).fill(1)
  const r = Math.round(0.004 * SR)
  for (const [a, b] of gaps) {
    const i0 = Math.round(a * SR)
    const i1 = Math.round(b * SR)
    for (let i = Math.max(0, i0 - r); i < Math.min(n, i1 + r); i++) {
      let v = 0
      if (i < i0) v = (i0 - i) / r
      else if (i >= i1) v = (i - i1) / r
      g[i] = Math.min(g[i], Math.min(1, v))
    }
  }
  return g
}

function applyCurve(s: Stereo, g: Float32Array, amount = 1): void {
  for (let i = 0; i < s.L.length; i++) {
    const k = 1 - amount * (1 - g[i])
    s.L[i] *= k
    s.R[i] *= k
  }
}

function stemLufs(s: Stereo): number {
  return integratedLoudness([s.L, s.R], SR)
}

/** Lleva un bus a `target` LUFS (si suena algo) y devuelve su sonoridad original y la ganancia. */
function level(s: Stereo, target: number): { lufs: number; gainDb: number } {
  const l = stemLufs(s)
  if (!Number.isFinite(l)) return { lufs: -Infinity, gainDb: 0 }
  const g = target - l
  scale(s, db(g))
  return { lufs: +l.toFixed(2), gainDb: +g.toFixed(2) }
}

/** `boost(t)` (0–1): dónde la película sube subgraves y brillo (el drop y la subida); en el corto vale siempre 1. */
/** `lift(t)` (dB): la automatización de nivel de la música por secciones (que ninguna se caiga). */
/** `warm(t)` (dB): un recorte extra por encima de 4 kHz (las secciones de día de la película, más cálidas como el v3). */
export function mixdown(sh: Sheet, b: Buses, plan: Plan, light: (t: number) => number, boost: (t: number) => number = () => 1, hits: number[] = [], lift: (t: number) => number = () => 0, warm: (t: number) => number = () => 0): MixOut {
  const n = b.pad.L.length
  const short = sh.mode === 'short'
  const targets = STEM_LUFS[sh.mode]
  // colchón: el filtro sigue la luz (cerrado de noche, abierto de día) con una respiración lenta
  // (como el v3: 780 Hz de noche y ~2,3 kHz de día; en el drop, la subida y el corto, hasta 3,9 kHz)
  sweepLowpass(b.pad, (t) => 760 * Math.pow((2300 + 1600 * boost(t)) / 760, light(t)) * (1 + 0.07 * Math.sin(2 * Math.PI * 0.11 * t)), 0.8)
  const pump = pumpCurve(n, plan.kicks)
  applyCurve(b.pad, pump, 1)
  applyCurve(b.bass, pump, short ? 0.9 : 0.75)
  applyCurve(b.keys, pump, 0.35)
  // el respiro antes del drop (las colas de reverb siguen: el aire queda)
  const gate = gateCurve(n, plan.gaps)
  for (const s of [b.pad, b.keys, b.bass, b.kick, b.drums]) applyCurve(s, gate)
  // las campanas callan antes de los golpes, pero no en el respiro del drop (ahí suena la anacrusa del motivo)
  applyCurve(b.bells, gateCurve(n, plan.hitGaps))
  // ecos ping-pong a corchea con puntillo
  const echo = new Stereo(n)
  pingPong(b.echo, echo, sh.beat * 0.75, 0.38, 1)
  addInto(b.keys, echo, 0.9)
  const fxEcho = new Stereo(n)
  pingPong(b.fxEcho, fxEcho, sh.beat * 0.75, 0.34, 1)
  // batería: un poco de saturación y aire
  saturate(b.drums, 1.25)
  clipCrest(b.drums, 12)
  clipCrest(b.kick, 11)
  tilt(b.drums, 200, -1.5, 6000, -2)
  saturate(b.kick, 1.1)
  // reverberaciones (sala larga para la música, corta para la batería, otra para los efectos)
  const hall = fdnReverb(b.hall, { rt60: short ? 2.0 : 2.7, size: 1.0, damp: 0.38, predelay: 0.03, width: short ? 1 : 0.6 })
  const room = fdnReverb(b.room, { rt60: 0.65, size: 0.5, damp: 0.25, predelay: 0.008, width: short ? 1 : 0.6 })
  const fxHall = fdnReverb(b.fxHall, { rt60: 2.3, size: 0.9, damp: 0.4, predelay: 0.02, width: short ? 1 : 0.6 })
  for (const r of [hall, room, fxHall]) highpass(r, 160)
  // en los respiros también se recoge la sala de la música (queda un poco de aire): el golpe llega sobre casi silencio
  applyCurve(hall, gate, 0.7)
  applyCurve(room, gate, 0.7)

  // efectos: su eco y su sala, a un nivel fijo respecto a la música (no dependen de cuántos haya)
  const fx = new Stereo(n)
  addInto(fx, b.fx)
  addInto(fx, fxEcho, 0.8)
  addInto(fx, fxHall, 1)
  highpass(fx, 45)
  // antes de cada golpe fuerte callan también las colas de los efectos (la semicorchea de silencio que lo hace subir)
  applyCurve(fx, gateCurve(n, plan.hitGaps), 0.85)
  // los picos se recortan ANTES de la ecualización: así lo que añade el recorte también sale cálido
  clipCrest(fx, 13)
  // en la película los efectos también son cálidos (un poco menos de aire), salvo en el drop y la subida
  if (!short) {
    ride(fx, 60, () => 0, 4000, (t) => -4 + 4 * boost(t))
    highShelf(fx, 4000, warm)
  }
  // en el corto, los golpes también con menos sub (en el móvil no existe): la energía va a la palmada y al metal
  else ride(fx, 70, () => -5, 6000, () => 0)
  scale(fx, db(FX_DB))
  // la música se aparta bajo cada efecto (lo dispara el sonido directo, no las colas): todo ~−3 dB y lo melódico, que
  // vive en el mismo registro que las palabras y los clics, ~−6 dB; vuelve en ~200 ms
  const dry = new Stereo(n)
  addInto(dry, b.fx, db(FX_DB))
  const env = envelope(dry, 0.004, 0.2)
  const duckAll = new Float32Array(n)
  const duckKeys = new Float32Array(n)
  let duckMax = 0
  // en los golpes (drop, impactos, logo) la música no se aparta: el golpe y la música suben juntos
  const free = new Uint8Array(n)
  for (const t of hits) for (let i = Math.max(0, Math.round((t - 0.02) * SR)); i < Math.min(n, Math.round((t + 0.6) * SR)); i++) free[i] = 1
  for (let i = 0; i < n; i++) {
    const k = free[i] ? 0 : env[i] / (env[i] + 0.05)
    // el corto, con efectos en cada pulso, se aparta menos: si no, la música entera baja tras el drop
    duckAll[i] = 1 - (short ? 0.18 : 0.3) * k
    duckKeys[i] = 1 - (short ? 0.3 : 0.5) * k
    duckMax = Math.max(duckMax, 0.5 * k)
  }
  const stems: MixReport['stems'] = {}
  const named: [string, Stereo][] = [['pad', b.pad], ['keys', b.keys], ['bells', b.bells], ['bass', b.bass], ['kick', b.kick], ['drums', b.drums], ['hall', hall], ['room', room]]
  const music = new Stereo(n)
  for (const [name, s] of named) {
    stems[name] = level(s, targets[name])
    applyCurve(s, name === 'keys' || name === 'bells' ? duckKeys : duckAll)
    if (name !== 'hall' && name !== 'room') for (let i = 0; i < n; i += 256) {
      const g = db(lift(i / SR))
      for (let k = i; k < Math.min(n, i + 256); k++) {
        s.L[k] *= g
        s.R[k] *= g
      }
    }
    addInto(music, s)
  }
  highpass(music, short ? 45 : 30)
  // el carácter cálido del v3: menos sub y menos aire, salvo donde la película pide pegada (boost)
  if (short) ride(music, 70, () => -5.5, 4500, () => 0, { f: 350, db: () => 4 })
  // (el cuerpo de la película, un paso más cálido: −8 dB por encima de 4 kHz)
  else {
    ride(music, 70, () => 0.5, 4000, (t) => -8 + 8 * boost(t), { f: 350, db: (t) => 1 * boost(t) })
    highShelf(music, 4000, warm)
  }
  const musicLufs = stemLufs(music)
  const fxLufs = stemLufs(fx)
  const mix = new Stereo(n)
  addInto(mix, music)
  addInto(mix, fx)
  // fundido final corto (lo último del acorde no se corta en seco)
  const fade = Math.round(Math.min(1.5, sh.duration * 0.05) * SR)
  for (let k = 0; k < fade; k++) {
    const g = Math.cos(((Math.PI / 2) * k) / fade)
    const i = n - fade + k
    if (i < 0) continue
    mix.L[i] *= g
    mix.R[i] *= g
  }
  const fin = Math.round(0.004 * SR)
  for (let i = 0; i < fin; i++) {
    mix.L[i] *= i / fin
    mix.R[i] *= i / fin
  }
  // −2,5 dBTP en el WAV: con los golpes de banda ancha el AAC sube el pico hasta ~0,7 dB y el archivo debe quedar ≤ −1,5
  const rep = masterTruePeak(mix, -14, -2.5)
  return {
    mix,
    music,
    fx,
    report: { stems, master: { ...rep, lufs: +rep.lufs.toFixed(2), truePeak: +rep.truePeak.toFixed(2), samplePeak: +rep.samplePeak.toFixed(2), gainDb: +rep.gainDb.toFixed(2) }, fxLufs: +fxLufs.toFixed(2), musicLufs: +musicLufs.toFixed(2), duckMaxDb: +(20 * Math.log10(1 - duckMax)).toFixed(2) }
  }
}

export { truePeak }

/** Paso bajo de 2 polos a 17 kHz en el máster: lo de más arriba no se oye en un vídeo (el AAC lo corta) y sus picos
 *  entre muestras son los que suben el pico verdadero. */
export function airCut(s: Stereo, fc = 17000): void {
  for (const ch of [s.L, s.R]) {
    const f = new Svf(fc, 0.6)
    for (let i = 0; i < ch.length; i++) {
      f.tick(ch[i])
      ch[i] = f.lp
    }
  }
}

/** Máster a `lufs` con el pico VERDADERO por debajo de `tp`: el limitador mira muestras, así que se repite con el techo
 *  más bajo hasta que el pico entre muestras (sobremuestreado ×4) también cumple. Deja el resultado en `mix`. */
export function masterTruePeak(mix: Stereo, lufs: number, tp: number): MasterReport {
  airCut(mix)
  const src = [mix.L.slice(), mix.R.slice()]
  let ceiling = tp - 0.3
  let out = src
  let gainDb = 0
  for (let pass = 0; pass < 8; pass++) {
    out = src.map((c) => c.slice())
    // ganancia a la sonoridad pedida, limitador y un retoque de ganancia (lo que el limitador quitó), dos veces
    gainDb = lufs - lufsOf(out, SR)
    for (const c of out) for (let i = 0; i < c.length; i++) c[i] *= db(gainDb)
    for (let k = 0; k < 2; k++) {
      lowLimit(out, ceiling - 4)
      limit(out, SR, ceiling)
      const d = lufs - lufsOf(out, SR)
      if (Math.abs(d) < 0.03) break
      gainDb += d
      for (const c of out) for (let i = 0; i < c.length; i++) c[i] *= db(d)
    }
    lowLimit(out, ceiling - 4)
    limit(out, SR, ceiling)
    const peakTp = truePeak(out)
    if (peakTp <= tp) break
    ceiling -= peakTp - tp + 0.05
  }
  mix.L.set(out[0])
  mix.R.set(out[1])
  return { lufs: lufsOf(out, SR), truePeak: truePeak(out), samplePeak: samplePeak(out), gainDb }
}

/** Limitador solo de los graves (< 150 Hz, separados por resta, así la suma es exacta): los picos de bombo, bajo y golpe
 *  grave se recogen aquí y el limitador general ya no hunde los medios y agudos de cada golpe (lo que se oye en un
 *  móvil). */
export function lowLimit(ch: Float32Array[], ceilingDb: number): void {
  const lows = ch.map((x) => {
    const f = new Svf(150, 0.6)
    const y = new Float32Array(x.length)
    for (let i = 0; i < x.length; i++) {
      f.tick(x[i])
      y[i] = f.lp
    }
    return y
  })
  const highs = ch.map((x, k) => x.map((v, i) => v - lows[k][i]))
  limit(lows, SR, ceilingDb, 0.012, 0.18)
  ch.forEach((x, k) => {
    for (let i = 0; i < x.length; i++) x[i] = lows[k][i] + highs[k][i]
  })
}

/** Estanterías grave y aguda cuya ganancia (dB) cambia con el tiempo (evaluada cada 256 muestras). */
export function ride(s: Stereo, fLow: number, lowDb: (t: number) => number, fHigh: number, highDb: (t: number) => number, mid?: { f: number; db: (t: number) => number }): void {
  for (const ch of [s.L, s.R]) {
    const lo = new Svf(fLow, 0.6)
    const hi = new Svf(fHigh, 0.6)
    const md = new Svf(mid?.f ?? 350, 0.8)
    let kl = 0
    let kh = 0
    let km = 0
    for (let i = 0; i < ch.length; i++) {
      if ((i & 255) === 0) {
        kl = db(lowDb(i / SR)) - 1
        kh = db(highDb(i / SR)) - 1
        km = mid ? db(mid.db(i / SR)) - 1 : 0
      }
      const x = ch[i]
      lo.tick(x)
      hi.tick(x)
      if (mid) md.tick(x)
      ch[i] = x + kl * lo.lp + kh * hi.hp + km * md.bp
    }
  }
}

/** Recorta con suavidad los picos que pasan de `crestDb` sobre el valor eficaz del bus (medido donde suena): las
 *  palmadas, cajas y ataques de los golpes conservan su cuerpo, pero sus picos de 1–2 ms ya no hacen trabajar al
 *  limitador del máster (que hundiría todo lo que suena con ellos). */
export function clipCrest(s: Stereo, crestDb: number): void {
  let acc = 0
  let cnt = 0
  for (let i = 0; i < s.L.length; i += 4) {
    const v = s.L[i] * s.L[i] + s.R[i] * s.R[i]
    if (v > 1e-8) {
      acc += v / 2
      cnt++
    }
  }
  if (!cnt) return
  const thr = Math.sqrt(acc / cnt) * db(crestDb)
  for (const ch of [s.L, s.R])
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i])
      if (a > thr) ch[i] = Math.sign(ch[i]) * thr * (1 + 0.5 * Math.tanh((a - thr) / (0.5 * thr)))
    }
}

/** Estantería aguda exacta: separa lo de arriba como el complemento de un paso bajo (la suma es exacta, sin fase que
 *  la deshaga) y le aplica `gainDb(t)`. Es la que da a las secciones de día de la película sus −2 dB por encima de 4 kHz. */
export function highShelf(s: Stereo, fc: number, gainDb: (t: number) => number): void {
  for (const ch of [s.L, s.R]) {
    const lp = new Svf(fc, Math.SQRT1_2)
    let k = 0
    for (let i = 0; i < ch.length; i++) {
      if ((i & 255) === 0) k = db(gainDb(i / SR)) - 1
      const x = ch[i]
      lp.tick(x)
      if (k) ch[i] = x + k * (x - lp.lp)
    }
  }
}
