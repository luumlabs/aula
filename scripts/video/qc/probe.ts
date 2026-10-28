// Sonda de códecs (página del compositor): codifica 3 s sintéticos, mide el cebado real del AAC (posición de un clic tras
// decodificar) y escribe un MP4 de prueba. Uso: node scripts/video/render.ts --probe
import { encodeAac, H264Encoder, h264Codec } from '../compose/encode.ts'
import { muxMp4 } from '../mp4/muxer.ts'
import { vt } from '../compose/bridge.ts'

const SR = 48000

async function decodeAac(track: Awaited<ReturnType<typeof encodeAac>>): Promise<Float32Array> {
  const parts: Float32Array[] = []
  const dec = new AudioDecoder({
    output: (d) => {
      const buf = new Float32Array(d.numberOfFrames)
      d.copyTo(buf, { planeIndex: 0, format: 'f32-planar' })
      parts.push(buf)
      d.close()
    },
    error: (e) => vt.log({ error: String(e) })
  })
  dec.configure({ codec: 'mp4a.40.2', sampleRate: track.sampleRate, numberOfChannels: track.channels, description: track.asc })
  let ts = 0
  for (const s of track.samples) {
    dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round((ts * 1e6) / SR), data: s.data }))
    ts += s.duration
  }
  await dec.flush()
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let p = 0
  for (const part of parts) {
    out.set(part, p)
    p += part.length
  }
  return out
}

function peakIndex(x: Float32Array): number {
  let best = 0
  for (let i = 1; i < x.length; i++) if (Math.abs(x[i]) > Math.abs(x[best])) best = i
  return best
}

export async function run(): Promise<void> {
  try {
    const W = 1920
    const H = 1080
    const fps = 60
    const canvas = new OffscreenCanvas(W, H)
    const ctx = canvas.getContext('2d')!
    const codec = h264Codec(W, H, fps)
    const enc = new H264Encoder({ width: W, height: H, fps, bitrate: 12e6, gop: 2, codec })
    const { hardware } = await enc.configure()
    const t0 = performance.now()
    for (let i = 0; i < fps * 3; i++) {
      ctx.fillStyle = '#f3f0e9'
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#b4502f'
      ctx.fillRect(200 + i * 8, 400, 200, 200)
      ctx.fillStyle = '#201e1a'
      ctx.font = '500 96px ui-serif, "New York", Georgia, serif'
      ctx.fillText('Aula · ' + i, 200, 300)
      await enc.add(canvas)
    }
    const video = await enc.finish()
    const encodeMs = performance.now() - t0
    // audio: tono suave + un clic en 0,5 s para medir el cebado
    const n = SR * 3
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) L[i] = R[i] = 0.05 * Math.sin((2 * Math.PI * 220 * i) / SR)
    for (let k = 0; k < 8; k++) L[SR / 2 + k] = R[SR / 2 + k] = 0.9 * (k % 2 ? -1 : 1)
    const audio0 = await encodeAac([L, R], SR, 192000, 0)
    const decoded = await decodeAac(audio0)
    const delay = peakIndex(decoded) - SR / 2
    const audio = { ...audio0, priming: Math.max(0, delay) }
    const mp4 = muxMp4({ video, audio })
    const path = await vt.write('probe.mp4', mp4)
    // el MP4 entero por decodeAudioData (Chromium/FFmpeg): ¿respeta la lista de edición?
    const ac = new OfflineAudioContext(2, n, SR)
    const buf = await ac.decodeAudioData(mp4.slice().buffer)
    const chromeDelay = peakIndex(buf.getChannelData(0)) - SR / 2
    vt.done({ path, codec, hardware, encodeMs: Math.round(encodeMs), fpsEncode: +((fps * 3) / (encodeMs / 1000)).toFixed(1), keyframes: video.samples.filter((s) => s.key).length, aacDelay: delay, aacPackets: audio.samples.length, chromeDecodeDelay: chromeDelay, bytes: mp4.length })
  } catch (e) {
    vt.done({ error: String((e as Error)?.stack ?? e) })
  }
}
