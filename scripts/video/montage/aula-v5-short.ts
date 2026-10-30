// El corto V5 de Aula en 16:9 (YouTube, X, Reddit). Guion común: aula-v5-short-common.ts.
//   AULA_VIDEO_FPS=30 node scripts/video/render.ts scripts/video/montage/aula-v5-short.ts --app tree --reuse --soft
import { buildV5Short } from './aula-v5-short-common.ts'

// en 16:9 los titulares del corto van enormes (11 % del alto) y pueden partirse en 4 líneas
export default { ...buildV5Short('h'), keynote: { min: 0.11, maxLines: 4 } }
