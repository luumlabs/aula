// Solo para pruebas: fabricante de ZIP (port de ZipForge de las pruebas Swift) que permite construir archivos hostiles
// (tamaños mentirosos, métodos desconocidos, datos dañados, ZIP64, prefijos de autoextraíble…).
import * as zlib from 'node:zlib'
import { crc32 } from '../core/zipArchive'

export type ZipMethod = 'stored' | 'deflate'

export interface ForgeEntry {
  name: string
  data: Uint8Array
  method?: ZipMethod
  flags?: number
  /** Valores falsos para el directorio central. */
  declaredUncompressed?: number
  declaredCompressed?: number
  /** Código de método a escribir en lugar del real (p. ej. 14 = LZMA). */
  methodCode?: number
  /** Bytes ya «comprimidos» a escribir tal cual. */
  rawPayload?: Uint8Array
  /** CRC a escribir en lugar del real. */
  crc?: number
}

const enc = new TextEncoder()
export const bytes = (s: string): Uint8Array => enc.encode(s)

export class ZipForge {
  entries: ForgeEntry[] = []
  /** Bytes antes del ZIP (como un autoextraíble). */
  prefix: Uint8Array = new Uint8Array()
  /** Número de entradas que anuncia el registro final (mentira). */
  declaredEntryCount?: number
  useZip64 = false

  constructor(files: Record<string, string | Uint8Array> = {}) {
    for (const [name, data] of Object.entries(files)) this.add(name, data)
  }

  add(name: string, data: string | Uint8Array, method: ZipMethod = 'deflate'): this {
    this.entries.push({ name, data: typeof data === 'string' ? bytes(data) : data, method })
    return this
  }

  build(): Uint8Array {
    const out: number[] = Array.from(this.prefix)
    const base = this.prefix.length
    const central: number[] = []
    const le16 = (a: number[], v: number): void => { a.push(v & 0xff, (v >>> 8) & 0xff) }
    const le32 = (a: number[], v: number): void => { a.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff) }
    const le64 = (a: number[], v: number): void => { le32(a, v % 0x1_0000_0000); le32(a, Math.floor(v / 0x1_0000_0000)) }
    const push = (a: number[], d: ArrayLike<number>): void => { for (let i = 0; i < d.length; i++) a.push(d[i]) }
    for (const e of this.entries) {
      const name = bytes(e.name)
      const method = e.method ?? 'deflate'
      const payload = method === 'stored' ? e.data : (e.data.length ? new Uint8Array(zlib.deflateRawSync(e.data)) : new Uint8Array())
      const body = e.rawPayload ?? payload
      const code = e.methodCode ?? (method === 'stored' ? 0 : 8)
      const crc = e.crc ?? crc32(e.data)
      const csize = e.declaredCompressed ?? body.length
      const usize = e.declaredUncompressed ?? e.data.length
      const offset = out.length - base
      le32(out, 0x04034b50); le16(out, 20); le16(out, e.flags ?? 0); le16(out, code); le16(out, 0); le16(out, 0x21); le32(out, crc)
      le32(out, body.length); le32(out, e.data.length); le16(out, name.length); le16(out, 0); push(out, name); push(out, body)
      const extra: number[] = []
      let c32 = csize >>> 0, u32 = usize >>> 0, o32 = offset >>> 0
      if (this.useZip64) {
        le16(extra, 1); le16(extra, 24); le64(extra, usize); le64(extra, csize); le64(extra, offset)
        c32 = 0xffffffff; u32 = 0xffffffff; o32 = 0xffffffff
      }
      le32(central, 0x02014b50); le16(central, 20); le16(central, this.useZip64 ? 45 : 20); le16(central, e.flags ?? 0); le16(central, code); le16(central, 0); le16(central, 0x21); le32(central, crc)
      le32(central, c32); le32(central, u32); le16(central, name.length); le16(central, extra.length); le16(central, 0); le16(central, 0); le16(central, 0); le32(central, 0); le32(central, o32)
      push(central, name); push(central, extra)
    }
    const cdOffset = out.length - base
    push(out, central)
    const count = this.declaredEntryCount ?? this.entries.length
    if (this.useZip64) {
      const z64 = out.length - base
      le32(out, 0x06064b50); le64(out, 44); le16(out, 45); le16(out, 45); le32(out, 0); le32(out, 0)
      le64(out, this.entries.length); le64(out, this.entries.length); le64(out, central.length); le64(out, cdOffset)
      le32(out, 0x07064b50); le32(out, 0); le64(out, z64); le32(out, 1)
      le32(out, 0x06054b50); le16(out, 0xffff); le16(out, 0xffff); le16(out, 0xffff); le16(out, 0xffff); le32(out, 0xffffffff); le32(out, 0xffffffff); le16(out, 0)
    } else {
      le32(out, 0x06054b50); le16(out, 0); le16(out, 0); le16(out, count & 0xffff); le16(out, count & 0xffff); le32(out, central.length); le32(out, cdOffset); le16(out, 0)
    }
    return new Uint8Array(out)
  }
}
