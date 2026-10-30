// El corto V6 para redes (≈ 37 s, 100 BPM, el sonido del v3): pausado, la app dentro del portátil y siempre entera, 10
// planos de producto de un compás (2,4 s) con 2–4 palabras grandes en el hueco que deja el portátil. Un solo guion para
// los tres formatos: aula-v6-short.ts (16:9), aula-v6-short-vertical.ts (9:16) y aula-v6-short-square.ts (1:1).
// Guion: scratchpad/aula2/video/v6/GUION.md §2. Solo compone sobre las tomas de 60 fps de la película (clonadas).
import { LID_OPEN, laptopView } from './laptop.ts'
import { drawGroup } from './draw.ts'
import { naclTake } from './v6-hfr.ts'
import type { Clip, LaptopKey, Montage, Section, SfxCue, Title } from './types.ts'

process.env.AULA_VIDEO_NO_WORLDS = '1'
const v5 = await import('./aula-v5-film.ts')
const film5 = v5.default
const { learn: L, see: S, docs: D } = v5.TAKE_AT

const BEAT = 0.6
const BAR = 2.4
const V = (bar: number, beat = 1, frac = 0): number => +((bar - 1) * BAR + (beat - 1 + frac) * BEAT).toFixed(4)
const EPS = 1 / 60
const NIGHT = '#15110F'
const DAY = '#F6EFE4'

type Fmt = 'h' | 'v' | 's'

/** Las imágenes del corto: compás, toma, desde, lado del portátil (el titular va en el hueco) y palabras. */
const SHOTS: { bar: number; take: string; from: number; side: 'right' | 'left'; words: string; enter?: Clip['enter'] }[] = [
  { bar: 3, take: 'morning', from: 13.6, side: 'right', words: 'One *click.*' },
  { bar: 4, take: 'morning', from: 27.6, side: 'left', words: 'It builds the *course.*' },
  { bar: 5, take: 'learn', from: L.practice + 1.3, side: 'right', words: 'Explains your *mistake.*' },
  { bar: 6, take: 'main', from: 45.4, side: 'left', words: 'Touch the *diagram.*' },
  { bar: 7, take: 'nacl', from: 3.2, side: 'right', words: 'Spin it in *3D.*' },
  { bar: 8, take: 'main', from: 72.8, side: 'left', words: 'Just *ask.*', enter: { kind: 'light', style: 'dusk', dur: BEAT } },
  { bar: 9, take: 'main', from: 82.2, side: 'right', words: 'Quizzes in the *chat.*' },
  { bar: 10, take: 'docs', from: D.page2, side: 'left', words: 'Practice exams, *printed.*' },
  { bar: 12, take: 'main', from: 92.4, side: 'right', words: 'Any AI. Even *offline.*', enter: { kind: 'light', style: 'dawn', dur: BEAT } },
  { bar: 13, take: 'main', from: 101.8, side: 'left', words: 'Mac. Windows. *Linux.*' }
]

/** h = 16:9 (YouTube, X, Reddit) · v = 9:16 (TikTok, Reels, Shorts) · s = 1:1. */
export function buildV6Short(fmt: Fmt): Montage {
  const size: [number, number] = fmt === 'v' ? [1080, 1920] : fmt === 's' ? [1080, 1080] : [1920, 1080]
  const name = fmt === 'v' ? 'aula-v6-short-vertical' : fmt === 's' ? 'aula-v6-short-square' : 'aula-v6-short'
  const shape = { size } as Montage
  const view = (v: '3/4-right' | '3/4-left' | 'front' | 'screen', over: Partial<LaptopKey> = {}) => laptopView(shape, v, over)
  const big = fmt === 'v' ? 112 : fmt === 's' ? 92 : 124

  // ——— cámara: un 3/4 por compás, alternando el lado, con una órbita lenta; corte seco en cada compás ———
  const keys: LaptopKey[] = []
  const k = (t: number, key: Omit<LaptopKey, 't'>) => keys.push({ t: +t.toFixed(4), ...key })
  const side = (s: 'right' | 'left', dyaw: number, grow = 1): Omit<LaptopKey, 't'> => {
    const b = view(s === 'right' ? '3/4-right' : '3/4-left')
    return { ...b, yaw: b.yaw! + dyaw, frame: +(b.frame! * grow).toFixed(4) }
  }
  const first = SHOTS[0]
  // la revelación (C3): el icono del prólogo ES la pantalla; la cámara empieza dentro y se aleja (2 pulsos) hasta 3/4
  // la pantalla más grande que el cuadro (en vertical, que cubra también el alto: la pantalla es 16:10)
  const BEYOND = fmt === 'v' ? 3.3 : 2.1
  k(V(3), { ...view('screen'), fill: BEYOND, lid: LID_OPEN })
  k(V(3, 3), side(first.side, -4))
  k(V(4) - EPS, side(first.side, 2, 1.03))
  for (const s of SHOTS.slice(1)) {
    const d = s.side === 'right' ? 1 : -1
    k(V(s.bar), side(s.side, -5 * d))
    k(V(s.bar + 1) - EPS, side(s.side, 2 * d, 1.03))
  }
  // C14: de frente; la cámara entra en la pantalla, que se hace el icono del final (laptop.close)
  k(V(14), view('front', { pitch: 8 }))
  k(V(14, 3), view('screen', { fill: (view('screen').fill ?? 0.96) - 0.08 }))
  k(V(15), { ...view('screen'), fill: BEYOND })

  // ——— planos y palabras ———
  const clips: Clip[] = SHOTS.map((s, i) => ({
    take: s.take, start: V(s.bar), dur: BAR, from: s.from, layout: { kind: 'laptop' as const },
    enter: s.enter ?? { kind: 'cut' as const, dur: 0 },
    // el NaCl a cámara lenta en su centro
    ...(s.bar === 7 ? { ramps: [{ from: 0.2, to: 2.2, at: 1.2, slow: 0.3 }] } : {})
  }))
  clips.push({ take: 'main', start: V(14), dur: BAR, from: 101.8, layout: { kind: 'laptop' }, enter: { kind: 'cut', dur: 0 } })
  const titles: Title[] = SHOTS.map((s) => ({
    start: s.bar === 3 ? V(3, 3) : V(s.bar), dur: +(V(s.bar + 1) - (s.bar === 3 ? V(3, 3) : V(s.bar)) - 0.05).toFixed(4),
    text: s.words, style: 'keynote' as const, side: s.side, size: big, underline: false as const
  }))
  // el gancho, entero desde el fotograma 0 · «Meet Aula.» enorme bajo el icono
  titles.unshift({ start: 0, dur: +(V(2) - 0.05).toFixed(4), text: 'Exam in *nine days.*', style: 'type', instant: true, underline: {} })
  titles.push({ start: V(2, 1, 0.75), dur: +(V(3) - V(2, 1, 0.75) - 0.05).toFixed(4), text: 'Meet *Aula.*', style: 'type', size: fmt === 'v' ? 150 : fmt === 's' ? 120 : 150, at: [0.5, fmt === 'v' ? 0.66 : 0.76], underline: {} })
  // «Study anything.» (C11): la ola de iconos pintados, sin portátil
  titles.push({ start: V(11), dur: +(BAR - 0.05).toFixed(4), text: 'Study *anything.*', style: 'keynote', side: 'left', size: big, underline: {} })
  // el cierre: «Aula» en el golpe del logo (C15.1), la línea y la dirección
  const DURATION = +V(16, 3).toFixed(2)
  titles.push({ start: V(15, 2), dur: +(DURATION - V(15, 2)).toFixed(4), text: 'Free & *open source.*', style: 'type', underline: {}, size: fmt === 'h' ? 76 : 70, at: fmt === 'v' ? [0.5, 0.64] : [0.5, 0.74] })
  titles.push({ start: V(15, 3), dur: +(DURATION - V(15, 3)).toFixed(4), text: 'github.com/luumlabs/aula', style: 'type', underline: false, size: fmt === 'h' ? 58 : 54, at: fmt === 'v' ? [0.5, 0.7] : [0.5, 0.84] })

  const paper = [
    { t: 0, color: NIGHT }, { t: V(2) - 0.01, color: NIGHT }, { t: +(V(2) + 0.35).toFixed(4), color: DAY },
    { t: V(8) - 0.01, color: DAY }, { t: V(8, 2), color: NIGHT }, { t: V(11) - 0.01, color: NIGHT }, { t: V(11, 2), color: DAY }
  ]
  const sections: Section[] = [
    { t: 0, name: 'Hook', mood: 'intro' }, { t: V(2), name: 'Meet Aula', mood: 'drop' }, { t: V(3), name: 'Montage', mood: 'day' },
    { t: V(8), name: 'Ask', mood: 'night' }, { t: V(11), name: 'Anything', mood: 'day' }, { t: V(15), name: 'Outro', mood: 'outro' }
  ]
  const sfx: SfxCue[] = [...[2, 3, 4].map((b): SfxCue => ({ t: V(13, b), type: 'impact', intensity: 0.55, note: 'Mac · Windows · Linux' }))]
  const vertical = fmt === 'v'
  return {
    name,
    fps: Number(process.env.AULA_VIDEO_FPS ?? 60),
    size,
    maxMB: 30,
    minTitle: 0.9,
    theme: 'light',
    duration: DURATION,
    takes: { morning: film5.takes.morning, main: film5.takes.main, learn: film5.takes.learn, docs: film5.takes.docs, nacl: naclTake },
    clips,
    titles,
    paper,
    cursor: 'sun',
    drift: 0,
    cameraEase: 'smooth',
    laptop: { keys, reveal: { t: V(3), dur: 2 * BEAT }, close: { t: V(14, 3), dur: 2 * BEAT }, ramps: [{ from: V(7) + 0.2, to: V(7) + 2.2, at: V(7) + 1.2, slow: 0.3 }] },
    drawings: [
      // el equipo que construye el curso (bajo las palabras: a la izquierda en 16:9, entre las palabras y el portátil en 9:16)
      ...(fmt === 'h' ? drawGroup({ t: V(4, 2), who: ['companion:robot', 'companion:buho', 'companion:libro'], at: [[0.1, 0.8], [0.2, 0.8], [0.3, 0.8]], size: 150, stagger: 0.45, dur: 0.8, until: V(5) })
        : fmt === 'v' ? drawGroup({ t: V(4, 2), who: ['companion:robot', 'companion:buho', 'companion:libro'], at: [[0.3, 0.335], [0.5, 0.335], [0.7, 0.335]], size: 140, stagger: 0.45, dur: 0.8, until: V(5) }) : []),
      // el cierre: la luna y el gato a los lados del icono
      ...drawGroup({ t: V(15, 2), who: ['companion:luna', 'companion:gato'], at: fmt === 'v' ? [[0.2, 0.36], [0.8, 0.36]] : fmt === 's' ? [[0.22, 0.3], [0.78, 0.3]] : [[0.36, 0.3], [0.64, 0.3]], size: fmt === 'h' ? 150 : 160, stagger: 0.3, dur: 1.0, after: 'alive' })
    ],
    ...(fmt === 'h' ? { keynote: { min: 0.11, maxLines: 4 } } : {}),
    ...(vertical ? { safe: { top: 220, bottom: 480, right: 140 } } : {}),
    hook: { start: 0, end: V(2), converge: [V(1, 3), V(2)], seed: 11 },
    iconWave: { t: V(11), end: V(12), dur: 1.0, area: fmt === 'h' ? [0.37, 0.08, 0.59, 0.84] : fmt === 'v' ? [0.06, 0.36, 0.88, 0.4] : [0.06, 0.36, 0.88, 0.58] },
    // dos amaneceres: el drop y la vuelta al día con la ola de iconos (sin fotograma vacío entre la noche y el día)
    flashes: [V(2), V(11)],
    prologue: { start: V(2), end: V(3), size: fmt === 'h' ? 330 : fmt === 's' ? 380 : 480, at: [0.5, vertical ? 0.4 : 0.36], spring: true, rise: [V(2), V(2, 2)] },
    finale: {
      start: V(15), dur: 2 * BAR, rise: [V(15), V(15, 2)], title: 'Aula', titleAt: V(15),
      size: fmt === 'h' ? 300 : fmt === 's' ? 260 : 440, at: [0.5, fmt === 'v' ? 0.36 : 0.3]
    },
    frames: [{ t: 0, frame: 'mac' }, { t: V(13, 2), frame: 'windows' }, { t: V(13, 3), frame: 'linux' }, { t: V(14), frame: 'mac' }],
    notices: [],
    sections,
    sfx,
    pixelSfx: [],
    music: { bpm: 100, offset: 0, root: 62, cues: [], wav: `work/${name}/soundtrack.wav`, asIs: true },
    outputs: []
  }
}
