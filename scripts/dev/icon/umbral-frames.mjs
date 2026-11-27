// Precalcula los fotogramas de «El umbral» (4 en reposo, 6 trabajando) para que AulaMark los pinte sin coste en el cliente.
//   node scripts/dev/icon/umbral-frames.mjs
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cel, UI_VIEWBOX } from './umbral-art.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const target = resolve(here, '../../../src/renderer/src/design/umbralFrames.ts')
// Para la interfaz (16–150 px), un paso de 20 unidades sobre el lienzo de 720 (≈0,2 px a 146 px) y enteros es
// indistinguible visualmente y reduce ~75 % el peso del bundle y los segmentos Bézier que rasteriza cada <AulaMark>.
const ui = { smooth: 20, sunSmooth: 16, decimals: 0 }
const IDLE_UI = [3, 11, 19, 27].map((seed, i) => cel({ ...ui, seed, jitter: i === 0 ? 0 : 3, open: [0, 2.5, 1, 3][i] }))
const WORK_UI = [0, 12, 26, 38, 26, 12].map((lift, i) => cel({ ...ui, seed: 40 + i * 7, jitter: 2.6, lift, rays: lift > 20 ? (lift - 18) / 20 : 0 }))
const pack = (cels) => cels.map((c) => [c.ink.join(''), c.sun.join('')])

const out = `// Fotogramas precalculados de «El umbral» (generado por scripts/dev/icon/umbral-frames.mjs). No editar a mano.
export const UMBRAL_VIEWBOX = ${JSON.stringify(UI_VIEWBOX)}
export const UMBRAL_IDLE: ReadonlyArray<readonly [string, string]> = ${JSON.stringify(pack(IDLE_UI))}
export const UMBRAL_WORK: ReadonlyArray<readonly [string, string]> = ${JSON.stringify(pack(WORK_UI))}
`

writeFileSync(target, out)
console.log('✓', target)
