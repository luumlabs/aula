// V6 · comprobación: los dibujos van en su capa sobre las cartelas y el final (bajo los titulares) y no pisan su texto.
// Los casos de DIR: el farol en la cartela 05 (película C35) y la luna y el gato junto al icono del cierre; y uno puesto
// a propósito encima del título de la cartela, que sale al hueco libre más cercano.
//   AULA_VIDEO_NO_WORLDS=1 node scripts/video/render.ts scripts/video/montage/v6-draw-over.ts --stills 0.7,1.2,1.9,2.5,3.5,4.6,5.4,7.0
import { drawGroup } from './draw.ts'
import type { Montage } from './types.ts'

const m: Montage = {
  name: 'v6-draw-over',
  fps: 60,
  size: [1920, 1080],
  theme: 'light',
  duration: 7.8,
  takes: {},
  clips: [],
  chapters: { names: ['Plan', 'Learn', 'See it', 'Ask', 'Always on', 'Documents', 'Everywhere'], cards: [{ t: 0.3, dur: 2.4, n: 5, sub: 'Like a tutor who never leaves.' }] },
  finale: { start: 3.0, dur: 4.8, size: 320, at: [0.5, 0.4], rise: [3.0, 3.6], title: 'Aula', sub: 'Your study companion.', titleAt: 3.0 },
  drawings: [
    { who: 'companion:farol', t: 0.3, dur: 1.4, until: 2.7, at: [0.3, 0.33], size: 170 },
    // encima del título de la cartela a propósito: sale de él
    { who: 'companion:robot', t: 0.6, dur: 1.2, until: 2.7, at: [0.52, 0.5], size: 170 },
    ...drawGroup({ t: 3.6, who: ['companion:luna', 'companion:gato'], at: [[0.33, 0.4], [0.67, 0.4]], size: 170, stagger: 0.6, dur: 1.2, after: 'alive' })
  ]
}
export default m
