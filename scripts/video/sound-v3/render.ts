// La banda sonora del v3 (su sintetizador original, Audio.swift) para un montaje (macOS: compila con swiftc):
//   node scripts/video/sound-v3/render.ts <cuesheet.json | linea-de-tiempo.json | demo> <salida.wav> [--s16]
// Una hoja del montaje (work/<montaje>/cuesheet.json) se traduce con timeline.ts y la línea de tiempo se deja junto al
// WAV (<salida>.timeline.json). Una línea de tiempo ya hecha (como v3.timeline.json) se usa tal cual. El binario se
// compila una vez por versión de las fuentes en la caché, fuera del repositorio.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { demoCues } from './demo.ts'
import { toV3Timeline, type MontageCues, type V3Timeline } from './timeline.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCES = ['Audio.swift', 'Timeline.swift', 'main.swift'].map((f) => join(HERE, f))

/** El binario del sintetizador (compilado con -O la primera vez y guardado por huella de las fuentes). */
export function binary(): string {
  const h = createHash('sha256')
  for (const f of SOURCES) h.update(readFileSync(f))
  const dir = join(process.env.VT_CACHE || join(tmpdir(), 'aula-video-cache'), 'sound-v3', h.digest('hex').slice(0, 16))
  const bin = join(dir, 'aula-v3-sound')
  if (!existsSync(bin)) {
    mkdirSync(dir, { recursive: true })
    execFileSync('swiftc', ['-O', '-swift-version', '5', '-o', bin + '.tmp', ...SOURCES], { stdio: 'inherit' })
    renameSync(bin + '.tmp', bin)
  }
  return bin
}

/** ¿Es ya una línea de tiempo del v3 (y no una hoja del montaje)? */
export function isTimeline(x: unknown): x is V3Timeline {
  const t = x as Partial<V3Timeline>
  return Array.isArray(t.kinds) && typeof t.meetBar === 'number' && typeof t.musicBars === 'number'
}

export function renderV3(input: unknown, out: string, opts: { s16?: boolean } = {}): { timeline: string; stats: Record<string, number> } {
  const tl = isTimeline(input) ? input : toV3Timeline(input as MontageCues)
  mkdirSync(dirname(out), { recursive: true })
  const tlPath = out.replace(/\.wav$/i, '') + '.timeline.json'
  writeFileSync(tlPath, JSON.stringify(tl, null, 1) + '\n')
  const res = execFileSync(binary(), [tlPath, out, ...(opts.s16 ? ['--s16'] : [])], { encoding: 'utf8' })
  return { timeline: tlPath, stats: JSON.parse(res.trim().split('\n').pop()!) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  if (args.length < 2) {
    console.error('uso: node scripts/video/sound-v3/render.ts <cuesheet.json | linea-de-tiempo.json | demo> <salida.wav> [--s16]')
    process.exit(2)
  }
  const input = args[0] === 'demo' ? demoCues() : JSON.parse(readFileSync(args[0], 'utf8'))
  const r = renderV3(input, args[1], { s16: process.argv.includes('--s16') })
  console.log(`${args[1]}: ${r.stats.seconds} s · pico ${r.stats.peakDb} dBFS · pico real ${r.stats.truePeakDb} dBTP · ${r.stats.renderS} s · línea de tiempo ${r.timeline}`)
}
