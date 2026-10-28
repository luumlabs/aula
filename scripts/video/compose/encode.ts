// Codificación con WebCodecs dentro de Electron: H.264 High (VideoToolbox en macOS) y AAC-LC. Devuelve pistas listas
// para el muxer propio (mp4/muxer.ts).
import type { AudioTrack, VideoSample, VideoTrack } from '../mp4/muxer.ts'

function bytesOf(src: AllowSharedBufferSource): Uint8Array {
  return src instanceof ArrayBuffer || src instanceof SharedArrayBuffer ? new Uint8Array(src).slice() : new Uint8Array(src.buffer, src.byteOffset, src.byteLength).slice()
}

export interface VideoOptions {
  width: number
  height: number
  fps: number
  bitrate: number
  /** Segundos entre fotogramas clave. */
  gop: number
  /** 'avc1.64002A' = High, nivel 4.2 (1080p60). */
  codec: string
}

/** Nivel H.264 mínimo para un tamaño y fps (macrobloques por fotograma y por segundo). */
export function h264Codec(width: number, height: number, fps: number): string {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16)
  const rate = mbs * fps
  const levels: [number, number, number][] = [
    [0x28, 8192, 245760],
    [0x2a, 8704, 522240],
    [0x32, 22080, 589824],
    [0x33, 36864, 983040],
    [0x34, 36864, 2073600]
  ]
  const level = levels.find(([, f, r]) => mbs <= f && rate <= r)
  if (!level) throw new Error(`H.264 no admite ${width}×${height}@${fps}`)
  return 'avc1.6400' + level[0].toString(16).toUpperCase().padStart(2, '0')
}

export class H264Encoder {
  private encoder: VideoEncoder
  private samples: VideoSample[] = []
  private avcC: Uint8Array | null = null
  private failure: Error | null = null
  private lastTs = -1
  private count = 0

  private readonly o: VideoOptions

  constructor(o: VideoOptions) {
    this.o = o
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        const desc = meta?.decoderConfig?.description
        if (desc && !this.avcC) this.avcC = bytesOf(desc)
        if (chunk.timestamp <= this.lastTs) this.failure = new Error('el codificador reordena fotogramas (B-frames): hace falta ctts')
        this.lastTs = chunk.timestamp
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        this.samples.push({ data, duration: 1000, key: chunk.type === 'key' })
      },
      error: (e) => (this.failure = e instanceof Error ? e : new Error(String(e)))
    })
  }

  async configure(): Promise<{ hardware: boolean }> {
    const config: VideoEncoderConfig = {
      codec: this.o.codec,
      width: this.o.width,
      height: this.o.height,
      bitrate: this.o.bitrate,
      bitrateMode: 'variable',
      framerate: this.o.fps,
      latencyMode: 'quality',
      hardwareAcceleration: 'prefer-hardware',
      avc: { format: 'avc' }
    }
    const hw = await VideoEncoder.isConfigSupported(config)
    if (!hw.supported) {
      config.hardwareAcceleration = 'no-preference'
      if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error('VideoEncoder no admite ' + this.o.codec)
    }
    this.encoder.configure(config)
    return { hardware: !!hw.supported }
  }

  /** Codifica un fotograma (lienzo) con su índice. */
  async add(source: CanvasImageSource): Promise<void> {
    if (this.failure) throw this.failure
    while (this.encoder.encodeQueueSize > 6) await new Promise((r) => this.encoder.addEventListener('dequeue', r, { once: true }))
    const i = this.count++
    const frame = new VideoFrame(source, { timestamp: Math.round((i * 1e6) / this.o.fps), duration: Math.round(1e6 / this.o.fps) })
    this.encoder.encode(frame, { keyFrame: i % Math.round(this.o.gop * this.o.fps) === 0 })
    frame.close()
  }

  async finish(): Promise<VideoTrack> {
    await this.encoder.flush()
    this.encoder.close()
    if (this.failure) throw this.failure
    if (!this.avcC) throw new Error('el codificador no dio avcC')
    return { width: this.o.width, height: this.o.height, timescale: this.o.fps * 1000, avcC: this.avcC, samples: this.samples }
  }
}

/** Codifica audio estéreo (canales planos Float32) en AAC-LC. */
export async function encodeAac(channels: Float32Array[], sampleRate: number, bitrate: number, priming: number): Promise<AudioTrack> {
  const samples: { data: Uint8Array; duration: number }[] = []
  let asc: Uint8Array | null = null
  let failure: unknown = null
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      const desc = meta?.decoderConfig?.description
      if (desc && !asc) asc = bytesOf(desc)
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      samples.push({ data, duration: 1024 })
    },
    error: (e) => (failure = e)
  })
  const config: AudioEncoderConfig = { codec: 'mp4a.40.2', sampleRate, numberOfChannels: channels.length, bitrate }
  if (!(await AudioEncoder.isConfigSupported(config)).supported) throw new Error('AudioEncoder no admite AAC aquí')
  enc.configure(config)
  const total = channels[0].length
  const block = 4096
  for (let p = 0; p < total; p += block) {
    const n = Math.min(block, total - p)
    const planar = new Float32Array(n * channels.length)
    channels.forEach((c, k) => planar.set(c.subarray(p, p + n), k * n))
    const data = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: channels.length, timestamp: Math.round((p * 1e6) / sampleRate), data: planar })
    enc.encode(data)
    data.close()
  }
  await enc.flush()
  enc.close()
  if (failure) throw failure
  if (!asc) {
    // AAC-LC, 48 kHz (índice 3), estéreo: 0x11 0x90
    const srIndex = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000].indexOf(sampleRate)
    asc = new Uint8Array([(2 << 3) | (srIndex >> 1), ((srIndex & 1) << 7) | (channels.length << 3)])
  }
  return { sampleRate, channels: channels.length, asc, samples, priming, presentation: total, bitrate }
}

/** Decodifica una pista AAC de encodeAac (para medir el pico verdadero de lo que de verdad irá en el archivo). */
export async function decodeAac(track: AudioTrack): Promise<Float32Array[]> {
  const parts: Float32Array[][] = []
  let failure: unknown = null
  const dec = new AudioDecoder({
    output: (d) => {
      const n = d.numberOfFrames
      const ch: Float32Array[] = []
      for (let k = 0; k < d.numberOfChannels; k++) {
        const a = new Float32Array(n)
        d.copyTo(a, { planeIndex: k, format: 'f32-planar' })
        ch.push(a)
      }
      parts.push(ch)
      d.close()
    },
    error: (e) => (failure = e)
  })
  dec.configure({ codec: 'mp4a.40.2', sampleRate: track.sampleRate, numberOfChannels: track.channels, description: track.asc })
  let ts = 0
  for (const smp of track.samples) {
    dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round((ts * 1e6) / track.sampleRate), data: smp.data }))
    ts += smp.duration
  }
  await dec.flush()
  dec.close()
  if (failure) throw failure
  const len = parts.reduce((s, p) => s + p[0].length, 0)
  return Array.from({ length: track.channels }, (_, k) => {
    const out = new Float32Array(len)
    let o = 0
    for (const p of parts) { out.set(p[k], o); o += p[k].length }
    return out
  })
}
