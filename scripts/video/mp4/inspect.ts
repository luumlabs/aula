// Lector MP4 para el control de calidad: orden de cajas (faststart), códecs, perfil/nivel H.264, duración, fps, audio y
// las tablas de muestras (para decodificar el archivo final y medirlo). Isomorfo: sirve en Node y en la página.

export interface Box {
  type: string
  start: number
  size: number
  header: number
  children?: Box[]
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf'])

export function readBoxes(data: Uint8Array, start = 0, end = data.length): Box[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const out: Box[] = []
  let p = start
  while (p + 8 <= end) {
    let size = view.getUint32(p)
    const type = String.fromCharCode(data[p + 4], data[p + 5], data[p + 6], data[p + 7])
    let header = 8
    if (size === 1) {
      size = view.getUint32(p + 8) * 2 ** 32 + view.getUint32(p + 12)
      header = 16
    } else if (size === 0) size = end - p
    if (size < header || p + size > end) throw new Error(`caja ${type} mal formada en ${p}`)
    const box: Box = { type, start: p, size, header }
    if (CONTAINERS.has(type)) box.children = readBoxes(data, p + header, p + size)
    out.push(box)
    p += size
  }
  return out
}

function find(boxes: Box[] | undefined, path: string[]): Box | undefined {
  let cur = boxes
  let found: Box | undefined
  for (const t of path) {
    found = cur?.find((b) => b.type === t)
    if (!found) return undefined
    cur = found.children
  }
  return found
}

export interface TrackInfo {
  handler: string
  codec: string
  timescale: number
  duration: number
  sampleSizes: number[]
  sampleDurations: number[]
  chunkOffsets: number[]
  samplesPerChunk: number[]
  syncSamples: number[] | null
  /** Datos de configuración del decodificador (avcC o AudioSpecificConfig). */
  config: Uint8Array
  width?: number
  height?: number
  profile?: number
  level?: number
  channels?: number
  sampleRate?: number
  aacObjectType?: number
  editMediaTime?: number
  editDuration?: number
  colr?: string
}

export interface Mp4Info {
  topLevel: string[]
  brand: string
  faststart: boolean
  movieDuration: number
  tracks: TrackInfo[]
}

function u32(d: DataView, p: number): number {
  return d.getUint32(p)
}

function parseTrack(data: Uint8Array, trak: Box): TrackInfo {
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const mdhd = find(trak.children, ['mdia', 'mdhd'])!
  const v = data[mdhd.start + 8]
  const base = mdhd.start + 12
  const timescale = u32(d, base + (v === 1 ? 16 : 8))
  const duration = v === 1 ? u32(d, base + 20) * 2 ** 32 + u32(d, base + 24) : u32(d, base + 12)
  const hdlr = find(trak.children, ['mdia', 'hdlr'])!
  const handler = String.fromCharCode(...data.subarray(hdlr.start + 16, hdlr.start + 20))
  const stbl = find(trak.children, ['mdia', 'minf', 'stbl'])!
  const get = (t: string) => stbl.children!.find((b) => b.type === t)
  const stsd = get('stsd')!
  const entry = stsd.start + 16
  const codec = String.fromCharCode(...data.subarray(entry + 4, entry + 8))
  const info: TrackInfo = { handler, codec, timescale, duration, sampleSizes: [], sampleDurations: [], chunkOffsets: [], samplesPerChunk: [], syncSamples: null, config: new Uint8Array() }
  const entrySize = u32(d, entry)
  if (codec === 'avc1') {
    info.width = d.getUint16(entry + 32)
    info.height = d.getUint16(entry + 34)
    for (const b of readBoxes(data, entry + 86, entry + entrySize)) {
      if (b.type === 'avcC') {
        info.config = data.slice(b.start + 8, b.start + b.size)
        info.profile = info.config[1]
        info.level = info.config[3]
      }
      if (b.type === 'colr') info.colr = `${String.fromCharCode(...data.subarray(b.start + 8, b.start + 12))} ${d.getUint16(b.start + 12)}/${d.getUint16(b.start + 14)}/${d.getUint16(b.start + 16)}`
    }
  } else if (codec === 'mp4a') {
    info.channels = d.getUint16(entry + 24)
    info.sampleRate = d.getUint16(entry + 32)
    for (const b of readBoxes(data, entry + 36, entry + entrySize)) {
      if (b.type !== 'esds') continue
      // busca el DecoderSpecificInfo (etiqueta 5) dentro del descriptor
      const body = data.subarray(b.start + 12, b.start + b.size)
      for (let i = 0; i < body.length - 2; i++) {
        if (body[i] === 0x05) {
          let len = 0
          let j = i + 1
          for (let k = 0; k < 4; k++) {
            const byte = body[j++]
            len = (len << 7) | (byte & 0x7f)
            if (!(byte & 0x80)) break
          }
          info.config = body.slice(j, j + len)
          info.aacObjectType = info.config[0] >> 3
          break
        }
      }
    }
  }
  const stts = get('stts')!
  for (let i = 0, n = u32(d, stts.start + 12); i < n; i++) {
    const count = u32(d, stts.start + 16 + i * 8)
    const delta = u32(d, stts.start + 20 + i * 8)
    for (let k = 0; k < count; k++) info.sampleDurations.push(delta)
  }
  const stsz = get('stsz')!
  const fixed = u32(d, stsz.start + 12)
  for (let i = 0, n = u32(d, stsz.start + 16); i < n; i++) info.sampleSizes.push(fixed || u32(d, stsz.start + 20 + i * 4))
  const stco = get('stco') ?? get('co64')!
  for (let i = 0, n = u32(d, stco.start + 12); i < n; i++)
    info.chunkOffsets.push(stco.type === 'co64' ? u32(d, stco.start + 16 + i * 8) * 2 ** 32 + u32(d, stco.start + 20 + i * 8) : u32(d, stco.start + 16 + i * 4))
  const stsc = get('stsc')!
  const entries: [number, number][] = []
  for (let i = 0, n = u32(d, stsc.start + 12); i < n; i++) entries.push([u32(d, stsc.start + 16 + i * 12), u32(d, stsc.start + 20 + i * 12)])
  for (let c = 1; c <= info.chunkOffsets.length; c++) {
    let per = 0
    for (const [first, n] of entries) if (first <= c) per = n
    info.samplesPerChunk.push(per)
  }
  const stss = get('stss')
  if (stss) {
    info.syncSamples = []
    for (let i = 0, n = u32(d, stss.start + 12); i < n; i++) info.syncSamples.push(u32(d, stss.start + 16 + i * 4))
  }
  const elst = find(trak.children, ['edts', 'elst'])
  if (elst) {
    info.editDuration = u32(d, elst.start + 16)
    info.editMediaTime = d.getInt32(elst.start + 20)
  }
  return info
}

export function inspectMp4(data: Uint8Array): Mp4Info {
  const boxes = readBoxes(data)
  const topLevel = boxes.map((b) => b.type)
  const ftyp = boxes.find((b) => b.type === 'ftyp')
  const brand = ftyp ? String.fromCharCode(...data.subarray(ftyp.start + 8, ftyp.start + 12)) : ''
  const moov = boxes.find((b) => b.type === 'moov')
  if (!moov) throw new Error('sin caja moov')
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const mvhd = moov.children!.find((b) => b.type === 'mvhd')!
  const movieDuration = u32(d, mvhd.start + 24) / u32(d, mvhd.start + 20)
  const tracks = moov.children!.filter((b) => b.type === 'trak').map((t) => parseTrack(data, t))
  return { topLevel, brand, faststart: topLevel.indexOf('moov') < topLevel.indexOf('mdat'), movieDuration, tracks }
}

/** Datos de cada muestra de una pista, en orden. */
export function trackSamples(data: Uint8Array, track: TrackInfo): Uint8Array[] {
  const out: Uint8Array[] = []
  let i = 0
  track.chunkOffsets.forEach((offset, c) => {
    let p = offset
    for (let k = 0; k < track.samplesPerChunk[c]; k++) {
      const size = track.sampleSizes[i++]
      out.push(data.subarray(p, p + size))
      p += size
    }
  })
  return out
}

/** «avc1.64002A» a partir del avcC. */
export function avcCodecString(avcC: Uint8Array): string {
  return 'avc1.' + [avcC[1], avcC[2], avcC[3]].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('')
}

export const H264_PROFILES: Record<number, string> = { 66: 'Baseline', 77: 'Main', 88: 'Extended', 100: 'High', 110: 'High 10', 122: 'High 4:2:2', 244: 'High 4:4:4' }
