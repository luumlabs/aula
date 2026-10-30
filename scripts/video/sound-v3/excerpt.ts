// Un trozo de la canción del v3 para una prueba corta: la hoja del montaje (cuesheet.json) se alarga para que el logo y
// el cierre caigan después del final del vídeo; así sus compases suenan con ritmo, como en mitad de la película, y el
// vídeo toma solo su tramo (con el fundido de salida de la salida). Deja la hoja alargada junto al WAV.
//   node scripts/video/sound-v3/excerpt.ts work/<montaje>/cuesheet.json work/<montaje>/soundtrack.wav
import { readFileSync, writeFileSync } from 'node:fs'
import { renderV3 } from './render.ts'
import type { MontageCues } from './timeline.ts'

/** La hoja alargada: el logo un compás después del último que empieza en el vídeo, y tres compases de cierre. */
export function excerptSheet(sheet: MontageCues): MontageCues {
  const bar = 240 / sheet.bpm
  const logo = +(Math.ceil(sheet.duration / bar + 1) * bar).toFixed(3)
  return { ...sheet, duration: +(logo + 3 * bar).toFixed(3), events: [...sheet.events.filter((e) => e.type !== 'logo'), { t: logo, type: 'logo', intensity: 1, pan: 0 }] }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [input, out] = process.argv.slice(2)
  if (!input || !out) {
    console.error('uso: node scripts/video/sound-v3/excerpt.ts <cuesheet.json> <salida.wav>')
    process.exit(2)
  }
  const sheet = excerptSheet(JSON.parse(readFileSync(input, 'utf8')) as MontageCues)
  writeFileSync(out.replace(/\.wav$/i, '') + '.sheet.json', JSON.stringify(sheet, null, 1) + '\n')
  const r = renderV3(sheet, out)
  console.log(`${out}: ${r.stats.seconds} s · pico ${r.stats.peakDb} dBFS · pico real ${r.stats.truePeakDb} dBTP · línea de tiempo ${r.timeline}`)
}
