// V6 · muestrario de personajes que se dibujan a pincel (sin tomas): uno grande a pantalla completa que se dibuja y cobra
// vida, y luego un grupo escalonado junto a un titular.
//   AULA_VIDEO_NO_WORLDS=1 node scripts/video/render.ts scripts/video/montage/v6-draw.ts --stills 0.4,0.8,1.2,1.6,2.0,2.4,3.2
import { drawGroup } from './draw.ts'
import type { Montage } from './types.ts'

const m: Montage = {
  name: 'v6-draw',
  fps: 60,
  size: [1920, 1080],
  theme: 'light',
  duration: 7.2,
  takes: {},
  clips: [],
  drawings: [
    // a pantalla completa: el gato, grande, se dibuja en 2,4 s y cobra vida
    { who: 'companion:gato', t: 0.2, dur: 2.4, until: 3.8, at: [0.5, 0.5], size: 900, after: 'alive' },
    // en grupo, junto al titular: cinco personajes escalonados
    ...drawGroup({ t: 4.0, who: ['icon:math', 'companion:buho', 'icon:study', 'companion:luna', 'icon:calculus'], at: [[0.12, 0.36], [0.31, 0.36], [0.5, 0.36], [0.21, 0.66], [0.4, 0.66]], size: 300, stagger: 0.3, dur: 1.2 })
  ],
  titles: [{ start: 4.6, dur: 2.6, text: 'Study *anything.*', style: 'keynote', side: 'right' }]
}
export default m
