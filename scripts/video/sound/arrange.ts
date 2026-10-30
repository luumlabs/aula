// El arreglo: qué toca cada instrumento en cada compás según el carácter de la sección (intro con tensión, drop, día,
// noche, cartela, subida, final), en 'film' (~104 BPM, sereno con pegada) o 'short' (~120 BPM, batería con más pulso).
// Devuelve además dónde golpea el bombo (para el bombeo del colchón y el bajo) y los respiros antes de cada drop.
import { rng } from './dsp.ts'
import { chordTones, type BarHarmony } from './harmony.ts'
import type { Sheet } from './sheet.ts'
import { bass, bell, clap, clockTick, epiano, glock, hat, kick, marimba, padChord, pluck, rim, shaker, snare, type Ctx } from './voices.ts'

export interface Plan {
  /** Golpes de bombo con la profundidad del bombeo que provocan (0–1). */
  kicks: { t: number; depth: number }[]
  /** Tramos en que la música calla (el respiro antes del drop), [desde, hasta) en s. */
  gaps: [number, number][]
  /** Los de antes de cada golpe fuerte (una semicorchea): ahí calla también lo que suena en las campanas. */
  hitGaps: [number, number][]
}

/** Los respiros: media negra antes de cada drop y de cada final que viene de una subida. */
export function gapsFor(sh: Sheet, H: BarHarmony[]): [number, number][] {
  const out: [number, number][] = []
  for (const h of H) {
    if (h.pos !== 0 || h.bar < 2) continue
    const prev = H[h.bar - 2]
    if (h.kind === 'drop' || (h.kind === 'end' && prev?.kind === 'rise')) out.push([h.t - sh.beat / 2, h.t])
  }
  return out
}

/** `hits`: instantes de los golpes fuertes (impact, flash, logo): la música calla una semicorchea antes de cada uno. */
export function arrange(ctx: Ctx, sh: Sheet, H: BarHarmony[], hits: number[] = []): Plan {
  const rand = rng(sh.seed * 31 + 5)
  const hum = (v: number, k = 0.06) => v * (1 - k + 2 * k * rand())
  const beat = sh.beat
  const e8 = beat / 2
  const e16 = beat / 4
  const short = sh.mode === 'short'
  const kicks: Plan['kicks'] = []
  // respiros: media negra antes de cada drop y del final tras la subida, y una semicorchea antes de cada golpe fuerte
  // (así cada golpe sube, también en el altavoz de un móvil)
  const gaps = gapsFor(sh, H)
  const hitGaps: [number, number][] = []
  const sorted = [...hits].sort((a, b) => a - b)
  sorted.forEach((t, k) => {
    if (gaps.some(([a, b]) => t > a - 1e-3 && t <= b + 1e-3)) return
    // el primero de una tanda (la ráfaga tras el drop, «Mac · Windows · Linux»…) respira una corchea, como el drop; los
    // siguientes, una semicorchea (con una corchea en cada pulso la música quedaría a trozos)
    // (en la ráfaga, el compás que sigue al drop, el golpe del pulso 3 respira como el del 1: los tiempos fuertes)
    const first = k === 0 || t - sorted[k - 1] > 1.3
    const strongBeat = H.some((x) => x.kind === 'drop' && Math.abs(t - (x.t + sh.bar + 2 * beat)) < 0.03)
    hitGaps.push([t - (first || strongBeat ? 2 * e16 : e16), t])
  })
  gaps.push(...hitGaps)
  const inGap = (t: number) => gaps.some(([a, b]) => t >= a - 0.002 && t < b)
  // la pegada del bombo: suave y redonda como el v3 en la película, dura en el drop, la subida y el corto
  let barPunch = 0.45
  const K = (t: number, vel: number, depth: number, punch = barPunch) => {
    if (inGap(t) || t >= sh.duration) return
    kick(ctx, t, vel, punch)
    kicks.push({ t, depth })
  }
  const play = (t: number, f: () => void) => {
    if (!inGap(t) && t < sh.duration && t >= -0.2) f()
  }

  // el compás 0 (anacrusa antes del downbeat) suena como el primero
  const lead = sh.downbeat > 0.05 ? [{ ...H[0], bar: 0, t: H[0].t - sh.bar, pos: -1 }] : []
  const bars = [...lead, ...H].filter((h) => h.t < sh.duration)

  for (const h of bars) {
    const t0 = h.t
    // una subida larga: hasta los dos últimos compases suena como el día a tope; el redoble va solo al final
    const rollBars = Math.min(2, h.len)
    const building = h.kind === 'rise' && h.len - h.pos > rollBars
    const kind = building ? 'day' : h.kind
    const rollPos = h.pos - (h.len - rollBars)
    const e = building ? 1 : h.energy
    // variante del capítulo: A, B (más brillo), C (calmado), D (en subida); la subida larga suena como la D
    const v = building ? 3 : h.variant
    // la película mantiene el carácter del v3 (bajo en la octava 3, shaker y rim, sin hats); el drop, la subida y el
    // corto suben subgraves, brillo y batería
    // (el compás que sigue al drop, la ráfaga de la película, también va a tope)
    const afterDrop = h.pos >= 0 && H[h.bar - 2]?.kind === 'drop' && h.kind !== 'drop'
    const punchy = short || h.kind === 'drop' || h.kind === 'rise' || afterDrop
    const lively = punchy || v >= 3
    barPunch = short ? 0.9 : punchy ? 0.6 : 0.25
    const at = (b: number) => t0 + b * beat
    const last = h.pos === h.len - 1
    const p = h.len > 1 ? Math.max(0, h.pos) / (h.len - 1) : 1
    const next = H[h.bar] // compás siguiente (índice 0-based = bar)
    const beforeDrop = last && (next?.kind === 'drop' || (h.kind === 'rise' && next?.kind === 'end'))

    // ── colchón ──
    if (h.kind === 'end') {
      // el final: re (con el golpe del logo) – sol/re (plagal) – re que se queda hasta el último segundo
      const final = h.pos >= 2 || last || !next || next.t >= sh.duration
      const toEnd = Math.max(sh.bar, sh.duration - t0 - 0.4)
      if (h.pos <= 2) padChord(ctx, t0 - 0.02, [48 + h.chord.root, ...h.pad], final ? toEnd : sh.bar + 0.05, h.pos === 0 ? 0.04 : 0.7, final ? 2.4 : 1.4, 1.0)
    } else {
      const soft = h.kind === 'intro' || h.kind === 'card' || h.kind === 'break'
      const amp = h.kind === 'intro' ? 0.8 : h.kind === 'card' ? 1.0 : h.kind === 'night' ? (h.variant === 1 ? 1.05 : 0.78) : h.kind === 'break' ? 0.9 : short ? 0.9 : 0.86
      // en el golpe del drop el acorde entra entero de golpe (tras el hueco)
      const hitBar = (h.kind === 'drop' || afterDrop) && h.pos === 0
      padChord(ctx, hitBar ? t0 : t0 - 0.06, [48 + h.chord.root, ...h.pad], sh.bar + (hitBar ? 0 : 0.06), hitBar ? 0.02 : soft ? 1.0 : 0.35, 1.3, hitBar ? 1.0 : amp)
    }

    // ── bajo ──
    const root = h.bass
    switch (kind) {
      case 'intro':
        if (h.pos >= 1 || h.len === 1) play(t0, () => bass(ctx, t0, root + (short ? 0 : 12), sh.bar - 0.05, 0.55, 'sustain'))
        break
      case 'card':
      case 'break':
        play(t0, () => bass(ctx, t0, root + (short ? 0 : 12), sh.bar - 0.05, 0.6, 'sustain'))
        break
      case 'night':
        if (short) {
          // la noche del corto no afloja: el bajo sintetizado sigue en corcheas (con el sub largo debajo)
          play(t0, () => bass(ctx, t0, root, sh.bar - 0.04, 0.55, 'sustain'))
          for (let k = 0; k < 8; k++) play(t0 + k * e8, () => bass(ctx, t0 + k * e8, root + (k % 4 === 2 ? 12 : 0), e8 * 0.9, hum(k % 2 ? 0.55 : 0.75), 'synth'))
        } else if (v >= 2) play(t0, () => bass(ctx, t0, root + 12, sh.bar - 0.04, 0.7, 'sustain'))
        else for (let k = 0; k < 8; k++) play(t0 + k * e8, () => bass(ctx, t0 + k * e8, root + 12, e8 * 0.95, hum(k % 2 ? 0.6 : 0.8), 'soft'))
        break
      case 'end':
        // el bajo sostiene el golpe del logo compás y medio y se va: el final queda en el colchón y las campanas
        if (h.pos === 0) play(t0, () => bass(ctx, t0, root, Math.min(sh.duration - t0 - 2, sh.bar * 1.2), 0.45, 'sustain', 1.6))
        break
      default: {
        if (!punchy) {
          // día de la película: las corcheas del bajo senoidal del v3, en la octava 3
          for (let k = 0; k < 8; k++) play(t0 + k * e8, () => bass(ctx, t0 + k * e8, root + 12, e8 * 0.95, hum(k % 2 ? 0.7 : 0.9), 'soft'))
          break
        }
        // drop, subida y corto: corcheas con salto de octava, en la octava 2 y con armónicos
        const vels = [1, 0.55, 0.8, 0.55, 0.9, 0.55, 0.8, 0.62]
        const oct = [0, 0, 12, 0, 0, 0, 12, 0]
        for (let k = 0; k < 8; k++) {
          const tk = t0 + k * e8
          const up = h.kind === 'rise' && last && k >= 4 ? 12 : 0
          play(tk, () => bass(ctx, tk, root + oct[k] + up, e8 * 0.92, hum(vels[k] * (0.75 + 0.25 * e)), short ? 'synth' : 'pulse'))
        }
      }
    }

    // ── batería ──
    switch (kind) {
      case 'intro': {
        // el reloj del examen: tic-tac en negras (corcheas en el corto) y un latido que aparece
        // en la octava 4–5, por debajo de las palabras (que van de sol5 hacia arriba)
        const tones = chordTones(h.pcs, 67, 79)
        const hi = tones[tones.length - 1] ?? 78
        const lo = tones[0] ?? 69
        const step = short ? e8 : beat
        for (let k = 0; k * step < sh.bar - 1e-6; k++) {
          const tk = t0 + k * step
          play(tk, () => clockTick(ctx, tk, k % 2 ? lo : hi, 0.42 + 0.18 * p, k % 2 ? 0.18 : -0.18))
        }
        if (h.pos >= 1 || h.len === 1 || short) {
          for (const b of short ? [0, 1, 2, 3] : [0, 2]) {
            K(at(b), 0.5, 0.15, 0.2)
            K(at(b) + 0.19, 0.3, 0.1, 0.2)
          }
        }
        if (last && next?.kind === 'drop') {
          // redoble que crece hacia el drop (las dos últimas negras, antes del respiro)
          for (let k = 8; k < 14; k++) play(t0 + k * e16, () => snare(ctx, t0 + k * e16, 0.12 + 0.05 * (k - 8), 0, 0.6))
        }
        break
      }
      case 'card': {
        K(t0, 0.55, 0.2, 0.3)
        if (short) for (let k = 0; k < 8; k++) play(t0 + k * e8, () => hat(ctx, t0 + k * e8, k % 2 ? 0.25 : 0.12))
        break
      }
      case 'break':
        break
      case 'night': {
        const swing = 0.07 * beat
        if (short) {
          for (const b of [0, 1.5, 2.5]) K(at(b), b ? 0.7 : 0.95, 0.45)
          clap1(at(1), 0.7)
          clap1(at(3), 0.75)
          for (let k = 0; k < 16; k++) play(t0 + k * e16 + (k % 2 ? swing * 0.5 : 0), () => hat(ctx, t0 + k * e16 + (k % 2 ? swing * 0.5 : 0), hum(k % 4 === 2 ? 0.32 : k % 2 ? 0.16 : 0.22)))
        } else if (v === 1) {
          // noche B (Ask, en mitad de la película): bombo sincopado, contratiempo con palmas y shaker en semicorcheas;
          // es la noche con más vida, para que el centro no se caiga
          K(t0, 0.9, 0.42)
          K(at(1.75), 0.5, 0.2)
          K(at(2.5), 0.6, 0.25)
          play(at(2), () => rim(ctx, at(2), 0.6))
          play(at(2), () => snare(ctx, at(2), 0.35, 0.05, 0.8))
          play(at(2), () => clap(ctx, at(2), 0.32))
          for (let k = 0; k < 16; k++) {
            const tk = t0 + k * e16 + (k % 2 ? swing * 0.5 : 0)
            play(tk, () => shaker(ctx, tk, hum(k % 4 === 2 ? 0.95 : k % 2 ? 0.45 : 0.6), 0.3))
          }
          for (const b of [1.5, 3.5]) play(at(b), () => hat(ctx, at(b), 0.16, true, b < 2 ? 0.25 : -0.25))
        } else if (v >= 2) {
          // noche C: casi nada, el bombo, el rim y un shaker a contratiempo
          K(t0, 0.75, 0.35)
          play(at(2), () => rim(ctx, at(2), 0.5))
          for (let k = 1; k < 8; k += 2) play(t0 + k * e8, () => shaker(ctx, t0 + k * e8, hum(0.45), 0.3))
        } else {
          K(t0, 0.85, 0.42)
          K(at(2.5), 0.5, 0.25)
          play(at(2), () => rim(ctx, at(2), 0.55))
          play(at(2), () => snare(ctx, at(2), 0.18, 0.05, 0.8))
          for (let k = 0; k < 8; k++) {
            const tk = t0 + k * e8 + (k % 2 ? swing : 0)
            play(tk, () => shaker(ctx, tk, hum(k % 2 ? 0.8 : 0.4), 0.3))
          }
        }
        break
      }
      case 'rise': {
        // bombo en negras que crece, redoble que acelera (corcheas → semicorcheas → fusas) y hats
        const prog = (k: number) => (rollPos + k / 16) / rollBars
        for (let b = 0; b < 4; b++) K(at(b), 0.6 + 0.4 * prog(b * 4), 0.25)
        for (let k = 0; k < 16; k++) {
          const q = prog(k)
          // primera mitad en corcheas, luego semicorcheas y el último 20 % en fusas
          if (q < 0.5 && k % 2) continue
          const tk = t0 + k * e16
          const vel = 0.18 + 0.62 * Math.pow(q, 1.4)
          play(tk, () => snare(ctx, tk, vel, 0, 0.7))
          if (q >= 0.8) play(tk + e16 / 2, () => snare(ctx, tk + e16 / 2, vel * 0.85, 0, 0.7))
          play(tk, () => hat(ctx, tk, 0.12 + 0.2 * q))
        }
        break
      }
      case 'end':
        // el plato del drop y del final lo pone el golpe (impact, flash o logo, que la forma añade si faltan)
        break
      default: {
        // drop y día
        if (short) {
          for (let b = 0; b < 4; b++) K(at(b), hum(0.95, 0.03), 0.38)
          clap1(at(1), 0.85)
          clap1(at(3), 0.9)
          for (let k = 0; k < 16; k++) {
            const tk = t0 + k * e16
            if (k % 4 === 2) play(tk, () => hat(ctx, tk, hum(0.34), true, 0.2))
            else play(tk, () => hat(ctx, tk, hum(k % 2 ? 0.2 : 0.3)))
          }
        } else if (v === 2 && h.kind === 'day') {
          // día C, calmado: medio tiempo (bombo en 1 y 3 y medio, palmas solo en el 3)
          K(t0, 0.85, 0.3)
          K(at(2.5), 0.45, 0.18)
          play(at(2), () => clap(ctx, at(2), hum(0.38)))
          play(at(0), () => rim(ctx, at(0), 0.2))
          for (let k = 0; k < 8; k++) {
            const tk = t0 + k * e8
            play(tk, () => shaker(ctx, tk, hum(k % 2 ? 0.7 : 0.35), 0.35))
          }
        } else if (!lively) {
          // día A y B de la película: el pulso del v3 (bombo en 1 y 3, shaker en corcheas, rim en 2 y 4); B suma palmas
          // suaves y un contratiempo abierto
          K(t0, 0.85, 0.3)
          K(at(2), 0.72, 0.26)
          for (let k = 0; k < 8; k++) play(t0 + k * e8, () => shaker(ctx, t0 + k * e8, hum(k % 2 ? 0.9 : 0.45), 0.35))
          play(at(1), () => rim(ctx, at(1), 0.55))
          play(at(3), () => rim(ctx, at(3), 0.65))
          if (v === 1) {
            play(at(1), () => clap(ctx, at(1), hum(0.22)))
            play(at(3), () => clap(ctx, at(3), hum(0.25)))
            play(at(3.5), () => hat(ctx, at(3.5), 0.14, true, -0.2))
          }
        } else {
          // drop, día D y subida: día A con más pegada; D va a negras (cuatro al suelo)
          const four = v >= 3 && h.kind !== 'drop'
          if (four) for (let b = 0; b < 4; b++) K(at(b), b % 2 ? 0.8 : 0.95, 0.34)
          else {
            K(t0, 0.92, 0.32)
            // (en la ráfaga, el 3 lo lleva el golpe: el bombo baja para que no se lo coma el limitador)
            K(at(2), afterDrop ? 0.55 : 0.85, 0.3)
            if (e >= 0.9 || v === 1) K(at(1.5), 0.5, 0.18)
          }
          play(at(1), () => clap(ctx, at(1), hum(0.32 + 0.3 * e)))
          play(at(3), () => clap(ctx, at(3), hum(0.36 + 0.3 * e)))
          if (four) for (const b of [1, 3]) play(at(b), () => snare(ctx, at(b), 0.22, 0, 0.8))
          play(at(1), () => rim(ctx, at(1), 0.25))
          play(at(3), () => rim(ctx, at(3), 0.3))
          for (let k = 0; k < 8; k++) {
            const tk = t0 + k * e8
            play(tk, () => hat(ctx, tk, hum(k % 2 ? 0.36 : 0.18) * (0.6 + 0.4 * e)))
          }
          for (let k = 0; k < 16; k++) {
            const tk = t0 + k * e16
            play(tk, () => shaker(ctx, tk, hum(k % 2 ? 0.55 : 0.3) * e, 0.35))
          }
          if (v >= 1) for (const b of [1.5, 3.5]) play(at(b), () => hat(ctx, at(b), 0.2, true, b < 2 ? 0.2 : -0.2))
          else if (e >= 0.85) play(at(3.5), () => hat(ctx, at(3.5), 0.22, true, -0.2))
        }
      }
    }

    // ── teclas: marimba, piano eléctrico, pluck ──
    const arp = h.arp
    switch (kind) {
      case 'intro': {
        if (h.pos >= 1 || h.len === 1) {
          const notes: [number, number][] = [[0, 0], [1.5, 2], [3, 4]]
          if (last) notes.push([2.25, 1], [3.5, 3])
          for (const [b, k] of notes) play(at(b), () => marimba(ctx, at(b), arp[k], hum(0.3 + 0.15 * p), k % 2 ? 0.3 : -0.3, { decay: 0.7, sends: { hall: 0.55, echo: 0.35 } }))
        }
        break
      }
      case 'card': {
        // la campana de la cartela suena en el 1: la marimba entra después y por debajo de ella
        for (let b = 1; b < 4; b++) play(at(b), () => marimba(ctx, at(b), arp[[4, 2, 3, 1][b]], 0.26, b % 2 ? 0.3 : -0.3, { decay: 0.9, bright: 0.85, sends: { hall: 0.6, echo: 0.4 } }))
        break
      }
      case 'break': {
        for (const b of [0, 2]) play(at(b), () => h.pad.forEach((m, k) => epiano(ctx, at(b) + k * 0.012, m, 0.36, beat * 1.6, (k - 2) * 0.2)))
        break
      }
      case 'night': {
        if (!short && v === 1) {
          // noche B: el piano eléctrico arpegia el acorde en corcheas, arriba y abajo
          const up = [...h.pad, h.pad[1] + 12]
          const seq = [0, 1, 2, 3, 4, 3, 2, 1]
          for (let k = 0; k < 8; k++) play(t0 + k * e8, () => epiano(ctx, t0 + k * e8, up[seq[k] % up.length], hum(k % 2 ? 0.44 : 0.58), e8 * 1.6, (seq[k] - 2) * 0.22))
          // y la marimba de la noche del v3, una octava abajo, en el 1, el 2 y medio y el 4
          for (const [b, k] of [[0, 0], [1.5, 2], [3, 4]] as const) play(at(b), () => marimba(ctx, at(b), arp[k] - 12, 0.5, k % 4 ? 0.28 : -0.28, { decay: 0.55, bright: 0.8 }))
          break
        }
        if (!short && v >= 2) {
          // noche C: un acorde largo y la marimba en negras, lejos
          play(t0, () => h.pad.forEach((m, k) => epiano(ctx, t0 + k * 0.015, m, hum(0.38), sh.bar * 0.95, (k - 2) * 0.2)))
          for (const [b, k] of [[0, 0], [1.5, 2], [3, 4]] as const) play(at(b), () => marimba(ctx, at(b), arp[k], 0.4, k % 4 ? 0.3 : -0.3, { decay: 0.8, bright: 0.7, sends: { hall: 0.6, echo: 0.4 } }))
          break
        }
        // noche A: el acorde en el 1 y un eco en el 3 (en el corto, también el contratiempo del 2)
        play(t0, () => h.pad.forEach((m, k) => epiano(ctx, t0 + k * 0.01, m, hum(0.42), beat * 1.3, (k - 2) * 0.2)))
        if (short) play(at(1.5), () => h.pad.slice(-3).forEach((m, k) => epiano(ctx, at(1.5) + k * 0.008, m, hum(0.3), beat * 0.45, (k - 1) * 0.25)))
        play(at(3), () => h.pad.slice(-3).forEach((m, k) => epiano(ctx, at(3) + k * 0.008, m, hum(0.26), beat * 0.7, (k - 1) * 0.25)))
        const pattern = [0, 2, 4, 2, 1, 3, 4, 3]
        for (let k = 0; k < 8; k++) {
          const tk = t0 + k * e8
          const note = arp[pattern[(k + h.bar) % 8]] + (short ? 0 : -12)
          if (short) {
            play(tk, () => pluck(ctx, tk, note, hum(k % 2 ? 0.36 : 0.5), k % 2 ? 0.3 : -0.3, { cutoff: 3000, decay: 0.28 }))
            play(tk, () => marimba(ctx, tk, note - 12, hum(k % 2 ? 0.38 : 0.5), k % 2 ? -0.25 : 0.25, { decay: 0.5, bright: 0.9 }))
          }
          else play(tk, () => marimba(ctx, tk, note, hum(k % 2 ? 0.38 : 0.55) * 0.9, k % 2 ? 0.28 : -0.28, { decay: 0.55, bright: 0.75 }))
        }
        break
      }
      case 'rise': {
        for (let k = 0; k < 16; k++) {
          const tk = t0 + k * e16
          const q = (rollPos + k / 16) / rollBars
          const note = arp[k % 4] + 12 * Math.floor((k % 8) / 4) + (q > 0.5 ? 12 : 0)
          play(tk, () => (short ? pluck(ctx, tk, note, 0.25 + 0.3 * q, k % 2 ? 0.3 : -0.3) : marimba(ctx, tk, note, 0.26 + 0.3 * q, k % 2 ? 0.28 : -0.28, { decay: 0.35, bright: 1.1 })))
        }
        break
      }
      case 'end': {
        if (h.pos === 0) {
          const top = chordTones(h.pcs, 74, 84).reverse()
          ;[1, 1.5, 2, 3].forEach((b, k) => play(at(b), () => marimba(ctx, at(b), top[k % top.length], 0.42 - 0.04 * k, (k % 2 ? 0.2 : -0.2), { decay: 1.0, bright: 1.05, bus: 'bells', sends: { hall: 0.75, echo: 0.35 } })))
        } else if (h.pos === 1) {
          const tones = chordTones(h.pcs, 79, 88)
          tones.slice(0, 3).forEach((m, k) => play(t0 + k * 0.05, () => bell(ctx, t0 + k * 0.05, m, 0.28 - 0.05 * k, (k - 1) * 0.3, { decay: 2.4 })))
        } else if (h.pos === 2) {
          const tones = chordTones(h.pcs, 74, 90)
          tones.slice(0, 4).forEach((m, k) => play(t0 + k * 0.07, () => bell(ctx, t0 + k * 0.07, m, 0.32 - 0.04 * k, (k - 1.5) * 0.3, { decay: 3.0 })))
          play(at(1), () => glock(ctx, at(1), tones[tones.length - 1] + 12, 0.25, 0.2, { bus: 'bells', decay: 1.6, sends: { hall: 0.7, echo: 0.4 } }))
        }
        break
      }
      default: {
        // drop y día
        if (short) {
          const pattern = [0, 1, 2, 4, 2, 1, 3, 4, 0, 2, 1, 3, 4, 3, 2, 1]
          for (let k = 0; k < 16; k++) {
            const tk = t0 + k * e16
            play(tk, () => pluck(ctx, tk, arp[pattern[k]] + 12, hum(k % 4 === 0 ? 0.6 : k % 2 ? 0.34 : 0.45), k % 2 ? 0.32 : -0.32, { decay: 0.22 }))
          }
          // y la marimba del v3 en corcheas debajo: el día del corto no baja de energía tras el drop
          for (let k = 0; k < 8; k++) {
            const tk = t0 + k * e8
            play(tk, () => marimba(ctx, tk, arp[[0, 2, 4, 2, 1, 3, 4, 3][(k + h.bar) % 8]], hum(k % 2 ? 0.4 : 0.55), k % 2 ? 0.28 : -0.28, { decay: 0.4, bright: 1.1 }))
          }
        } else if (v === 2 && h.kind === 'day') {
          // día C, calmado: marimba en negras y el piano eléctrico en el 1 y el 3
          for (let b = 0; b < 4; b++) play(at(b), () => marimba(ctx, at(b), arp[[0, 2, 4, 3][b]], hum(b ? 0.42 : 0.55), b % 2 ? 0.28 : -0.28, { decay: 0.8, bright: 0.9 }))
          for (const b of [0, 2]) play(at(b), () => h.pad.forEach((m, k) => epiano(ctx, at(b) + k * 0.012, m, 0.3, beat * 1.7, (k - 2) * 0.2)))
        } else {
          // día A (y D): la marimba en corcheas del v3; B y D le suman un pluck brillante en semicorcheas
          const pattern = v === 1 ? [0, 4, 2, 4, 1, 4, 3, 4] : [0, 2, 4, 2, 1, 3, 4, 3]
          for (let k = 0; k < 8; k++) {
            const tk = t0 + k * e8
            let vel = k % 2 === 0 ? 0.62 : 0.42
            if (k === 0) vel *= 1.2
            play(tk, () => marimba(ctx, tk, arp[pattern[(k + h.bar) % 8]], hum(vel * (0.8 + 0.2 * e)), k % 2 ? 0.28 : -0.28, { decay: 0.45, bright: 0.95 + 0.2 * e }))
          }
          if (short && v >= 1 && h.kind !== 'drop') {
            const sparkle = [4, 2, 3, 1, 4, 2, 3, 0, 4, 2, 3, 1, 4, 3, 2, 3]
            for (let k = 0; k < 16; k++) {
              const tk = t0 + k * e16
              play(tk, () => pluck(ctx, tk, arp[sparkle[k]] + 12, hum(k % 4 === 0 ? 0.3 : 0.18), k % 2 ? 0.45 : -0.45, { decay: 0.16, cutoff: 4200, sends: { hall: 0.25, echo: 0.2 } }))
            }
          }
        }
      }
    }

    // ── el motivo de Aula en el drop: la (anacrusa en el respiro) – re – mi – fa# (5-1-2-3), campana y glock ──
    if (h.kind === 'drop' && h.pos === 0) {
      const tonic = 62 + ((sh.key - 2 + 12) % 12)
      const motif: [number, number, number][] = [[-e8, tonic - 5 + 12, 0.5], [0, tonic + 12, 0.75], [beat, tonic + 14, 0.6], [2 * beat, tonic + 16, 0.7]]
      for (const [dt, note, v] of motif) {
        bell(ctx, t0 + dt, note, v * 0.75, -0.1 + dt * 0.1, { decay: dt >= 2 * beat ? 2.6 : 1.4 })
        glock(ctx, t0 + dt, note + 12, v * 0.45, 0.15, { bus: 'bells', decay: 1.1 })
      }
      // el golpe del drop tiene que subir también en un móvil: el acorde a tope en la marimba (y el pluck en el corto),
      // palmada y caja en el 1, además del golpe de los efectos
      h.pad.forEach((m, k) => marimba(ctx, t0 + k * 0.006, m + 12, 0.35, (k - 2) * 0.25, { decay: 0.9, bright: 1.3, sends: { hall: 0.5, echo: 0.3 } }))
      if (short) h.pad.forEach((m, k) => pluck(ctx, t0, m + 12, 0.4, (k - 2) * 0.3, { decay: 0.4, cutoff: 6000 }))
      clap(ctx, t0, 0.5)
      snare(ctx, t0, 0.4, 0, 1)
    }
    // el primer compás tras el drop (la ráfaga) arranca con el mismo golpe: acorde a tope, palmada y caja
    if (afterDrop && h.pos === 0 && !short) {
      h.pad.forEach((m, k) => marimba(ctx, t0 + k * 0.006, m + 12, 0.35, (k - 2) * 0.25, { decay: 0.8, bright: 1.3, sends: { hall: 0.45, echo: 0.3 } }))
      clap(ctx, t0, 0.5)
      snare(ctx, t0, 0.4, 0, 1)
      // la ráfaga son cuatro golpes, uno por pulso: palmada y caja también en el 2 (el 1 y el 3 ya la llevan)
      play(at(2), () => {
        clap(ctx, at(2), 0.6)
        snare(ctx, at(2), 0.3, 0, 1)
      })
    }
    if (beforeDrop && !short && h.kind !== 'intro' && h.kind !== 'rise') {
      for (let k = 12; k < 14; k++) play(t0 + k * e16, () => snare(ctx, t0 + k * e16, 0.2, 0, 0.6))
    }
  }

  function clap1(t: number, vel: number): void {
    if (inGap(t) || t >= sh.duration) return
    clap(ctx, t, hum(vel))
    snare(ctx, t, vel * 0.32, 0, 0.7)
  }

  return { kicks, gaps, hitGaps }
}
