// Página del compositor: música → mezcla a −14 LUFS → AAC; fotograma a fotograma: cargar capturas → dibujar → H.264;
// muxer MP4 con faststart; control de calidad dentro del propio Electron (decodifica el MP4 final: fotogramas, PSNR frente
// al original, sonoridad y pico verdadero del audio ya codificado) y hoja de contactos.
import type { Montage, Output, TakeMeta } from '../montage/types.ts'
import { vt } from './bridge.ts'
import { clipViews, drawFrame, type Assets, type ClipView, type FrameSource } from './render.ts'
import { loadIconAssets } from './icon.ts'
import { decodeAac, encodeAac, H264Encoder, h264Codec } from './encode.ts'
import { muxMp4 } from '../mp4/muxer.ts'
import { inspectMp4, trackSamples } from '../mp4/inspect.ts'
import { renderMusic } from '../audio/music.ts'
import { editTrack } from '../audio/edit.ts'
import { filmGrid } from '../montage/grid.ts'
import { integratedLoudness, master, truePeak } from '../audio/loudness.ts'
import { clickCues, pixelCues } from '../montage/cues.ts'
import { storyEvents } from '../audio/sfx.ts'
import { ICON_ANIMS } from '../../../src/renderer/src/design/pixel/iconAnims.ts'
/** Pico verdadero máximo del archivo final (medido tras el AAC), y margen por la diferencia entre decodificadores. */
export const FILE_TRUE_PEAK = -1.5
const TP_MARGIN = 0.15

export interface ComposePayload {
  montage: Montage
  takes: Record<string, TakeMeta>
  /** La salida que se compone (el máster o una parte). */
  output: Required<Pick<Output, 'name' | 'size' | 'fps' | 'bitrate' | 'audioBitrate' | 'range'>> & Output
  /** Segundos entre miniaturas de la hoja de contactos. */
  sheetEvery: number
  /** Huella SHA-256 de cada fotograma compuesto (para comprobar el determinismo). */
  hashFrames: boolean
  /** Sin música (borradores rápidos). */
  silent?: boolean
  /** WAV de la pista real ya decodificado (vt://music/<archivo>); si falta, suena lo sintetizado. */
  trackWav?: string
  /** Modo revisión: en vez de codificar, tiras de fotogramas a 15 fps (±1 s) alrededor de cada instante. */
  strips?: { t: number; label: string }[]
  /** Retardo del AAC medido (muestras de cebado). */
  priming?: number
}

const AAC_PRIMING = 2112

/** Carga (con caché y precarga) los PNG de las tomas, reducidos con calidad alta al tamaño de pantalla. */
class FrameLoader {
  private blobs = new Map<string, Promise<Blob>>()
  private readonly outScale: number
  constructor(outScale: number) {
    this.outScale = outScale
  }
  private fetchBlob(url: string): Promise<Blob> {
    let p = this.blobs.get(url)
    if (!p) {
      p = fetch(url).then((r) => {
        if (!r.ok) throw new Error(`no se pudo leer ${url}`)
        return r.blob()
      })
      this.blobs.set(url, p)
      if (this.blobs.size > 48) this.blobs.delete(this.blobs.keys().next().value!)
    }
    return p
  }
  static url(take: string, frame: number): string {
    return `vt://work/${encodeURIComponent(take)}/${String(frame).padStart(6, '0')}.png`
  }
  prefetch(take: string, frame: number, frames: number, step: number): void {
    for (let k = 1; k <= 6 && frame + k * step < frames; k++) void this.fetchBlob(FrameLoader.url(take, frame + k * step))
  }
  async load(v: ClipView, step: number): Promise<FrameSource> {
    const blob = await this.fetchBlob(FrameLoader.url(v.clip.take, v.frame))
    this.prefetch(v.clip.take, v.frame, v.meta.frames, step)
    const [vw, vh] = v.meta.viewport
    const w = Math.ceil(vw * v.zoom * v.scale * this.outScale)
    const h = Math.ceil(vh * v.zoom * v.scale * this.outScale)
    // por debajo de 0,75 de la captura se reduce al decodificar (filtro de calidad alta: texto nítido, sin dientes)
    const image = w < vw * v.meta.scale * 0.75 ? await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }) : await createImageBitmap(blob)
    return { image, dark: isDark(image) }
  }
}

/** ¿La app está en oscuro en este fotograma? Se mira el papel de la barra de arriba del contenido (siempre opaco). */
const tone = new OffscreenCanvas(1, 1)
const toneCtx = tone.getContext('2d', { willReadFrequently: true })!
function isDark(image: ImageBitmap): boolean {
  toneCtx.clearRect(0, 0, 1, 1)
  toneCtx.drawImage(image, image.width * 0.55, image.height * 0.01, image.width * 0.1, image.height * 0.02, 0, 0, 1, 1)
  const [r, g, b] = toneCtx.getImageData(0, 0, 1, 1).data
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110
}

async function sha256(data: Uint8ClampedArray): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data as Uint8ClampedArray<ArrayBuffer>)
  return [...new Uint8Array(d).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Decodifica el vídeo del MP4 final: cuántos fotogramas salen y PSNR de algunos frente al lienzo original. */
async function verifyVideo(mp4: Uint8Array, refs: Map<number, ImageData>, W: number, H: number): Promise<{ decoded: number; psnr: Record<number, number> }> {
  const info = inspectMp4(mp4)
  const track = info.tracks.find((t) => t.handler === 'vide')!
  const samples = trackSamples(mp4, track)
  const canvas = new OffscreenCanvas(W, H)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const psnr: Record<number, number> = {}
  let decoded = 0
  let failure: unknown = null
  const dec = new VideoDecoder({
    output: (frame) => {
      const i = decoded++
      const ref = refs.get(i)
      if (ref) {
        ctx.drawImage(frame, 0, 0)
        const got = ctx.getImageData(0, 0, W, H).data
        let se = 0
        for (let k = 0; k < got.length; k += 4) for (let c = 0; c < 3; c++) se += (got[k + c] - ref.data[k + c]) ** 2
        const mse = se / ((got.length / 4) * 3)
        psnr[i] = +(10 * Math.log10((255 * 255) / Math.max(mse, 1e-9))).toFixed(2)
      }
      frame.close()
    },
    error: (e) => (failure = e)
  })
  dec.configure({ codec: 'avc1.' + [track.config[1], track.config[2], track.config[3]].map((b) => b.toString(16).padStart(2, '0')).join(''), description: track.config, codedWidth: W, codedHeight: H })
  samples.forEach((s, i) => {
    dec.decode(new EncodedVideoChunk({ type: !track.syncSamples || track.syncSamples.includes(i + 1) ? 'key' : 'delta', timestamp: i * 1000, data: s }))
  })
  await dec.flush()
  dec.close()
  if (failure) throw failure
  return { decoded, psnr }
}

async function contactSheet(thumbs: { t: number; bitmap: ImageBitmap }[], name: string): Promise<string | null> {
  if (!thumbs.length) return null
  const cols = 6
  const tw = 320
  const th = 180
  const rows = Math.ceil(thumbs.length / cols)
  const sheet = new OffscreenCanvas(cols * (tw + 8) + 8, rows * (th + 30) + 8)
  const ctx = sheet.getContext('2d')!
  ctx.fillStyle = '#1a1816'
  ctx.fillRect(0, 0, sheet.width, sheet.height)
  ctx.font = '500 15px ui-monospace, monospace'
  thumbs.forEach(({ t, bitmap }, i) => {
    const x = 8 + (i % cols) * (tw + 8)
    const y = 8 + Math.floor(i / cols) * (th + 30)
    ctx.drawImage(bitmap, x, y, tw, th)
    ctx.fillStyle = '#e8e2d8'
    ctx.fillText(`${t.toFixed(2)} s`, x + 2, y + th + 19)
  })
  const blob = await sheet.convertToBlob({ type: 'image/png' })
  return vt.write(name, new Uint8Array(await blob.arrayBuffer()))
}

/** Fundidos de sonido (curva de potencia constante) al principio y al final del tramo. */
function fades(channels: Float32Array[], rate: number, fadeIn = 0, fadeOut = 0): void {
  const n = channels[0].length
  const a = Math.round(fadeIn * rate)
  const b = Math.round(fadeOut * rate)
  for (const c of channels) {
    for (let i = 0; i < a && i < n; i++) c[i] *= Math.sin((Math.PI / 2) * (i / a))
    for (let i = 0; i < b && i < n; i++) c[n - 1 - i] *= Math.sin((Math.PI / 2) * (i / b))
  }
}

/** La banda sonora entera: la pista real montada (normalizada a −14 LUFS) con clics y personajes por debajo, o la
 *  música sintetizada si no hay pista. */
async function soundtrack(m: Montage, job: ComposePayload, clicks: number[], sfx: ReturnType<typeof storyEvents>): Promise<{ channels: Float32Array[]; sampleRate: number }> {
  const music = m.music!
  if (!music.track || !job.trackWav) return renderMusic(music, m.duration, clicks, sfx)
  const rate = 48000
  const res = await fetch(`vt://music/${encodeURIComponent(job.trackWav)}`)
  if (!res.ok) throw new Error('no se pudo leer la pista decodificada')
  const ac = new OfflineAudioContext(2, rate, rate)
  const buf = await ac.decodeAudioData(await res.arrayBuffer())
  const src = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, c) => buf.getChannelData(c))
  if (src.length === 1) src.push(src[0])
  const g = filmGrid(music.track.grid, music.track.cuts ?? [], music.track.start ?? 0)
  if (Math.abs(g.duration - m.duration) > 0.05) vt.log({ aviso: `la película dura ${m.duration} s y la pista montada ${g.duration.toFixed(3)} s` })
  const track = editTrack(src, rate, g.segments, m.duration)
  // la pista a −14 LUFS (solo ganancia) y, encima, los efectos calibrados para esa sonoridad
  const level = integratedLoudness(track, rate)
  const gain = Math.pow(10, (-14 - level) / 20)
  for (const c of track) for (let i = 0; i < c.length; i++) c[i] *= gain
  const fx = await renderMusic(music, m.duration, clicks, sfx, rate, { effectsOnly: true })
  for (let c = 0; c < 2; c++) for (let i = 0; i < track[c].length; i++) track[c][i] += fx.channels[c][i] ?? 0
  vt.log({ step: 'pista', origen: job.trackWav, lufsOriginal: +level.toFixed(2), ganancia: +(20 * Math.log10(gain)).toFixed(2), cortes: g.cuts.map((x) => +x.toFixed(3)) })
  return { channels: track, sampleRate: rate }
}

/** Desviación típica de la luminancia de un fotograma (en pequeño): un fotograma «plano» (gris, blanco, a medio
 *  cargar) da casi 0. */
const probe = new OffscreenCanvas(48, 27)
const probeCtx = probe.getContext('2d', { willReadFrequently: true })!
function flatness(src: OffscreenCanvas): number {
  probeCtx.drawImage(src, 0, 0, 48, 27)
  const d = probeCtx.getImageData(0, 0, 48, 27).data
  let s = 0
  let s2 = 0
  const n = d.length / 4
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
    s += l
    s2 += l * l
  }
  return Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2))
}

/** Tiras de revisión: 31 fotogramas (±1 s a 15 fps) alrededor de cada transición, con su hora, en una hoja por transición. */
async function strips(job: ComposePayload, assets: Assets): Promise<void> {
  const m = job.montage
  const [W, H] = m.size
  const canvas = new OffscreenCanvas(W, H)
  const ctx = canvas.getContext('2d', { alpha: false })!
  const loader = new FrameLoader(1)
  const tw = 384
  const th = 216
  const cols = 8
  const out: { label: string; t: number; file: string; flat: number[]; maxJump: number }[] = []
  for (const [n, s] of (job.strips ?? []).entries()) {
    const times = Array.from({ length: 31 }, (_, k) => +(s.t - 1 + k / 15).toFixed(4)).filter((x) => x >= 0 && x < m.duration)
    const rows = Math.ceil(times.length / cols)
    const sheet = new OffscreenCanvas(cols * (tw + 6) + 6, rows * (th + 26) + 40)
    const sc = sheet.getContext('2d')!
    sc.fillStyle = '#1a1816'
    sc.fillRect(0, 0, sheet.width, sheet.height)
    sc.font = '600 18px ui-monospace, monospace'
    sc.fillStyle = '#f0eae3'
    sc.fillText(`${s.label} · ${s.t.toFixed(3)} s`, 8, 26)
    const flat: number[] = []
    let prev: ImageData | null = null
    let maxJump = 0
    for (const [k, t] of times.entries()) {
      const views = clipViews(m, job.takes, t)
      const sources = await Promise.all(views.map((v) => loader.load(v, 4)))
      drawFrame(ctx, m, t, views, sources, assets)
      for (const x of sources) x.image.close()
      if (flatness(canvas) < 4) flat.push(t)
      const x = 6 + (k % cols) * (tw + 6)
      const y = 40 + Math.floor(k / cols) * (th + 26)
      sc.drawImage(canvas, x, y, tw, th)
      // salto entre fotogramas seguidos (media de diferencias en pequeño): un corte brusco da un valor alto
      const small = probeCtx
      small.drawImage(canvas, 0, 0, 48, 27)
      const img = small.getImageData(0, 0, 48, 27)
      if (prev) {
        let d = 0
        for (let i = 0; i < img.data.length; i += 4) d += Math.abs(img.data[i] - prev.data[i]) + Math.abs(img.data[i + 1] - prev.data[i + 1]) + Math.abs(img.data[i + 2] - prev.data[i + 2])
        maxJump = Math.max(maxJump, d / ((img.data.length / 4) * 3))
      }
      prev = img
      sc.fillStyle = Math.abs(t - s.t) < 1 / 30 ? '#ea9a6c' : '#b7afa5'
      sc.font = '500 14px ui-monospace, monospace'
      sc.fillText(`${t.toFixed(2)}${Math.abs(t - s.t) < 1 / 30 ? ' ◀' : ''}`, x + 2, y + th + 18)
    }
    const blob = await sheet.convertToBlob({ type: 'image/png' })
    const file = await vt.write(`strips/${String(n + 1).padStart(2, '0')}-${s.t.toFixed(2)}.png`, new Uint8Array(await blob.arrayBuffer()))
    out.push({ label: s.label, t: s.t, file, flat, maxJump: +maxJump.toFixed(1) })
    vt.log({ step: 'tira', n: n + 1, de: job.strips!.length })
  }
  vt.done({ strips: out })
}

export async function run(): Promise<void> {
  const timing: Record<string, number> = {}
  const t0 = performance.now()
  const lap = (k: string, since: number) => (timing[k] = Math.round(performance.now() - since))
  try {
    const job = (await vt.job()) as ComposePayload
    if (job.strips) return strips(job, await loadIconAssets())
    const m = job.montage
    const o = job.output
    const [W, H] = o.size
    const scale = W / m.size[0]
    const fps = o.fps
    const [from, to] = o.range
    const first = Math.round(from * fps)
    const last = Math.round(to * fps)
    const duration = (last - first) / fps

    // 1) música y mezcla (la partitura es la del vídeo entero: cada parte es un tramo de la misma)
    let audio = null
    let mix = null
    // una salida de menos de 1 s (el póster) va sin sonido: la sonoridad necesita bloques de 400 ms y un AAC tan corto es solo cebado
    if (m.music && !job.silent && duration >= 1) {
      const ta = performance.now()
      const stories = pixelCues(m, job.takes)
      const sfx = stories.flatMap((c) => (ICON_ANIMS[c.story] ? storyEvents(ICON_ANIMS[c.story], c.clip, c.t) : []))
      vt.log({ step: 'sonidos', historias: stories.length, efectos: sfx.length })
      const score = await soundtrack(m, job, clickCues(m).map((c) => c.t), sfx)
      const start = Math.round(from * score.sampleRate)
      const end = start + Math.round(duration * score.sampleRate)
      const channels = score.channels.map((c) => c.slice(start, end))
      fades(channels, score.sampleRate, o.fadeIn, o.fadeOut)
      // el pico verdadero se mide DESPUÉS del AAC (el codificador sube los picos ~0,5–1 dB): se masteriza, se codifica, se
      // decodifica y, si pasa de FILE_TRUE_PEAK − margen, se repite desde la mezcla sin limitar con el techo más bajo
      let ceiling = -2
      for (let pass = 0; ; pass++) {
        const take = channels.map((c) => c.slice())
        const rep = master(take, score.sampleRate, -14, ceiling)
        audio = await encodeAac(take, score.sampleRate, o.audioBitrate, job.priming ?? AAC_PRIMING)
        const aacTruePeak = truePeak(await decodeAac(audio))
        mix = { ...rep, ceiling, aacTruePeak }
        if (aacTruePeak <= FILE_TRUE_PEAK - TP_MARGIN || pass === 4) break
        ceiling -= aacTruePeak - (FILE_TRUE_PEAK - 2 * TP_MARGIN)
      }
      vt.log({ step: 'música', ...mix })
      lap('musicMs', ta)
    }

    // 2) vídeo fotograma a fotograma
    const tv = performance.now()
    const assets: Assets = await loadIconAssets()
    const canvas = new OffscreenCanvas(W, H)
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: job.hashFrames })!
    const codec = h264Codec(W, H, fps)
    const enc = new H264Encoder({ width: W, height: H, fps, bitrate: o.bitrate, gop: 2, codec })
    const { hardware } = await enc.configure()
    const loader = new FrameLoader(scale)
    const hashes: string[] = []
    const flat: number[] = []
    const refs = new Map<number, ImageData>()
    const total = last - first
    const refAt = new Set([Math.floor(total * 0.2), Math.floor(total * 0.5), Math.floor(total * 0.8)])
    const thumbs: { t: number; bitmap: ImageBitmap }[] = []
    const sheetStep = Math.max(1, Math.round(job.sheetEvery * fps))
    let loadMs = 0
    let drawMs = 0
    for (let i = first; i < last; i++) {
      const t = i / fps
      const views = clipViews(m, job.takes, t)
      const tl = performance.now()
      const sources = await Promise.all(views.map((v) => loader.load(v, Math.max(1, Math.round(v.meta.fps / fps)))))
      loadMs += performance.now() - tl
      const td = performance.now()
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      drawFrame(ctx, m, t, views, sources, assets)
      drawMs += performance.now() - td
      for (const s of sources) s.image.close()
      if (flatness(canvas) < 4) flat.push(+t.toFixed(3))
      const n = i - first
      if (job.hashFrames || refAt.has(n)) {
        const img = ctx.getImageData(0, 0, W, H)
        if (job.hashFrames) hashes.push(await sha256(img.data))
        if (refAt.has(n)) refs.set(n, img)
      }
      if (o.stills?.some((s) => Math.round(s * fps) === i)) {
        const blob = await canvas.convertToBlob({ type: 'image/png' })
        await vt.write(`stills/${o.name}-${t.toFixed(2)}.png`, new Uint8Array(await blob.arrayBuffer()))
      }
      if (n % sheetStep === 0) thumbs.push({ t, bitmap: await createImageBitmap(canvas, { resizeWidth: 320, resizeHeight: 180, resizeQuality: 'high' }) })
      await enc.add(canvas)
      if (n % 60 === 0) vt.log({ step: 'vídeo', frame: n, of: total })
    }
    const video = await enc.finish()
    lap('videoMs', tv)
    timing.loadMs = Math.round(loadMs)
    timing.drawMs = Math.round(drawMs)

    // 3) MP4
    const tm = performance.now()
    const mp4 = muxMp4({ video, audio: audio ?? undefined })
    const path = await vt.write(`${o.name}.mp4`, mp4)
    lap('muxMs', tm)

    // 4) control de calidad sobre el archivo final
    const tq = performance.now()
    const check = await verifyVideo(mp4, refs, W, H)
    let finalAudio = null
    if (audio) {
      const ac = new OfflineAudioContext(2, Math.ceil(duration * 48000), 48000)
      const buf = await ac.decodeAudioData(mp4.slice().buffer)
      const ch = [buf.getChannelData(0), buf.getChannelData(1)]
      finalAudio = { lufs: +integratedLoudness(ch, 48000).toFixed(2), truePeak: +truePeak(ch).toFixed(2), seconds: +(buf.length / 48000).toFixed(3) }
    }
    const sheet = await contactSheet(thumbs, `${o.name}-contactos.png`)
    lap('qcMs', tq)
    timing.totalMs = Math.round(performance.now() - t0)
    vt.done({ path, sheet, bytes: mp4.length, frames: total, codec, hardware, mix, finalAudio, decodedFrames: check.decoded, psnr: check.psnr, hashes, flat, timing })
  } catch (e) {
    vt.done({ error: String((e as Error)?.stack ?? e) })
  }
}
