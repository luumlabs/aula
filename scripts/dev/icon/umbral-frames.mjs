// Regenera los fotogramas compartidos por Electron y el renderer móvil: node scripts/dev/icon/umbral-frames.mjs
import { writeFileSync } from 'node:fs'
import { IDLE, WORK, UI_VIEWBOX } from './umbral-art.mjs'

const frames = (cels) => cels.map(({ ink, sun }) => [ink.join(' '), sun.join(' ')])
writeFileSync(new URL('../../../src/renderer/src/design/umbralFrames.ts', import.meta.url),
  `// Generado por scripts/dev/icon/umbral-frames.mjs; no editar a mano.\nexport const umbralViewBox = ${JSON.stringify(UI_VIEWBOX)}\nexport const idleCels = ${JSON.stringify(frames(IDLE), null, 2)}\nexport const workingCels = ${JSON.stringify(frames(WORK), null, 2)}\n`)
