// El corto V5 para redes (28 s, 120 BPM): gancho desde el fotograma 0 («Exam in nine days.» sobre los materiales que
// vuelan), drop con el amanecer a los 2 s, 12 imágenes con 2–4 palabras enormes y el final con el icono, «Aula», «Free &
// open source» y la dirección. Un solo guion para los tres formatos: aula-v5-short.ts (16:9), aula-v5-short-vertical.ts
// (9:16) y aula-v5-short-square.ts (1:1). Reutiliza las tomas de la película V5 (mismas definiciones → misma huella).
// Guion: scratchpad/aula2/video/v5/GUION.md §2.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bpmGrid } from './grid.ts'
import film5, { TAKE_AT } from './aula-v5-film.ts'
import { defineMontage, type CameraKey, type Clip, type Montage, type Section, type SfxCue, type Title } from './types.ts'

export const SHORT_BPM = 120
const BARS = 13
const G = bpmGrid(SHORT_BPM, (BARS * 4 * 60) / SHORT_BPM, 0)
const BEAT = G.beat
const BAR = G.barDur
const V = (bar: number, beat = 1, frac = 0): number => +G.V(bar, beat, frac).toFixed(4)
const DURATION = +(V(BARS + 1)).toFixed(2)
const S = TAKE_AT.see
const D = TAKE_AT.docs
const NIGHT = '#15110F'
const DAY = '#F6EFE4'

type Fmt = 'h' | 'v' | 's'
type Side = 'left' | 'right'

/** Una imagen del corto: de `t0` a `t1` (s), de la toma `take` desde `from`; `ui` es el lado de la interfaz en 16:9 (en
 *  vertical y cuadrado el motor pone el titular arriba y el panel abajo). `split` corta a un primer plano en ese pulso. */
interface Img {
  t0: number
  t1: number
  take: string
  from: number
  ui: Side
  zoom: number
  focus: [number, number]
  close?: { at: number; zoom: number; focus: [number, number] }
  /** Encuadre propio en vertical y cuadrado (si el de 16:9 corta lo que importa). */
  vfocus?: [number, number]
  vzoom?: number
  words: string
  enter?: Clip['enter']
}

const CUT: Clip['enter'] = { kind: 'cut', dur: 0 }
const IMGS: Img[] = [
  // la losa del icono se hace ventana (3,0): el día del examen → «Prepare for this exam» (clic en 4,0, se ve la reacción)
  { t0: V(2, 3), t1: V(3, 2), take: 'morning', from: 14.87 - 1.0, ui: 'right', zoom: 1.45, focus: [1150, 330], close: { at: V(2, 4), zoom: 1.85, focus: [1170, 320] }, words: 'One *click.*' },
  { t0: V(3, 2), t1: V(4), take: 'morning', from: 28.6, ui: 'left', zoom: 1.4, focus: [650, 430], close: { at: V(3, 4), zoom: 1.8, focus: [720, 440] }, words: 'It builds the *course.*' },
  { t0: V(4), t1: V(4, 4), take: 'main', from: 8.6, ui: 'right', zoom: 1.75, focus: [800, 330], words: 'Explains your *mistake.*' },
  { t0: V(4, 4), t1: V(5, 3), take: 'main', from: 47.09 - 2 * BEAT, ui: 'left', zoom: 1.6, focus: [840, 470], words: 'Touch the *diagram.*', enter: { kind: 'whip', dur: 0.3, dir: 'left' } },
  { t0: V(5, 3), t1: V(6, 2), take: 'see', from: S.nacl + 0.8, ui: 'right', zoom: 1.85, focus: [844, 350], words: 'Spin it in *3D.*' },
  { t0: V(6, 2), t1: V(7), take: 'see', from: S.proj + 0.3, ui: 'left', zoom: 1.5, focus: [855, 430], close: { at: V(6, 4), zoom: 1.9, focus: [855, 400] }, words: 'Play with *physics.*' },
  { t0: V(7), t1: V(8), take: 'main', from: 75.37 - 3 * BEAT, ui: 'right', zoom: 1.5, focus: [1000, 300], vfocus: [1110, 330], vzoom: 1.0, words: 'Just *ask.*', enter: { kind: 'light', style: 'dusk', dur: 2 * BEAT } },
  { t0: V(8), t1: V(8, 4), take: 'main', from: 83.6, ui: 'left', zoom: 1.8, focus: [1000, 520], vfocus: [880, 560], vzoom: 1.75, words: 'Quizzes in the *chat.*' },
  { t0: V(8, 4), t1: V(9, 3), take: 'docs', from: D.export + 0.2, ui: 'right', zoom: 1.7, focus: [928, 415], words: 'Practice exams, *printed.*' },
  { t0: V(10, 3), t1: V(11, 2), take: 'main', from: 93.4, ui: 'right', zoom: 1.85, focus: [560, 500], words: 'Any AI. Even *offline.*', enter: CUT },
  { t0: V(11, 2), t1: V(12), take: 'main', from: 101.8, ui: 'left', zoom: 0.85, focus: [720, 450], vzoom: 0.62, words: 'Mac. Windows. *Linux.*' }
]

/** h = 16:9 (YouTube, X, Reddit) · v = 9:16 (TikTok, Reels, Shorts) · s = 1:1. */
export function buildV5Short(fmt: Fmt): Montage {
  const size: [number, number] = fmt === 'v' ? [1080, 1920] : fmt === 's' ? [1080, 1080] : [1920, 1080]
  const big = fmt === 'v' ? 112 : fmt === 's' ? 92 : 124
  // en vertical y cuadrado la ventana se ve más cerca (el panel es más estrecho): el mismo encuadre con más zoom
  const zk = fmt === 'h' ? 1 : 1.12
  const clips: Clip[] = []
  const titles: Title[] = []
  IMGS.forEach((m, i) => {
    const banded = fmt !== 'h'
    const fz = banded && m.vzoom ? m.vzoom / zk : m.zoom
    const ff = banded && m.vfocus ? m.vfocus : m.focus
    const pieces = m.close ? [[m.t0, m.close.at, fz, ff], [m.close.at, m.t1, m.close.zoom, m.close.focus]] as const : [[m.t0, m.t1, fz, ff]] as const
    pieces.forEach(([a, b, z, f], k) => {
      const dur = +(b - a).toFixed(4)
      const camera: CameraKey[] = [{ t: 0, zoom: +Math.min(2, z * zk).toFixed(3), focus: f }, { t: dur, zoom: +Math.min(2, z * zk * 1.05).toFixed(3), focus: f }]
      clips.push({
        take: m.take, start: a, dur, from: +(m.from + (a - m.t0)).toFixed(3), camera,
        layout: { kind: 'keynote', side: fmt === 'h' ? m.ui : 'right', size: 0.62 },
        enter: k > 0 ? CUT : i === 0 ? { kind: 'icon', dur: BEAT } : (m.enter ?? CUT)
      })
    })
    // el primer titular espera a que la losa del icono sea ventana
    // el primer titular espera a que la losa acabe de hacerse ventana (3,5)
    const ts = i === 0 ? V(2, 4) : m.t0
    const hold = IMGS[i + 1]?.enter?.kind === 'light' ? 0.3 : 0
    titles.push({ start: ts, dur: +(m.t1 - ts + hold - 0.002).toFixed(4), text: m.words, style: 'keynote', side: m.ui === 'left' ? 'right' : 'left', size: big, underline: false })
  })
  // la revelación: «Meet Aula.» enorme bajo el icono (2,25–3,0)
  titles.push({ start: V(2, 1, 0.45), dur: +(V(2, 3) - V(2, 1, 0.45) - 0.002).toFixed(4), text: 'Meet *Aula.*', style: 'type', size: fmt === 'v' ? 150 : fmt === 's' ? 120 : 150, at: [0.5, fmt === 'v' ? 0.66 : 0.76], underline: {} })
  // «Study anything.»: la ola de los iconos pintados, sin interfaz
  titles.push({ start: V(9, 3), dur: +(V(10, 3) - V(9, 3) - 0.002).toFixed(4), text: 'Study *anything.*', style: 'keynote', side: 'left', size: big, underline: {} })
  // el gancho: entero desde el fotograma 0
  titles.unshift({ start: 0, dur: +(V(2) - 0.002).toFixed(4), text: 'Exam in *nine days.*', style: 'type', instant: true, underline: {} })
  // el final: icono con el sol (22,0), «Aula» (23,0), la línea y la dirección (completas antes de 25,0)
  titles.push({ start: V(12, 3), dur: +(DURATION - V(12, 3)).toFixed(4), text: 'Free & *open source.*', style: 'type', underline: {}, size: fmt === 'h' ? 76 : 70, at: fmt === 'v' ? [0.5, 0.64] : [0.5, 0.74] })
  titles.push({ start: V(12, 4), dur: +(DURATION - V(12, 4)).toFixed(4), text: 'github.com/luumlabs/aula', style: 'type', size: fmt === 'h' ? 58 : 54, at: fmt === 'v' ? [0.5, 0.7] : [0.5, 0.84] })

  const paper = [
    { t: 0, color: NIGHT }, { t: V(2) - 0.01, color: NIGHT }, { t: +(V(2) + 0.35).toFixed(4), color: DAY },
    { t: V(7) - 0.01, color: DAY }, { t: V(7, 3), color: NIGHT }, { t: V(9, 3) - 0.01, color: NIGHT }, { t: V(9, 4), color: DAY }
  ]
  const sections: Section[] = [
    { t: 0, name: 'Hook', mood: 'intro' }, { t: V(2), name: 'Meet Aula', mood: 'drop' }, { t: V(2, 3), name: 'Montage', mood: 'day' },
    { t: V(7), name: 'Ask', mood: 'night' }, { t: V(9, 3), name: 'Anything', mood: 'build' }, { t: V(12), name: 'Outro', mood: 'outro' }
  ]
  const sfx: SfxCue[] = [
    { t: 0, type: 'rise', intensity: 1, note: 'del fotograma 0 al drop (2,0 s)' },
    { t: V(2), type: 'impact', intensity: 1, note: 'drop: amanecer' },
    ...[2, 3, 4].map((b): SfxCue => ({ t: V(11, b), type: 'impact', intensity: 0.65, note: 'Mac · Windows · Linux' }))
  ]
  const vertical = fmt === 'v'
  const name = fmt === 'v' ? 'aula-v5-short-vertical' : fmt === 's' ? 'aula-v5-short-square' : 'aula-v5-short'
  // la banda sonora de SOUND (scripts/video/sound/render.ts sobre la hoja de efectos de este montaje), si ya existe
  const wav = join(dirname(fileURLToPath(import.meta.url)), '..', 'work', name, 'soundtrack.wav')
  return defineMontage({
    name,
    fps: Number(process.env.AULA_VIDEO_FPS ?? 60),
    size,
    maxMB: 30,
    minTitle: 0.9,
    theme: 'light',
    duration: DURATION,
    takes: { morning: film5.takes.morning, main: film5.takes.main, see: film5.takes.see, docs: film5.takes.docs },
    clips,
    titles,
    paper,
    cursor: 'sun',
    drift: 0,
    cameraEase: 'smooth',
    ...(vertical ? { safe: { top: 220, bottom: 480, right: 140 } } : {}),
    hook: { start: 0, end: V(2), converge: [V(1, 2), V(2)], seed: 11 },
    iconWave: { t: V(9, 3), end: V(10, 3), dur: 1.0, area: fmt === 'h' ? [0.37, 0.08, 0.59, 0.84] : fmt === 'v' ? [0.06, 0.36, 0.88, 0.4] : [0.06, 0.36, 0.88, 0.58] },
    // dos amaneceres: el drop y la vuelta al día con la ola de iconos
    flashes: [V(2), V(9, 3)],
    prologue: {
      start: V(2), end: V(2, 4), size: fmt === 'h' ? 330 : fmt === 's' ? 380 : 480, at: [0.5, vertical ? 0.4 : 0.36], spring: true, rise: [V(2), V(2, 2)],
      morph: BEAT
    },
    finale: {
      start: V(12), dur: 2 * BEAT + BAR, morph: BEAT, rise: [V(12, 2), V(12, 3)], sunFrom: 'cursor', title: 'Aula', titleAt: V(12, 2),
      size: fmt === 'h' ? 300 : fmt === 's' ? 260 : 440, at: [0.5, fmt === 'v' ? 0.36 : 0.3]
    },
    frames: [{ t: 0, frame: 'mac' }, { t: V(11, 3), frame: 'windows' }, { t: V(11, 4), frame: 'linux' }, { t: V(12), frame: 'mac' }],
    notices: [],
    sections,
    sfx,
    pixelSfx: [],
    music: {
      bpm: SHORT_BPM, offset: 0, root: 62, seed: 2027, ...(existsSync(wav) ? { wav } : {}),
      chords: ['Bm', 'D', 'G', 'A'],
      sections: [{ bar: 1, style: 'dawn', light: 0.2 }, { bar: 2, style: 'day', light: 0.9, claps: true }, { bar: 12, style: 'end' }],
      cues: [{ t: V(12, 3), kind: 'end' }],
      clicks: existsSync(wav) ? null : -20,
      sfx: -24
    },
    outputs: []
  })
}
