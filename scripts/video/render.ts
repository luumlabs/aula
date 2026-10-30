// Cadena de render del vídeo de Aula.
//   node scripts/video/render.ts scripts/video/montage/demo.ts [opciones]
// Opciones:
//   --app out|tree|<ref git>   qué app capturar (por defecto out: la compilación de out/; tree: compila el árbol actual en
//                              una carpeta propia; HEAD o un commit: la versión de git, aparte)
//   --only capture|compose|cues  solo un paso (las tomas se guardan en caché por huella; cues: la hoja de efectos V5)
//   --outputs master,tour-1    qué salidas componer (por defecto: el máster y todas las de montage.outputs)
//   --draft                    borrador rápido: solo el máster a 1280×720 y 30 fps
//   --range 3:8                componer solo ese tramo del máster (segundos)
//   --stills 2.5,7             guarda esos instantes del máster como PNG (work/<montaje>/stills/)
//   --verify                   determinismo: captura cada toma dos veces y compone dos veces, y compara
//   --jobs N                   tomas en paralelo (por defecto 1)
//   --soft                     si el objetivo de una acción no aparece, aviso y sigue (borradores)
//   --reuse                    reutiliza las tomas capturadas aunque la app o su guion hayan cambiado (--strips lo hace solo)
//   --out carpeta              copia los MP4 ahí
//   --strips [t1,t2…]          revisión: tiras de 31 fotogramas (±1 s a 15 fps) en cada transición (o en esos instantes),
//                              en work/<montaje>/strips/; avisa de fotogramas planos y de saltos bruscos
//   --probe                    solo la sonda de códecs (H.264/AAC de este equipo)
//   --analyze [pista.mp3]      rejilla de pulsos y compases de la pista real (AULA_FILM_MUSIC o la de por defecto):
//                              escribe scripts/video/music/<pista>.grid.json (solo números; el audio nunca entra en el repo)
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import type { Montage, Output, TakeMeta } from './montage/types.ts'
import { cueSheet } from './montage/cues.ts'
import { lintMontage } from './montage/lint.ts'
import { appSnapshot } from './capture/snapshot.ts'
import { captureTake } from './capture/capture.ts'
import { runCompositor } from './compose/host.ts'
import type { ComposePayload } from './compose/page.ts'
import { H264_PROFILES, avcCodecString, inspectMp4 } from './mp4/inspect.ts'
import { decodePng, diffRgba } from './qc/png.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const args = process.argv.slice(2)
const opt = (name: string) => {
  const i = args.indexOf('--' + name)
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true') : undefined
}
const log = (msg: string) => console.log(`${new Date().toLocaleTimeString('es-ES')} ${msg}`)

async function probe(): Promise<void> {
  const out = join(HERE, 'work', 'probe')
  const r = await runCompositor({ entry: join(HERE, 'qc', 'probe.ts'), workDir: out, outDir: out, payload: {} })
  console.log(r)
}

async function analyze(): Promise<void> {
  const { decodeTrack, mono, trackPath } = await import('./audio/track.ts')
  const { analyzeTrack } = await import('./audio/beatgrid.ts')
  const file = trackPath(args[args.indexOf('--analyze') + 1]?.startsWith('--') ? undefined : args[args.indexOf('--analyze') + 1])
  const d = decodeTrack(file)
  const g = analyzeTrack(mono(d.channels), d.rate, { minBpm: 95, maxBpm: 140 })
  const slug = basename(file).replace(/\.[^.]+$/, '').split(' - ')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const out = join(HERE, 'music', `${slug}.grid.json`)
  mkdirSync(dirname(out), { recursive: true })
  const round = (v: number, d = 4) => +v.toFixed(d)
  writeFileSync(out, JSON.stringify({ ...g, track: basename(file), beat: round(g.beat, 6), firstBeat: round(g.firstBeat), downbeat: round(g.downbeat), duration: round(g.duration), bars: g.bars.map((b) => ({ ...b, t: round(b.t), rmsDb: round(b.rmsDb, 1), lowDb: round(b.lowDb, 1) })) }, null, 1) + '\n')
  log(`${basename(file)}: ${g.bpm} BPM (pulso ${(g.beat * 1000).toFixed(2)} ms), compás 1 en ${g.downbeat.toFixed(3)} s, ${g.bars.length} compases, confianza ${g.confidence}, secciones en ${g.sections.join(', ')}`)
  log(`escrito ${out}`)
}

/** El puente con el pintor de la app (compose/drawn-kit.ts) empaquetado para Node: el kit usa importaciones sin
 *  extensión, así que esbuild lo junta en un módulo en la caché. Para las piezas de los dibujos en la hoja de efectos. */
async function drawnKitForNode(cache: string): Promise<typeof import('./compose/drawn-kit.ts')> {
  const { build } = await import('esbuild')
  const out = join(cache, 'drawn-kit', 'drawn-kit.mjs')
  await build({ entryPoints: [join(HERE, 'compose', 'drawn-kit.ts')], outfile: out, bundle: true, platform: 'node', format: 'esm', logLevel: 'error' })
  return (await import(pathToFileURL(out).href + `?v=${Date.now()}`)) as typeof import('./compose/drawn-kit.ts')
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.max(1, n) }, async () => {
      for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x)
    })
  )
}

async function captureAll(m: Montage, dir: string, appDir: string, fingerprint: string, jobs: number): Promise<Record<string, TakeMeta>> {
  const used = [...new Set(m.clips.map((c) => c.take))]
  const takes: Record<string, TakeMeta> = {}
  await pool(used, jobs, async (name) => {
    const t = Date.now()
    takes[name] = await captureTake({ name, take: m.takes[name], fps: m.takes[name].fps ?? m.fps, appDir, fingerprint, outDir: dir, log, soft: !!opt('soft'), reuse: !!opt('reuse') || args.includes('--strips') })
    log(`toma ${name}: ${takes[name].frames} fotogramas (${((Date.now() - t) / 1000).toFixed(1)} s, ${takes[name].timing.perFrameMs} ms/fotograma)`)
  })
  return takes
}

interface ComposeResult {
  path: string
  sheet: string | null
  bytes: number
  frames: number
  codec: string
  hardware: boolean
  mix: { lufs: number; truePeak: number } | null
  finalAudio: { lufs: number; truePeak: number; seconds: number } | null
  decodedFrames: number
  psnr: Record<string, number>
  hashes: string[]
  /** Instantes con fotogramas planos (gris, blanco, a medio cargar). */
  flat?: number[]
  /** Saltos entre fotogramas: la diferencia media de luma (0–255) más alta y dónde, y los fotogramas por encima de 12. */
  scan?: { max: number; at: number; over12: number[]; top: { t: number; d: number }[] }
  timing: Record<string, number>
}

type ResolvedOutput = ComposePayload['output']

/** El máster (tamaño y fps del montaje) y las salidas declaradas, con sus valores por defecto. */
/** bits/s del vídeo para que el archivo quepa en `maxMB` (con un 6 % de margen para el contenedor y el control de tasa). */
export function bitrateFor(maxMB: number, seconds: number, audioBitrate: number): number {
  return Math.max(1e6, Math.min(16e6, Math.floor((maxMB * 8e6 * 0.94) / Math.max(1, seconds) - audioBitrate)))
}

function resolveOutputs(m: Montage): ResolvedOutput[] {
  const rate = (o: { bitrate?: number; maxMB?: number }, range: [number, number], audio: number) => o.bitrate ?? m.bitrate ?? (o.maxMB ?? m.maxMB ? bitrateFor((o.maxMB ?? m.maxMB)!, range[1] - range[0], audio) : 16e6)
  const master: ResolvedOutput = { name: m.name, size: m.size, fps: m.fps, bitrate: rate({}, [0, m.duration], 192000), audioBitrate: 192000, range: [0, m.duration], maxMB: m.maxMB }
  const rest = (m.outputs ?? []).map((o: Output): ResolvedOutput => {
    const range = o.range ?? [0, m.duration]
    const audioBitrate = o.audioBitrate ?? 192000
    return { ...o, size: o.size ?? m.size, fps: o.fps ?? m.fps, bitrate: rate(o, range, audioBitrate), audioBitrate, range }
  })
  return [master, ...rest]
}

/** La pista real decodificada (o null, con aviso, si falta: suena lo sintetizado). */
async function trackFor(m: Montage): Promise<{ wav: string; dir: string } | null> {
  if (m.music?.wav) {
    // V5: la banda sonora generada por SOUND (WAV); si falta, aviso y suena lo sintetizado
    const file = resolve(HERE, m.music.wav)
    if (existsSync(file)) return { wav: basename(file), dir: dirname(file) }
    log(`AVISO: no está la banda sonora ${file}; suena la música sintetizada`)
    return null
  }
  if (!m.music?.track) return null
  const { decodeTrack, trackPath } = await import('./audio/track.ts')
  const file = trackPath(m.music.track.file)
  try {
    const d = decodeTrack(file)
    return { wav: basename(d.wav), dir: dirname(d.wav) }
  } catch (e) {
    log(`AVISO: no hay pista (${(e as Error).message}); suena la música sintetizada`)
    return null
  }
}

async function compose(m: Montage, takes: Record<string, TakeMeta>, takesDir: string, outDir: string, output: ResolvedOutput, hashFrames: boolean): Promise<ComposeResult> {
  const track = await trackFor(m)
  const payload: ComposePayload = { montage: m, takes, output, sheetEvery: m.duration > 40 ? 2 : 0.5, hashFrames, trackWav: track?.wav }
  return (await runCompositor({
    entry: join(HERE, 'compose', 'page.ts'),
    workDir: takesDir,
    outDir,
    musicDir: track?.dir,
    payload,
    onLog: (msg) => {
      if (msg.step === 'vídeo' && Number(msg.frame) % 600 !== 0) return
      if (msg.console && !/Electron Security Warning/.test(String(msg.console))) log(`[página] ${String(msg.console).slice(0, 300)}`)
      else if (!msg.console) log(`[${output.name}] ${JSON.stringify(msg)}`)
    }
  })) as ComposeResult
}

/** Comprobación del MP4 en Node y con AVFoundation (lo que usan el iPad, Safari y QuickTime). */
function qc(file: string, r: ComposeResult, o: ResolvedOutput): Record<string, unknown> {
  const data = new Uint8Array(readFileSync(file))
  const info = inspectMp4(data)
  const v = info.tracks.find((t) => t.handler === 'vide')!
  const a = info.tracks.find((t) => t.handler === 'soun')
  const fps = v.timescale / v.sampleDurations[0]
  const constantFps = v.sampleDurations.every((d) => d === v.sampleDurations[0])
  const report: Record<string, unknown> = {
    file,
    bytes: data.length,
    mb: +(data.length / 1e6).toFixed(2),
    mbps: +((data.length * 8) / info.movieDuration / 1e6).toFixed(2),
    boxes: info.topLevel.join(' '),
    faststart: info.faststart,
    duration: +info.movieDuration.toFixed(3),
    video: {
      codec: avcCodecString(v.config),
      profile: H264_PROFILES[v.profile ?? 0] ?? v.profile,
      level: (v.level ?? 0) / 10,
      size: `${v.width}×${v.height}`,
      fps: +fps.toFixed(3),
      constantFps,
      frames: v.sampleSizes.length,
      keyframes: v.syncSamples?.length ?? v.sampleSizes.length,
      colr: v.colr
    },
    audio: a ? { codec: a.codec, aac: a.aacObjectType === 2 ? 'AAC-LC' : a.aacObjectType, rate: a.sampleRate, channels: a.channels, priming: a.editMediaTime, seconds: +((a.editDuration ?? 0) / 1000).toFixed(3) } : null,
    decodedFrames: r.decodedFrames,
    psnr: r.psnr,
    loudness: r.finalAudio,
    mix: r.mix,
    scan: r.scan
  }
  const problems: string[] = []
  if (!info.faststart) problems.push('moov no va delante de mdat')
  if (v.profile !== 100) problems.push('el perfil no es High')
  if (Math.abs(fps - o.fps) > 1e-6 || !constantFps) problems.push(`fps ${fps} (se pedían ${o.fps} constantes)`)
  if (r.decodedFrames !== v.sampleSizes.length) problems.push(`se decodificaron ${r.decodedFrames} de ${v.sampleSizes.length} fotogramas`)
  // V6: la banda del v3 suena tal cual (music.asIs): no se le pide −14 LUFS; solo que el AAC no pase de −1,5 dBTP
  const asIs = !!(r.mix as { asIs?: boolean } | null)?.asIs
  if (r.finalAudio && !asIs && Math.abs(r.finalAudio.lufs + 14) > 0.5) problems.push(`sonoridad ${r.finalAudio.lufs} LUFS (objetivo −14 ± 0,5)`)
  if (r.finalAudio && r.finalAudio.truePeak > -1.5) problems.push(`pico verdadero ${r.finalAudio.truePeak} dBTP (> −1,5)`)
  if (Object.values(r.psnr).some((p) => p < 36)) problems.push('PSNR bajo (< 36 dB) frente al original')
  if (r.flat?.length) problems.push(`fotogramas planos en ${r.flat.slice(0, 8).join(', ')} s${r.flat.length > 8 ? '…' : ''}`)
  if (o.maxMB && data.length / 1e6 > o.maxMB) problems.push(`pesa ${(data.length / 1e6).toFixed(2)} MB (máximo ${o.maxMB})`)
  if (process.platform === 'darwin') {
    // AVFoundation: decodificar el archivo entero (vídeo y audio) y leer el cebado del AAC con CoreAudio
    const tmp = join(tmpdir(), `aula-video-avf-${process.pid}.mp4`)
    try {
      const t = Date.now()
      execFileSync('avconvert', ['-s', file, '-p', 'Preset1280x720', '-o', tmp, '--replace'], { stdio: 'pipe' })
      report.avfoundation = `decodifica bien (${((Date.now() - t) / 1000).toFixed(1)} s)`
    } catch (e) {
      report.avfoundation = 'ERROR: ' + String((e as Error).message).slice(0, 200)
      problems.push('AVFoundation no pudo decodificarlo')
    } finally {
      rmSync(tmp, { force: true })
    }
    try {
      report.coreaudio = execFileSync('afinfo', [file], { encoding: 'utf8' }).split('\n').find((l) => l.includes('valid frames'))?.trim()
    } catch {
      /* sin afinfo */
    }
  }
  report.problems = problems
  return report
}

async function verifyTakes(m: Montage, a: Record<string, TakeMeta>, dirA: string, dirB: string, appDir: string, fingerprint: string): Promise<Record<string, unknown>> {
  const b = await captureAll(m, dirB, appDir, fingerprint + '-b', 1)
  const out: Record<string, unknown> = {}
  for (const name of Object.keys(a)) {
    let same = 0
    let small = 0
    let px50 = 0
    let maxPixels = 0
    let maxDelta = 0
    for (let f = 0; f < a[name].frames; f++) {
      if (a[name].frameHashes[f] === b[name].frameHashes[f]) {
        same++
        continue
      }
      const n = String(f).padStart(6, '0') + '.png'
      const d = diffRgba(decodePng(readFileSync(join(dirA, name, n))), decodePng(readFileSync(join(dirB, name, n))))
      if (d.pixels <= 10 && d.max <= 5) small++
      else if (d.pixels <= 50) px50++
      maxPixels = Math.max(maxPixels, d.pixels)
      maxDelta = Math.max(maxDelta, d.max)
    }
    out[name] = { frames: a[name].frames, identical: same, within10px5: small, within50px: px50, okPercent: +((100 * (same + small + px50)) / a[name].frames).toFixed(1), worstFramePixels: maxPixels, worstDelta: maxDelta }
  }
  return out
}

/** Las transiciones del guion: cada plano que entra (salvo el primero), el final del prólogo y el comienzo del final. */
function transitions(m: Montage): { t: number; label: string }[] {
  const out: { t: number; label: string }[] = []
  const clips = [...m.clips].sort((a, b) => a.start - b.start)
  clips.forEach((c, i) => {
    if (i > 0) out.push({ t: c.start, label: `${c.enter?.kind ?? 'corte'} → ${c.take}` })
  })
  if (m.prologue) out.push({ t: m.prologue.end, label: 'fin del prólogo' })
  if (m.finale) out.push({ t: m.finale.start, label: 'final: ventana → icono' })
  return out.sort((a, b) => a.t - b.t)
}

async function reviewStrips(m: Montage, takes: Record<string, TakeMeta>, takesDir: string, work: string): Promise<void> {
  const given = opt('strips')
  const list = given && given !== 'true' ? given.split(',').map((x) => ({ t: Number(x), label: 'instante pedido' })) : transitions(m)
  const output = resolveOutputs(m)[0]
  const r = (await runCompositor({
    entry: join(HERE, 'compose', 'page.ts'),
    workDir: takesDir,
    outDir: work,
    payload: { montage: m, takes, output, sheetEvery: 1, hashFrames: false, strips: list } satisfies ComposePayload,
    onLog: (msg) => msg.step === 'tira' && log(`tira ${msg.n}/${msg.de}`)
  })) as { strips: { label: string; t: number; file: string; flat: number[]; maxJump: number }[] }
  for (const s of r.strips) log(`${s.t.toFixed(2)} s · ${s.label}: salto máx. ${s.maxJump}${s.flat.length ? ` · ¡fotogramas planos en ${s.flat.join(', ')}!` : ''} → ${s.file}`)
  writeFileSync(join(work, 'strips', 'strips.json'), JSON.stringify(r.strips, null, 2))
}

async function main(): Promise<void> {
  if (opt('probe')) return probe()
  if (args.includes('--analyze')) return analyze()
  const file = args.find((a) => !a.startsWith('--') && /\.ts$/.test(a))
  if (!file) throw new Error('uso: node scripts/video/render.ts <montaje.ts> [--app out|tree|HEAD] [--only capture|compose] [--draft] [--verify]')
  const m = ((await import(pathToFileURL(resolve(file)).href)) as { default: Montage }).default
  const work = join(HERE, 'work', m.name)
  const takesDir = join(work, 'takes')
  mkdirSync(takesDir, { recursive: true })
  const t0 = Date.now()
  const cache = process.env.VT_CACHE || join(tmpdir(), 'aula-video-cache')
  const snap = appSnapshot(ROOT, cache, opt('app') ?? 'out', log)
  log(`app congelada ${snap.fingerprint} (${opt('app') ?? 'out'})`)
  const takes = await captureAll(m, takesDir, snap.dir, snap.fingerprint, Number(opt('jobs') ?? 1))
  const captureS = (Date.now() - t0) / 1000
  writeFileSync(join(work, 'cues.json'), JSON.stringify(cueSheet(m, takes), null, 2))
  const { clipViews, viewCursorPx } = await import('./compose/render.ts')
  const lint = lintMontage(m, {
    cursorAt: (t) =>
      clipViews(m, takes, t).flatMap((v) => {
        const p = viewCursorPx(m, v)
        return p ? [p] : []
      })
  })
  for (const w of lint) log(`guion: ${w}`)
  // V5 · la hoja de efectos para SOUND (siempre; con --only cues, solo ella)
  {
    const { cueSheet5 } = await import('./montage/cuesheet.ts')
    const kit = m.drawings?.length ? await drawnKitForNode(cache) : null
    const sheet = cueSheet5(m, {
      drawingPieces: kit ? (who, tone) => kit.subjectOf(who, tone).pieces : undefined,
      cursorX: (t) => {
        const v = clipViews(m, takes, t).pop()
        return v ? (viewCursorPx(m, v)?.[0] ?? null) : null
      }
    })
    writeFileSync(join(work, 'cuesheet.json'), JSON.stringify(sheet, null, 1))
    log(`hoja de efectos: ${sheet.events.length} eventos → ${join(work, 'cuesheet.json')}`)
    if (opt('only') === 'cues') return
  }
  if (opt('only') === 'capture') return
  if (args.includes('--strips')) return reviewStrips(m, takes, takesDir, work)

  let outputs = resolveOutputs(m)
  if (opt('draft')) outputs = [{ ...outputs[0], name: `${m.name}-borrador`, size: [1280, 720], fps: 30, bitrate: 5e6, audioBitrate: 128000 }]
  const pick = opt('outputs')?.split(',')
  if (pick) outputs = outputs.filter((o, i) => pick.includes(o.name) || (i === 0 && pick.includes('master')))
  if (!outputs.length) throw new Error('ninguna salida coincide con --outputs')
  const range = opt('range')?.split(':').map(Number) as [number, number] | undefined
  const stills = opt('stills')?.split(',').map(Number)
  if (range) outputs[0] = { ...outputs[0], range }
  if (stills) outputs[0] = { ...outputs[0], stills: [...(outputs[0].stills ?? []), ...stills] }
  const verify = !!opt('verify')
  const reports: Record<string, unknown>[] = []
  const results: ComposeResult[] = []
  for (const o of outputs) {
    const tc = Date.now()
    const r = await compose(m, takes, takesDir, work, o, verify && o === outputs[0])
    const report = qc(r.path, r, o)
    report.render = { composeS: +((Date.now() - tc) / 1000).toFixed(1), compositor: r.timing, hardwareEncoder: r.hardware }
    report.sheet = r.sheet
    reports.push(report)
    results.push(r)
    const problems = report.problems as string[]
    log(`${o.name}: ${report.mb} MB, ${problems.length ? 'PROBLEMAS: ' + problems.join('; ') : 'sin problemas'}`)
    if (r.scan) log(`${o.name}: salto máximo entre fotogramas ${r.scan.max} en ${r.scan.at} s; por encima de 12: ${r.scan.over12.length ? r.scan.over12.join(', ') : 'ninguno'}`)
  }
  const summary: Record<string, unknown> = {
    montage: m.name,
    lint,
    captureS: +captureS.toFixed(1),
    takes: Object.fromEntries(Object.entries(takes).map(([k, v]) => [k, { frames: v.frames, ...v.timing }])),
    outputs: reports
  }
  if (verify) {
    log('determinismo: segunda captura de cada toma…')
    summary.determinismTakes = await verifyTakes(m, takes, takesDir, join(work, 'takes-b'), snap.dir, snap.fingerprint)
    log('determinismo: segunda composición…')
    const o = { ...outputs[0], name: `${outputs[0].name}-b`, stills: undefined }
    const r2 = await compose(m, takes, takesDir, work, o, true)
    const r = results[0]
    const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16)
    summary.determinismCompose = { frames: r.hashes.length, framesIdentical: r.hashes.filter((h, i) => h === r2.hashes[i]).length, mp4Identical: sha(r.path) === sha(r2.path) }
  }
  writeFileSync(join(work, 'qc.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  const out = opt('out')
  if (out) {
    mkdirSync(resolve(out), { recursive: true })
    for (const r of results) copyFileSync(r.path, join(resolve(out), basename(r.path)))
    log(`copiado a ${resolve(out)}`)
  }
  log(`listo en ${((Date.now() - t0) / 1000).toFixed(0)} s: ${results.map((r) => basename(r.path)).join(', ')} (en ${work})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
