// Pista de audio de un MP4 / M4A / MOV, sin descodificar nada: se leen las tablas de muestras del contenedor y el audio
// se vuelve a empaquetar en archivos M4A pequeños (trozos de unos minutos) que un servicio de transcripción acepta tal cual.
// No se carga el archivo en memoria (una clase grabada puede pesar gigas): solo la caja `moov` y, trozo a trozo, sus bytes.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'

export class MediaFormatError extends Error {
  constructor(readonly code: 'noAudio' | 'unsupportedCodec' | 'corrupt' | 'fragmented', message: string) {
    super(message)
    this.name = 'MediaFormatError'
  }
}

interface Box { type: string; start: number; payload: number; end: number }

/** Lo que hace falta de la pista de audio para trocearla. */
export interface AudioTrack {
  /** Unidades de tiempo por segundo de la pista. */
  timescale: number
  /** Duración en segundos. */
  duration: number
  /** Códec de la entrada de muestra (`mp4a`, `alac`…). */
  codec: string
  /** La caja `stsd` original, tal cual (lleva la configuración del descodificador). */
  stsd: Uint8Array
  /** Por muestra: dónde está, cuánto ocupa y cuánto dura (en unidades de `timescale`). */
  offsets: Float64Array
  sizes: Uint32Array
  deltas: Uint32Array
  /** La caja `ftyp` del archivo (o una de M4A si no la trae). */
  ftyp: Uint8Array
}

/** Un trozo: de qué muestra a qué muestra, y en qué segundos cae. */
export interface TrackSlice { first: number; count: number; start: number; end: number; bytes: number }

const MAX_MOOV_BYTES = 512 * 1024 * 1024
const u32 = (b: Uint8Array, o: number): number => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
const u64 = (b: Uint8Array, o: number): number => u32(b, o) * 2 ** 32 + u32(b, o + 4)
const fourcc = (b: Uint8Array, o: number): string => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])

function readAt(fd: number, position: number, length: number): Uint8Array {
  const out = new Uint8Array(length)
  let got = 0
  while (got < length) {
    const n = readSync(fd, out, got, length - got, position + got)
    if (n <= 0) break
    got += n
  }
  if (got < length) throw new MediaFormatError('corrupt', 'El archivo termina antes de lo que dicen sus tablas.')
  return out
}

/** Cajas de primer nivel (solo sus cabeceras: no se lee `mdat`). */
function topLevelBoxes(fd: number, fileSize: number): Box[] {
  const out: Box[] = []
  let pos = 0
  while (pos + 8 <= fileSize && out.length < 4096) {
    const head = readAt(fd, pos, Math.min(16, fileSize - pos))
    let size = u32(head, 0)
    let header = 8
    if (size === 1) {
      if (head.length < 16) break
      size = u64(head, 8)
      header = 16
    } else if (size === 0) size = fileSize - pos
    if (size < header || pos + size > fileSize) {
      // una caja que dice ocupar más que el archivo: se acepta solo si es la última (grabación cortada), sin pasar del final
      if (pos + header <= fileSize) out.push({ type: fourcc(head, 4), start: pos, payload: pos + header, end: fileSize })
      break
    }
    out.push({ type: fourcc(head, 4), start: pos, payload: pos + header, end: pos + size })
    pos += size
  }
  return out
}

/** Cajas hijas dentro de un trozo de memoria. */
function children(b: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = []
  let pos = from
  while (pos + 8 <= to) {
    let size = u32(b, pos)
    let header = 8
    if (size === 1) { size = u64(b, pos + 8); header = 16 } else if (size === 0) size = to - pos
    if (size < header || pos + size > to) break
    out.push({ type: fourcc(b, pos + 4), start: pos, payload: pos + header, end: pos + size })
    pos += size
  }
  return out
}
const child = (b: Uint8Array, parent: Box, type: string): Box | undefined => children(b, parent.payload, parent.end).find((x) => x.type === type)

/** Lee la pista de audio de un MP4, M4A o MOV. Lanza `MediaFormatError` con un motivo claro si no puede. */
export function readAudioTrack(path: string): AudioTrack {
  const fd = openSync(path, 'r')
  try {
    const fileSize = fstatSync(fd).size
    const top = topLevelBoxes(fd, fileSize)
    const moovBox = top.find((b) => b.type === 'moov')
    if (!moovBox) throw new MediaFormatError('corrupt', 'El archivo no trae su índice (caja «moov»): la grabación quedó incompleta.')
    if (moovBox.end - moovBox.start > MAX_MOOV_BYTES) throw new MediaFormatError('corrupt', 'El índice del archivo es demasiado grande.')
    const moov = readAt(fd, moovBox.start, moovBox.end - moovBox.start)
    const root: Box = { type: 'moov', start: 0, payload: moovBox.payload - moovBox.start, end: moov.length }
    const ftypBox = top.find((b) => b.type === 'ftyp')
    const ftyp = ftypBox && ftypBox.end - ftypBox.start <= 1024 ? readAt(fd, ftypBox.start, ftypBox.end - ftypBox.start) : DEFAULT_FTYP

    let sawAudio = false
    for (const trak of children(moov, root.payload, root.end).filter((b) => b.type === 'trak')) {
      const mdia = child(moov, trak, 'mdia')
      const hdlr = mdia && child(moov, mdia, 'hdlr')
      if (!mdia || !hdlr || fourcc(moov, hdlr.payload + 8) !== 'soun') continue
      sawAudio = true
      const mdhd = child(moov, mdia, 'mdhd')
      const minf = child(moov, mdia, 'minf')
      const stbl = minf && child(moov, minf, 'stbl')
      const stsd = stbl && child(moov, stbl, 'stsd')
      if (!mdhd || !stbl || !stsd) continue
      const v1 = moov[mdhd.payload] === 1
      const timescale = u32(moov, mdhd.payload + (v1 ? 20 : 12))
      if (!timescale) continue
      const codec = stsd.end - stsd.payload >= 16 ? fourcc(moov, stsd.payload + 12) : ''
      const table = sampleTable(moov, stbl)
      if (!table.sizes.length) {
        // sin muestras en el índice: es un MP4 fragmentado (las muestras van en cajas `moof` repartidas por el archivo)
        const fragments = fragmentSamples(fd, top, moov, root, trak)
        if (!fragments.sizes.length) continue
        return finish({ timescale, codec, stsd: moov.slice(stsd.start, stsd.end), ftyp, ...fragments })
      }
      return finish({ timescale, codec, stsd: moov.slice(stsd.start, stsd.end), ftyp, ...table })
    }
    throw new MediaFormatError('noAudio', sawAudio ? 'La pista de audio está vacía.' : 'El archivo no tiene pista de audio.')
  } finally {
    closeSync(fd)
  }
}

const DEFAULT_FTYP = box('ftyp', bytes('M4A '), be32(0), bytes('M4A mp42isom'))
/** Códecs que los servicios de transcripción leen dentro de un M4A. */
const UPLOADABLE = new Set(['mp4a', 'alac', '.mp3', 'Opus', 'opus', 'fLaC'])

function finish(t: Omit<AudioTrack, 'duration'>): AudioTrack {
  if (!UPLOADABLE.has(t.codec)) throw new MediaFormatError('unsupportedCodec', `El audio usa un códec que Aula aún no sabe trocear (${t.codec.trim() || 'desconocido'}).`)
  let total = 0
  for (let i = 0; i < t.deltas.length; i++) total += t.deltas[i]
  return { ...t, duration: total / t.timescale }
}

/** Tablas `stts`, `stsc`, `stsz`/`stz2` y `stco`/`co64` → una fila por muestra. */
function sampleTable(moov: Uint8Array, stbl: Box): Pick<AudioTrack, 'offsets' | 'sizes' | 'deltas'> {
  const stsz = child(moov, stbl, 'stsz')
  const stz2 = child(moov, stbl, 'stz2')
  let count = 0
  let sizeAt: (i: number) => number = () => 0
  if (stsz) {
    const fixed = u32(moov, stsz.payload + 4)
    count = u32(moov, stsz.payload + 8)
    const base = stsz.payload + 12
    if (!fixed && base + count * 4 > stsz.end) throw new MediaFormatError('corrupt', 'La tabla de tamaños está cortada.')
    sizeAt = fixed ? () => fixed : (i) => u32(moov, base + i * 4)
  } else if (stz2) {
    const field = moov[stz2.payload + 7]
    count = u32(moov, stz2.payload + 8)
    const base = stz2.payload + 12
    sizeAt = field === 16 ? (i) => (moov[base + i * 2] << 8) | moov[base + i * 2 + 1] : field === 8 ? (i) => moov[base + i] : (i) => (i % 2 === 0 ? moov[base + (i >> 1)] >> 4 : moov[base + (i >> 1)] & 0x0f)
  }
  if (!count || count > 50_000_000) return { offsets: new Float64Array(0), sizes: new Uint32Array(0), deltas: new Uint32Array(0) }

  const sizes = new Uint32Array(count)
  for (let i = 0; i < count; i++) sizes[i] = sizeAt(i)

  const deltas = new Uint32Array(count)
  const stts = child(moov, stbl, 'stts')
  if (stts) {
    const entries = u32(moov, stts.payload + 4)
    let i = 0
    for (let e = 0; e < entries && i < count; e++) {
      const n = u32(moov, stts.payload + 8 + e * 8)
      const d = u32(moov, stts.payload + 12 + e * 8)
      for (let k = 0; k < n && i < count; k++) deltas[i++] = d
    }
  }

  const stco = child(moov, stbl, 'stco')
  const co64 = child(moov, stbl, 'co64')
  const chunkBox = stco ?? co64
  const stsc = child(moov, stbl, 'stsc')
  if (!chunkBox || !stsc) throw new MediaFormatError('corrupt', 'Faltan las tablas que dicen dónde está el audio.')
  const chunks = u32(moov, chunkBox.payload + 4)
  const chunkOffset = stco ? (c: number) => u32(moov, chunkBox.payload + 8 + c * 4) : (c: number) => u64(moov, chunkBox.payload + 8 + c * 8)
  const runs = u32(moov, stsc.payload + 4)
  const offsets = new Float64Array(count)
  let sample = 0
  for (let r = 0; r < runs && sample < count; r++) {
    const firstChunk = u32(moov, stsc.payload + 8 + r * 12) - 1
    const perChunk = u32(moov, stsc.payload + 12 + r * 12)
    const nextFirst = r + 1 < runs ? u32(moov, stsc.payload + 8 + (r + 1) * 12) - 1 : chunks
    for (let c = firstChunk; c < nextFirst && c < chunks && sample < count; c++) {
      let pos = chunkOffset(c)
      for (let k = 0; k < perChunk && sample < count; k++) {
        offsets[sample] = pos
        pos += sizes[sample]
        sample++
      }
    }
  }
  if (sample < count) throw new MediaFormatError('corrupt', 'Las tablas del audio no cuadran entre sí.')
  return { offsets, sizes, deltas }
}

/** MP4 fragmentado (grabaciones del navegador, algunas descargas): las muestras de la pista en cada `moof`. */
function fragmentSamples(fd: number, top: Box[], moov: Uint8Array, root: Box, trak: Box): Pick<AudioTrack, 'offsets' | 'sizes' | 'deltas'> {
  const tkhd = child(moov, trak, 'tkhd')
  if (!tkhd) return { offsets: new Float64Array(0), sizes: new Uint32Array(0), deltas: new Uint32Array(0) }
  const trackID = u32(moov, tkhd.payload + (moov[tkhd.payload] === 1 ? 20 : 12))
  // valores por defecto de la pista (mvex → trex)
  let defDuration = 0
  let defSize = 0
  const mvex = child(moov, root, 'mvex')
  if (mvex) for (const trex of children(moov, mvex.payload, mvex.end)) {
    if (trex.type === 'trex' && u32(moov, trex.payload + 4) === trackID) { defDuration = u32(moov, trex.payload + 12); defSize = u32(moov, trex.payload + 16) }
  }
  const offsets: number[] = []
  const sizes: number[] = []
  const deltas: number[] = []
  for (const moofBox of top) {
    if (moofBox.type !== 'moof') continue
    if (moofBox.end - moofBox.start > 64 * 1024 * 1024) throw new MediaFormatError('corrupt', 'Un fragmento del archivo es demasiado grande.')
    const moof = readAt(fd, moofBox.start, moofBox.end - moofBox.start)
    const header = moofBox.payload - moofBox.start
    for (const traf of children(moof, header, moof.length)) {
      if (traf.type !== 'traf') continue
      const tfhd = child(moof, traf, 'tfhd')
      if (!tfhd || u32(moof, tfhd.payload + 4) !== trackID) continue
      const flags = u32(moof, tfhd.payload) & 0xffffff
      let p = tfhd.payload + 8
      let base = moofBox.start
      if (flags & 0x1) { base = u64(moof, p); p += 8 }
      if (flags & 0x2) p += 4
      let duration = defDuration
      let size = defSize
      if (flags & 0x8) { duration = u32(moof, p); p += 4 }
      if (flags & 0x10) { size = u32(moof, p); p += 4 }
      let next: number | undefined
      for (const trun of children(moof, traf.payload, traf.end)) {
        if (trun.type !== 'trun') continue
        const tf = u32(moof, trun.payload) & 0xffffff
        const n = u32(moof, trun.payload + 4)
        let q = trun.payload + 8
        let pos = next ?? base
        if (tf & 0x1) { pos = base + (u32(moof, q) | 0); q += 4 }
        if (tf & 0x4) q += 4
        for (let i = 0; i < n; i++) {
          let d = duration
          let s = size
          if (tf & 0x100) { d = u32(moof, q); q += 4 }
          if (tf & 0x200) { s = u32(moof, q); q += 4 }
          if (tf & 0x400) q += 4
          if (tf & 0x800) q += 4
          offsets.push(pos)
          sizes.push(s)
          deltas.push(d)
          pos += s
        }
        next = pos
      }
    }
  }
  return { offsets: Float64Array.from(offsets), sizes: Uint32Array.from(sizes), deltas: Uint32Array.from(deltas) }
}

/** Parte la pista en trozos que no pasan de `maxSeconds` ni de `maxBytes`. */
export function sliceTrack(track: AudioTrack, maxSeconds: number, maxBytes: number): TrackSlice[] {
  const out: TrackSlice[] = []
  const limit = maxSeconds * track.timescale
  let first = 0
  let ticks = 0
  let bytes = 0
  let startTicks = 0
  let clock = 0
  for (let i = 0; i < track.sizes.length; i++) {
    if (i > first && (ticks + track.deltas[i] > limit || bytes + track.sizes[i] > maxBytes)) {
      out.push({ first, count: i - first, start: startTicks / track.timescale, end: clock / track.timescale, bytes })
      first = i
      startTicks = clock
      ticks = 0
      bytes = 0
    }
    ticks += track.deltas[i]
    bytes += track.sizes[i]
    clock += track.deltas[i]
  }
  if (track.sizes.length > first) out.push({ first, count: track.sizes.length - first, start: startTicks / track.timescale, end: clock / track.timescale, bytes })
  return out
}

/** Un M4A con solo las muestras de ese trozo (mismo códec y configuración: no se pierde calidad ni se recodifica). */
export function sliceToM4A(path: string, track: AudioTrack, slice: TrackSlice): Uint8Array {
  const end = slice.first + slice.count
  let ticks = 0
  // stts: duraciones seguidas iguales, agrupadas
  const stts: number[] = []
  for (let i = slice.first; i < end; ) {
    let n = 1
    while (i + n < end && track.deltas[i + n] === track.deltas[i]) n++
    stts.push(n, track.deltas[i])
    ticks += n * track.deltas[i]
    i += n
  }
  const sizes = new Uint8Array(slice.count * 4)
  for (let i = 0; i < slice.count; i++) sizes.set(be32(track.sizes[slice.first + i]), i * 4)

  const movieTimescale = 1000
  const movieDuration = Math.round((ticks / track.timescale) * movieTimescale)
  const identity = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].flatMap((n) => [...be32(n)])
  const build = (chunkOffset: number): Uint8Array => box('moov',
    box('mvhd', be32(0), be32(0), be32(0), be32(movieTimescale), be32(movieDuration), be32(0x00010000), be16(0x0100), new Uint8Array(10), Uint8Array.from(identity), new Uint8Array(24), be32(2)),
    box('trak',
      box('tkhd', be32(0x00000003), be32(0), be32(0), be32(1), be32(0), be32(movieDuration), new Uint8Array(8), be16(0), be16(0), be16(0x0100), be16(0), Uint8Array.from(identity), be32(0), be32(0)),
      box('mdia',
        box('mdhd', be32(0), be32(0), be32(0), be32(track.timescale), be32(ticks), be16(0x55c4), be16(0)),
        box('hdlr', be32(0), be32(0), bytes('soun'), new Uint8Array(12), bytes('SoundHandler\0')),
        box('minf',
          box('smhd', be32(0), be32(0)),
          box('dinf', box('dref', be32(0), be32(1), box('url ', be32(1)))),
          box('stbl',
            track.stsd,
            box('stts', be32(0), be32(stts.length / 2), Uint8Array.from(stts.flatMap((n) => [...be32(n)]))),
            box('stsc', be32(0), be32(1), be32(1), be32(slice.count), be32(1)),
            box('stsz', be32(0), be32(0), be32(slice.count), sizes),
            box('stco', be32(0), be32(1), be32(chunkOffset)))))))
  // el audio va detrás del índice: su posición depende de lo que ocupe el propio índice
  const moov = build(track.ftyp.length + build(0).length + 8)

  const out = new Uint8Array(track.ftyp.length + moov.length + 8 + slice.bytes)
  out.set(track.ftyp, 0)
  out.set(moov, track.ftyp.length)
  let pos = track.ftyp.length + moov.length
  out.set(be32(8 + slice.bytes), pos)
  out.set(bytes('mdat'), pos + 4)
  pos += 8
  const fd = openSync(path, 'r')
  try {
    // las muestras seguidas en el archivo se leen de una vez
    for (let i = slice.first; i < end; ) {
      let run = track.sizes[i]
      let n = 1
      while (i + n < end && track.offsets[i + n] === track.offsets[i] + run && run < 8 * 1024 * 1024) { run += track.sizes[i + n]; n++ }
      const got = readSync(fd, out, pos, run, track.offsets[i])
      if (got < run) throw new MediaFormatError('corrupt', 'El archivo termina antes de lo que dicen sus tablas.')
      pos += run
      i += n
    }
  } finally {
    closeSync(fd)
  }
  return out
}

function bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}
function be32(n: number): Uint8Array { return Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff) }
function be16(n: number): Uint8Array { return Uint8Array.of((n >>> 8) & 0xff, n & 0xff) }
function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(size)
  out.set(be32(size), 0)
  out.set(bytes(type), 4)
  let pos = 8
  for (const p of parts) { out.set(p, pos); pos += p.length }
  return out
}
