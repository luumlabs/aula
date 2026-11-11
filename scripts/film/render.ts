// El corto animado de Aula: lo pinta fotograma a fotograma una página oculta de Electron (canvas), lo codifica en H.264
// con música original sintetizada y escribe el MP4. No captura la app ni usa ffmpeg.
//   node scripts/film/render.ts                      el corto entero → scripts/film/work/aula-short-film.mp4
//   node scripts/film/render.ts --stills 3,12.5,30   solo esos instantes, como PNG (work/stills/)
//   node scripts/film/render.ts --range 9:18         solo ese tramo
//   node scripts/film/render.ts --fps 12 --silent    borrador rápido, sin sonido
//   --bitrate 1800000 --grain 0.4                    un corte ligero (menos grano de película: pesa mucho menos)
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCompositor } from '../video/compose/host.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (name: string): string | null => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
const outDir = resolve(opt('--out') ?? join(HERE, 'work'))
mkdirSync(outDir, { recursive: true })
const range = opt('--range')?.split(':').map(Number) ?? null
const payload = {
  name: opt('--name') ?? 'aula-short-film',
  stills: opt('--stills')?.split(',').map(Number) ?? null,
  range,
  fps: opt('--fps') ? Number(opt('--fps')) : null,
  silent: args.includes('--silent'),
  bitrate: opt('--bitrate') ? Number(opt('--bitrate')) : 12_000_000,
  grain: opt('--grain') ? Number(opt('--grain')) : 1
}
const t0 = Date.now()
const result = await runCompositor({
  entry: join(HERE, 'page.ts'),
  workDir: join(HERE, 'assets'),
  outDir,
  payload,
  onLog: (m) => console.log(JSON.stringify(m))
})
console.log(JSON.stringify(result), `· ${((Date.now() - t0) / 1000).toFixed(1)} s`)
