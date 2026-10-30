// V6 · lo que pide el §3 del guion, en 14,4 s sobre clones de las tomas (work/v6-tec3/takes: main y lesson):
// el icono del prólogo ES la pantalla y la cámara se aleja hasta el portátil (laptop.reveal); el aviso de macOS y el
// cambio de marco (macOS → Windows → Linux) dentro de la pantalla; una luz de capítulo (anochecer) que cambia el cuarto
// —lámpara— y el tema de la app a la vez; y el cierre: la cámara entra en la pantalla, que se hace el icono del final.
//   AULA_VIDEO_NO_WORLDS=1 node scripts/video/render.ts scripts/video/montage/v6-s3.ts --reuse --stills …
import { lessonTake } from './v6-round2.ts'
import { LID_OPEN, laptopView } from './laptop.ts'
import type { LaptopKey, Montage } from './types.ts'

const shape = { size: [1920, 1080] } as Montage
const view = (v: Parameters<typeof laptopView>[1], over: Partial<LaptopKey> = {}) => laptopView(shape, v, over)
const screen = view('screen')

const m: Montage = {
  name: 'v6-tec3',
  fps: 60,
  size: [1920, 1080],
  theme: 'light',
  duration: 14.4,
  // `main` se reutiliza tal cual (--reuse): aquí basta su forma
  takes: { main: { duration: 108, theme: 'light', viewport: [1440, 900] }, lesson: lessonTake },
  prologue: { start: 0, end: 2.4, size: 300, at: [0.5, 0.42], rise: [0.5, 1.7], spring: true },
  clips: [
    { take: 'main', start: 2.4, dur: 4.8, from: 100.0, layout: { kind: 'laptop' } },
    { take: 'lesson', start: 7.2, dur: 4.2, from: 1.35, enter: { kind: 'light', dur: 1.2, style: 'dusk' }, layout: { kind: 'laptop' } }
  ],
  laptop: {
    reveal: { t: 2.4, dur: 2.4 },
    close: { t: 9.6, dur: 1.8 },
    keys: [
      // revelación: la pantalla más grande que el cuadro (el icono, como en el prólogo) y se aleja a 3/4
      { t: 2.4, ...screen, fill: 2.1 },
      // se aleja hasta tenerlo de frente y cerca (la pantalla al 78 %): el aviso y los marcos se leen
      { t: 4.8, ...view('screen', { fill: 0.78 }), screen: [0.5, 0.52] },
      { t: 6.6, ...view('screen', { fill: 0.82 }), screen: [0.5, 0.52] },
      // anochecer: 3/4 al otro lado
      { t: 7.8, ...view('3/4-left', { yaw: 28 }) },
      { t: 9.6, ...view('3/4-left', { yaw: 22 }) },
      // cierre: entra en la pantalla hasta que la pantalla es el cuadro (el icono del final, en su sitio)
      { t: 11.4, ...screen, fill: 2.1 },
      { t: 14.4, lid: LID_OPEN }
    ]
  },
  frames: [
    { t: 5.4, frame: 'windows' },
    { t: 6.0, frame: 'linux' },
    { t: 6.6, frame: 'mac' }
  ],
  notices: [{ start: 4.9, dur: 2.2, title: 'New assignment · Physics', body: 'Problem set 4 is due Friday. Shall we prepare it together?', time: 'now', theme: 'light' }],
  finale: { start: 11.4, dur: 3.0, size: 300, at: [0.5, 0.42], rise: [11.8, 12.8], title: 'Aula', sub: 'Your study companion.' }
}
export default m
