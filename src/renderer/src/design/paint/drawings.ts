// Los dibujos a mano en vectores (puro, sin DOM): cada dibujo es una o varias pinceladas con su silueta (presión, temblor,
// remates, hebras secas), los huecos de papel entre las cerdas y el EJE por el que la mano la recorre, con su ritmo (arranca,
// corre, frena en las curvas y en las esquinas y se levanta). Así el trazo puede DIBUJARSE al aparecer, una sola vez.
// Mismo pincel que la marca de Aula y el icono (brush.ts). Semilla fija: el mismo dibujo en cada arranque.
import { brushOutline, dryBrush, handLine, handLoop, pathLength, pressureProfile, resample, type BrushOpts, type Pt, type Spine } from './brush'
import { createNoise, type Noise } from './noise'
import { between, gauss, rngFrom, seedOf, type Rng } from './random'
import { bandEdge } from './recipes'

export interface InkStroke {
  /** La silueta rellena (cuerpo y hebras). */
  d: string
  /** El eje por el que pasa la mano (para dibujarse). */
  spine: string
  /** Ancho que cubre la máscara que lo descubre (px). */
  reach: number
  /** Huecos secos entre cerdas (rayas finas de papel) y su grosor. */
  dry: string
  dryWidth: number
  /** Ritmo de la mano: pares [tiempo 0–1, recorrido 0–1]. */
  pace: [number, number][]
  /** Cuánto tarda (ms) y cuándo empieza respecto al dibujo (ms). */
  ms: number
  at: number
}

export interface InkDrawing {
  w: number
  h: number
  strokes: InkStroke[]
  /** Lo que tarda el dibujo entero (ms). */
  ms: number
}

/** El tipo de herramienta: pincel (grueso, con hebras), pluma (fina, viva) o lápiz (gris, granulado). */
export type Tool = 'brush' | 'pen' | 'pencil'

const f2 = (v: number) => (Math.round(v * 100) / 100).toString()
const pathOf = (pts: Pt[]) => (pts.length ? 'M' + pts.map((p) => `${f2(p.x)} ${f2(p.y)}`).join('L') : '')
const polysOf = (polys: Pt[][]) => polys.filter((p) => p.length > 2).map((p) => pathOf(p) + 'Z').join('')

/**
 * El ritmo de la mano por un camino: arranca (acelera), corre, frena donde el camino gira (curvas y esquinas) y se levanta
 * frenando un poco. Devuelve pares [tiempo, recorrido] (0–1), para fotogramas clave.
 */
export function handPace(pts: Pt[], samples = 12): [number, number][] {
  const p = resample(pts, 2)
  const n = p.length
  if (n < 3) return [[0, 0], [1, 1]]
  let t = 0
  const times = [0]
  for (let i = 1; i < n; i++) {
    const a = p[Math.max(0, i - 3)]
    const b = p[i]
    const c = p[Math.min(n - 1, i + 3)]
    const v1 = Math.atan2(b.y - a.y, b.x - a.x)
    const v2 = Math.atan2(c.y - b.y, c.x - b.x)
    let turn = Math.abs(v2 - v1)
    if (turn > Math.PI) turn = 2 * Math.PI - turn
    const s = i / (n - 1)
    // velocidad: menos en los giros, arranque y final más lentos
    const speed = (0.35 + 0.65 * Math.min(1, s / 0.12)) * (1 - 0.5 * Math.min(1, turn / 0.9)) * (s > 0.88 ? 1 - (s - 0.88) * 2.2 : 1)
    t += 2 / Math.max(0.08, speed)
    times.push(t)
  }
  const out: [number, number][] = []
  for (let k = 0; k <= samples; k++) {
    const i = Math.round((k / samples) * (n - 1))
    out.push([times[i] / t, i / (n - 1)])
  }
  return out
}

/** Huecos secos dentro de una pincelada: rayas finas a lo largo del eje, más largas y seguidas hacia el final. */
function dryStreaks(sp: Spine, noise: Noise, rng: Rng, dryness: number, from = 0): string {
  const n = sp.c.length
  if (n < 4 || dryness <= 0) return ''
  const maxW = Math.max(...sp.w)
  const count = Math.max(3, Math.round(maxW * 1.2))
  const parts: string[] = []
  for (let k = 0; k < count; k++) {
    const v = (k + 0.5) / count - 0.5 + gauss(rng) * 0.04
    let seg: Pt[] = []
    const flush = () => {
      if (seg.length > 1) parts.push(pathOf(seg))
      seg = []
    }
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1)
      const gap = t >= from && noise.at(i / 3.5 + k * 11.3, k * 2.7) + Math.pow(t, 2) * dryness * 1.15 - 0.96 + Math.abs(v) * 0.6 * dryness > 0
      if (!gap) {
        flush()
        continue
      }
      seg.push({ x: sp.c[i].x + sp.n[i].x * v * sp.w[i], y: sp.c[i].y + sp.n[i].y * v * sp.w[i] })
    }
    flush()
  }
  return parts.join('')
}

interface StrokeOpts {
  tool: Tool
  /** Grosor máximo (px). */
  width: number
  pressure?: (t: number) => number
  /** Cuánto se seca (0–1): hebras al final y huecos. */
  dryness?: number
  /** Hebras al final del pincel (0 = sin abrirse). */
  tines?: number
  /** Velocidad media de la mano (px/s) y límites (ms). */
  speed?: number
  minMs?: number
  maxMs?: number
}

/** Una pincelada lista para dibujarse: silueta, eje, huecos y ritmo. */
export function inkStroke(path: Pt[], o: StrokeOpts, noise: Noise, rng: Rng, at = 0): InkStroke {
  const tool = o.tool
  const len = pathLength(path)
  const brush: BrushOpts = {
    // en trazos largos (bordes de tarjeta) un punto cada 2 px basta y cuesta la mitad
    step: len > 420 ? 2 : 1,
    width: o.width,
    pressure: o.pressure ?? (tool === 'pencil' ? (t) => 0.75 + 0.25 * Math.sin(t * 7 + 1) ** 2 : pressureProfile(0.7, 0.05, 0.62, 0.12)),
    tremor: tool === 'pencil' ? Math.max(0.35, o.width * 0.4) : Math.min(0.9, o.width * 0.18 + 0.15),
    tremorScale: tool === 'pencil' ? 18 : 42,
    jitter: tool === 'brush' ? 0.12 : tool === 'pen' ? 0.18 : 0.08
  }
  // el cuerpo de la pincelada (y, si es pincel, las hebras que se abren al final)
  const body = brushOutline(path, brush, noise)
  const spine = body.spine
  const polys = o.tines && o.tines > 0 ? dryBrush(path, brush, noise, rng, 0.8, o.tines) : [body.outline]
  const dryness = o.dryness ?? (tool === 'pencil' ? 0.55 : tool === 'brush' ? 0.7 : 0.25)
  // el lápiz granula a lo largo de todo el trazo; el pincel y la pluma se secan hacia el final
  const dry = dryStreaks(spine, noise, rng, dryness, tool === 'pencil' ? 0 : 0.35)
  const speed = o.speed ?? (tool === 'pencil' ? 380 : tool === 'pen' ? 620 : 560)
  const ms = Math.round(Math.max(o.minMs ?? 220, Math.min(o.maxMs ?? 760, (len / speed) * 1000)))
  return {
    d: polysOf(polys),
    spine: pathOf(resample(path, 2)),
    reach: o.width * 1.6 + 3,
    dry,
    dryWidth: tool === 'pencil' ? 0.45 : Math.max(0.35, Math.min(0.8, o.width * 0.12)),
    pace: handPace(path),
    ms,
    at
  }
}

function drawing(w: number, h: number, strokes: InkStroke[]): InkDrawing {
  return { w, h, strokes, ms: Math.max(0, ...strokes.map((s) => s.at + s.ms)) }
}

/** Generadores con semilla: misma semilla + tamaño = el mismo dibujo (y se guarda: no se recalcula). */
const memo = new Map<string, InkDrawing>()
function cached(key: string, make: () => InkDrawing): InkDrawing {
  let d = memo.get(key)
  if (!d) {
    d = make()
    if (memo.size > 400) memo.clear()
    memo.set(key, d)
  }
  return d
}
const tools = (seed: string | number) => {
  const s = seedOf(String(seed))
  return { rng: rngFrom(s), noise: createNoise(s ^ 0x5bd1e995), s }
}

// ───────────── Dibujos ─────────────

/** Subrayado a pincel: se posa romo, corre y se levanta abriéndose en hebras secas. */
export function underlineInk(w: number, h: number, seed: string | number): InkDrawing {
  return cached(`u:${seed}:${w}x${h}`, () => {
    const { rng, noise } = tools(seed)
    const width = h * 0.56
    const path = handLine(h * 0.35, w - h * 0.15, h * 0.52, rng, 0.05, 0.02)
    // presión de verdad: carga al posarse, una leve hinchazón a media carrera y se levanta
    const swell = rng() * 6
    const pressure = (t: number) => pressureProfile(0.8, 0.04, 0.6, 0.1)(t) * (1 + 0.1 * Math.sin(t * 5 + swell))
    return drawing(w, h, [inkStroke(path, { tool: 'brush', width, pressure, tines: 4, speed: 640, minMs: 420, maxMs: 760 }, noise, rng)])
  })
}

/** Rodeado a mano: algo más de una vuelta, más apretado abajo (donde la mano empuja) y suelto al cerrar. */
export function ringInk(size: number, seed: string | number, line = Math.max(1.6, size * 0.065)): InkDrawing {
  const box = size + 8
  return cached(`r:${seed}:${box}:${line}`, () => {
    const { rng, noise } = tools(seed)
    const path = handLoop(box / 2, box / 2, box / 2 - line * 1.4, box / 2 - line * 1.4, rng, 1.14)
    const pressure = (t: number) => (0.5 + 0.5 * Math.min(1, t / 0.12)) * (1 + 0.22 * Math.sin(t * Math.PI * 2 * 1.14 + 2.2)) * (t > 0.82 ? Math.max(0.25, 1 - (t - 0.82) / 0.18 * 0.75) : 1)
    return drawing(box, box, [inkStroke(path, { tool: 'pen', width: line, pressure, dryness: 0.35, speed: 420, minMs: 380, maxMs: 520 }, noise, rng)])
  })
}

/**
 * Borde de una tarjeta, como lo dibuja una persona: dos trazos que salen de la misma esquina (uno por arriba y la derecha,
 * otro por la izquierda y abajo) y se encuentran pasándose un poco; donde vuelven a coincidir, la línea se solapa.
 */
export function borderInk(w: number, h: number, r: number, line: number, seed: string | number): InkDrawing {
  return cached(`b:${seed}:${w}x${h}:${r}:${line}`, () => {
    const { rng, noise } = tools(seed)
    const pad = line * 1.6 + 1
    const loop = roundRectLoop(pad, pad, w - pad * 2, h - pad * 2, Math.max(2, r - pad + 3))
    const n = loop.length
    const lead = Math.round(n * 0.012)
    const meet = between(rng, 0.5, 0.58)
    const over = between(rng, 0.03, 0.05)
    // trazo 1: desde un poco antes de la esquina de arriba a la izquierda, en el sentido de las agujas, hasta pasado el encuentro
    const a: Pt[] = []
    for (let i = -lead; i <= Math.round(n * (meet + over)); i++) a.push(loop[(i + n) % n])
    // trazo 2: desde la misma esquina hacia abajo por la izquierda, hasta cruzarse con el primero
    const b: Pt[] = []
    for (let i = Math.round(n * 0.015); i >= -Math.round(n * (1 - meet + over)); i--) b.push(loop[(i + n) % n])
    // cada trazo con su propia deriva: donde se encuentran no casan del todo
    const drift = (pts: Pt[], amt: number) => {
      const cx = w / 2
      const cy = h / 2
      return pts.map((p, i) => {
        const t = i / (pts.length - 1)
        const k = amt * Math.sin(t * Math.PI) * 0.6 + amt * (t > 0.9 ? (t - 0.9) * 6 : 0)
        const dx = p.x - cx
        const dy = p.y - cy
        const d = Math.hypot(dx, dy) || 1
        return { x: p.x + (dx / d) * k, y: p.y + (dy / d) * k }
      })
    }
    const pen: StrokeOpts = { tool: 'pen', width: line, dryness: 0.2, speed: 1400, minMs: 380, maxMs: 620 }
    const pressure = pressureProfile(0.55, 0.03, 0.9, 0.3)
    const s1 = inkStroke(drift(a, between(rng, 0.4, 1.1)), { ...pen, pressure }, noise, rng, 0)
    // la mano levanta la pluma, vuelve a la esquina y baja por el otro lado
    const s2 = inkStroke(drift(b, between(rng, -1.1, -0.3)), { ...pen, pressure }, noise, rng, s1.ms + 90)
    return drawing(w, h, [s1, s2])
  })
}

/** La línea de tinta de una portada: sigue el corte de su relleno algo desplazada, con principio y final. */
export function coverLineInk(w: number, h: number, seed: string | number, line = 2): InkDrawing {
  return cached(`c:${seed}:${w}x${h}:${line}`, () => {
    const s = seedOf(String(seed))
    // el mismo corte que el relleno (recipes.band): misma semilla, mismo orden de azar
    const rng = rngFrom(s)
    const noise = createNoise(s ^ 0x5bd1e995)
    const edge = bandEdge(rng, noise, w, h)
    const r2 = rngFrom(Math.floor(rng() * 1e9))
    const x0 = w * between(r2, 0.04, 0.12)
    const x1 = w * between(r2, 0.62, 0.86)
    const dx = between(r2, 1, 3)
    const dy = between(r2, 1.5, 3)
    const path = edge.filter((p) => p.x >= x0 && p.x <= x1).map((p) => ({ x: p.x + dx, y: p.y + dy }))
    return drawing(w, h, [inkStroke(path, { tool: 'pen', width: line, pressure: pressureProfile(0.5, 0.05, 0.7, 0.12), dryness: 0.45, speed: 700, minMs: 420, maxMs: 700 }, noise, r2)])
  })
}

/** Tachado a mano (una tarea hecha): una raya que sube un pelo y se pasa por los dos lados. */
export function strikeInk(w: number, h: number, seed: string | number): InkDrawing {
  return cached(`s:${seed}:${w}x${h}`, () => {
    const { rng, noise } = tools(seed)
    const y = h * between(rng, 0.52, 0.6)
    const path = handLine(1, w - 1, y, rng, 0.025, 0.03).map((p, i, all) => ({ x: p.x, y: p.y - (i / (all.length - 1)) * h * 0.14 }))
    const pressure = (t: number) => (0.45 + 0.55 * Math.min(1, t / 0.15)) * (t > 0.75 ? Math.max(0.3, 1 - (t - 0.75) * 2.6) : 1) * (1 + 0.15 * Math.sin(t * 9))
    return drawing(w, h, [inkStroke(path, { tool: 'pen', width: Math.max(1.6, h * 0.1), pressure, dryness: 0.35, speed: 900, minMs: 260, maxMs: 420 }, noise, rng)])
  })
}

/** Visto bueno a mano: un trazo corto que baja y otro largo que sube, de una vez. */
export function checkInk(size: number, seed: string | number): InkDrawing {
  return cached(`k:${seed}:${size}`, () => {
    const { rng, noise } = tools(seed)
    const s = size
    const pts: Pt[] = []
    const a = { x: s * 0.16, y: s * (0.5 + gauss(rng) * 0.03) }
    const b = { x: s * 0.4, y: s * 0.76 }
    const c = { x: s * 0.86, y: s * (0.2 + gauss(rng) * 0.04) }
    for (let i = 0; i <= 10; i++) pts.push({ x: a.x + ((b.x - a.x) * i) / 10, y: a.y + ((b.y - a.y) * i) / 10 + Math.sin((i / 10) * Math.PI) * s * 0.02 })
    for (let i = 1; i <= 20; i++) pts.push({ x: b.x + ((c.x - b.x) * i) / 20, y: b.y + ((c.y - b.y) * i) / 20 - Math.sin((i / 20) * Math.PI) * s * 0.06 })
    return drawing(s, s, [inkStroke(pts, { tool: 'pen', width: Math.max(1.6, s * 0.1), pressure: pressureProfile(0.55, 0.08, 0.7, 0.18), dryness: 0.3, speed: 360, minMs: 300, maxMs: 460 }, noise, rng)])
  })
}

/**
 * Rayitas de alegría alrededor de algo (un logro): trazos cortos que salen hacia fuera, uno detrás de otro, como los que se
 * dibujan alrededor de una estrella en un cuaderno.
 */
export function burstInk(w: number, h: number, seed: string | number, count = 6): InkDrawing {
  return cached(`x:${seed}:${w}x${h}:${count}`, () => {
    const { rng, noise } = tools(seed)
    const cx = w / 2
    const cy = h / 2
    const r0 = Math.min(w, h) * 0.36
    const strokes: InkStroke[] = []
    let at = 0
    // en abanico por arriba y los lados (no por debajo, donde va el texto)
    const from = -Math.PI * 0.98
    const to = -Math.PI * 0.02
    for (let k = 0; k < count; k++) {
      const a = from + ((to - from) * (k + 0.5)) / count + gauss(rng) * 0.08
      const r1 = r0 * between(rng, 1.08, 1.16)
      const len = Math.min(w, h) * between(rng, 0.1, 0.16)
      const p0 = { x: cx + Math.cos(a) * r1, y: cy + Math.sin(a) * r1 }
      const p1 = { x: cx + Math.cos(a + gauss(rng) * 0.05) * (r1 + len), y: cy + Math.sin(a + gauss(rng) * 0.05) * (r1 + len) }
      const path: Pt[] = []
      for (let i = 0; i <= 8; i++) path.push({ x: p0.x + ((p1.x - p0.x) * i) / 8, y: p0.y + ((p1.y - p0.y) * i) / 8 })
      const s = inkStroke(path, { tool: 'brush', width: Math.max(1.8, Math.min(w, h) * 0.035), pressure: pressureProfile(0.85, 0.04, 0.35, 0.15), dryness: 0.2, speed: 260, minMs: 110, maxMs: 170 }, noise, rng, at)
      strokes.push(s)
      at += Math.round(s.ms * 0.7)
    }
    return drawing(w, h, strokes)
  })
}

/**
 * Rayos a lápiz alrededor de la marca (los vacíos): un amanecer esbozado deprisa, gris y suave. Desiguales en largo y en
 * separación, algo curvos, y alguno repasado dos veces (la mano vuelve sobre él).
 */
export function raysInk(w: number, h: number, seed: string | number, cx = w / 2, cy = h * 0.72, count = 5): InkDrawing {
  return cached(`y:${seed}:${w}x${h}:${count}:${cx}:${cy}`, () => {
    const { rng, noise } = tools(seed)
    const r0 = Math.min(w, h) * 0.45
    const strokes: InkStroke[] = []
    let at = 0
    const again = Math.floor(rng() * count)
    for (let k = 0; k < count; k++) {
      const a = -Math.PI * (0.16 + (0.68 * (k + gauss(rng) * 0.18)) / (count - 1))
      const r1 = r0 * between(rng, 0.96, 1.12)
      const len = r0 * between(rng, 0.2, 0.36)
      const bend = gauss(rng) * 0.012
      const ray = (off: number, shrink: number): Pt[] => {
        const p: Pt[] = []
        for (let i = 0; i <= 8; i++) {
          const t = i / 8
          const rr = r1 + len * t * shrink
          const aa = a + (bend * Math.sin(Math.PI * t) * r0) / rr + off
          p.push({ x: cx + Math.cos(aa) * rr, y: cy + Math.sin(aa) * rr })
        }
        return p
      }
      const s = inkStroke(ray(0, 1), { tool: 'pencil', width: 1.1, speed: 110, minMs: 120, maxMs: 220 }, noise, rng, at)
      strokes.push(s)
      at += s.ms + Math.round(between(rng, 20, 90))
      if (k === again) {
        // la mano vuelve sobre este rayo: un segundo trazo casi encima, algo más corto
        const s2 = inkStroke(ray(0.035, 0.8), { tool: 'pencil', width: 0.9, speed: 140, minMs: 100, maxMs: 180 }, noise, rng, at)
        strokes.push(s2)
        at += s2.ms + 40
      }
    }
    return drawing(w, h, strokes)
  })
}

/**
 * Flecha a mano de (x0,y0) a (x1,y1): una curva con un pequeño bucle a mitad (la mano que se anima) y la punta en dos
 * trazos cortos, después del cuerpo.
 */
export function arrowInk(w: number, h: number, seed: string | number, from: Pt, to: Pt, loop = true): InkDrawing {
  return cached(`a:${seed}:${w}x${h}:${from.x},${from.y}:${to.x},${to.y}:${loop}`, () => {
    const { rng, noise } = tools(seed)
    const pts: Pt[] = []
    const mx = (from.x + to.x) / 2
    const my = (from.y + to.y) / 2
    const dx = to.x - from.x
    const dy = to.y - from.y
    const len = Math.hypot(dx, dy)
    const nx = -dy / len
    const ny = dx / len
    const bend = len * 0.28 * (rng() < 0.5 ? 1 : -1)
    const c = { x: mx + nx * bend, y: my + ny * bend }
    const N = 60
    const lr = len * 0.085
    for (let i = 0; i <= N; i++) {
      const t = i / N
      const u = 1 - t
      let x = u * u * from.x + 2 * u * t * c.x + t * t * to.x
      let y = u * u * from.y + 2 * u * t * c.y + t * t * to.y
      if (loop && t > 0.36 && t < 0.6) {
        // un bucle pequeño: la mano gira una vez sobre sí misma (hacia atrás y por encima de la curva)
        const q = (t - 0.36) / 0.24
        const tx = 2 * u * (c.x - from.x) + 2 * t * (to.x - c.x)
        const ty = 2 * u * (c.y - from.y) + 2 * t * (to.y - c.y)
        const tl = Math.hypot(tx, ty) || 1
        const side = -Math.sign(bend)
        x += (-Math.sin(q * Math.PI * 2) * (tx / tl) * 1.5 + (1 - Math.cos(q * Math.PI * 2)) * (-ty / tl) * side) * lr
        y += (-Math.sin(q * Math.PI * 2) * (ty / tl) * 1.5 + (1 - Math.cos(q * Math.PI * 2)) * (tx / tl) * side) * lr
      }
      pts.push({ x, y })
    }
    const shaft = inkStroke(pts, { tool: 'pen', width: 1.8, pressure: pressureProfile(0.5, 0.05, 0.85, 0.4), dryness: 0.25, speed: 520, minMs: 520, maxMs: 760 }, noise, rng, 0)
    // la punta: dos trazos cortos que salen de la punta hacia atrás
    const end = pts[pts.length - 1]
    const prev = pts[pts.length - 6]
    const ang = Math.atan2(end.y - prev.y, end.x - prev.x)
    const head = (side: number, at: number) => {
      const a = ang + Math.PI + side * between(rng, 0.42, 0.55)
      const L = Math.max(7, len * 0.1)
      const p: Pt[] = []
      for (let i = 0; i <= 6; i++) p.push({ x: end.x + Math.cos(a) * L * (i / 6), y: end.y + Math.sin(a) * L * (i / 6) })
      return inkStroke(p.reverse(), { tool: 'pen', width: 1.8, pressure: pressureProfile(0.35, 0.2, 0.7, 0.4), dryness: 0.1, speed: 200, minMs: 120, maxMs: 160 }, noise, rng, at)
    }
    const h1 = head(1, shaft.ms + 40)
    const h2 = head(-1, h1.at + h1.ms + 30)
    return drawing(w, h, [shaft, h1, h2])
  })
}

/** Contorno de una losa (pequeña: el icono del curso, el del aviso de logro): un trazo que da la vuelta y se pasa un poco. */
export function tileInk(size: number, r: number, line: number, seed: string | number): InkDrawing {
  const box = size + 10
  return cached(`t:${seed}:${box}:${r}:${line}`, () => {
    const { rng, noise } = tools(seed)
    const pad = line * 1.6 + 1
    const loop = roundRectLoop(pad, pad, box - pad * 2, box - pad * 2, r)
    const n = loop.length
    const start = Math.floor(rng() * n)
    const total = Math.round(n * between(rng, 1.04, 1.08))
    const pts: Pt[] = []
    for (let i = 0; i <= total; i++) {
      const p = loop[(start + i) % n]
      const t = i / total
      // al pasarse, la mano ya no va justo encima: se abre un pelo hacia fuera
      const k = t > 0.93 ? (t - 0.93) * 14 * line * 0.6 : 0
      const dx = p.x - box / 2
      const dy = p.y - box / 2
      const d = Math.hypot(dx, dy) || 1
      pts.push({ x: p.x + (dx / d) * k, y: p.y + (dy / d) * k })
    }
    return drawing(box, box, [inkStroke(pts, { tool: 'pen', width: line, pressure: pressureProfile(0.5, 0.04, 0.9, 0.3), dryness: 0.25, speed: 520, minMs: 420, maxMs: 640 }, noise, rng)])
  })
}

/** Rectángulo de puntas redondas como polilínea (en el sentido de las agujas desde arriba a la izquierda), a pasos de 2 px. */
function roundRectLoop(x: number, y: number, w: number, h: number, r: number): Pt[] {
  const rr = Math.max(1, Math.min(r, w / 2, h / 2))
  const seg: Pt[] = []
  const arc = (cx: number, cy: number, a0: number) => {
    for (let k = 0; k <= 8; k++) {
      const a = a0 + (k / 8) * (Math.PI / 2)
      seg.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr })
    }
  }
  arc(x + rr, y + rr, Math.PI * 1.0)
  seg.push({ x: x + w - rr, y })
  arc(x + w - rr, y + rr, -Math.PI / 2)
  seg.push({ x: x + w, y: y + h - rr })
  arc(x + w - rr, y + h - rr, 0)
  seg.push({ x: x + rr, y: y + h })
  arc(x + rr, y + h - rr, Math.PI / 2)
  seg.push({ x, y: y + rr })
  return resample(seg, 2)
}
