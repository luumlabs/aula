// La película corta de Aula para redes, en 16:9 (Reddit, X, YouTube). Guion: aula-short-common.ts.
//   AULA_VIDEO_FPS=30 node scripts/video/render.ts scripts/video/montage/aula-short.ts --app tree --draft --jobs 2
import { buildShort } from './aula-short-common.ts'

const base = buildShort('h')
// en 16:9 el gancho del fotograma 0 va 1,4× más grande: la losa del prólogo y el rótulo «Got an exam?»
const hook = base.titles?.[0]
const hookSize = Math.round(Math.min(base.size[0], base.size[1]) * 0.075 * 1.4)

export default {
  ...base,
  prologue: base.prologue ? { ...base.prologue, size: Math.round((base.prologue.size ?? 360) * 1.4) } : base.prologue,
  titles: (base.titles ?? []).map((t) => (t === hook && t.start <= 0 ? { ...t, size: hookSize } : t))
}
