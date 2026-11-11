// De una grabación a trozos de audio que un servicio de transcripción acepta (pocos minutos y pocos megas cada uno), con
// el segundo en el que empieza cada uno. Nunca se carga el archivo entero: una clase grabada puede pesar gigas.
//  · MP4, M4A, MOV → trozos M4A con las mismas muestras (mp4.ts), sin recodificar.
//  · MP3 → se corta entre tramas: cada trozo es un MP3 válido.
//  · WAV → se baja a 16 kHz mono (lo que usan los modelos de voz) y se corta por tiempo.
//  · WebM, Ogg, FLAC… → tal cual si el archivo es pequeño; si no, se explica qué hacer.
import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { containerOf, mediaMime, type MediaContainer } from './formats'
import { MediaFormatError, readAudioTrack, sliceToM4A, sliceTrack } from './mp4'

export interface AudioPart {
  index: number
  /** Segundo de la grabación en el que empieza este trozo. */
  start: number
  /** Segundo en el que termina, si se sabe (un archivo subido entero no lo dice hasta transcribirlo). */
  end?: number
  /** Nombre con la extensión que el servicio espera. */
  filename: string
  mime: string
  /** Los bytes del trozo (se piden cuando toca subirlo, no antes). */
  load(): Uint8Array
}

export interface AudioPlan {
  container: MediaContainer
  /** Duración total en segundos, si el contenedor la dice. */
  duration?: number
  parts: AudioPart[]
}

export interface PartLimits {
  /** Segundos por trozo como mucho. */
  maxSeconds: number
  /** Bytes por trozo como mucho (los servicios suelen admitir 25 MB). */
  maxBytes: number
}

export const DEFAULT_LIMITS: PartLimits = { maxSeconds: 600, maxBytes: 20 * 1024 * 1024 }

/** Formatos que se suben enteros si caben (el servicio los descodifica). */
const DIRECT: ReadonlySet<MediaContainer> = new Set(['webm', 'ogg', 'flac', 'aac', 'other'])
const DIRECT_EXTENSIONS: ReadonlySet<string> = new Set(['webm', 'weba', 'ogg', 'oga', 'opus', 'flac', 'mpga', 'mpeg'])

export class MediaTooLargeError extends Error {
  constructor(readonly container: MediaContainer, readonly megabytes: number) {
    super(`Recording too large to send whole: ${megabytes} MB (${container})`)
    this.name = 'MediaTooLargeError'
  }
}

/** Planifica los trozos de una grabación. Lanza `MediaFormatError` o `MediaTooLargeError` con el motivo. */
export function planAudio(path: string, head: Uint8Array, limits: PartLimits = DEFAULT_LIMITS): AudioPlan {
  const ext = extname(path).slice(1).toLowerCase()
  const container = containerOf(head, ext)
  switch (container) {
    case 'mp4': {
      const track = readAudioTrack(path)
      const parts = sliceTrack(track, limits.maxSeconds, limits.maxBytes).map((s, index): AudioPart => ({
        index, start: s.start, end: s.end, filename: `parte-${index + 1}.m4a`, mime: 'audio/mp4', load: () => sliceToM4A(path, track, s)
      }))
      return { container, duration: track.duration, parts }
    }
    case 'mp3': return planMP3(path, limits)
    case 'wav': return planWAV(path, limits)
    default: {
      const size = statSync(path).size
      if (!DIRECT.has(container) || !DIRECT_EXTENSIONS.has(ext) || size > limits.maxBytes) throw new MediaTooLargeError(container, Math.round(size / (1024 * 1024)))
      return { container, parts: [{ index: 0, start: 0, filename: `grabacion.${ext}`, mime: mediaMime(ext), load: () => readWhole(path) }] }
    }
  }
}

function readWhole(path: string): Uint8Array {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const out = new Uint8Array(size)
    let got = 0
    while (got < size) { const n = readSync(fd, out, got, size - got, got); if (n <= 0) break; got += n }
    return out.subarray(0, got)
  } finally {
    closeSync(fd)
  }
}

// MARK: MP3

const MP3_BITRATES: Record<string, number[]> = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
}
const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

/** Cabecera de una trama MP3: cuánto ocupa y cuánto dura; null si esos 4 bytes no son una cabecera. */
export function mp3Frame(b: Uint8Array, o: number): { bytes: number; seconds: number } | null {
  if (o + 4 > b.length || b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return null
  const version = (b[o + 1] >> 3) & 3 // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const layer = 4 - ((b[o + 1] >> 1) & 3) // 1, 2 o 3
  const bitrateIndex = b[o + 2] >> 4
  const rateIndex = (b[o + 2] >> 2) & 3
  if (version === 1 || layer === 4 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null
  const rate = MP3_RATES[version][rateIndex]
  const kbps = MP3_BITRATES[`${version === 3 ? 1 : 2}-${layer}`][bitrateIndex]
  const padding = (b[o + 2] >> 1) & 1
  const samples = layer === 1 ? 384 : layer === 2 ? 1152 : version === 3 ? 1152 : 576
  const bytes = layer === 1 ? (Math.floor((12 * kbps * 1000) / rate) + padding) * 4 : Math.floor(((samples / 8) * kbps * 1000) / rate) + padding
  return bytes < 4 ? null : { bytes, seconds: samples / rate }
}

/** Recorre las tramas del MP3 (sin cargarlo entero) y corta entre tramas. */
function planMP3(path: string, limits: PartLimits): AudioPlan {
  const fd = openSync(path, 'r')
  const cuts: Array<{ offset: number; start: number }> = []
  let fileSize = 0
  let clock = 0
  try {
    fileSize = fstatSync(fd).size
    const BLOCK = 1024 * 1024
    const buf = new Uint8Array(BLOCK + 8)
    let pos = 0
    // etiqueta ID3v2 del principio: su tamaño va en 4 bytes de 7 bits
    const head = new Uint8Array(10)
    if (readSync(fd, head, 0, 10, 0) === 10 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
      pos = 10 + ((head[6] & 0x7f) << 21 | (head[7] & 0x7f) << 14 | (head[8] & 0x7f) << 7 | (head[9] & 0x7f))
    }
    let partStart = pos
    let partClock = 0
    let synced = false
    cuts.push({ offset: pos, start: 0 })
    while (pos < fileSize) {
      const n = readSync(fd, buf, 0, Math.min(buf.length, fileSize - pos), pos)
      if (n < 4) break
      let o = 0
      while (o + 4 <= n) {
        const f = mp3Frame(buf, o)
        // una cabecera solo cuenta si detrás viene otra (o el final): un 0xFF suelto dentro del audio no es una trama
        if (!f) { o++; synced = false; continue }
        if (o + f.bytes + 4 > n && pos + o + f.bytes < fileSize) break
        if (!synced && o + f.bytes + 4 <= n && !mp3Frame(buf, o + f.bytes)) { o++; continue }
        synced = true
        const at = pos + o
        if (at > partStart && (clock + f.seconds - partClock > limits.maxSeconds || at + f.bytes - partStart > limits.maxBytes)) {
          cuts.push({ offset: at, start: clock })
          partStart = at
          partClock = clock
        }
        clock += f.seconds
        o += f.bytes
      }
      if (o === 0) break
      pos += o
    }
  } finally {
    closeSync(fd)
  }
  if (clock === 0) throw new MediaFormatError('corrupt', 'No se encontró audio MP3 en el archivo.')
  const parts = cuts.map((c, index): AudioPart => {
    const until = index + 1 < cuts.length ? cuts[index + 1].offset : fileSize
    return {
      index, start: c.start, end: index + 1 < cuts.length ? cuts[index + 1].start : clock, filename: `parte-${index + 1}.mp3`, mime: 'audio/mpeg',
      load: () => readRange(path, c.offset, until - c.offset)
    }
  })
  return { container: 'mp3', duration: clock, parts }
}

function readRange(path: string, offset: number, length: number): Uint8Array {
  const fd = openSync(path, 'r')
  try {
    const out = new Uint8Array(length)
    let got = 0
    while (got < length) { const n = readSync(fd, out, got, length - got, offset + got); if (n <= 0) break; got += n }
    return out.subarray(0, got)
  } finally {
    closeSync(fd)
  }
}

// MARK: WAV

/** Frecuencia a la que trabajan los modelos de voz: más no mejora la transcripción y ocupa el triple. */
export const SPEECH_RATE = 16_000

interface WavFormat { format: number; channels: number; rate: number; bits: number; blockAlign: number; dataOffset: number; dataBytes: number }

function wavFormat(fd: number, fileSize: number): WavFormat {
  const head = new Uint8Array(12)
  readSync(fd, head, 0, 12, 0)
  let pos = 12
  let fmt: Omit<WavFormat, 'dataOffset' | 'dataBytes'> | undefined
  const le16 = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8)
  const le32 = (b: Uint8Array, o: number): number => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
  while (pos + 8 <= fileSize) {
    const ch = new Uint8Array(8)
    if (readSync(fd, ch, 0, 8, pos) < 8) break
    const id = String.fromCharCode(ch[0], ch[1], ch[2], ch[3])
    const size = le32(ch, 4)
    if (id === 'fmt ') {
      const f = new Uint8Array(Math.min(size, 40))
      readSync(fd, f, 0, f.length, pos + 8)
      let format = le16(f, 0)
      // WAVE_FORMAT_EXTENSIBLE: el formato de verdad va en el subformato
      if (format === 0xfffe && f.length >= 26) format = le16(f, 24)
      fmt = { format, channels: le16(f, 2), rate: le32(f, 4), blockAlign: le16(f, 12), bits: le16(f, 14) }
    } else if (id === 'data') {
      if (!fmt) break
      // una grabación cortada deja el tamaño a cero o mayor que el archivo: vale lo que haya
      const dataBytes = size === 0 || pos + 8 + size > fileSize ? fileSize - pos - 8 : size
      return { ...fmt, dataOffset: pos + 8, dataBytes }
    }
    pos += 8 + size + (size % 2)
  }
  throw new MediaFormatError('corrupt', 'El WAV no tiene cabecera de formato o no tiene audio.')
}

/** Cabecera WAV de PCM de 16 bits mono. */
export function wavHeader(samples: number, rate = SPEECH_RATE): Uint8Array {
  const data = samples * 2
  const h = new DataView(new ArrayBuffer(44))
  const put = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) h.setUint8(o + i, s.charCodeAt(i)) }
  put(0, 'RIFF'); h.setUint32(4, 36 + data, true); put(8, 'WAVE'); put(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true)
  h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); put(36, 'data'); h.setUint32(40, data, true)
  return new Uint8Array(h.buffer)
}

function planWAV(path: string, limits: PartLimits): AudioPlan {
  const fd = openSync(path, 'r')
  let f: WavFormat
  try { f = wavFormat(fd, fstatSync(fd).size) } finally { closeSync(fd) }
  const bytesPerSample = f.bits / 8
  const pcm = f.format === 1 && [8, 16, 24, 32].includes(f.bits)
  const float = f.format === 3 && (f.bits === 32 || f.bits === 64)
  if ((!pcm && !float) || !f.channels || !f.rate || f.blockAlign !== f.channels * bytesPerSample) {
    throw new MediaFormatError('unsupportedCodec', 'El WAV usa una compresión que Aula no sabe leer (solo PCM).')
  }
  const frames = Math.floor(f.dataBytes / f.blockAlign)
  const duration = frames / f.rate
  // por tiempo, y sin pasar de los bytes que caben a 16 kHz y 16 bits
  const seconds = Math.max(1, Math.min(limits.maxSeconds, Math.floor(limits.maxBytes / (SPEECH_RATE * 2))))
  const count = Math.max(1, Math.ceil(duration / seconds))
  const parts = Array.from({ length: count }, (_, index): AudioPart => {
    const start = index * seconds
    const end = Math.min(duration, start + seconds)
    return { index, start, end, filename: `parte-${index + 1}.wav`, mime: 'audio/wav', load: () => wavSpeech(path, f, start, end) }
  })
  return { container: 'wav', duration, parts }
}

/** Un tramo del WAV como voz: mono, 16 kHz, 16 bits (media de los canales y de las muestras que caen en cada muestra nueva). */
function wavSpeech(path: string, f: WavFormat, start: number, end: number): Uint8Array {
  const firstFrame = Math.floor(start * f.rate)
  const frames = Math.max(0, Math.floor(end * f.rate) - firstFrame)
  const raw = readRange(path, f.dataOffset + firstFrame * f.blockAlign, frames * f.blockAlign)
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const got = Math.floor(raw.length / f.blockAlign)
  const bytesPerSample = f.bits / 8
  const sample = (frame: number, channel: number): number => {
    const o = frame * f.blockAlign + channel * bytesPerSample
    if (f.format === 3) return f.bits === 32 ? view.getFloat32(o, true) : view.getFloat64(o, true)
    switch (f.bits) {
      case 8: return (view.getUint8(o) - 128) / 128
      case 16: return view.getInt16(o, true) / 32768
      case 24: return ((view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getInt8(o + 2) << 16))) / 8388608
      default: return view.getInt32(o, true) / 2147483648
    }
  }
  const out = Math.max(1, Math.floor((got * SPEECH_RATE) / f.rate))
  const wav = new Uint8Array(44 + out * 2)
  wav.set(wavHeader(out), 0)
  const dv = new DataView(wav.buffer)
  const ratio = f.rate / SPEECH_RATE
  for (let i = 0; i < out; i++) {
    const a = Math.floor(i * ratio)
    const b = Math.max(a + 1, Math.min(got, Math.floor((i + 1) * ratio)))
    let sum = 0
    for (let k = a; k < b; k++) for (let c = 0; c < f.channels; c++) sum += sample(k, c)
    const v = Math.max(-1, Math.min(1, sum / ((b - a) * f.channels)))
    dv.setInt16(44 + i * 2, Math.round(v * 32767), true)
  }
  return wav
}
