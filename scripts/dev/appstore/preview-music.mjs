// La música de las vistas previas del App Store: piano tranquilo, original, sintetizado con scripts/video/audio (sin
// pistas de terceros). 72 ppm en fa, Fmaj7 · Dm7 · B♭maj7 · C; el motivo con el primer rótulo, un soplo suave en cada
// cambio de escena y el acorde final en la cartela. Se masteriza a −18 LUFS con el pico verdadero ≤ −1,5 dBTP.
//   node scripts/dev/appstore/preview-music.mjs render [salida.wav] [--duration 27]   → WAV de 48 kHz, 16 bits, estéreo
//   node scripts/dev/appstore/preview-music.mjs measure <archivo.wav|.mp4|.m4a>        → sonoridad y picos (tras el AAC)
// «render» usa el Electron del compositor (scripts/video/compose), como el vídeo del README. «measure» decodifica con
// afconvert (de macOS) y mide con audio/loudness.ts; sale con 1 si no cumple (−18 ± 0,5 LUFS en el WAV y ± 1 en el MP4,
// ≤ −1,5 dBTP, sin saturar, sin continua y en silencio al final).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCompositor } from '../../video/compose/host.ts'
import { integratedLoudness, master, samplePeak, truePeak } from '../../video/audio/loudness.ts'
import { readWav } from '../../video/audio/track.ts'
import { encodeWav } from '../../video/sound/wav.ts'
import { CAPTIONS, CLIPS, END_CARD } from './store-copy.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../../..')
const RATE = 48000
const TARGET = -18
const CEILING = -1.5

/** La pieza: los tiempos salen del guion de la vista previa (store-copy.mjs). */
function music(duration) {
  const beat = 60 / 72
  // un soplo en cada cambio de escena (los fundidos largos, no el corte suave del tutor), en la mitad del fundido
  const scenes = CLIPS.filter((c) => (c.dissolveIn ?? 0) >= 0.4).map((c) => ({ t: c.at + c.dissolveIn / 2, kind: 'swell' }))
  return {
    bpm: 72,
    root: 65, // fa
    chords: ['Fmaj7', 'Dm7', 'Bbmaj7', 'C', 'Fmaj7', 'Dm7', 'Bbmaj7', 'C', 'Fmaj7'],
    // piano arpegiado; desde el compás 3 (el boli rojo) se abre a marimba y bajo; cierre en la cartela
    sections: [{ bar: 1, style: 'piano' }, { bar: 3, style: 'dawn' }, { bar: 8, style: 'end' }],
    cues: [
      { t: CAPTIONS[0].start + beat, kind: 'motif', voice: 'bell' }, // con el primer rótulo (la anacrusa, medio pulso antes)
      ...scenes, // Hoy → lección, lección → el fallo, tutor → tarjetas
      { t: Math.min(END_CARD.start + END_CARD.fade / 2, duration - 2.5), kind: 'end' } // el acorde final, con la cartela
    ],
    clicks: null,
    sfx: null,
    seed: 27
  }
}

function db(x) {
  return Math.round(x * 100) / 100
}

/** Lo que se mira para dar la música por buena sin escucharla: sonoridad, picos, ráfagas, continua y el final. */
function report(channels, rate) {
  const len = channels[0].length
  const rms = (from, to) => {
    let s = 0
    let n = 0
    for (const c of channels) for (let i = Math.max(0, from); i < Math.min(len, to); i++) (s += c[i] * c[i]), n++
    return n ? 10 * Math.log10(s / n || 1e-20) : -200
  }
  // sonoridad a corto plazo (ventanas de 3 s cada 1 s): que no haya ráfagas muy por encima de la integrada
  let shortMax = -Infinity
  for (let t = 0; t + 3 * rate <= len; t += rate) {
    const l = integratedLoudness(channels.map((c) => c.subarray(t, t + 3 * rate)), rate)
    if (l > shortMax) shortMax = l
  }
  let nan = 0
  let dc = 0
  for (const c of channels) for (let i = 0; i < len; i++) Number.isFinite(c[i]) ? (dc += c[i]) : nan++
  return {
    seconds: Math.round((len / rate) * 1000) / 1000,
    lufs: db(integratedLoudness(channels, rate)),
    truePeak: db(truePeak(channels)),
    samplePeak: db(samplePeak(channels)),
    shortTermMax: db(shortMax),
    dcOffset: Math.round((dc / (len * channels.length)) * 1e6) / 1e6,
    nonFinite: nan,
    firstTenthDb: db(rms(0, rate / 10)),
    lastTwentyMsDb: db(rms(len - rate / 50, len))
  }
}

function verdict(r, tolerance) {
  const fails = []
  if (Math.abs(r.lufs - TARGET) > tolerance) fails.push(`sonoridad ${r.lufs} LUFS (objetivo ${TARGET} ± ${tolerance})`)
  if (r.truePeak > CEILING) fails.push(`pico verdadero ${r.truePeak} dBTP (techo ${CEILING})`)
  if (r.samplePeak >= 0) fails.push('satura')
  if (r.nonFinite) fails.push(`${r.nonFinite} muestras no finitas`)
  if (Math.abs(r.dcOffset) > 1e-3) fails.push(`continua ${r.dcOffset}`)
  if (r.shortTermMax - r.lufs > 6) fails.push(`ráfaga de ${r.shortTermMax} LUFS a corto plazo`)
  if (r.lastTwentyMsDb > -50) fails.push(`el final no acaba en silencio (${r.lastTwentyMsDb} dB)`)
  return fails
}

async function render(out, duration) {
  const work = mkdtempSync(join(tmpdir(), 'aula-preview-music-'))
  try {
    const job = { music: music(duration), duration, sampleRate: RATE }
    await runCompositor({ entry: join(HERE, 'preview-music.page.ts'), workDir: work, outDir: work, payload: job })
    const raw = readFileSync(join(work, 'music.f32'))
    const frames = Math.round(duration * RATE)
    if (raw.length !== frames * 8) throw new Error(`la página devolvió ${raw.length / 8} muestras y hacían falta ${frames}`)
    const f32 = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4)
    const channels = [f32.slice(0, frames), f32.slice(frames)]
    const m = master(channels, RATE, TARGET, CEILING)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, encodeWav(channels, RATE, 's16'))
    // se mide el archivo ya escrito (16 bits con tramado), no la mezcla en memoria
    const r = report(readWav(readFileSync(out)).channels, RATE)
    return { out, gainDb: db(m.gainDb), ...r }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

function measure(file) {
  const ext = extname(file).toLowerCase()
  if (ext === '.wav') return readWav(readFileSync(file))
  const tmp = mkdtempSync(join(tmpdir(), 'aula-preview-measure-'))
  try {
    const wav = join(tmp, 'audio.wav')
    // afconvert decodifica la pista AAC (también dentro de un MP4 con vídeo) y quita el cebado del codificador
    execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEF32@${RATE}`, file, wav])
    return readWav(readFileSync(wav))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

const [cmd, ...rest] = process.argv.slice(2)
const flag = (k, d) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : d)
if (cmd === 'render') {
  const duration = Number(flag('--duration', '27'))
  const out = resolve(rest.find((a) => a.endsWith('.wav')) ?? join(ROOT, 'docs/app-store/media/music/preview-27s.wav'))
  const r = await render(out, duration)
  const fails = verdict(r, 0.5)
  console.log(JSON.stringify(r, null, 2))
  console.log(fails.length ? '✗ ' + fails.join('; ') : `✓ ${out}`)
  process.exit(fails.length ? 1 : 0)
} else if (cmd === 'measure' && rest[0]) {
  const file = resolve(rest[0])
  const { rate, channels } = measure(file)
  const r = { file, rate, ...report(channels, rate) }
  // tras el AAC la sonoridad se mueve un poco y el pico puede subir: margen de 1 LU, el mismo techo
  const fails = verdict(r, extname(file).toLowerCase() === '.wav' ? 0.5 : 1)
  console.log(JSON.stringify(r, null, 2))
  console.log(fails.length ? '✗ ' + fails.join('; ') : '✓ pasa')
  process.exit(fails.length ? 1 : 0)
} else {
  console.log('uso: preview-music.mjs render [salida.wav] [--duration 27] | measure <archivo>')
  process.exit(2)
}
