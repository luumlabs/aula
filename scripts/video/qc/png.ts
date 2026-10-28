// PNG mínimo (Node, sin dependencias): lee RGB/RGBA de 8 bits sin entrelazar (lo que dan las capturas de Chromium) y
// escribe RGBA. Para comparar fotogramas y montar hojas de contactos.
import { deflateSync, inflateSync } from 'node:zlib'

export interface Rgba {
  width: number
  height: number
  data: Uint8Array
}

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export function decodePng(buf: Uint8Array): Rgba {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)
  if (!b.subarray(0, 8).equals(SIG)) throw new Error('no es PNG')
  let p = 8
  let width = 0
  let height = 0
  let channels = 4
  const idat: Buffer[] = []
  while (p < b.length) {
    const len = b.readUInt32BE(p)
    const type = b.toString('latin1', p + 4, p + 8)
    const body = b.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const depth = body[8]
      const color = body[9]
      if (depth !== 8 || body[12] !== 0 || (color !== 6 && color !== 2)) throw new Error(`PNG no admitido (prof. ${depth}, color ${color})`)
      channels = color === 6 ? 4 : 3
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    p += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const cur = new Uint8Array(stride)
  const prev = new Uint8Array(stride)
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0
      const up = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += up
      else if (filter === 3) v += (a + up) >> 1
      else if (filter === 4) {
        const pa = Math.abs(up - c)
        const pb = Math.abs(a - c)
        const pc = Math.abs(a + up - 2 * c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c
      }
      cur[i] = v & 0xff
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      out[o] = cur[x * channels]
      out[o + 1] = cur[x * channels + 1]
      out[o + 2] = cur[x * channels + 2]
      out[o + 3] = channels === 4 ? cur[x * channels + 3] : 255
    }
    prev.set(cur)
  }
  return { width, height, data: out }
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
function crc32(b: Buffer): number {
  let c = -1
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])))
  return Buffer.concat([head, body, crc])
}

export function encodePng(img: Rgba): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(img.width, 0)
  ihdr.writeUInt32BE(img.height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = img.width * 4
  const raw = Buffer.alloc((stride + 1) * img.height)
  for (let y = 0; y < img.height; y++) Buffer.from(img.data.buffer, img.data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))])
}

/** Diferencia entre dos imágenes del mismo tamaño. */
export function diffRgba(a: Rgba, b: Rgba): { pixels: number; max: number; box: [number, number, number, number] | null } {
  let pixels = 0
  let max = 0
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -1
  let y1 = -1
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]), Math.abs(a.data[i + 3] - b.data[i + 3]))
    if (!d) continue
    pixels++
    if (d > max) max = d
    const px = (i / 4) % a.width
    const py = Math.floor(i / 4 / a.width)
    if (px < x0) x0 = px
    if (py < y0) y0 = py
    if (px > x1) x1 = px
    if (py > y1) y1 = py
  }
  return { pixels, max, box: pixels ? [x0, y0, x1, y1] : null }
}
