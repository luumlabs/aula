// El corto V6 de Aula en 16:9 (YouTube, X, Reddit). Guion común: aula-v6-short-common.ts.
//   AULA_VIDEO_NO_WORLDS=1 AULA_VIDEO_FPS=30 node scripts/video/render.ts scripts/video/montage/aula-v6-short.ts --reuse
import { buildV6Short } from './aula-v6-short-common.ts'

export default buildV6Short('h')
