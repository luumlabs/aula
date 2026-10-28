// Formato y tamaño de una imagen leyendo solo su cabecera (sin decodificarla): PNG, JPEG, GIF, BMP, WebP, TIFF, HEIC/AVIF.

export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'bmp' | 'webp' | 'tiff' | 'heif' | 'avif'

export interface ImageInfo {
  format: ImageFormat
  /** 0 si la cabecera no lo dice (HEIC/AVIF) o está dañada. */
  width: number
  height: number
  /** Páginas de un TIFF (1 en los demás formatos). */
  frames: number
  /** Orientación EXIF (1…8) de un JPEG, si la trae. */
  orientation?: number
}

const be16 = (d: Uint8Array, o: number): number => (o + 2 <= d.length ? (d[o] << 8) | d[o + 1] : 0)
const be32 = (d: Uint8Array, o: number): number => (o + 4 <= d.length ? ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0 : 0)
const le16 = (d: Uint8Array, o: number): number => (o + 2 <= d.length ? d[o] | (d[o + 1] << 8) : 0)
const le32 = (d: Uint8Array, o: number): number => (o + 4 <= d.length ? (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0 : 0)

function ascii(d: Uint8Array, o: number, n: number): string {
  let s = ''
  for (let i = o; i < o + n && i < d.length; i++) s += String.fromCharCode(d[i])
  return s
}

export function imageInfo(d: Uint8Array): ImageInfo | null {
  if (d.length < 8) return null
  if (d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) {
    return { format: 'png', width: be32(d, 16), height: be32(d, 20), frames: 1 }
  }
  if (d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff) return jpegInfo(d)
  const head = ascii(d, 0, 6)
  if (head === 'GIF87a' || head === 'GIF89a') return { format: 'gif', width: le16(d, 6), height: le16(d, 8), frames: 1 }
  if (d[0] === 0x42 && d[1] === 0x4d && d.length >= 26) return { format: 'bmp', width: Math.abs(le32(d, 18) | 0), height: Math.abs(le32(d, 22) | 0), frames: 1 }
  if (ascii(d, 0, 4) === 'RIFF' && ascii(d, 8, 4) === 'WEBP') return webpInfo(d)
  if ((d[0] === 0x49 && d[1] === 0x49 && d[2] === 0x2a && d[3] === 0) || (d[0] === 0x4d && d[1] === 0x4d && d[2] === 0 && d[3] === 0x2a)) return tiffInfo(d)
  if (ascii(d, 4, 4) === 'ftyp') {
    const brand = ascii(d, 8, 4)
    if (['avif', 'avis'].includes(brand)) return { format: 'avif', width: 0, height: 0, frames: 1 }
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return { format: 'heif', width: 0, height: 0, frames: 1 }
  }
  return null
}

function jpegInfo(d: Uint8Array): ImageInfo {
  let o = 2
  let orientation: number | undefined
  while (o + 4 <= d.length) {
    if (d[o] !== 0xff) { o++; continue }
    const marker = d[o + 1]
    if (marker === 0xff) { o++; continue }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue }
    const len = be16(d, o + 2)
    if (len < 2) break
    if (marker === 0xe1 && ascii(d, o + 4, 4) === 'Exif') orientation = exifOrientation(d, o + 10, len - 8) ?? orientation
    // SOF0…SOF15 salvo DHT (C4), JPG (C8) y DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { format: 'jpeg', height: be16(d, o + 5), width: be16(d, o + 7), frames: 1, orientation }
    }
    if (marker === 0xda) break
    o += 2 + len
  }
  return { format: 'jpeg', width: 0, height: 0, frames: 1, orientation }
}

function exifOrientation(d: Uint8Array, start: number, length: number): number | undefined {
  const end = Math.min(d.length, start + length)
  if (start + 8 > end) return undefined
  const little = d[start] === 0x49
  const r16 = (o: number): number => (little ? le16(d, o) : be16(d, o))
  const r32 = (o: number): number => (little ? le32(d, o) : be32(d, o))
  const ifd = start + r32(start + 4)
  if (ifd + 2 > end) return undefined
  const count = Math.min(r16(ifd), 500)
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12
    if (e + 12 > end) break
    if (r16(e) === 0x0112) {
      const v = r16(e + 8)
      return v >= 1 && v <= 8 ? v : undefined
    }
  }
  return undefined
}

function webpInfo(d: Uint8Array): ImageInfo {
  const chunk = ascii(d, 12, 4)
  if (chunk === 'VP8X') return { format: 'webp', width: 1 + (d[24] | (d[25] << 8) | (d[26] << 16)), height: 1 + (d[27] | (d[28] << 8) | (d[29] << 16)), frames: 1 }
  if (chunk === 'VP8L' && d.length >= 25) {
    const b = le32(d, 21)
    return { format: 'webp', width: 1 + (b & 0x3fff), height: 1 + ((b >>> 14) & 0x3fff), frames: 1 }
  }
  if (chunk === 'VP8 ' && d.length >= 30) return { format: 'webp', width: le16(d, 26) & 0x3fff, height: le16(d, 28) & 0x3fff, frames: 1 }
  return { format: 'webp', width: 0, height: 0, frames: 1 }
}

function tiffInfo(d: Uint8Array): ImageInfo {
  const little = d[0] === 0x49
  const r16 = (o: number): number => (little ? le16(d, o) : be16(d, o))
  const r32 = (o: number): number => (little ? le32(d, o) : be32(d, o))
  let ifd = r32(4)
  let width = 0, height = 0, frames = 0
  const visited = new Set<number>()
  while (ifd > 0 && ifd + 2 <= d.length && !visited.has(ifd) && frames < 10_000) {
    visited.add(ifd)
    frames++
    const count = Math.min(r16(ifd), 1000)
    if (frames === 1) {
      for (let i = 0; i < count; i++) {
        const e = ifd + 2 + i * 12
        if (e + 12 > d.length) break
        const tag = r16(e), type = r16(e + 2)
        const value = type === 3 ? r16(e + 8) : r32(e + 8)
        if (tag === 256) width = value
        if (tag === 257) height = value
      }
    }
    ifd = r32(ifd + 2 + count * 12)
  }
  return { format: 'tiff', width, height, frames: Math.max(1, frames) }
}
