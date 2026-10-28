// Tercera demostración (v2 del motor): la pista real («South Waves», fuera del repo) con su rejilla, un recorte de
// sección (del compás 9 salta al cierre real del tema), corte por coincidencia (el curso de la barra lateral → el título
// del curso), fundido de contenido dentro de la ventana quieta, el fondo que pasa de día a noche de forma continua,
// rótulos tranquilos, la curva única de la cámara y el final «ventana → icono» sobre el acorde final.
//   node scripts/video/render.ts scripts/video/montage/demo3.ts --app out [--strips]
import grid from '../music/south-waves.grid.json' with { type: 'json' }
import { defineMontage } from './types.ts'
import { filmGrid } from './grid.ts'

const CUTS: [number, number][] = [[9, 81]]
const START = grid.downbeat - grid.beat
const G = filmGrid(grid, CUTS, START)
const V = G.V
const COURSE = 'exam-2-math112'

export default defineMontage({
  name: 'demo3',
  fps: 60,
  size: [1920, 1080],
  bitrate: 14e6,
  theme: 'light',
  duration: +G.duration.toFixed(3),
  cameraEase: 'smooth',
  takes: {
    today: {
      duration: +(V(5) + 0.5).toFixed(2),
      lang: 'en',
      theme: 'light',
      setup: [{ do: 'navigate', route: { name: 'home' } }],
      actions: [
        { at: V(2), do: 'move', to: 'text:Start the plan', dur: 2 * G.beat },
        { at: V(4), do: 'move', to: 'text:Exam #2 · MATH 101', dur: 2 * G.beat }
      ],
      marks: { plan: 'text:Start the plan', course: 'text:Exam #2 · MATH 101' }
    },
    course: {
      duration: 9,
      lang: 'en',
      theme: 'light',
      setup: [{ do: 'navigate', route: { name: 'course', id: COURSE } }],
      marks: { title: 'h1' }
    },
    night: {
      duration: 30,
      lang: 'en',
      theme: 'dark',
      setup: [{ do: 'navigate', route: { name: 'stats' } }]
    }
  },
  // prólogo: el icono crece un poco mientras sale el sol y, en V(2,3), su losa se convierte en la ventana
  prologue: { start: 0, end: V(2, 3), size: 360, grow: 0.94, rise: [V(1), V(2)] },
  captionBand: 950,
  clips: [
    {
      take: 'today',
      start: V(2, 3),
      from: V(2, 3),
      dur: V(5) - V(2, 3),
      enter: { kind: 'icon', dur: 2 * G.beat },
      camera: [
        { t: 0, zoom: 'fit' },
        { t: V(3) - V(2, 3), zoom: 'fit' },
        { t: V(3, 3) - V(2, 3), zoom: 1.25, focus: 'mark:plan', screen: [0.42, 0.45] },
        { t: V(4) - V(2, 3), zoom: 1.25, focus: 'mark:plan', screen: [0.42, 0.45] },
        { t: V(4, 3) - V(2, 3), zoom: 'fit' }
      ]
    },
    // corte por coincidencia: el nombre del curso de la barra lateral se convierte en el título del curso
    { take: 'course', start: V(5), dur: V(9) - V(5), from: 0, enter: { kind: 'match', dur: 2 * G.beat, from: 'mark:course', to: 'mark:title' } },
    // la noche: el contenido funde dentro de la ventana quieta; el papel ya se ha oscurecido en dos compases
    { take: 'night', start: V(9), dur: G.duration - V(9), enter: { kind: 'theme', dur: 2 * G.beat } }
  ],
  titles: [
    { start: V(3, 3), dur: 2 * G.barDur, text: 'Today’s plan, *made for you*', style: 'caption' },
    { start: V(10), dur: 2 * G.barDur, text: 'Always with you, *even at night*', style: 'caption' }
  ],
  finale: { start: V(14, 1), dur: 2 * G.barDur, morph: G.barDur, rise: [V(15, 1), V(15, 3)], sunFrom: 'cursor', title: 'Aula', sub: 'github.com/luumlabs/aula' },
  cursor: 'sun',
  music: { track: { grid, cuts: CUTS, start: START }, bpm: grid.bpm, root: 62, cues: [], clicks: -20, sfx: -20 },
  outputs: [{ name: 'demo3-720', size: [1280, 720], fps: 30, bitrate: 2.4e6, audioBitrate: 128000 }]
})
