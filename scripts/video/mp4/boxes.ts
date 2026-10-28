// Escritura de cajas ISO-BMFF (MP4) sin dependencias: un búfer que crece y cajas anidadas.

export class ByteWriter {
  private buf = new Uint8Array(1 << 16)
  private view = new DataView(this.buf.buffer)
  pos = 0

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return
    let size = this.buf.length * 2
    while (size < this.pos + n) size *= 2
    const next = new Uint8Array(size)
    next.set(this.buf.subarray(0, this.pos))
    this.buf = next
    this.view = new DataView(next.buffer)
  }
  u8(v: number): this {
    this.ensure(1)
    this.view.setUint8(this.pos, v)
    this.pos += 1
    return this
  }
  u16(v: number): this {
    this.ensure(2)
    this.view.setUint16(this.pos, v)
    this.pos += 2
    return this
  }
  u24(v: number): this {
    return this.u8((v >>> 16) & 0xff).u16(v & 0xffff)
  }
  u32(v: number): this {
    this.ensure(4)
    this.view.setUint32(this.pos, v >>> 0)
    this.pos += 4
    return this
  }
  i32(v: number): this {
    this.ensure(4)
    this.view.setInt32(this.pos, v)
    this.pos += 4
    return this
  }
  u64(v: number): this {
    return this.u32(Math.floor(v / 2 ** 32)).u32(v % 2 ** 32)
  }
  bytes(b: Uint8Array): this {
    this.ensure(b.length)
    this.buf.set(b, this.pos)
    this.pos += b.length
    return this
  }
  zeros(n: number): this {
    this.ensure(n)
    this.buf.fill(0, this.pos, this.pos + n)
    this.pos += n
    return this
  }
  ascii(s: string): this {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i) & 0x7f)
    return this
  }
  /** Caja con tamaño de 32 bits que se rellena al cerrar. */
  box(type: string, body: (w: this) => void): this {
    const start = this.pos
    this.u32(0).ascii(type)
    body(this)
    this.view.setUint32(start, this.pos - start)
    return this
  }
  /** Caja completa (versión + banderas). */
  full(type: string, version: number, flags: number, body: (w: this) => void): this {
    return this.box(type, (w) => {
      w.u8(version).u24(flags)
      body(w)
    })
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.pos)
  }
}

/** Matriz identidad de las cabeceras mvhd/tkhd. */
export function writeMatrix(w: ByteWriter): void {
  for (const v of [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]) w.u32(v)
}

/** Idioma «und» empaquetado (ISO-639-2/T en 3×5 bits). */
export const LANG_UND = ((('u'.charCodeAt(0) - 0x60) << 10) | (('n'.charCodeAt(0) - 0x60) << 5) | ('d'.charCodeAt(0) - 0x60)) & 0x7fff
