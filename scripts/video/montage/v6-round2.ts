// V6 · ronda 2 del motor (prueba de 7,2 s, 3 compases a 100 BPM, de noche con la lámpara): un compañero se dibuja a
// pincel en el aire junto al portátil; empujón hacia la pantalla con rampa de velocidad (rápido, muy lento en el acierto,
// rápido otra vez) sobre una toma capturada a 250 fps (la respuesta se pone verde con su destello, a 0,2×); vuelta a 3/4
// y tres iconos de curso se dibujan escalonados. La toma `lesson` se captura en work/v6-tec2/takes con el mundo de la V5
// clonado (cp -c) en work/v6-tec2-world: este montaje no importa la película (no toca work/worlds*).
//   node scripts/video/render.ts scripts/video/montage/v6-round2.ts --only capture --reuse      (solo la primera vez)
//   AULA_VIDEO_NO_WORLDS=1 node scripts/video/render.ts scripts/video/montage/v6-round2.ts --reuse --only cues
//   node scripts/video/sound-v3/excerpt.ts scripts/video/work/v6-tec2/cuesheet.json scripts/video/work/v6-tec2/soundtrack.wav
//   AULA_VIDEO_NO_WORLDS=1 node scripts/video/render.ts scripts/video/montage/v6-round2.ts --reuse --outputs round2-16x9
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { markSel } from './aula-v5-js.ts'
import { drawGroup } from './draw.ts'
import { laptopView } from './laptop.ts'
import type { LaptopKey, Montage, Ramp, Take } from './types.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const TRIG = 'exam-2-math112'

/** La lección de ángulos de referencia (la del plano 11 de la película), de noche, a 250 fps: el cursor va a «30°»,
 *  pulsa (5,25 s) y la respuesta se pone verde con su destello. */
export const lessonTake: Take = {
  duration: 8.6,
  fps: 250,
  lang: 'en',
  theme: 'dark',
  viewport: [1440, 900],
  home: join(HERE, '..', 'work', 'v6-tec2-world', 'course'),
  clock: '2026-10-28T21:30:00',
  mainClock: true,
  env: { AULA_FAKE_AI: '1', AULA_FAKE_AI_DELAY_MS: '25' },
  setup: [{ do: 'navigate', route: { name: 'home' } }],
  actions: [
    { at: 0.3, do: 'navigate', route: { name: 'study', id: TRIG, mode: 'learn', skill: 'reference-angles' } },
    { at: 1.0, do: 'eval', js: markSel('vt-a', '[data-predict-open] button, [data-predict-open] [role="button"]', 0) },
    { at: 3.9, do: 'move', to: '#vt-a', dur: 0.9, soft: true },
    { at: 5.0, do: 'click', to: '#vt-a', dur: 0.25, soft: true }
  ]
}

// la rampa del acierto: rápido, a 0,25× alrededor del destello (4,1 s del vídeo = 5,45 s de la toma) y rápido otra vez;
// la toma (250 fps) y la cámara del portátil comparten la misma curva (todo el cuadro va a cámara lenta)
const SLOW: Ramp = { from: 2.9, to: 5.4, at: 4.1, slow: 0.25, width: 0.45 }
const left = (over: Partial<LaptopKey> = {}) => laptopView({ size: [1920, 1080] } as Montage, '3/4-left', over)

const m: Montage = {
  name: 'v6-tec2',
  fps: 60,
  size: [1920, 1080],
  theme: 'dark',
  duration: 7.2,
  takes: { lesson: lessonTake },
  clips: [{ take: 'lesson', start: 0, dur: 7.2, from: 1.35, ramps: [SLOW], layout: { kind: 'laptop' } }],
  laptop: {
    ramps: [SLOW],
    keys: [
      { t: -2.4, yaw: 44 },
      { t: 0, ...left({ yaw: 36, pitch: 15 }) },
      { t: 2.4, ...left({ yaw: 29, pitch: 14 }) },
      // empujón hasta la pantalla (con la rampa: se lanza, casi se para en el acierto y acaba deprisa)
      { t: 4.8, ...laptopView({ size: [1920, 1080] } as Montage, 'screen') },
      { t: 5.4, ...laptopView({ size: [1920, 1080] } as Montage, 'screen', { fill: 0.972 }) },
      // vuelta a 3/4
      { t: 6.6, ...left({ yaw: 30, pitch: 14, frame: 0.55 }) },
      { t: 7.2, yaw: 32 }
    ]
  },
  drawings: [
    // el búho (compañero de estudio de noche) se dibuja en el aire, junto al portátil, y se va al empezar el empujón
    { who: 'companion:buho', t: 0.15, dur: 2.0, until: 3.0, at: [0.25, 0.47], size: 430 },
    // al volver: tres iconos de curso escalonados
    ...drawGroup({ t: 6.1, who: ['icon:calculus', 'icon:geometry', 'icon:math'], at: [[0.13, 0.4], [0.3, 0.33], [0.22, 0.64]], size: 210, stagger: 0.14, dur: 0.75 })
  ],
  sections: [
    { t: 0, name: 'Hook', mood: 'intro' },
    { t: 2.4, name: 'Meet Aula', mood: 'drop' },
    { t: 4.8, name: 'Learn', mood: 'night' }
  ],
  music: { bpm: 100, offset: 0, root: 62, cues: [], wav: 'work/v6-tec2/soundtrack.wav', asIs: true },
  outputs: [{ name: 'round2-16x9', fadeOut: 0.5, maxMB: 30 }]
}
export default m
