import { describe, expect, it } from 'vitest'
import { INK, familiesOf, lineColorsOf, readBoard, splitCorners } from './trace'
import { oklch, warm, SUMI, IVORY } from './palette'
import { paintBoard, paintDrawing, type InkInfo } from './painter'
import { drawFx, readOps, rigIds, rigOf, paintRigFrame, Kit } from './rigs'
import { DRAWINGS } from './drawings'
import './cast'
import { PALETTE, SPRITES } from '../sprites'
import { COMPANIONS } from '../companions'
import { FX } from '../fx'
import { companionAnim, iconAnim } from '../characters'
import { TONES } from '../tones'
import { opsOf, type Px } from '../anim'

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')
const board = (rows: string[], legend: Record<string, string>, S = rows.length): Px[] => {
  const px: Px[] = new Array(S * S).fill(null)
  rows.forEach((r, y) => Array.from(r).forEach((c, x) => (px[y * S + x] = legend[c] ?? null)))
  return px
}
/** ¿Violeta? (tono OKLCH entre el azul y el rosa, con color de verdad). */
const violet = (r: number, g: number, b: number) => {
  const [, C, h] = oklch('#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''))
  return C > 0.05 && h > 285 && h < 335
}
const target = (W: number, stride: number, dark = false, variant = 0) => ({ W, stride, dark, variant, dpr: 2 })

describe('de pixel art a tinta y relleno (trace)', () => {
  const ink = hex(PALETTE.ink)
  const red = hex(PALETTE.red2)
  const white = hex(PALETTE.white)
  it('la tinta del contorno es línea; el color, relleno que llega hasta la línea', () => {
    const px = board(['.....', '.ooo.', '.oRo.', '.ooo.', '.....'], { o: ink, R: red })
    const r = readBoard(px, 5, new Set([INK]))
    expect(r.paths.filter((p) => p.kind === 'ink').length).toBeGreaterThan(0)
    // el píxel rojo es relleno rojo y los de tinta llevan, repartido, el rojo de dentro y el papel de fuera
    const id = r.colors.indexOf(red)
    expect(r.lab[(2 * 5 + 2) * 3]).toBe(id)
    const edge = (1 * 5 + 2) * 3
    expect([r.lab[edge], r.lab[edge + 1], r.lab[edge + 2]]).toContain(id)
    expect([r.lab[edge], r.lab[edge + 1], r.lab[edge + 2]]).toContain(0)
  })
  it('una escalera de tinta es una sola diagonal, y una caja se parte en sus esquinas', () => {
    const diag = board(['o....', '.o...', '..o..', '...o.', '....o'], { o: ink })
    expect(readBoard(diag, 5, new Set([INK])).paths.filter((p) => p.kind === 'ink')).toHaveLength(1)
    const box = Array.from({ length: 6 }, (_, i) => ({ x: i, y: 0 })).concat(Array.from({ length: 5 }, (_, i) => ({ x: 5, y: i + 1 })))
    const parts = splitCorners(box, false, 'free', 'free', ink, 'ink')
    expect(parts).toHaveLength(2)
    expect(parts[0].end).toBe('corner')
  })
  it('un brillo de un píxel sobre un cuerpo es una pincelada de su color (y debajo sigue el cuerpo)', () => {
    const px = board(['RRRRR', 'RWWWR', 'RRRRR', 'RRRRR', 'RRRRR'], { R: red, W: white })
    const r = readBoard(px, 5, new Set([INK]))
    expect(r.paths.some((p) => p.kind === 'color' && p.color === white)).toBe(true)
    expect(r.colors).not.toContain(white)
  })
  it('las familias juntan luz y sombra de un color pero no materiales distintos', () => {
    const fox = companionAnim('zorro')
    const line = lineColorsOf(fox.base, fox.look?.outline)
    const fam = familiesOf(fox.base, line)
    // la sombra naranja va con el naranja; la crema del hocico no
    expect(fam.get('#cf632c')).toBe('#f5914a')
    expect(fam.get('#f5e6c8')).not.toBe('#f5914a')
  })
})

describe('los pigmentos (palette)', () => {
  it('templa cada color sin cambiarle la familia y nunca da violeta', () => {
    const all = [...Object.values(PALETTE).map(hex), ...COMPANIONS.flatMap((c) => c.palette), ...TONES.flatMap((t) => [t.top, t.bottom, t.fillLight])]
    for (const c of all) {
      for (const dark of [false, true]) {
        const w = warm(c, dark)
        const n = parseInt(w.slice(1), 16)
        expect(violet(n >> 16, (n >> 8) & 255, n & 255), `${c} → ${w}`).toBe(false)
      }
      const [, C, h] = oklch(c)
      const [, C2, h2] = oklch(warm(c))
      if (C > 0.06) expect(Math.abs(((h - h2 + 540) % 360) - 180), c).toBeLessThan(40)
      expect(C2).toBeLessThanOrEqual(0.175)
    }
    expect(SUMI).toMatch(/^#[0-9a-f]{6}$/)
    expect(IVORY).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('el pintor', () => {
  const anim = iconAnim('chemistry', TONES[5])
  const info: InkInfo = { line: lineColorsOf(anim.base), family: familiesOf(anim.base, lineColorsOf(anim.base)), strokes: 'all' }
  it('pinta siempre igual (semilla fija) y cada dibujo del hervor, un pelo distinto', () => {
    const a = paintBoard(anim.base, info, target(64, anim.stride))
    const b = paintBoard(anim.base, info, target(64, anim.stride))
    const c = paintBoard(anim.base, info, target(64, anim.stride, false, 1))
    expect(a.width).toBe(64)
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true)
    expect(Buffer.from(a.data).equals(Buffer.from(c.data))).toBe(false)
    let ink = 0
    for (let i = 3; i < a.data.length; i += 4) if (a.data[i] > 0) ink++
    expect(ink).toBeGreaterThan(64 * 64 * 0.2)
  })
  it('los colores de la interfaz (glifos) van tal cual, con su transparencia', () => {
    const px = board(['.....', '.pp..', '.pp..', '.....', '.....'], { p: '#336699' }, 5)
    const p = paintBoard(px, { line: new Set(), strokes: 'any', plain: true }, target(40, 5))
    const i = (20 * 40 + 18) * 4
    expect(Math.abs(p.data[i] - 0x33)).toBeLessThan(14)
    expect(Math.abs(p.data[i + 2] - 0x99)).toBeLessThan(14)
    const half = paintBoard(board(['.....', '.pp..', '.pp..', '.....', '.....'], { p: '#33669980' }, 5), { line: new Set(), strokes: 'any', plain: true }, target(40, 5))
    expect(half.data[i + 3]).toBeLessThan(p.data[i + 3] * 0.7)
  })
  it('ningún icono de curso sale violeta (en claro ni en oscuro)', () => {
    for (const sp of SPRITES) {
      const a = iconAnim(sp.id, TONES[(sp.id.length * 3) % TONES.length])
      const inf: InkInfo = { line: lineColorsOf(a.base), family: familiesOf(a.base, lineColorsOf(a.base)), strokes: 'all' }
      for (const dark of [false, true]) {
        const p = paintBoard(a.base, inf, target(44, a.stride, dark))
        let bad = 0
        for (let i = 0; i < p.data.length; i += 4) if (p.data[i + 3] > 200 && violet(p.data[i], p.data[i + 1], p.data[i + 2])) bad++
        expect(bad, `${sp.id} ${dark ? 'oscuro' : 'claro'}`).toBeLessThan(3)
      }
    }
  })
  it('los dibujos sueltos (medalla, llama, sol, luna) se pintan en sus dos fotogramas', () => {
    for (const [name, draw] of Object.entries(DRAWINGS)) {
      for (const f of [0, 1]) {
        const p = paintDrawing(draw({ ribbon: '#b4502f', ribbonDark: '#9c4126', gold: '#d39a3e', goldLight: '#f2c275', star: '#fff6dc', outer: '#b4502f', inner: '#e3a03a', core: '#ffe2a8', sun: '#b97a12', light: '#ffe2a8', moon: '#f2e3c0', shade: '#d9c49a' }, f), target(56, 28))
        let ink = 0
        for (let i = 3; i < p.data.length; i += 4) if (p.data[i] > 0) ink++
        expect(ink, name).toBeGreaterThan(56 * 56 * 0.1)
      }
    }
  })
})

describe('los compañeros dibujados a mano (rigs)', () => {
  it('los 44 tienen su muñeco', () => {
    expect(new Set(rigIds())).toEqual(new Set(COMPANIONS.map((c) => c.id)))
  })
  it('leen las operaciones de su historia: estado, desplazamientos, espejo, parches y efectos', () => {
    const rig = rigOf('gato')!
    const a = readOps(rig, 'happy pose @0,-2 heart3@19,6')
    expect(a.state.eyes).toBe('happy')
    expect(a.state.pose).toBe(true)
    expect(a.items[0]).toMatchObject({ kind: 'rig', dx: 0, dy: -2 })
    expect(a.items[1]).toMatchObject({ kind: 'fx', name: 'heart3', x: 19, y: 6, dy: 0 })
    // espejo y luego desplazamiento: el muñeco reflejado se mueve en el sentido de la pantalla
    const b = readOps(rigOf('erizo')!, '<> @3,1')
    expect(b.items[0]).toMatchObject({ flip: true, dx: 3, dy: 1 })
    // parche propio como estado (bostezo) y como objeto suelto (la manzana que cae)
    expect(readOps(rig, 'blink yawn').state.cels.has('yawn')).toBe(true)
    expect(readOps(rigOf('arbol')!, 'noap ap@4,14').items[1]).toMatchObject({ kind: 'prop', name: 'ap', x: 4, y: 14 })
  })
  it('cada efecto compartido tiene su dibujo', () => {
    for (const name of Object.keys(FX)) expect(drawFx(new Kit(), name, 0, 0), name).toBe(true)
  })
  it('todos los fotogramas de todas sus historias se pintan, sin violeta', () => {
    for (const c of COMPANIONS) {
      const anim = companionAnim(c.id)
      const frames = [anim.base, ...anim.working, ...Object.values(anim.clips).flatMap((cl) => cl!.frames.map((f) => f.px))]
      frames.forEach((px, i) => {
        const ops = opsOf(px)
        expect(ops, `${c.id} ${i}`).not.toBeUndefined()
        const p = paintRigFrame(rigOf(c.id)!, ops!, target(36, anim.stride, i % 2 === 1, i % 3))
        if (i === 0) {
          let bad = 0
          let ink = 0
          for (let j = 0; j < p.data.length; j += 4) {
            if (p.data[j + 3] > 0) ink++
            if (p.data[j + 3] > 200 && violet(p.data[j], p.data[j + 1], p.data[j + 2])) bad++
          }
          expect(ink, c.id).toBeGreaterThan(36 * 36 * 0.12)
          expect(bad, c.id).toBeLessThan(3)
        }
      })
    }
  })
})

describe('a medio dibujar (el vídeo: los personajes se dibujan trazo a trazo)', () => {
  const ink = (d: Uint8ClampedArray) => {
    let n = 0
    for (let i = 3; i < d.length; i += 4) n += d[i]
    return n
  }
  it('un muñeco: entero con todo a 1 es el mismo dibujo; a 0 no hay nada; a medias, algo entre los dos', async () => {
    const { scenePieces } = await import('./painter')
    const rig = rigOf('zorro')!
    const k = new Kit()
    rig.draw(k, readOps(rig, '').state)
    const groups = k.groups()
    const pieces = scenePieces(groups, { size: 24, margin: 2 })
    expect(pieces.some((p) => p.kind === 'ink' && p.edge)).toBe(true)
    expect(pieces.some((p) => p.kind === 'fill')).toBe(true)
    const full = paintRigFrame(rig, '', target(96, 28))
    const all = paintRigFrame(rig, '', { ...target(96, 28), reveal: { progress: pieces.map(() => 1) } })
    expect(Buffer.from(all.data).equals(Buffer.from(full.data))).toBe(true)
    const none = paintRigFrame(rig, '', { ...target(96, 28), reveal: { progress: pieces.map(() => 0) } })
    expect(ink(none.data)).toBe(0)
    const half = paintRigFrame(rig, '', { ...target(96, 28), reveal: { progress: pieces.map(() => 0.5) } })
    expect(ink(half.data)).toBeGreaterThan(ink(full.data) * 0.15)
    expect(ink(half.data)).toBeLessThan(ink(full.data) * 0.9)
  })
  it('un icono de curso: lo mismo, con una pieza por relleno y una por trazo', async () => {
    const { boardPieces, paintBoard } = await import('./painter')
    const { inkInfoOf } = await import('./frames')
    const anim = iconAnim(SPRITES[0].id, TONES[0])
    const info = inkInfoOf(anim)
    const pieces = boardPieces(anim.base, info, anim.stride)
    expect(pieces.length).toBeGreaterThan(2)
    const full = paintBoard(anim.base, info, target(96, anim.stride))
    const all = paintBoard(anim.base, info, { ...target(96, anim.stride), reveal: { progress: pieces.map(() => 1) } })
    expect(Buffer.from(all.data).equals(Buffer.from(full.data))).toBe(true)
    const none = paintBoard(anim.base, info, { ...target(96, anim.stride), reveal: { progress: pieces.map(() => 0) } })
    expect(ink(none.data)).toBe(0)
  })
})
