// Muxer MP4 propio (sin dependencias): H.264 (avcC) + AAC (AudioSpecificConfig) en un MP4 no fragmentado con «faststart»
// (la caja moov va delante de mdat, para que el iPad, Safari y GitHub empiecen a reproducir sin descargar el archivo entero).
// Muestras intercaladas en trozos de ~0,5 s. Fechas a cero: dos renders iguales dan bytes iguales.
import { ByteWriter, LANG_UND, writeMatrix } from './boxes.ts'

export interface VideoSample {
  data: Uint8Array
  /** Duración en unidades de `timescale`. */
  duration: number
  key: boolean
}
export interface AudioSample {
  data: Uint8Array
  /** Duración en muestras de audio (1024 en AAC-LC). */
  duration: number
}
export interface VideoTrack {
  width: number
  height: number
  timescale: number
  /** AVCDecoderConfigurationRecord (decoderConfig.description de WebCodecs). */
  avcC: Uint8Array
  samples: VideoSample[]
}
export interface AudioTrack {
  sampleRate: number
  channels: number
  /** AudioSpecificConfig (decoderConfig.description de WebCodecs). */
  asc: Uint8Array
  samples: AudioSample[]
  /** Muestras de cebado del codificador que la lista de edición salta (retardo del AAC). */
  priming: number
  /** Muestras que se presentan tras el cebado (la duración real del audio). */
  presentation: number
  bitrate: number
}
export interface MuxInput {
  video: VideoTrack
  audio?: AudioTrack
}

const MOVIE_TIMESCALE = 1000
const CHUNK_SECONDS = 0.5

interface Chunk {
  track: 0 | 1
  start: number // segundos
  samples: Uint8Array[]
  offset: number
}

function chunkTrack(track: 0 | 1, samples: { data: Uint8Array; duration: number }[], timescale: number): Chunk[] {
  const chunks: Chunk[] = []
  let t = 0
  let cur: Chunk | null = null
  for (const s of samples) {
    const sec = t / timescale
    if (!cur || sec - cur.start >= CHUNK_SECONDS) {
      cur = { track, start: sec, samples: [], offset: 0 }
      chunks.push(cur)
    }
    cur.samples.push(s.data)
    t += s.duration
  }
  return chunks
}

/** Entradas de stts (duraciones con compresión por rachas). */
function runs(values: number[]): [number, number][] {
  const out: [number, number][] = []
  for (const v of values) {
    const last = out[out.length - 1]
    if (last && last[1] === v) last[0]++
    else out.push([1, v])
  }
  return out
}

function writeStbl(w: ByteWriter, entry: (w: ByteWriter) => void, durations: number[], sizes: number[], chunks: Chunk[], keys: boolean[] | null, co64: boolean, roll: boolean): void {
  w.box('stbl', (w) => {
    w.full('stsd', 0, 0, (w) => {
      w.u32(1)
      entry(w)
    })
    const stts = runs(durations)
    w.full('stts', 0, 0, (w) => {
      w.u32(stts.length)
      for (const [count, delta] of stts) w.u32(count).u32(delta)
    })
    if (keys && keys.some((k) => !k)) {
      const sync = keys.flatMap((k, i) => (k ? [i + 1] : []))
      w.full('stss', 0, 0, (w) => {
        w.u32(sync.length)
        for (const n of sync) w.u32(n)
      })
    }
    // stsc: rachas de trozos con el mismo número de muestras
    const stsc: [number, number][] = []
    chunks.forEach((c, i) => {
      if (!stsc.length || stsc[stsc.length - 1][1] !== c.samples.length) stsc.push([i + 1, c.samples.length])
    })
    w.full('stsc', 0, 0, (w) => {
      w.u32(stsc.length)
      for (const [first, n] of stsc) w.u32(first).u32(n).u32(1)
    })
    w.full('stsz', 0, 0, (w) => {
      w.u32(0).u32(sizes.length)
      for (const s of sizes) w.u32(s)
    })
    w.full(co64 ? 'co64' : 'stco', 0, 0, (w) => {
      w.u32(chunks.length)
      for (const c of chunks) co64 ? w.u64(c.offset) : w.u32(c.offset)
    })
    if (roll) {
      // AAC: cada muestra necesita la anterior para decodificarse bien (roll = −1), como escribe AVFoundation
      w.full('sgpd', 1, 0, (w) => {
        w.ascii('roll').u32(2).u32(1).u16(0xffff)
      })
      w.full('sbgp', 0, 0, (w) => {
        w.ascii('roll').u32(1).u32(sizes.length).u32(1)
      })
    }
  })
}

function writeDinf(w: ByteWriter): void {
  w.box('dinf', (w) => w.full('dref', 0, 0, (w) => w.u32(1).full('url ', 0, 1, () => {})))
}

function writeTkhd(w: ByteWriter, id: number, duration: number, audio: boolean, width = 0, height = 0): void {
  w.full('tkhd', 0, 3, (w) => {
    w.u32(0).u32(0).u32(id).u32(0).u32(duration).zeros(8)
    w.u16(0).u16(0).u16(audio ? 0x0100 : 0).u16(0)
    writeMatrix(w)
    w.u32(width * 65536).u32(height * 65536)
  })
}

function writeMdhd(w: ByteWriter, timescale: number, duration: number): void {
  w.full('mdhd', 0, 0, (w) => w.u32(0).u32(0).u32(timescale).u32(duration).u16(LANG_UND).u16(0))
}

function writeHdlr(w: ByteWriter, type: string, name: string): void {
  w.full('hdlr', 0, 0, (w) => w.u32(0).ascii(type).zeros(12).ascii(name).u8(0))
}

function descriptor(tag: number, body: Uint8Array): Uint8Array {
  if (body.length > 127) throw new Error('descriptor demasiado largo')
  const out = new Uint8Array(2 + body.length)
  out[0] = tag
  out[1] = body.length
  out.set(body, 2)
  return out
}

function esds(a: AudioTrack): Uint8Array {
  const dsi = descriptor(0x05, a.asc)
  const dcd = new ByteWriter().u8(0x40).u8(0x15).u24(0).u32(a.bitrate).u32(a.bitrate).bytes(dsi).result()
  const sl = descriptor(0x06, new Uint8Array([0x02]))
  const es = new ByteWriter().u16(2).u8(0).bytes(descriptor(0x04, dcd)).bytes(sl).result()
  return descriptor(0x03, es)
}

function writeMoov(w: ByteWriter, input: MuxInput, vChunks: Chunk[], aChunks: Chunk[], co64: boolean): void {
  const { video, audio } = input
  const vDur = video.samples.reduce((s, x) => s + x.duration, 0)
  const vMovie = Math.round((vDur / video.timescale) * MOVIE_TIMESCALE)
  const aMovie = audio ? Math.round((audio.presentation / audio.sampleRate) * MOVIE_TIMESCALE) : 0
  w.box('moov', (w) => {
    w.full('mvhd', 0, 0, (w) => {
      w.u32(0).u32(0).u32(MOVIE_TIMESCALE).u32(Math.max(vMovie, aMovie)).u32(0x00010000).u16(0x0100).u16(0).u32(0).u32(0)
      writeMatrix(w)
      w.zeros(24).u32(audio ? 3 : 2)
    })
    w.box('trak', (w) => {
      writeTkhd(w, 1, vMovie, false, video.width, video.height)
      w.box('mdia', (w) => {
        writeMdhd(w, video.timescale, vDur)
        writeHdlr(w, 'vide', 'Aula video')
        w.box('minf', (w) => {
          w.full('vmhd', 0, 1, (w) => w.u16(0).u16(0).u16(0).u16(0))
          writeDinf(w)
          writeStbl(
            w,
            (w) =>
              w.box('avc1', (w) => {
                w.zeros(6).u16(1).u16(0).u16(0).zeros(12).u16(video.width).u16(video.height)
                w.u32(0x00480000).u32(0x00480000).u32(0).u16(1)
                const name = 'Aula'
                w.u8(name.length).ascii(name).zeros(31 - name.length)
                w.u16(0x0018).u16(0xffff)
                w.box('avcC', (w) => w.bytes(video.avcC))
                // BT.709, rango limitado: el color del papel igual en el iPad, Safari y QuickTime
                w.box('colr', (w) => w.ascii('nclx').u16(1).u16(1).u16(1).u8(0))
                w.box('pasp', (w) => w.u32(1).u32(1))
              }),
            video.samples.map((s) => s.duration),
            video.samples.map((s) => s.data.length),
            vChunks,
            video.samples.map((s) => s.key),
            co64,
            false
          )
        })
      })
    })
    if (!audio) return
    const aDur = audio.samples.reduce((s, x) => s + x.duration, 0)
    w.box('trak', (w) => {
      writeTkhd(w, 2, aMovie, true)
      // lista de edición: salta el cebado del AAC y recorta el relleno final (audio y vídeo alineados al milisegundo)
      w.box('edts', (w) => w.full('elst', 0, 0, (w) => w.u32(1).u32(aMovie).u32(audio.priming).u16(1).u16(0)))
      w.box('mdia', (w) => {
        writeMdhd(w, audio.sampleRate, aDur)
        writeHdlr(w, 'soun', 'Aula audio')
        w.box('minf', (w) => {
          w.full('smhd', 0, 0, (w) => w.u16(0).u16(0))
          writeDinf(w)
          writeStbl(
            w,
            (w) =>
              w.box('mp4a', (w) => {
                w.zeros(6).u16(1).zeros(8).u16(audio.channels).u16(16).u16(0).u16(0).u32(audio.sampleRate * 65536)
                w.full('esds', 0, 0, (w) => w.bytes(esds(audio)))
              }),
            audio.samples.map((s) => s.duration),
            audio.samples.map((s) => s.data.length),
            aChunks,
            null,
            co64,
            true
          )
        })
      })
    })
  })
}

/** Devuelve el archivo MP4 completo (ftyp · moov · mdat). */
export function muxMp4(input: MuxInput): Uint8Array {
  const vChunks = chunkTrack(0, input.video.samples, input.video.timescale)
  const aChunks = input.audio ? chunkTrack(1, input.audio.samples, input.audio.sampleRate) : []
  const order = [...vChunks, ...aChunks].sort((a, b) => a.start - b.start || a.track - b.track)
  const payload = order.reduce((s, c) => s + c.samples.reduce((t, x) => t + x.length, 0), 0)
  const co64 = payload > 0xfff00000
  const largeMdat = payload + 8 > 0xffffffff

  const ftyp = new ByteWriter().box('ftyp', (w) => w.ascii('isom').u32(512).ascii('isom').ascii('iso2').ascii('avc1').ascii('mp41')).result()
  // primera pasada para medir la moov (su tamaño no depende de los valores de los desplazamientos)
  const probe = new ByteWriter()
  writeMoov(probe, input, vChunks, aChunks, co64)
  const mdatHeader = largeMdat ? 16 : 8
  let offset = ftyp.length + probe.pos + mdatHeader
  for (const c of order) {
    c.offset = offset
    offset += c.samples.reduce((t, x) => t + x.length, 0)
  }
  const moov = new ByteWriter()
  writeMoov(moov, input, vChunks, aChunks, co64)

  const out = new Uint8Array(offset)
  out.set(ftyp, 0)
  out.set(moov.result(), ftyp.length)
  const head = new DataView(out.buffer, ftyp.length + moov.pos, mdatHeader)
  if (largeMdat) {
    head.setUint32(0, 1)
    head.setUint32(4, 0x6d646174)
    head.setUint32(8, Math.floor((payload + 16) / 2 ** 32))
    head.setUint32(12, (payload + 16) % 2 ** 32)
  } else {
    head.setUint32(0, payload + 8)
    head.setUint32(4, 0x6d646174)
  }
  for (const c of order) {
    let p = c.offset
    for (const s of c.samples) {
      out.set(s, p)
      p += s.length
    }
  }
  return out
}
