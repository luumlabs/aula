// La película corta de Aula para redes, en 9:16 (TikTok, Reels, Shorts). Guion: aula-short-common.ts.
//   AULA_VIDEO_FPS=30 node scripts/video/render.ts scripts/video/montage/aula-short-vertical.ts --app tree --jobs 2
import { buildShort } from './aula-short-common.ts'

export default buildShort('v')
