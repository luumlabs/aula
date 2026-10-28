// Lector ZIP mínimo y defensivo (solo lectura, en memoria; nunca escribe en disco, así que no hay «zip slip»).
//
// Frente a bombas zip y archivos hostiles:
// - solo se confía en el directorio central; cada lectura se comprueba contra los límites del archivo;
// - máximo de entradas y de bytes descomprimidos totales (suma de los tamaños declarados);
// - el inflado se corta si produce más bytes de los declarados;
// - presupuesto de lectura: entre todas las lecturas no se descomprime más del doble del límite total;
// - no se descomprime nada que no se pida expresamente.
import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs'
import * as zlib from 'node:zlib'
import { archiveLimit, corrupt, passwordProtected, unreadable, unsupportedType, errorMessage } from '../errors'
import { L } from '../messages'
import { strictUTF8, utf8 } from './textDecoding'

export interface ZipLimits {
  maxEntries: number
  maxTotalUncompressed: number
  maxEntryUncompressed: number
}

export function zipLimits(maxEntries = 5_000, maxTotalUncompressed = 200 * 1024 * 1024): ZipLimits {
  return { maxEntries, maxTotalUncompressed, maxEntryUncompressed: maxTotalUncompressed }
}

export interface ZipEntry {
  name: string
  method: number
  flags: number
  crc32: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
  isDirectory: boolean
}

/** Bytes que aún se pueden descomprimir entre todas las lecturas (compartido entre copias del lector). */
class ReadBudget {
  constructor(private remaining: number) {}
  consume(bytes: number): boolean {
    if (bytes > this.remaining) return false
    this.remaining -= bytes
    return true
  }
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c
  }
  return t
})()

const nativeCrc = (zlib as unknown as { crc32?: (data: Uint8Array) => number }).crc32

/** CRC-32 estándar de ZIP (polinomio 0xEDB88320). */
export function crc32(data: Uint8Array): number {
  if (nativeCrc) return nativeCrc(data) >>> 0
  let c = -1
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function le16(d: Uint8Array, o: number): number | null {
  if (o < 0 || o + 2 > d.length) return null
  return d[o] | (d[o + 1] << 8)
}
function le32(d: Uint8Array, o: number): number | null {
  if (o < 0 || o + 4 > d.length) return null
  return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0
}
function le64(d: Uint8Array, o: number): number | null {
  const lo = le32(d, o), hi = le32(d, o + 4)
  if (lo === null || hi === null) return null
  return hi * 0x1_0000_0000 + lo
}

export function normalizeZipName(name: string): string {
  let s = name.replace(/\\/g, '/')
  while (s.startsWith('/')) s = s.slice(1)
  while (s.startsWith('./')) s = s.slice(2)
  return s
}

const MB = 1024 * 1024

export class ZipArchive {
  readonly entries: ZipEntry[]
  readonly limits: ZipLimits
  private readonly data: Uint8Array
  private readonly base: number
  private readonly exactIndex = new Map<string, number>()
  private readonly foldedIndex = new Map<string, number>()
  private readonly budget: ReadBudget

  static open(path: string, limits: ZipLimits = zipLimits()): ZipArchive {
    let data: Uint8Array
    try {
      data = readFileSync(path)
    } catch (e) {
      throw unreadable(errorMessage(e))
    }
    return new ZipArchive(data, limits)
  }

  constructor(data: Uint8Array, limits: ZipLimits = zipLimits()) {
    this.data = data
    this.limits = limits
    this.budget = new ReadBudget(Number.isFinite(limits.maxTotalUncompressed * 2) ? limits.maxTotalUncompressed * 2 : Number.MAX_SAFE_INTEGER)
    const n = data.length
    if (n < 22) throw corrupt(L('no es un archivo ZIP válido'))

    // 1. Registro de fin del directorio central (EOCD): se busca desde el final
    const eocd = ZipArchive.findEOCD(data)
    if (eocd === null) throw corrupt(L('no es un archivo ZIP válido (falta el directorio central)'))
    let totalEntries = le16(data, eocd + 10) ?? 0
    let cdSize = le32(data, eocd + 12) ?? 0
    let cdOffset = le32(data, eocd + 16) ?? 0
    const disk = le16(data, eocd + 4) ?? 0
    const cdDisk = le16(data, eocd + 6) ?? 0
    if ((disk !== 0 && disk !== 0xffff) || (cdDisk !== 0 && cdDisk !== 0xffff)) throw unsupportedType(L('los ZIP en varias partes no están soportados'))

    // 2. ZIP64
    let dirEnd = eocd
    if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const z64 = eocd >= 20 && le32(data, eocd - 20) === 0x07064b50 ? le64(data, eocd - 20 + 8) : null
      const sig = z64 !== null && z64 < n ? le32(data, z64) : null
      const t = z64 !== null ? le64(data, z64 + 32) : null
      const s = z64 !== null ? le64(data, z64 + 40) : null
      const o = z64 !== null ? le64(data, z64 + 48) : null
      const big = Number.MAX_SAFE_INTEGER / 2
      if (z64 === null || sig !== 0x06064b50 || t === null || s === null || o === null || t >= big || s >= big || o >= big) {
        throw corrupt(L('directorio ZIP64 dañado'))
      }
      totalEntries = t
      cdSize = s
      cdOffset = o
      dirEnd = z64
    }
    if (totalEntries > limits.maxEntries) {
      throw archiveLimit(L('tiene %lld entradas (el máximo permitido es %lld)', totalEntries, limits.maxEntries))
    }
    if (cdSize < 0 || cdOffset < 0 || cdSize > 64 * MB || cdOffset > n || cdSize > n) throw corrupt(L('directorio central fuera de rango'))
    // Posible prefijo antes del ZIP (autoextraíble)
    let base = 0
    if (le32(data, cdOffset) !== 0x02014b50 && totalEntries > 0) {
      const shifted = dirEnd - (cdOffset + cdSize)
      if (shifted > 0 && le32(data, cdOffset + shifted) === 0x02014b50) base = shifted
    }
    const cdStart = cdOffset + base
    if (cdStart + cdSize > n) throw corrupt(L('directorio central fuera de rango'))
    this.base = base

    // 3. Entradas del directorio central
    const list: ZipEntry[] = []
    let p = cdStart
    const cdEnd = cdStart + cdSize
    let totalUncompressed = 0
    for (let k = 0; k < totalEntries; k++) {
      if (p + 46 > cdEnd || le32(data, p) !== 0x02014b50) throw corrupt(L('entrada del directorio ZIP dañada'))
      const flags = le16(data, p + 8) ?? 0
      const method = le16(data, p + 10) ?? 0
      const crc = le32(data, p + 16) ?? 0
      let csize = le32(data, p + 20) ?? 0
      let usize = le32(data, p + 24) ?? 0
      const nameLen = le16(data, p + 28) ?? 0
      const extraLen = le16(data, p + 30) ?? 0
      const commentLen = le16(data, p + 32) ?? 0
      let offset = le32(data, p + 42) ?? 0
      const recordEnd = p + 46 + nameLen + extraLen + commentLen
      if (recordEnd > cdEnd) throw corrupt(L('entrada del directorio ZIP truncada'))
      // Campo extra ZIP64 (id 0x0001): solo trae los valores que en la cabecera valen 0xFFFFFFFF, en este orden
      if (usize === 0xffffffff || csize === 0xffffffff || offset === 0xffffffff) {
        let q = p + 46 + nameLen
        const extraEnd = q + extraLen
        while (q + 4 <= extraEnd) {
          const id = le16(data, q) ?? 0, size = le16(data, q + 2) ?? 0
          if (id === 0x0001) {
            let r = q + 4
            if (usize === 0xffffffff) { const v = le64(data, r); if (v !== null) { usize = v; r += 8 } }
            if (csize === 0xffffffff) { const v = le64(data, r); if (v !== null) { csize = v; r += 8 } }
            if (offset === 0xffffffff) { const v = le64(data, r); if (v !== null) { offset = v; r += 8 } }
            break
          }
          q += 4 + size
        }
      }
      const name = ZipArchive.decodeName(data.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0)
      const limitBig = Number.MAX_SAFE_INTEGER / 4
      if (usize >= limitBig || csize >= limitBig || offset >= limitBig) throw archiveLimit(L('tamaños declarados absurdos en «%@»', name))
      totalUncompressed += usize
      if (totalUncompressed > limits.maxTotalUncompressed) {
        throw archiveLimit(L('descomprimido ocuparía más de %lld MB', Math.floor(limits.maxTotalUncompressed / MB)))
      }
      list.push({ name, method, flags, crc32: crc, compressedSize: csize, uncompressedSize: usize, localHeaderOffset: offset, isDirectory: name.endsWith('/') })
      p = recordEnd
    }
    this.entries = list
    list.forEach((e, i) => {
      if (e.isDirectory) return
      if (!this.exactIndex.has(e.name)) this.exactIndex.set(e.name, i)
      const f = e.name.toLowerCase()
      if (!this.foldedIndex.has(f)) this.foldedIndex.set(f, i)
    })
  }

  // MARK: Consulta

  /** Nombres de las entradas que no son carpetas. */
  get fileNames(): string[] {
    return this.entries.filter((e) => !e.isDirectory).map((e) => e.name)
  }

  entry(name: string): ZipEntry | null {
    const clean = normalizeZipName(name)
    const i = this.exactIndex.get(clean) ?? this.foldedIndex.get(clean.toLowerCase())
    return i === undefined ? null : this.entries[i]
  }

  contains(name: string): boolean {
    return this.entry(name) !== null
  }

  /** Lee una entrada por nombre (con su CRC comprobado). `null` si no existe. */
  read(name: string, maxBytes?: number): Uint8Array | null {
    const e = this.entry(name)
    return e ? this.dataFor(e, maxBytes) : null
  }

  readText(name: string, maxBytes?: number): string | null {
    const d = this.read(name, maxBytes)
    return d ? utf8(d) : null
  }

  dataFor(entry: ZipEntry, maxBytes?: number): Uint8Array {
    const limit = Math.min(maxBytes ?? Number.MAX_SAFE_INTEGER, this.limits.maxEntryUncompressed)
    if (entry.uncompressedSize > limit) {
      throw archiveLimit(L('«%@» ocupa %lld MB descomprimido', entry.name, Math.floor(entry.uncompressedSize / MB)))
    }
    const data = this.extract(entry, null).data
    if (crc32(data) !== entry.crc32) {
      throw corrupt(L('«%@» no coincide con su suma de comprobación: el archivo está dañado o se ha modificado.', entry.name))
    }
    return data
  }

  /** Lee como mucho `maxBytes` del inicio de una entrada y descarta el resto sin error (hojas enormes). */
  readPrefix(name: string, maxBytes: number): { data: Uint8Array; truncated: boolean } | null {
    const entry = this.entry(name)
    if (!entry) return null
    const result = this.extract(entry, maxBytes)
    if (!result.truncated && result.data.length === entry.uncompressedSize && crc32(result.data) !== entry.crc32) {
      throw corrupt(L('«%@» no coincide con su suma de comprobación: el archivo está dañado o se ha modificado.', entry.name))
    }
    return result
  }

  // MARK: Descompresión

  private extract(entry: ZipEntry, prefix: number | null): { data: Uint8Array; truncated: boolean } {
    if (entry.flags & 0x1) throw passwordProtected(entry.name)
    if (!this.budget.consume(Math.min(entry.uncompressedSize, prefix ?? Number.MAX_SAFE_INTEGER))) {
      throw archiveLimit(L('se intentó descomprimir más de %lld MB en total (¿partes repetidas?)', Math.floor(this.limits.maxTotalUncompressed / MB) * 2))
    }
    const d = this.data
    const header = this.base + entry.localHeaderOffset
    if (header < 0 || header + 30 > d.length || le32(d, header) !== 0x04034b50) throw corrupt(L('cabecera local dañada en «%@»', entry.name))
    const nameLen = le16(d, header + 26) ?? 0, extraLen = le16(d, header + 28) ?? 0
    const start = header + 30 + nameLen + extraLen
    if (start < 0 || entry.compressedSize < 0 || start + entry.compressedSize > d.length) throw corrupt(L('datos truncados en «%@»', entry.name))
    switch (entry.method) {
      case 0: {
        if (entry.compressedSize !== entry.uncompressedSize) throw corrupt(L('tamaño inconsistente en «%@»', entry.name))
        const n = Math.min(entry.compressedSize, prefix ?? Number.MAX_SAFE_INTEGER)
        return { data: d.slice(start, start + n), truncated: n < entry.compressedSize }
      }
      case 8:
        if (entry.uncompressedSize === 0) return { data: new Uint8Array(0), truncated: false }
        return ZipArchive.inflate(d.subarray(start, start + entry.compressedSize), entry.uncompressedSize, prefix, entry.name)
      default:
        throw unsupportedType(L('método de compresión %@ en «%@»', String(entry.method), entry.name))
    }
  }

  /** DEFLATE crudo que se corta si excede el tamaño declarado; con `prefix`, se detiene al llegar a esos bytes. */
  private static inflate(src: Uint8Array, expected: number, prefix: number | null, name: string): { data: Uint8Array; truncated: boolean } {
    const run = (input: Uint8Array, partial: boolean): Uint8Array => {
      try {
        return zlib.inflateRawSync(input, {
          maxOutputLength: Math.max(1, expected),
          ...(partial ? { finishFlush: zlib.constants.Z_SYNC_FLUSH } : {})
        })
      } catch (e) {
        const code = (e as { code?: string }).code
        if (e instanceof RangeError || code === 'ERR_BUFFER_TOO_LARGE') throw archiveLimit(L('«%@» se descomprime a más de lo declarado', name))
        if (code === 'Z_BUF_ERROR' || /unexpected end/i.test(errorMessage(e))) throw corrupt(L('datos comprimidos truncados en «%@»', name))
        throw corrupt(L('datos comprimidos dañados en «%@»', name))
      }
    }
    if (prefix === null || prefix >= expected) {
      const out = run(src, false)
      if (out.length !== expected) throw corrupt(L('el tamaño descomprimido de «%@» no coincide con el declarado', name))
      return { data: out, truncated: false }
    }
    // Lectura parcial: se descomprime un trozo creciente de la entrada hasta tener `prefix` bytes
    let n = Math.min(src.length, Math.max(16 * 1024, Math.ceil(prefix / 4)))
    for (;;) {
      const whole = n >= src.length
      const out = run(src.subarray(0, n), !whole)
      if (out.length >= prefix) return { data: out.slice(0, prefix), truncated: prefix < expected }
      if (whole) {
        if (out.length !== expected) throw corrupt(L('el tamaño descomprimido de «%@» no coincide con el declarado', name))
        return { data: out, truncated: false }
      }
      n = Math.min(src.length, n * 2)
    }
  }

  // MARK: Utilidades

  private static findEOCD(data: Uint8Array): number | null {
    const n = data.length
    const lowest = Math.max(0, n - 22 - 65_535)
    for (let pos = n - 22; pos >= lowest; pos--) {
      if (data[pos] === 0x50 && data[pos + 1] === 0x4b && data[pos + 2] === 0x05 && data[pos + 3] === 0x06) {
        const commentLen = le16(data, pos + 20) ?? 0
        if (pos + 22 + commentLen <= n) return pos
      }
    }
    return null
  }

  static decodeName(raw: Uint8Array, utf8Flag: boolean): string {
    const s = strictUTF8(raw) ?? (utf8Flag ? utf8(raw) : Buffer.from(raw).toString('latin1'))
    return normalizeZipName(s)
  }

  /** Busca el registro final (EOCD) en el final de un archivo ya leído (`tail`). */
  static eocdIn(tail: Uint8Array): number | null {
    return ZipArchive.findEOCD(tail)
  }
}

/**
 * Los nombres de las entradas de un ZIP leyendo SOLO su final (el registro EOCD y el directorio central), sin cargar el archivo
 * (A2-P2-14: para saber si un .zip es un docx, un pptx o un epub, antes se leía entero en el proceso principal). null si no es
 * un ZIP que se pueda mirar así.
 */
export function zipEntryNames(path: string, maxEntries = 200_000): string[] | null {
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const size = fstatSync(fd).size
    if (size < 22) return null
    const read = (pos: number, len: number): Uint8Array => {
      const b = new Uint8Array(len)
      const n = readSync(fd as number, b, 0, len, pos)
      return b.subarray(0, n)
    }
    const tailLen = Math.min(size, 22 + 65_535 + 20)
    const tailStart = size - tailLen
    const tail = read(tailStart, tailLen)
    const at = ZipArchive.eocdIn(tail)
    if (at === null) return null
    let total = le16(tail, at + 10) ?? 0
    let cdSize = le32(tail, at + 12) ?? 0
    let cdOffset = le32(tail, at + 16) ?? 0
    let dirEnd = tailStart + at
    if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      if (at < 20 || le32(tail, at - 20) !== 0x07064b50) return null
      const z64 = le64(tail, at - 20 + 8)
      if (z64 === null || z64 + 56 > size) return null
      const rec = read(z64, 56)
      if (le32(rec, 0) !== 0x06064b50) return null
      total = le64(rec, 32) ?? Infinity
      cdSize = le64(rec, 40) ?? Infinity
      cdOffset = le64(rec, 48) ?? Infinity
      dirEnd = z64
    }
    if (!Number.isSafeInteger(total) || total > maxEntries || !Number.isSafeInteger(cdSize) || cdSize > 64 * MB || !Number.isSafeInteger(cdOffset)) return null
    // posible prefijo antes del ZIP (autoextraíble): el directorio acaba justo donde empieza el registro final
    const shift = dirEnd - (cdOffset + cdSize)
    const start = cdOffset + (shift > 0 ? shift : 0)
    if (start < 0 || start + cdSize > size) return null
    const cd = read(start, cdSize)
    const names: string[] = []
    let p = 0
    for (let k = 0; k < total && p + 46 <= cd.length; k++) {
      if (le32(cd, p) !== 0x02014b50) return null
      const flags = le16(cd, p + 8) ?? 0
      const nameLen = le16(cd, p + 28) ?? 0, extraLen = le16(cd, p + 30) ?? 0, commentLen = le16(cd, p + 32) ?? 0
      if (p + 46 + nameLen > cd.length) return null
      names.push(ZipArchive.decodeName(cd.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0))
      p += 46 + nameLen + extraLen + commentLen
    }
    return names
  } catch {
    return null
  } finally {
    if (fd !== null) try { closeSync(fd) } catch { /* nada */ }
  }
}
