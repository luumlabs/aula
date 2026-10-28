// Hojas de fotogramas (PNG) de las animaciones pixel-art, para revisarlas a tamaño grande.
// Uso: npx esbuild scripts/dev/pixel-sheets.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/pixel-sheets.mjs \
//        --alias:@engine=./src/engine --alias:@shared=./src/shared && node node_modules/.cache/pixel-sheets.mjs <carpeta> [icons|companions] [ids…]
// Variables: SCALE (px por píxel), LINE (fotogramas por fila), PER (personajes por hoja).
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { SPRITES } from '../../src/renderer/src/design/pixel/sprites'
import { COMPANIONS } from '../../src/renderer/src/design/pixel/companions'
import { iconAnim, companionAnim } from '../../src/renderer/src/design/pixel/characters'
import { toneForHue } from '../../src/renderer/src/design/pixel/tones'
import { CourseIconCatalog } from '../../src/shared/schema/courseIcons'
import type { CompiledAnim, Px } from '../../src/renderer/src/design/pixel/anim'

// fuente 3×5
const FONT: Record<string, string> = {
  a: '010101111101101', b: '110101110101110', c: '011100100100011', d: '110101101101110', e: '111100110100111', f: '111100110100100',
  g: '011100101101011', h: '101101111101101', i: '111010010010111', j: '001001001101010', k: '101101110101101', l: '100100100100111',
  m: '101111111101101', n: '110101101101101', o: '010101101101010', p: '110101110100100', q: '010101101110011', r: '110101110101101',
  s: '011100010001110', t: '111010010010010', u: '101101101101111', v: '101101101101010', w: '101101111111101', x: '101101010101101',
  y: '101101010010010', z: '111001010100111', '-': '000000111000000', ' ': '000000000000000', '0': '111101101101111', '1': '010110010010111',
  '2': '110001010100111', '3': '110001010001110', '4': '101101111001001', '5': '111100110001110', '6': '011100111101111', '7': '111001010010010',
  '8': '111101111101111', '9': '111101111001110', ':': '000010000010000', '.': '000000000000010', '/': '001001010100100'
}

class Img {
  w: number; h: number; d: Uint8Array
  constructor(w: number, h: number, bg = 0xf6efe2) { this.w = w; this.h = h; this.d = new Uint8Array(w * h * 3); this.rect(0, 0, w, h, bg) }
  rect(x: number, y: number, w: number, h: number, c: number) {
    for (let j = Math.max(0, y); j < Math.min(this.h, y + h); j++) for (let i = Math.max(0, x); i < Math.min(this.w, x + w); i++) {
      const o = (j * this.w + i) * 3; this.d[o] = c >> 16; this.d[o + 1] = (c >> 8) & 255; this.d[o + 2] = c & 255
    }
  }
  text(x: number, y: number, s: string, scale = 2, c = 0x2a1e26) {
    let cx = x
    for (const ch of s.toLowerCase()) {
      const g = FONT[ch] ?? FONT[' ']
      for (let k = 0; k < 15; k++) if (g[k] === '1') this.rect(cx + (k % 3) * scale, y + Math.floor(k / 3) * scale, scale, scale, c)
      cx += 4 * scale
    }
  }
  png(): Buffer {
    const raw = Buffer.alloc((this.w * 3 + 1) * this.h)
    for (let y = 0; y < this.h; y++) { raw[y * (this.w * 3 + 1)] = 0; Buffer.from(this.d.buffer, y * this.w * 3, this.w * 3).copy(raw, y * (this.w * 3 + 1) + 1) }
    const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
    const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
    const chunk = (t: string, data: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(t), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
    const ih = Buffer.alloc(13); ih.writeUInt32BE(this.w, 0); ih.writeUInt32BE(this.h, 4); ih[8] = 8; ih[9] = 2
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
  }
}

const out = process.argv[2]
const kind = process.argv[3] ?? 'icons'
const ids = process.argv.slice(4)
mkdirSync(out, { recursive: true })
const PER_LINE = Number(process.env.LINE ?? 14)

function frameBox(img: Img, x: number, y: number, a: CompiledAnim, px: Px[], s: number, label: string) {
  const W = a.stride * s
  img.rect(x - 1, y - 1, W + 2, W + 2, 0xc9b9a0)
  img.rect(x, y, W, W, 0xfbf7ef)
  // marco del sprite (sin margen)
  const m = a.margin * s
  img.rect(x + m, y + m, a.size * s, a.size * s, 0xf1e8d6)
  for (let j = 0; j < a.stride; j++) for (let i = 0; i < a.stride; i++) {
    const c = px[j * a.stride + i]
    if (c) img.rect(x + i * s, y + j * s, s, s, parseInt(c.slice(1), 16))
  }
  img.text(x, y + W + 3, label, 1, 0x857a7d)
}

function sheet(name: string, list: { id: string; a: CompiledAnim }[], s: number) {
  const W = list[0].a.stride * s + 8
  let lines = 0
  for (const { a } of list) for (const c of ['idle', 'hover', 'celebrate'] as const) lines += Math.max(1, Math.ceil((a.clips[c]?.frames.length ?? 0) / PER_LINE))
  const LH = W + 10
  const img = new Img(110 + PER_LINE * W, 20 + lines * LH + list.length * 14)
  let y = 10
  for (const { id, a } of list) {
    img.text(6, y, id, 2)
    for (const c of ['idle', 'hover', 'celebrate'] as const) {
      const clip = a.clips[c]
      img.text(6, y + 16, c.slice(0, 5), 2, 0xb4502f)
      if (clip) img.text(6, y + 30, `${clip.ms}ms`, 1, 0x857a7d)
      const fr = clip?.frames ?? []
      fr.forEach((f, i) => {
        const col = i % PER_LINE
        const row = Math.floor(i / PER_LINE)
        frameBox(img, 100 + col * W, y + row * LH, a, f.px, s, `${i}${f.ticks > 1 ? 'x' + f.ticks : ''}`)
      })
      y += Math.max(1, Math.ceil(fr.length / PER_LINE)) * LH
    }
    y += 14
    img.rect(0, y - 8, img.w, 1, 0xc9b9a0)
  }
  writeFileSync(`${out}/${name}.png`, img.png())
  console.log(`${out}/${name}.png`, img.w, 'x', img.h)
}

if (kind === 'icons') {
  const all = SPRITES.filter((s) => !ids.length || ids.includes(s.id)).map((s) => ({ id: s.id, a: iconAnim(s.id, toneForHue(CourseIconCatalog.hue(s.id))) }))
  const per = Number(process.env.PER ?? 4)
  for (let i = 0; i < all.length; i += per) sheet(`icons-${String(i / per + 1).padStart(2, '0')}-${all[i].id}`, all.slice(i, i + per), Number(process.env.SCALE ?? 5))
} else {
  const all = COMPANIONS.filter((c) => !ids.length || ids.includes(c.id)).map((c) => ({ id: c.id, a: companionAnim(c.id) }))
  const per = Number(process.env.PER ?? 4)
  for (let i = 0; i < all.length; i += per) sheet(`companions-${String(i / per + 1).padStart(2, '0')}-${all[i].id}`, all.slice(i, i + per), 4)
}
