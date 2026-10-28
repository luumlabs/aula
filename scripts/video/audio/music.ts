// Banda sonora por síntesis (OfflineAudioContext, en la página del compositor), sincronizada con el montaje:
// acordes por compás (cifrado o grados), secciones con su arreglo (piano, alba, día, noche, final), el motivo del sol en
// los cues, oleadas y golpes en los cortes y un «tic» de madera en cada clic. Determinista (azar con semilla).
import type { Music, MusicSection, Voice } from '../montage/types.ts'
import { bassNote, parseChord, voice, type Chord } from './chords.ts'
import { bass, bell, bubble, clap, coin, flatline, giggle, heartbeat, hit, impulse, kick, marimba, pad, piano, plip, pluck, pop, puffSound, shaker, slosh, sparkle, swell, tick, zap, blip, type Bus } from './instruments.ts'
import type { SfxEvent } from './sfx.ts'

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Grado diatónico (0 = I) → cifrado con séptima («Em7», «Gmaj7»…), para las progresiones por grados. */
function degreeChord(root: number, d: number): string {
  const r = (root + MAJOR[((d % 7) + 7) % 7]) % 12
  const quality = ['maj7', 'm7', 'm7', 'maj7', '7', 'm7', 'm7'][((d % 7) + 7) % 7]
  return NOTE[r] + quality
}

const DEFAULT_MOTIF: [number, number][] = [
  [-5, 0.5],
  [0, 1],
  [2, 1],
  [4, 3]
]
const DEFAULT_MINOR: [number, number][] = [
  [-8, 0.5],
  [-3, 1],
  [-1, 1],
  [0, 3]
]

function sectionAt(sections: MusicSection[] | undefined, bar: number): MusicSection {
  let s: MusicSection = { bar: 1, style: 'piano' }
  for (const x of sections ?? []) if (x.bar <= bar) s = x
  return s
}

function play(v: Voice, b: Bus, t: number, midi: number, vel: number, dur: number, pan: number): void {
  if (v === 'marimba') marimba(b, t, midi, vel, pan)
  else if (v === 'pluck') pluck(b, t, midi, vel, pan)
  else if (v === 'bell') bell(b, t, midi, vel, pan)
  else piano(b, t, midi, vel, dur, pan)
}

export interface Score {
  channels: Float32Array[]
  sampleRate: number
}

/** Compone y sintetiza `duration` segundos. `clicks`: instantes de los clics del montaje (para los «tic»). */
export async function renderMusic(m: Music, duration: number, clicks: number[] = [], sfx: SfxEvent[] = [], sampleRate = 48000, opts: { effectsOnly?: boolean } = {}): Promise<Score> {
  const rand = rng(m.seed ?? 7)
  const ac = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate)
  const master = ac.createGain()
  const comp = ac.createDynamicsCompressor()
  comp.threshold.value = -18
  comp.ratio.value = 2.5
  comp.attack.value = 0.02
  comp.release.value = 0.25
  master.connect(comp)
  comp.connect(ac.destination)
  if (!opts.effectsOnly) {
    master.gain.setValueAtTime(0, 0)
    master.gain.linearRampToValueAtTime(1, 0.3)
    master.gain.setValueAtTime(1, Math.max(0.4, duration - 1.6))
    master.gain.linearRampToValueAtTime(0, duration)
  }
  const verb = ac.createConvolver()
  verb.buffer = impulse(ac, 3.2, rand)
  const wet = ac.createGain()
  wet.gain.value = 0.32
  verb.connect(wet)
  wet.connect(master)
  const b: Bus = { ac, dry: master, wet: verb, rand }

  if (!opts.effectsOnly) arrange(b, m, duration, rand)
  effects(b, m, duration, clicks, sfx)
  const out = await ac.startRendering()
  return { channels: [out.getChannelData(0).slice(), out.getChannelData(1).slice()], sampleRate }
}

/** El arreglo sintetizado: acordes por compás, secciones y cues. */
function arrange(b: Bus, m: Music, duration: number, rand: () => number): void {
  const beat = 60 / m.bpm
  const bar = beat * 4
  const endCue = m.cues.find((q) => q.kind === 'end')?.t ?? duration
  const bars = Math.ceil(endCue / bar - 1e-6)
  const symbols = m.chords?.length ? m.chords : (m.progression ?? [0, 4, 5, 3]).map((d) => degreeChord(m.root, d))
  let prevVoicing: number[] | undefined
  for (let i = 0; i < bars; i++) {
    const t0 = i * bar
    const sec = sectionAt(m.sections, i + 1)
    const chord: Chord = parseChord(symbols[Math.min(i, symbols.length - 1)] ?? 'C')
    const notes = voice(chord, m.root + 2, prevVoicing)
    prevVoicing = notes
    const low = bassNote(chord, m.root - 26)
    const len = Math.min(bar, endCue - t0)
    const light = sec.light ?? (sec.style === 'night' ? 0.15 : sec.style === 'dawn' ? 0.4 : sec.style === 'day' ? 1 : 0.6)
    pad(b, t0, notes.map((n) => n - 12), len, sec.style === 'night' ? 0.55 : 0.45, light)
    if (len < bar - 0.01 || sec.style === 'end') {
      bass(b, t0, low, len)
      continue
    }
    const energy = Math.min(1, 0.55 + (0.45 * t0) / Math.max(1, duration))
    switch (sec.style) {
      case 'piano': {
        bass(b, t0, low, beat * 2)
        bass(b, t0 + beat * 2, low + (i % 2 ? 7 : 0), beat * 2)
        const pattern = [0, 1, 2, 3, 2, 1, 2, 3]
        for (let k = 0; k < 8; k++) {
          const n = notes[pattern[k] % notes.length] + (k >= 4 && i % 2 ? 12 : 0)
          piano(b, t0 + k * (beat / 2) + (rand() - 0.5) * 0.008, n, (k % 2 ? 0.48 : 0.62) * energy + rand() * 0.05, beat * 0.9, (pattern[k] - 1.5) * 0.25)
        }
        piano(b, t0, notes[0] - 12, 0.55 * energy, bar * 0.95, -0.2)
        break
      }
      case 'dawn': {
        bass(b, t0, low, bar, 0.22)
        marimba(b, t0, notes[0] + 12, 0.5, -0.3)
        marimba(b, t0 + beat * 2, notes[notes.length - 1] + 12, 0.42, 0.3)
        break
      }
      case 'day': {
        for (const k of [0, 1.5, 2, 3.5]) bass(b, t0 + k * beat, low + (k === 3.5 ? 12 : 0), beat * (k % 1 ? 0.5 : 1.4), 0.26)
        kick(b, t0, 0.4)
        kick(b, t0 + beat * 2, 0.36)
        for (let k = 0; k < 8; k++) shaker(b, t0 + k * (beat / 2), k % 2 ? 0.7 : 1, k % 2 ? 0.35 : 0.2)
        if (sec.claps) {
          clap(b, t0 + beat, 0.8)
          clap(b, t0 + beat * 3, 0.8)
        }
        const pattern = [0, 2, 1, 3, 2, 1, 3, 2]
        for (let k = 0; k < 8; k++) pluck(b, t0 + k * (beat / 2), notes[pattern[k] % notes.length] + 12, k % 2 ? 0.5 : 0.7, (pattern[k] - 1.5) * 0.3)
        break
      }
      case 'night': {
        bass(b, t0, low - 12, bar * 0.95, 0.3)
        for (let k = 0; k < 4; k++) pluck(b, t0 + k * beat, notes[k % notes.length] - 12, 0.45, (k - 1.5) * 0.25, 0.5)
        for (let k = 0; k < 8; k++) shaker(b, t0 + k * (beat / 2), 0.35, 0.25)
        kick(b, t0, 0.28)
        break
      }
    }
  }
  const motifOf = (minor?: boolean) => (minor ? (m.minorMotif ?? DEFAULT_MINOR) : (m.motif ?? DEFAULT_MOTIF))
  for (const q of m.cues) {
    if (q.kind === 'motif') {
      const notes = motifOf(q.minor)
      const top = m.root + 12 + 12 * (q.octave ?? 0)
      // la primera nota es anacrusa: el cue cae en la segunda
      let t = q.t - notes[0][1] * beat
      notes.forEach(([st, beats], k) => {
        play(q.voice ?? 'bell', b, t, top + st, 0.85 - k * 0.05, beats * beat, -0.25 + k * 0.15)
        t += beats * beat
      })
    } else if (q.kind === 'swell') swell(b, q.t, Math.min(2.4, bar * 0.75))
    else if (q.kind === 'hit') hit(b, q.t)
    else if (q.kind === 'end') {
      const final = voice(parseChord(symbols[symbols.length - 1].includes('add9') ? symbols[symbols.length - 1] : NOTE[m.root % 12] + 'add9'), m.root + 2)
      ;[final[0] - 12, ...final, final[0] + 12].forEach((n, k) => piano(b, q.t + k * 0.035, n, 0.6, 4, (k - 2.5) * 0.15))
      bell(b, q.t + 0.4, m.root + 24, 0.6, 0.2)
      hit(b, q.t, 0.35)
    }
  }
}

/** Los «tic» de los clics y los sonidos de los personajes, calibrados para una música a −14 LUFS. */
function effects(b: Bus, m: Music, duration: number, clicks: number[], sfx: SfxEvent[]): void {
  if (m.clicks !== null) {
    const level = Math.pow(10, (m.clicks ?? -18) / 20) * 8
    for (const t of clicks) if (t < duration) tick(b, t, level)
  }
  if (m.sfx !== null) {
    // los personajes suenan por debajo de la música (−12 dB por defecto); sin reverberación larga para que se entiendan
    const level = Math.pow(10, (m.sfx ?? -12) / 20) * 4
    for (const e of sfx) {
      if (e.t >= duration) continue
      if (e.kind === 'heartbeat') heartbeat(b, e.t, level)
      else if (e.kind === 'flatline') flatline(b, e.t, e.dur ?? 0.3, level)
      else if (e.kind === 'zap') zap(b, e.t, level)
      else if (e.kind === 'giggle') giggle(b, e.t, e.n, level)
      else if (e.kind === 'heart') sparkle(b, e.t, level * 0.8, e.n + 2)
      else if (e.kind === 'bubble') bubble(b, e.t, level, 0.9 + (e.n % 4) * 0.08)
      else if (e.kind === 'plip') plip(b, e.t, level)
      else if (e.kind === 'splash') puffSound(b, e.t, level * 1.3)
      else if (e.kind === 'slosh') slosh(b, e.t, level, !!e.right)
      else if (e.kind === 'puff') puffSound(b, e.t, level)
      else if (e.kind === 'sparkle') sparkle(b, e.t, level, e.n)
      else if (e.kind === 'note') blip(b, e.t, level, e.n)
      else if (e.kind === 'coin') coin(b, e.t, level)
      else if (e.kind === 'pop') pop(b, e.t, level)
    }
  }
}
