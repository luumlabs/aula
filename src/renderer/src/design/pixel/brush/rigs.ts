// Los personajes dibujados a mano DESDE CERO (puro, sin DOM). En vez de leer su pixel art, cada compañero tiene su
// «muñeco» (./cast/): una función que lo dibuja a pincel (manchas planas y líneas) en el estado que piden las operaciones
// de su historia. Las historias no cambian: se leen tal cual (`blink`, `happy`, `pose`, `@dx,dy`, `<>`, `%XY`, sus parches
// propios y los efectos compartidos), así que cada fotograma cuenta lo mismo que en pixel art, ahora dibujado. Los efectos
// (destellos, corazones, notas, humo, confeti…) también se dibujan aquí con el mismo pincel.
import { FX } from '../fx'
import { COMPANION_ANIMS } from '../companionAnims'
import { paintScene, type DrawGroup, type DrawLine, type DrawShape, type Painting, type PaintTarget } from './painter'

export type P = [number, number]

/** El estado del muñeco en un fotograma. */
export interface RigState {
  eyes: 'open' | 'closed' | 'happy' | 'wink'
  /** Su otra pose (la cola arriba, las alas abiertas, el rayo de luz…). */
  pose: boolean
  /** Parches propios activos (con su desplazamiento): `yawn`, `boo`, `sh` (gafas)… */
  cels: Map<string, P>
  /** Recoloreados de la historia (`%25`, `%78`…): cada muñeco sabe qué significan (se enciende, se apaga…). */
  recolor: Set<string>
}

/** Un muñeco dibujado a mano. Se dibuja en coordenadas del sprite (0–24; el margen lo pone la escena). */
export interface Rig {
  id: string
  /** Cuerpo claro (cara crema, fantasma blanco): en papel oscuro su silueta sigue en tinta. */
  light?: boolean
  draw(k: Kit, s: RigState): void
  /** Parches propios que son objetos sueltos (la manzana que cae, una gota de tinta…): se dibujan donde se pegan. */
  props?: Record<string, (k: Kit, x: number, y: number, s: RigState) => void>
}

const rigs = new Map<string, Rig>()
export function registerRig(...list: Rig[]): void {
  for (const r of list) rigs.set(r.id, r)
}
export function rigOf(id: string): Rig | undefined {
  return rigs.get(id)
}
export function rigIds(): string[] {
  return [...rigs.keys()]
}

// ——— el estuche de dibujo ———

/** Puntos de una elipse (n puntos, girada `rot` rad). */
export function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0, n = 16): P[] {
  const out: P[] = []
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const x = Math.cos(a) * rx
    const y = Math.sin(a) * ry
    out.push([cx + x * c - y * s, cy + x * s + y * c])
  }
  return out
}
/** Un arco (de a0 a a1 rad) de una elipse. */
export function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 10): P[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as P
  })
}
/** Estrella de `n` puntas (radio exterior e interior). */
export function star(cx: number, cy: number, r: number, ri: number, n = 5, rot = -Math.PI / 2): P[] {
  const out: P[] = []
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n
    const rr = i % 2 ? ri : r
    out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr])
  }
  return out
}
/** Traslada y escala unos puntos. */
export function move(pts: P[], dx: number, dy: number, sx = 1, sy = sx): P[] {
  return pts.map(([x, y]) => [x * sx + dx, y * sy + dy])
}

const PINK = '#ff8fb1'
const WHITE = '#fffbf2'

type FillOpts = { sharp?: boolean; alpha?: number; exact?: boolean }
type LineOpts = { w?: number; color?: string; edge?: boolean; closed?: boolean; alpha?: number; corners?: boolean }
export type Mouth = 'smile' | 'grin' | 'o' | 'flat' | 'cat' | 'none' | 'yawn'

/** Lo que dibuja un muñeco o un efecto: manchas y líneas de un grupo de la escena. */
export class Kit {
  private parts: { shapes: DrawShape[]; lines: DrawLine[] }[] = [{ shapes: [], lines: [] }]
  private get shapes(): DrawShape[] {
    return this.parts[this.parts.length - 1].shapes
  }
  private get lines(): DrawLine[] {
    return this.parts[this.parts.length - 1].lines
  }
  /** Empieza una capa nueva encima: lo de antes (con sus líneas) queda debajo de lo que venga. */
  layer(): this {
    if (this.shapes.length || this.lines.length) this.parts.push({ shapes: [], lines: [] })
    return this
  }

  fill(color: string, pts: P[], o: FillOpts = {}): this {
    this.shapes.push({ fill: color, pts, ...o })
    return this
  }
  oval(cx: number, cy: number, rx: number, ry: number, color: string, o: FillOpts & { rot?: number; n?: number } = {}): this {
    return this.fill(color, ellipse(cx, cy, rx, ry, o.rot ?? 0, o.n ?? 16), o)
  }
  line(pts: P[], o: LineOpts = {}): this {
    this.lines.push({ pts, closed: o.closed, weight: o.w, color: o.color, edge: o.edge, alpha: o.alpha, corners: o.corners })
    return this
  }
  /** Contorno de silueta (cerrado): en papel oscuro, en marfil. */
  edge(pts: P[], o: LineOpts = {}): this {
    return this.line(pts, { closed: true, edge: true, ...o })
  }
  ovalLine(cx: number, cy: number, rx: number, ry: number, o: LineOpts & { rot?: number; n?: number } = {}): this {
    return this.line(ellipse(cx, cy, rx, ry, o.rot ?? 0, o.n ?? 20), { closed: true, ...o })
  }
  /** Mancha con su contorno de silueta (de esquinas vivas si la mancha lo es). */
  body(color: string, pts: P[], o: FillOpts & { w?: number } = {}): this {
    this.fill(color, pts, o)
    return this.edge(pts, { w: o.w, corners: o.sharp })
  }

  /** Los ojos según el estado (abiertos con su brillo, cerrados, felices ^ ^ o guiño). */
  eyes(s: RigState, l: P, r: P, size = 1, o: { sleepy?: boolean; color?: string } = {}): this {
    const one = (p: P, state: RigState['eyes']) => {
      const [x, y] = p
      if (state === 'open') {
        this.oval(x, y, 0.78 * size, 1 * size, o.color ?? 'ink', { exact: true, n: 12 })
        this.oval(x - 0.28 * size, y - 0.36 * size, 0.3 * size, 0.3 * size, WHITE, { exact: true, n: 8 })
      } else if (state === 'closed') {
        this.line(o.sleepy ? arc(x, y - 0.35 * size, 0.95 * size, 0.7 * size, 0.15, Math.PI - 0.15, 6) : [[x - 0.9 * size, y + 0.1], [x, y + 0.35 * size], [x + 0.9 * size, y + 0.1]], { w: 0.8 })
      } else {
        this.line([[x - 0.95 * size, y + 0.45 * size], [x, y - 0.5 * size], [x + 0.95 * size, y + 0.45 * size]], { w: 0.85 })
      }
    }
    const st = s.eyes
    one(l, st === 'wink' ? 'open' : st)
    one(r, st === 'wink' ? 'happy' : st)
    return this
  }
  cheeks(l: P, r: P, size = 1, color = PINK): this {
    this.oval(l[0], l[1], 1.15 * size, 0.62 * size, color, { alpha: 0.85, exact: true, n: 10 })
    return this.oval(r[0], r[1], 1.15 * size, 0.62 * size, color, { alpha: 0.85, exact: true, n: 10 })
  }
  mouth(kind: Mouth, x: number, y: number, w = 2): this {
    const h = w / 2
    if (kind === 'smile') return this.line([[x - h, y - 0.25], [x - h * 0.4, y + 0.42], [x + h * 0.4, y + 0.42], [x + h, y - 0.25]], { w: 0.8 })
    if (kind === 'flat') return this.line([[x - h * 0.8, y], [x + h * 0.8, y + 0.05]], { w: 0.75 })
    if (kind === 'cat')
      return this.line([[x - h, y - 0.1], [x - h * 0.5, y + 0.45], [x, y - 0.05]], { w: 0.75 }).line([[x, y - 0.05], [x + h * 0.5, y + 0.45], [x + h, y - 0.1]], { w: 0.75 })
    if (kind === 'o') return this.oval(x, y + 0.2, 0.55, 0.65, 'ink', { exact: true, n: 10 })
    if (kind === 'grin' || kind === 'yawn') {
      const hh = kind === 'yawn' ? 1.4 : 1.1
      const pts: P[] = kind === 'yawn' ? ellipse(x, y + 0.5, h * 0.8, hh, 0, 12) : [[x - h, y - 0.3], [x + h, y - 0.3], ...arc(x, y - 0.3, h, hh, 0.1, Math.PI - 0.1, 8)]
      this.fill('ink', pts, { exact: true })
      return this.oval(x, y + (kind === 'yawn' ? 1.1 : 0.45), h * 0.5, 0.42, '#e9707d', { exact: true, n: 10 })
    }
    return this
  }
  /** La cara de siempre: ojos (con su estado), mejillas y boca (abierta de alegría con los ojos felices). */
  face(s: RigState, o: { l: P; r: P; size?: number; mouth?: P; w?: number; kind?: Mouth; happyKind?: Mouth; cheeks?: [P, P]; sleepy?: boolean }): this {
    this.eyes(s, o.l, o.r, o.size ?? 1, { sleepy: o.sleepy })
    if (o.cheeks) this.cheeks(o.cheeks[0], o.cheeks[1], o.size ?? 1)
    if (o.mouth) this.mouth(s.eyes === 'happy' ? o.happyKind ?? o.kind ?? 'smile' : o.kind ?? 'smile', o.mouth[0], o.mouth[1], o.w ?? 2)
    return this
  }
  /** Un destello de cuatro puntas (el brillo de Aula). */
  sparkle(cx: number, cy: number, r: number, color = '#ffd45e', rot = 0): this {
    this.fill(color, star(cx, cy, r, r * 0.28, 4, rot - Math.PI / 2), { exact: true })
    if (r > 1.2) this.oval(cx, cy, r * 0.22, r * 0.22, WHITE, { exact: true, n: 8 })
    return this
  }
  /** Las capas, como grupos de la escena (con el sitio, el espejo y la luz del muñeco). */
  groups(extra: Partial<DrawGroup> = {}): DrawGroup[] {
    return this.parts.filter((p) => p.shapes.length || p.lines.length).map((p) => ({ shapes: p.shapes, lines: p.lines, ...extra }))
  }
}

// ——— los efectos compartidos, dibujados (en su caja de pixel art: x, y arriba a la izquierda; w, h su tamaño) ———
const C = { gold1: '#fff2a8', gold2: '#ffd45e', gold3: '#e89e34', red2: '#e85a48', red3: '#b43a3e', pink1: '#ffcad8', pink2: '#f294b5', pink3: '#cc628e', blue1: '#b4def7', blue2: '#67aeea', blue3: '#3f73c4', teal2: '#62c5b3', teal3: '#33918c', stone1: '#e4ded8', stone2: '#b8aea9', stone3: '#857a7d', green2: '#8dc860' }

const heartPts = (cx: number, cy: number, w: number): P[] => {
  const s = w / 5
  return move(
    [
      [0, -0.6],
      [0.9, -1.6],
      [2, -1.5],
      [2.45, -0.6],
      [2.1, 0.5],
      [0, 2.1],
      [-2.1, 0.5],
      [-2.45, -0.6],
      [-2, -1.5],
      [-0.9, -1.6]
    ],
    cx,
    cy,
    s
  )
}
export { heartPts }

type FxDraw = (k: Kit, cx: number, cy: number, w: number, h: number) => void
const FX_DRAW: Record<string, FxDraw> = {
  tw1: (k, cx, cy) => void k.sparkle(cx, cy, 0.95, C.gold1),
  tw2: (k, cx, cy) => void k.sparkle(cx, cy, 1.6, C.gold1),
  tw3: (k, cx, cy) => void k.sparkle(cx, cy, 1.7),
  tw5: (k, cx, cy) => void k.sparkle(cx, cy, 2.7),
  twx: (k, cx, cy) => void k.sparkle(cx, cy, 1.7, C.gold1, Math.PI / 4),
  heart: (k, cx, cy, w) => {
    const pts = heartPts(cx, cy + 0.1, w)
    k.fill(C.red2, pts).line(pts, { closed: true, w: 0.7 }).oval(cx - w * 0.22, cy - 0.5, 0.45, 0.32, C.pink1, { exact: true, n: 8 })
  },
  heart3: (k, cx, cy, w) => void k.fill(C.pink2, heartPts(cx, cy + 0.05, w * 1.05), { exact: true }),
  note: (k, cx, cy) => {
    k.oval(cx - 0.6, cy + 1.1, 0.95, 0.7, 'ink', { rot: -0.4, exact: true, n: 10 }).line([[cx + 0.25, cy + 1], [cx + 0.25, cy - 1.8], [cx + 1.2, cy - 1.2]], { w: 0.8 })
  },
  note2: (k, cx, cy) => {
    k.oval(cx - 1, cy + 1.6, 0.9, 0.65, C.teal3, { rot: -0.4, exact: true, n: 10 }).oval(cx + 1, cy + 1.2, 0.9, 0.65, C.teal3, { rot: -0.4, exact: true, n: 10 })
    k.line([[cx - 0.2, cy + 1.5], [cx - 0.2, cy - 2], [cx + 1.8, cy - 2.3], [cx + 1.8, cy + 1.1]], { w: 0.8, color: C.teal3 })
  },
  drop: (k, cx, cy, w, h) => {
    const pts: P[] = [[cx, cy - h * 0.6], [cx + 0.75, cy + 0.2], ...arc(cx, cy + 0.35, 0.75, 0.75, 0, Math.PI, 6).slice(1, -1), [cx - 0.75, cy + 0.2]]
    k.fill(C.blue2, pts, { exact: true })
  },
  drop3: (k, cx, cy) => {
    const pts: P[] = [[cx, cy - 1.6], [cx + 1.15, cy + 0.2], ...arc(cx, cy + 0.4, 1.15, 1.1, 0, Math.PI, 8).slice(1, -1), [cx - 1.15, cy + 0.2]]
    k.fill(C.blue2, pts).oval(cx - 0.4, cy + 0.2, 0.3, 0.42, C.blue1, { exact: true, n: 8 })
  },
  bub: (k, cx, cy) => void k.ovalLine(cx, cy, 1.15, 1.15, { color: WHITE, w: 0.6, alpha: 0.95 }),
  bub1: (k, cx, cy) => void k.oval(cx, cy, 0.55, 0.55, WHITE, { exact: true, n: 8, alpha: 0.95 }),
  bub2: (k, cx, cy) => void k.oval(cx, cy, 0.9, 0.9, WHITE, { exact: true, n: 10, alpha: 0.9 }).ovalLine(cx, cy, 0.9, 0.9, { color: C.teal2, w: 0.4 }),
  puff: (k, cx, cy) => {
    k.oval(cx - 0.6, cy + 0.2, 1, 0.9, C.stone1).oval(cx + 0.7, cy + 0.1, 0.95, 0.85, C.stone1).oval(cx, cy - 0.5, 1, 0.9, C.stone1).oval(cx - 0.1, cy - 0.2, 0.5, 0.45, WHITE, { exact: true, n: 8 })
  },
  puff5: (k, cx, cy) => {
    k.oval(cx - 1.4, cy + 0.4, 1.3, 1.1, C.stone1).oval(cx + 1.3, cy + 0.5, 1.3, 1.1, C.stone1).oval(cx, cy - 0.6, 1.6, 1.4, C.stone1).oval(cx, cy + 0.8, 1.5, 0.9, C.stone2, { alpha: 0.7 })
    k.oval(cx - 0.4, cy - 0.5, 0.8, 0.6, WHITE, { exact: true, n: 10 })
  },
  dust: (k, cx, cy) => void k.oval(cx - 1, cy, 0.55, 0.45, C.stone1).oval(cx + 1, cy - 0.1, 0.55, 0.45, C.stone1),
  bolt: (k, cx, cy) => {
    const pts: P[] = [[cx + 1.2, cy - 2.6], [cx - 1.1, cy + 0.3], [cx + 0.1, cy + 0.3], [cx - 1.2, cy + 2.6], [cx + 1.3, cy - 0.5], [cx + 0.1, cy - 0.5]]
    k.fill(C.gold2, pts, { sharp: true }).line([...pts, pts[0]], { w: 0.55 })
  },
  boltL: (k, cx, cy) => {
    const pts: P[] = [[cx - 1.2, cy - 2.6], [cx + 1.1, cy + 0.3], [cx - 0.1, cy + 0.3], [cx + 1.2, cy + 2.6], [cx - 1.3, cy - 0.5], [cx - 0.1, cy - 0.5]]
    k.fill(C.gold2, pts, { sharp: true }).line([...pts, pts[0]], { w: 0.55 })
  },
  zap: (k, cx, cy) => {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2
      const r0 = i % 2 ? 1.1 : 0.9
      const r1 = i % 2 ? 2.2 : 2.7
      k.line([[cx + Math.cos(a) * r0, cy + Math.sin(a) * r0], [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]], { color: i % 2 ? C.gold1 : C.gold2, w: 0.7 })
    }
    k.oval(cx, cy, 0.7, 0.7, WHITE, { exact: true, n: 8 })
  },
  zz: (k, cx, cy, w, h) => void k.line([[cx - w / 2, cy - h / 2 + 0.2], [cx + w / 2, cy - h / 2], [cx - w / 2, cy + h / 2], [cx + w / 2, cy + h / 2 - 0.1]], { color: C.stone3, w: 0.8 }),
  bang: (k, cx, cy, w, h) => void k.line([[cx, cy - h / 2], [cx + 0.1, cy + h / 2 - 1.4]], { color: C.red2, w: 1 }).oval(cx + 0.1, cy + h / 2 - 0.4, 0.5, 0.5, C.red2, { exact: true, n: 8 }),
  ask: (k, cx, cy, w, h) => {
    k.line([[cx - 1.2, cy - h / 2 + 0.9], ...arc(cx, cy - h / 2 + 1, 1.2, 1, Math.PI, Math.PI * 2.35, 7), [cx, cy + 0.6]], { w: 0.8 })
    k.oval(cx, cy + h / 2 - 0.4, 0.45, 0.45, 'ink', { exact: true, n: 8 })
  },
  star: (k, cx, cy) => {
    const pts = star(cx, cy + 0.15, 2.6, 1.15)
    k.fill(C.gold2, pts).line(pts, { closed: true, w: 0.6 })
  },
  coin: (k, cx, cy) => void k.oval(cx, cy, 2.3, 2.3, C.gold2).ovalLine(cx, cy, 2.3, 2.3, { w: 0.65 }).ovalLine(cx, cy, 1.35, 1.35, { color: C.gold3, w: 0.5 }),
  whooshL: (k, cx, cy) => void k.line([[cx - 1.1, cy - 1], [cx + 1, cy - 1]], { color: C.stone2, w: 0.6 }).line([[cx - 1.1, cy + 1], [cx + 1, cy + 1]], { color: C.stone2, w: 0.6 }),
  whooshR: (k, cx, cy) => void k.line([[cx - 1, cy - 1], [cx + 1.1, cy - 1]], { color: C.stone2, w: 0.6 }).line([[cx - 1, cy + 1], [cx + 1.1, cy + 1]], { color: C.stone2, w: 0.6 })
}
// confeti: tiritas de papel de colores, cada una con su giro
const CONFETTI: Record<string, string> = { c1: C.red2, c2: C.gold2, c3: C.blue2, c4: C.green2, c5: C.teal2 }
for (const [name, color] of Object.entries(CONFETTI))
  FX_DRAW[name] = (k, cx, cy) => {
    const rot = ((cx * 7.3 + cy * 3.1) % 3) - 1.5
    k.fill(color, ellipse(cx, cy, 0.75, 0.38, rot, 6), { sharp: true, exact: true })
  }

/** Dibuja el efecto `name` en su caja de pixel art (x, y arriba a la izquierda). */
export function drawFx(k: Kit, name: string, x: number, y: number): boolean {
  const spec = FX[name]
  const draw = FX_DRAW[name]
  if (!spec || !draw) return false
  const w = Math.max(...spec.rows.map((r) => r.length))
  const h = spec.rows.length
  draw(k, x + w / 2, y + h / 2, w, h)
  return true
}

// ——— leer las operaciones de un fotograma ———
interface Item {
  kind: 'rig' | 'fx' | 'prop'
  name: string
  x: number
  y: number
  dx: number
  dy: number
  flip: boolean
}

const SHIFT = /^@(-?\d+),(-?\d+)$/
const CEL = /^([A-Za-z][\w-]*)(?:@(-?\d+),(-?\d+))?$/

/** Las operaciones de un fotograma → el estado del muñeco y los objetos sueltos, cada uno en su sitio. */
export function readOps(rig: Rig, ops: string): { state: RigState; items: Item[] } {
  const state: RigState = { eyes: 'open', pose: false, cels: new Map(), recolor: new Set() }
  const cels = COMPANION_ANIMS[rig.id]?.cels ?? {}
  const SIZE = 24
  let items: Item[] = [{ kind: 'rig', name: rig.id, x: 0, y: 0, dx: 0, dy: 0, flip: false }]
  for (const tok of ops.trim().split(/\s+/).filter(Boolean)) {
    let m: RegExpExecArray | null
    if (tok === '-') items = []
    else if (tok === '<>') for (const it of items) it.flip = !it.flip
    else if (/^\*\d+$/.test(tok)) continue
    else if ((m = SHIFT.exec(tok))) {
      for (const it of items) {
        // lo que está en espejo se mueve al revés (se dibuja reflejado)
        it.dx += it.flip ? -Number(m[1]) : Number(m[1])
        it.dy += Number(m[2])
      }
    } else if (tok.startsWith('%')) state.recolor.add(tok)
    else if ((m = CEL.exec(tok))) {
      const name = m[1]
      const ox = Number(m[2] ?? 0)
      const oy = Number(m[3] ?? 0)
      if (name === 'blink') state.eyes = state.eyes === 'happy' ? 'happy' : 'closed'
      else if (name === 'happy') state.eyes = 'happy'
      else if (name === 'wink') state.eyes = 'wink'
      else if (name === 'pose') state.pose = true
      else if (rig.props?.[name] && cels[name]) items.push({ kind: 'prop', name, x: cels[name].at[0] + ox, y: cels[name].at[1] + oy, dx: 0, dy: 0, flip: false })
      else if (cels[name]) state.cels.set(name, [ox, oy])
      else if (FX[name]) items.push({ kind: 'fx', name, x: ox, y: oy, dx: 0, dy: 0, flip: false })
    }
  }
  // en espejo, los desplazamientos van al revés de como se acumularon; y los objetos reflejan su caja (x → 24 − x − ancho)
  for (const it of items) {
    if (!it.flip) continue
    if (it.kind === 'rig') {
      it.dx = -it.dx
      continue
    }
    const spec = it.kind === 'fx' ? FX[it.name] : cels[it.name]
    const w = spec ? Math.max(...spec.rows.map((r) => r.length)) : 0
    it.x = SIZE - it.x - w
    it.flip = false
    it.dx = -it.dx
  }
  return { state, items }
}

/** Pinta un fotograma de un muñeco a partir de las operaciones de su historia. */
export function paintRigFrame(rig: Rig, ops: string, t: PaintTarget): Painting {
  const { state, items } = readOps(rig, ops)
  const groups: DrawGroup[] = []
  for (const it of items) {
    const k = new Kit()
    if (it.kind === 'rig') rig.draw(k, state)
    else if (it.kind === 'prop') rig.props![it.name](k, it.x, it.y, state)
    else drawFx(k, it.name, it.x, it.y)
    groups.push(...k.groups({ dx: it.dx, dy: it.dy, flip: it.kind === 'rig' ? it.flip : false, light: it.kind === 'rig' ? rig.light : true }))
  }
  return paintScene(groups, { size: 24, margin: Math.round((t.stride - 24) / 2) }, t)
}
