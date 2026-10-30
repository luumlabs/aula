// V6 · tomas a alta frecuencia (250 fps) para la cámara lenta, en work/v6-tec2/takes, sobre el mundo de la V5 clonado
// (work/v6-tec2-world): `lesson` (el acierto que se pone verde, de noche) y `nacl` (la sal en 3D girando, de día, el
// plano C22 de la película y C7 del corto). No importa la película (no toca work/worlds*). Solo para capturar:
//   node scripts/video/render.ts scripts/video/montage/v6-hfr.ts --only capture --reuse
// Para usarlas en otro montaje: clona (cp -c -R) work/v6-tec2/takes/<toma> en work/<montaje>/takes y declara la toma
// con su spec (importa `lessonTake` o `naclTake` de aquí) y `--reuse`.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lessonTake } from './v6-round2.ts'
import type { Montage, Take } from './types.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

/** La sal (NaCl) en 3D girando (la lección «Ionic crystals» de Biology & Physics), de día: visible de 2,9 s a 6,6 s. */
export const naclTake: Take = {
  duration: 6.6,
  fps: 250,
  lang: 'en',
  theme: 'light',
  viewport: [1440, 900],
  home: join(HERE, '..', 'work', 'v6-tec2-world', 'course'),
  clock: '2026-10-28T10:00:00',
  mainClock: true,
  env: { AULA_FAKE_AI: '1', AULA_FAKE_AI_DELAY_MS: '25' },
  setup: [{ do: 'navigate', route: { name: 'home' } }],
  actions: [{ at: 0.3, do: 'navigate', route: { name: 'study', id: 'biology-physics-visuals', mode: 'learn', skill: 'salt-crystal' } }]
}

const m: Montage = {
  name: 'v6-tec2',
  fps: 60,
  size: [1920, 1080],
  theme: 'light',
  duration: 6.6,
  takes: { lesson: lessonTake, nacl: naclTake },
  clips: [
    { take: 'lesson', start: 0, dur: 1, layout: { kind: 'laptop' } },
    { take: 'nacl', start: 1, dur: 5.6, layout: { kind: 'laptop' } }
  ]
}
export default m
