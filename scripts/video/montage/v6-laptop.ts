// V6 · prueba del portátil (12 s, 5 compases a 100 BPM): la tapa se abre y la pantalla se enciende en el «Meet Aula»
// (compás 2), órbita lenta en 3/4 con el titular en el hueco, empujón hasta que la pantalla llena el cuadro, un clic de la
// app («Prepare for this exam»), vuelta a 3/4 al otro lado con su titular. Tomas `main` y `morning` de la película,
// clonadas (cp -c) en work/<nombre>/takes; la música es la del v3 (sound-v3) generada desde la hoja de este montaje.
//   AULA_VIDEO_NO_WORLDS=1 node scripts/video/render.ts scripts/video/montage/v6-laptop.ts --reuse --only cues
//   node scripts/video/sound-v3/excerpt.ts scripts/video/work/v6-laptop-h/cuesheet.json scripts/video/work/v6-laptop-h/soundtrack.wav
//   (un trozo de la canción del v3 desde la hoja de este montaje: el logo cae después del final)
//   AULA_VIDEO_NO_WORLDS=1 node scripts/video/render.ts scripts/video/montage/v6-laptop.ts --reuse --outputs laptop-test-16x9
//   (V6_FMT=v para el 9:16)
import { LID_OPEN, laptopView } from './laptop.ts'
import type { LaptopKey, Montage, Title } from './types.ts'

// solo se compone sobre tomas ya capturadas: importar la película no reescribe las plantillas de work/worlds
process.env.AULA_VIDEO_NO_WORLDS = '1'
const film = (await import('./aula-film.ts')).default

// rejilla: compás 2,4 s, pulso 0,6 s; compás 1 en t = 0
const BAR = 2.4
const DURATION = 5 * BAR
const PULL_END = 10.2

/** La coreografía de la prueba para un cuadro (pura: la comprueban las pruebas sin componer). */
export function laptopTest(size: [number, number]): {
  keys: LaptopKey[]
  titles: Title[]
  duration: number
} {
  const shape = { size } as Montage
  const view = (v: Parameters<typeof laptopView>[1], over: Partial<LaptopKey> = {}) => laptopView(shape, v, over)
  const right = view('3/4-right')
  const left = view('3/4-left')
  const screen = view('screen')

  const keys: LaptopKey[] = [
    // órbita ya en marcha en el fotograma 0 (clave virtual antes de empezar)
    { t: -BAR, yaw: right.yaw! - 26 },
    // cerrado, algo más alto y lejos; la tapa se abre en el compás 1 (0,6 → 2,4: llega abierta al «Meet Aula»)
    {
      t: 0,
      yaw: right.yaw! - 14,
      pitch: right.pitch! + 8,
      lid: 0,
      frame: right.frame! * 0.9,
      at: null,
      screen: [right.screen![0] + 0.03, right.screen![1] - 0.1]
    },
    { t: 0.6, lid: 0 },
    { t: BAR, lid: LID_OPEN, pitch: right.pitch! + 1, screen: [right.screen![0] + 0.01, right.screen![1] - 0.01] },
    // compás 2: 3/4 a la derecha, órbita lenta (el titular a la derecha)
    {
      t: 2 * BAR,
      yaw: right.yaw! + 6,
      pitch: right.pitch! + 1,
      frame: right.frame! * 1.02,
      at: null,
      screen: right.screen
    },
    // compás 3: empujón (3 pulsos) hasta que la pantalla llena el cuadro; compás 4: la pantalla, con deriva mínima y el clic
    { t: 2 * BAR + 1.8, ...screen },
    { t: 3 * BAR + 1.2, ...screen, fill: Math.min(screen.fill! + 0.012, 0.99) },
    // vuelta (3 pulsos) a 3/4 al otro lado, que sigue girando despacio en el mismo sentido (el titular a la izquierda)
    { t: PULL_END, ...left, yaw: left.yaw! - 6, pitch: left.pitch! + 1 },
    {
      t: DURATION,
      yaw: left.yaw! + 2,
      pitch: left.pitch!,
      frame: left.frame! * 0.97,
      screen: [left.screen![0] + 0.01, left.screen![1]]
    }
  ]

  const titles: Title[] = [
    {
      start: 3.0,
      dur: 1.7,
      text: 'Your day at a *glance.*',
      style: 'keynote',
      side: 'right',
      underline: false
    },
    {
      start: PULL_END,
      dur: DURATION - PULL_END + 0.1,
      text: 'One click. *Filled in.*',
      style: 'keynote',
      side: 'left',
      underline: false
    }
  ]
  return { keys, titles, duration: DURATION }
}

const vertical = process.env.V6_FMT === 'v'
const name = vertical ? 'v6-laptop-v' : 'v6-laptop-h'
const size: [number, number] = vertical ? [1080, 1920] : [1920, 1080]
const { keys, titles } = laptopTest(size)

const m: Montage = {
  name,
  fps: 60,
  size,
  theme: 'light',
  duration: DURATION,
  minTitle: 1.2,
  takes: { main: film.takes.main, morning: film.takes.morning },
  clips: [
    // Today con los cursos (el cursor pasa por las tarjetas): mientras se abre la tapa y en la órbita
    {
      take: 'main',
      start: 0,
      dur: 2 * BAR,
      from: 100.0,
      layout: { kind: 'laptop' }
    },
    // el calendario con el examen: empujón, clic en «Prepare for this exam» (14,87 s de la toma → 7,07 s) y el curso nuevo
    {
      take: 'morning',
      start: 2 * BAR,
      dur: DURATION - 2 * BAR,
      from: 12.6,
      enter: { kind: 'content', dur: 0.2 },
      layout: { kind: 'laptop' }
    }
  ],
  laptop: { keys },
  titles,
  sections: [
    { t: 0, name: 'Hook', mood: 'intro' },
    { t: BAR, name: 'Meet Aula', mood: 'drop' },
    { t: 2 * BAR, name: 'Plan', mood: 'day' }
  ],
  music: {
    bpm: 100,
    offset: 0,
    root: 62,
    cues: [],
    wav: `work/${name}/soundtrack.wav`,
    asIs: true
  },
  outputs: [
    {
      name: vertical ? 'laptop-test-9x16' : 'laptop-test-16x9',
      fadeOut: 0.6,
      maxMB: 30
    }
  ]
}

export default m
