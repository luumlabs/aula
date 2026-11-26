// Precalcula los fotogramas de «El umbral» (4 en reposo, 6 trabajando) para que AulaMark los pinte sin coste en el cliente.
//   node scripts/dev/icon/umbral-frames.mjs
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IDLE, UI_VIEWBOX, WORK } from './umbral-art.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const target = resolve(here, '../../../src/renderer/src/design/umbralFrames.ts')
const pack = (cels) => cels.map((c) => [c.ink.join(''), c.sun.join('')])

const out = `// Fotogramas precalculados de «El umbral» (generado por scripts/dev/icon/umbral-frames.mjs). No editar a mano.
export const UMBRAL_VIEWBOX = ${JSON.stringify(UI_VIEWBOX)}
export const UMBRAL_IDLE: ReadonlyArray<readonly [string, string]> = ${JSON.stringify(pack(IDLE))}
export const UMBRAL_WORK: ReadonlyArray<readonly [string, string]> = ${JSON.stringify(pack(WORK))}
`

writeFileSync(target, out)
console.log('✓', target)
