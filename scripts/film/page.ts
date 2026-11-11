// La página que pinta el corto: fotogramas → H.264, partitura → AAC, y el MP4.
import { vt } from '../video/compose/bridge.ts'
import { encodeAac, H264Encoder, h264Codec } from '../video/compose/encode.ts'
import { muxMp4 } from '../video/mp4/muxer.ts'
import { FPS, H, W } from './engine/core.ts'
import { finishKit, sheet } from './engine/paint.ts'
import { DURATION, drawFilm, initFilm, look } from './film.ts'
import { renderScore } from './score.ts'

interface Job { name: string; stills: number[] | null; range: [number, number] | null; fps: number | null; silent: boolean; bitrate: number; grain: number }

const png = async (c: OffscreenCanvas): Promise<Uint8Array> => new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())

export async function run(): Promise<void> {
  try {
    const job = (await vt.job()) as Job
    finishKit()
    look.grain = job.grain
    await initFilm()
    const { canvas, ctx } = sheet(W, H)
    if (job.stills) {
      for (const t of job.stills) {
        drawFilm(ctx, t, Math.round(t * FPS))
        await vt.write(`stills/${job.name}-${t.toFixed(2)}.png`, await png(canvas))
        vt.log({ still: t })
      }
      vt.done({ stills: job.stills.length })
      return
    }
    const fps = job.fps ?? FPS
    const from = job.range ? job.range[0] : 0
    const to = job.range ? Math.min(DURATION, job.range[1]) : DURATION
    const first = Math.round(from * fps)
    const last = Math.round(to * fps)
    let audio
    if (!job.silent) {
      const score = await renderScore(DURATION)
      const a = Math.round(from * score.sampleRate)
      const b = Math.round(to * score.sampleRate)
      audio = await encodeAac(score.channels.map((c) => c.slice(a, b)), score.sampleRate, 192_000, 2112)
      vt.log({ step: 'música', lufs: score.lufs, peak: score.peak })
    }
    const enc = new H264Encoder({ width: W, height: H, fps, bitrate: job.bitrate, gop: 2, codec: h264Codec(W, H, fps) })
    await enc.configure()
    const thumbs: { t: number; bitmap: ImageBitmap }[] = []
    const every = Math.max(1, Math.round(fps * (to - from > 30 ? 1.5 : 0.5)))
    const t0 = performance.now()
    for (let i = first; i < last; i++) {
      const t = i / fps
      // el dibujo «hierve» a 24 fps aunque el borrador vaya a menos
      drawFilm(ctx, t, Math.round(t * FPS))
      if ((i - first) % every === 0) thumbs.push({ t, bitmap: await createImageBitmap(canvas, { resizeWidth: 384, resizeHeight: 216, resizeQuality: 'high' }) })
      await enc.add(canvas)
      if ((i - first) % 48 === 0) vt.log({ step: 'vídeo', frame: i - first, of: last - first, s: +((performance.now() - t0) / 1000).toFixed(1) })
    }
    const video = await enc.finish()
    const mp4 = muxMp4({ video, audio })
    const path = await vt.write(`${job.name}.mp4`, mp4)
    // hoja de contactos
    const cols = 6
    const rows = Math.ceil(thumbs.length / cols)
    const sh = sheet(cols * 392 + 8, rows * 246 + 8)
    sh.ctx.fillStyle = '#111'
    sh.ctx.fillRect(0, 0, sh.canvas.width, sh.canvas.height)
    sh.ctx.fillStyle = '#ddd'
    sh.ctx.font = '16px ui-monospace, Menlo, monospace'
    thumbs.forEach((th, k) => {
      const x = 8 + (k % cols) * 392
      const y = 8 + Math.floor(k / cols) * 246
      sh.ctx.drawImage(th.bitmap, x, y)
      sh.ctx.fillText(`${th.t.toFixed(1)} s`, x + 2, y + 234)
    })
    await vt.write(`${job.name}-contactos.png`, await png(sh.canvas))
    vt.done({ path, seconds: +(to - from).toFixed(2), frames: last - first, mb: +(mp4.length / 1048576).toFixed(1), renderS: +((performance.now() - t0) / 1000).toFixed(1) })
  } catch (e) {
    vt.done({ error: String((e as Error).stack ?? e) })
  }
}
