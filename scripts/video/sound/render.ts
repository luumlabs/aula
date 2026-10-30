// Banda sonora desde una hoja de efectos (Node):
//   node scripts/video/sound/render.ts <hoja.json | demo:film | demo:short> <salida.wav> [--png lámina.png] [--report informe.json] [--sheet hoja.json] [--s16]
// Escribe el WAV estéreo de 48 kHz (flotante de 32 bits; --s16 para PCM de 16) ya mezclado y masterizado (−14 LUFS,
// ≤ −2,5 dBTP en el WAV), y si se pide, la lámina de revisión, el informe (acordes, colocaciones, niveles, tiempos) y la hoja
// v1 que se usó (--sheet: útil con las de ejemplo o para ver cómo se tradujo la del montaje).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { EventCheck } from './analysis.ts'
import { demoFilm, demoShort } from './demo.ts'
import { renderSoundtrack } from './score.ts'
import { fromMontage, isMontageSheet } from './sheet.ts'
import { soundSheetPng } from './sheetpng.ts'
import { encodeWav } from './wav.ts'

const args = process.argv.slice(2)
const opt = (k: string) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : undefined
}
const [input, out] = args.filter((a, i) => !a.startsWith('--') && !['--png', '--report', '--sheet'].includes(args[i - 1]))
if (!input || !out) {
  console.error('uso: node scripts/video/sound/render.ts <hoja.json | demo:film | demo:short> <salida.wav> [--png lámina.png] [--report informe.json] [--s16]')
  process.exit(2)
}
const raw: unknown = input === 'demo:film' ? demoFilm() : input === 'demo:short' ? demoShort() : JSON.parse(readFileSync(input, 'utf8'))
const sheet = isMontageSheet(raw) ? fromMontage(raw) : raw
const saveSheet = opt('--sheet')
if (saveSheet) writeFileSync(saveSheet, JSON.stringify(sheet, null, 1) + '\n')
const st = renderSoundtrack(sheet)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, encodeWav(st.channels, st.sampleRate, args.includes('--s16') ? 's16' : 'f32'))
const m = st.report.mix.master
console.log(`${out}: ${st.sheet.duration.toFixed(2)} s · ${m.lufs} LUFS · ${m.truePeak} dBTP · ${st.report.placements.length} efectos · ${st.report.renderMs} ms`)
let checks: EventCheck[] | undefined
const png = opt('--png')
if (png) {
  const sheetPng = soundSheetPng(st)
  checks = sheetPng.checks
  mkdirSync(dirname(png), { recursive: true })
  writeFileSync(png, sheetPng.png)
  const worst = checks.reduce((a, c) => (c.snrDb < a.snrDb ? c : a), checks[0])
  const soft = (c: EventCheck) => c.type === 'whoosh' || c.type === 'rise'
  const maxErr = checks.filter((c) => !soft(c)).reduce((a, c) => Math.max(a, Math.abs(c.errorMs ?? 0)), 0)
  const maxSoft = checks.filter(soft).reduce((a, c) => Math.max(a, Math.abs(c.errorMs ?? 0)), 0)
  console.log(`${png}: error máx. del ataque ${maxErr} ms (cresta de aire/subida ${maxSoft} ms) · efecto/música mín. ${worst?.snrDb} dB (${worst?.type} @ ${worst?.t})`)
}
const report = opt('--report')
if (report) writeFileSync(report, JSON.stringify({ ...st.report, checks }, null, 1) + '\n')
