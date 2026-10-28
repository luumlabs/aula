// Del dibujo de píxeles al dibujo a mano (PURO, sin DOM): lee cada fotograma como lo leería un ilustrador que lo pasa a
// «tinta y aguada». La TINTA (el contorno oscuro) se vuelve trazos: el esqueleto de sus píxeles en polilíneas que luego
// se entintan con grosor variable, partidas en las esquinas (cada lado, su pincelada). Las líneas de color de un píxel
// (brillos, renglones, letras, el electro del corazón…) se vuelven pinceladas de su color sobre la aguada de debajo. El
// resto son AGUADAS: manchas de color que llegan hasta el centro de la línea (la línea va encima, como al entintar).
import type { Px } from '../anim'
import { oklch } from './palette'

/** La tinta de la paleta de Aula (`ink`). */
export const INK = '#2a1e26'

const lin = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
/** Luminancia relativa (0–1) de un #rrggbb. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16)
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}

/**
 * Los colores que son LÍNEA en un personaje: la tinta, el color de su silueta si se da (el contorno de los compañeros, el
 * primero de su paleta) y los tonos casi negros. El resto son aguadas.
 */
export function lineColorsOf(base: Px[], outline?: string): Set<string> {
  const out = new Set<string>([INK])
  if (outline && luminance(outline) < 0.06) out.add(outline.toLowerCase())
  for (const c of new Set(base)) if (c && luminance(c) < 0.022) out.add(c)
  return out
}

export interface Pt {
  x: number
  y: number
}

/** Un trazo: polilínea por los centros de los píxeles (en unidades de tablero). */
export interface InkPath {
  pts: Pt[]
  closed: boolean
  /** Extremos: 'free' = punta que se afila, 'join' = se une a otro trazo, 'corner' = esquina (el trazo se pasa un pelo). */
  start: 'free' | 'join' | 'corner'
  end: 'free' | 'join' | 'corner'
  color: string
  /** 'ink' = línea de tinta; 'color' = pincelada de color (brillo, renglón, letra). */
  kind: 'ink' | 'color'
  /** La línea va por la silueta (toca el papel): en papel oscuro se entinta en claro. */
  edge?: boolean
  /** Grosor relativo (1 = el de siempre; los detalles de un dibujo, más finos). */
  weight?: number
  /** Opacidad (0–1). */
  alpha?: number
}

/** Lo que el pintor necesita de un fotograma. */
export interface Reading {
  /** Colores de las aguadas (índice 0 = papel). */
  colors: (string | null)[]
  /** Hasta 3 pares (color, peso) por celda: la aguada que hay debajo de cada píxel. */
  lab: Int16Array
  wt: Float32Array
  /** Por celda: cuánto más clara (+) u oscura (−) era en el pixel art que el tono principal de su familia (luz OKLab). */
  shade: Float32Array
  paths: InkPath[]
}

/** Opciones de lectura de un personaje (calculadas una vez con su dibujo base). */
export interface ReadOptions {
  /** Cada color → el tono principal de su familia (el relleno plano); la diferencia de luz se pinta como sombreado suave. */
  family?: Map<string, string>
  /** Pasadas del filtro que ordena el sombreado tramado. */
  tidy?: number
  /** Líneas de color de un píxel como pinceladas: todas (iconos), solo los toques sueltos (compañeros: su pelaje es
   *  sombreado) o cualquier línea fina aunque vaya sobre el papel (`any`: los glifos de la interfaz). */
  strokes?: 'all' | 'dabs' | 'any'
}

const N4: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
]
const N8: [number, number][] = [...N4, [1, 1], [-1, 1], [1, -1], [-1, -1]]

/** Lee un fotograma: qué es tinta, qué es pincelada de color y qué es aguada (y de qué color es la aguada de debajo). */
export function readBoard(px0: Px[], S: number, line: Set<string>, opts: ReadOptions = {}): Reading {
  const px = opts.tidy ? tidyShading(px0, S, line, opts.tidy) : px0
  const fam = (c: string) => opts.family?.get(c) ?? c
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < S && y < S
  const at = (x: number, y: number): Px => (inside(x, y) ? px[y * S + x] : null)
  const isLine = (x: number, y: number) => {
    const c = at(x, y)
    return !!c && line.has(c)
  }
  // 1) masa de tinta: bloques 2×2 de una misma tinta (ojos, manchas): se pintan como mancha, no como trazo
  const mass = new Uint8Array(S * S)
  for (let y = 0; y < S - 1; y++)
    for (let x = 0; x < S - 1; x++) {
      const c = px[y * S + x]
      if (!c || !line.has(c)) continue
      if (at(x + 1, y) === c && at(x, y + 1) === c && at(x + 1, y + 1) === c) mass[y * S + x] = mass[y * S + x + 1] = mass[(y + 1) * S + x] = mass[(y + 1) * S + x + 1] = 1
    }
  // los ojos: grupitos de tinta compactos (hasta 6 píxeles en una caja de 3×3) son una mancha, no un trazo
  {
    const seenE = new Uint8Array(S * S)
    for (let i = 0; i < S * S; i++) {
      const c = px[i]
      if (!c || !line.has(c) || seenE[i]) continue
      const cells: number[] = []
      const stack = [i]
      seenE[i] = 1
      while (stack.length) {
        const j = stack.pop()!
        cells.push(j)
        const x = j % S
        const y = (j - x) / S
        for (const [dx, dy] of N8) {
          const nx = x + dx
          const ny = y + dy
          if (!inside(nx, ny)) continue
          const n = ny * S + nx
          if (!seenE[n] && px[n] === c) {
            seenE[n] = 1
            stack.push(n)
          }
        }
      }
      if (cells.length < 2 || cells.length > 6) continue
      const xs = cells.map((j) => j % S)
      const ys = cells.map((j) => Math.floor(j / S))
      if (Math.max(...xs) - Math.min(...xs) > 2 || Math.max(...ys) - Math.min(...ys) > 2) continue
      if (Math.max(...xs) - Math.min(...xs) === 0 || Math.max(...ys) - Math.min(...ys) === 0) continue
      for (const j of cells) mass[j] = 1
    }
  }
  // …pero solo por dentro (ojos, pupilas): un contorno que engorda en la silueta sigue siendo línea
  {
    const seenM = new Uint8Array(S * S)
    for (let i = 0; i < S * S; i++) {
      if (!mass[i] || seenM[i]) continue
      const cells: number[] = []
      const stack = [i]
      seenM[i] = 1
      let edge = false
      while (stack.length) {
        const j = stack.pop()!
        cells.push(j)
        const x = j % S
        const y = (j - x) / S
        for (const [dx, dy] of N8) {
          const nx = x + dx
          const ny = y + dy
          if (!at(nx, ny)) edge = true
          if (!inside(nx, ny)) continue
          const n = ny * S + nx
          if (!seenM[n] && px[n] === px[j] && (mass[n] || line.has(px[n]!))) {
            seenM[n] = 1
            stack.push(n)
          }
        }
      }
      if (edge) for (const j of cells) mass[j] = 0
    }
  }
  // 2) líneas de color: componentes de un color (no tinta) de un píxel de grueso
  const thick = new Uint8Array(S * S)
  for (let y = 0; y < S - 1; y++)
    for (let x = 0; x < S - 1; x++) {
      const c = px[y * S + x]
      if (!c || line.has(c)) continue
      if (at(x + 1, y) === c && at(x, y + 1) === c && at(x + 1, y + 1) === c) thick[y * S + x] = thick[y * S + x + 1] = thick[(y + 1) * S + x] = thick[(y + 1) * S + x + 1] = 1
    }
  const comp = new Int32Array(S * S).fill(-1)
  const comps: { color: string; cells: number[]; thin: number }[] = []
  for (let i = 0; i < S * S; i++) {
    const c = px[i]
    if (!c || line.has(c) || comp[i] >= 0) continue
    const id = comps.length
    const cells: number[] = []
    const stack = [i]
    comp[i] = id
    let thin = 0
    while (stack.length) {
      const j = stack.pop()!
      cells.push(j)
      if (!thick[j]) thin++
      const x = j % S
      const y = (j - x) / S
      for (const [dx, dy] of N8) {
        const nx = x + dx
        const ny = y + dy
        if (!inside(nx, ny)) continue
        const n = ny * S + nx
        if (comp[n] < 0 && px[n] === c) {
          comp[n] = id
          stack.push(n)
        }
      }
    }
    comps.push({ color: c, cells, thin })
  }
  // fina y «sobre» una superficie: la mayoría de sus píxeles tiene relleno a ambos lados (un renglón en la página, un
  // brillo en el cuerpo, el código en la pantalla); si va por el borde (contra la línea o el papel), es parte de la forma
  const fillAt = (x: number, y: number, c: string) => {
    const v = at(x, y)
    return !!v && v !== c && !line.has(v)
  }
  const thinComp = comps.map((k) => {
    if (k.thin / k.cells.length < 0.8) return false
    let embedded = 0
    for (const j of k.cells) {
      const x = j % S
      const y = (j - x) / S
      const n = N4.filter(([dx, dy]) => fillAt(x + dx, y + dy, k.color)).length
      if (n >= 2) embedded++
    }
    return opts.strokes === 'any' || embedded >= k.cells.length * 0.5
  })
  // el color de debajo de cada componente fina: lo que la rodea (que no sea tinta ni otra línea fina)
  const stroke = new Uint8Array(comps.length)
  const under = new Array<Px>(comps.length).fill(null)
  comps.forEach((k, id) => {
    if (!thinComp[id]) return
    const votes = new Map<string | null, number>()
    let blocked = 0
    for (const j of k.cells) {
      const x = j % S
      const y = (j - x) / S
      for (const [dx, dy] of N8) {
        const nx = x + dx
        const ny = y + dy
        const n = inside(nx, ny) ? ny * S + nx : -1
        const v = n < 0 ? null : px[n]
        if (n >= 0 && comp[n] === id) continue
        if (v && line.has(v)) continue
        if (n >= 0 && v && thinComp[comp[n]]) {
          blocked++
          continue
        }
        votes.set(v, (votes.get(v) ?? 0) + 1)
      }
    }
    let best: Px = null
    let bestN = -1
    for (const [v, n] of votes) if (n > bestN) [best, bestN] = [v, n]
    // si casi todo lo que la rodea son otras líneas finas (dos tonos de una barra), es aguada
    if (bestN <= 0 || blocked > bestN * 1.5) return
    if (opts.strokes === 'dabs' && k.cells.length > 2) return
    stroke[id] = 1
    under[id] = best
  })
  // 3) las aguadas: índice de color por celda (0 = papel)
  const colors: (string | null)[] = [null]
  const idOf = new Map<string, number>()
  const idFor = (c: Px) => {
    if (!c) return 0
    let id = idOf.get(c)
    if (id == null) {
      id = colors.length
      idOf.set(c, id)
      colors.push(c)
    }
    return id
  }
  const base = new Int16Array(S * S).fill(-1)
  const shade = new Float32Array(S * S)
  const lightOf = (c: string) => oklch(c)[0]
  for (let i = 0; i < S * S; i++) {
    const c = px[i]
    if (!c) base[i] = 0
    else if (line.has(c)) base[i] = mass[i] ? idFor(c) : -1
    else {
      const own = stroke[comp[i]] ? under[comp[i]] : c
      base[i] = idFor(own ? fam(own) : null)
      if (own) shade[i] = lightL(own) - lightL(fam(own))
    }
  }
  const lab = new Int16Array(S * S * 3)
  const wt = new Float32Array(S * S * 3)
  for (let i = 0; i < S * S; i++) {
    if (base[i] >= 0) {
      lab[i * 3] = base[i]
      wt[i * 3] = 1
      continue
    }
    // un píxel de línea: se reparte entre las aguadas de sus vecinos de lado (la línea cae en el borde entre ellas)
    const x = i % S
    const y = (i - x) / S
    const votes = new Map<number, number>()
    for (const set of [N4, N8]) {
      for (const [dx, dy] of set) {
        const nx = x + dx
        const ny = y + dy
        const b = inside(nx, ny) ? base[ny * S + nx] : 0
        if (b < 0) continue
        votes.set(b, (votes.get(b) ?? 0) + 1)
      }
      if (votes.size) break
    }
    if (!votes.size) votes.set(0, 1)
    const top = [...votes].sort((a, b) => b[1] - a[1]).slice(0, 3)
    const sum = top.reduce((s, [, n]) => s + n, 0)
    top.forEach(([b, n], m) => {
      lab[i * 3 + m] = b
      wt[i * 3 + m] = n / sum
    })
  }
  // 4) los trazos: la tinta (sin la masa) y las líneas de color
  const paths: InkPath[] = []
  const inkNode = (x: number, y: number) => inside(x, y) && isLine(x, y) && !mass[y * S + x]
  const ink = skeleton(px, S, inkNode, 'ink')
  // ¿va por la silueta? (la mitad de sus píxeles tocan el papel)
  for (const p of ink) {
    let touching = 0
    for (const q of p.pts) {
      const x = Math.floor(q.x)
      const y = Math.floor(q.y)
      if (N4.some(([dx, dy]) => !at(x + dx, y + dy))) touching++
    }
    p.edge = touching >= p.pts.length * 0.5
    // contra un relleno claro (una cara crema, un cristal) la línea oscura ya se lee: en papel oscuro se queda oscura
    if (p.edge) {
      let sum = 0
      let n = 0
      for (const q of p.pts) {
        const x = Math.floor(q.x)
        const y = Math.floor(q.y)
        for (const [dx, dy] of N4) {
          const v = at(x + dx, y + dy)
          if (!v || line.has(v)) continue
          sum += lightL(fam(v))
          n++
        }
      }
      if (n && sum / n > 0.8) p.edge = false
    }
  }
  paths.push(...ink)
  const colorNode = (x: number, y: number) => inside(x, y) && !!px[y * S + x] && !line.has(px[y * S + x]!) && stroke[comp[y * S + x]] === 1
  paths.push(...skeleton(px, S, colorNode, 'color'))
  return { colors, lab, wt, shade, paths }
}

/**
 * El esqueleto de unos píxeles: un grafo con ellos como nodos, unidos de lado y en diagonal solo cuando no hay ya un
 * camino de lado (una escalera de píxeles es una diagonal y no un zigzag), partido en polilíneas entre extremos y cruces,
 * y cada polilínea partida en sus esquinas. Un píxel suelto es un punto.
 */
function skeleton(px: Px[], S: number, node: (x: number, y: number) => boolean, kind: InkPath['kind']): InkPath[] {
  const adj: number[][] = Array.from({ length: S * S }, () => [])
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if (!node(x, y)) continue
      const i = y * S + x
      const c = px[i]
      for (const [dx, dy] of N8) {
        const nx = x + dx
        const ny = y + dy
        if (!node(nx, ny) || px[ny * S + nx] !== c) continue
        if (dx && dy && ((node(x + dx, y) && px[y * S + x + dx] === c) || (node(x, y + dy) && px[(y + dy) * S + x] === c))) continue
        adj[i].push(ny * S + nx)
      }
    }
  const seen = new Set<number>()
  const key = (a: number, b: number) => (a < b ? a * 4096 + b : b * 4096 + a)
  const pt = (i: number): Pt => ({ x: (i % S) + 0.5, y: Math.floor(i / S) + 0.5 })
  const out: InkPath[] = []
  const walk = (start: number, next: number): number[] => {
    const chain = [start]
    let prev = start
    let cur = next
    seen.add(key(start, next))
    for (;;) {
      chain.push(cur)
      if (adj[cur].length !== 2) break
      const nxt = adj[cur][0] === prev ? adj[cur][1] : adj[cur][0]
      if (seen.has(key(cur, nxt))) break
      seen.add(key(cur, nxt))
      prev = cur
      cur = nxt
    }
    return chain
  }
  for (let i = 0; i < S * S; i++) {
    if (!adj[i].length) {
      if (node(i % S, Math.floor(i / S))) out.push({ pts: [pt(i)], closed: false, start: 'free', end: 'free', color: px[i]!, kind })
      continue
    }
    if (adj[i].length === 2) continue
    for (const j of adj[i]) {
      if (seen.has(key(i, j))) continue
      const chain = walk(i, j)
      const last = chain[chain.length - 1]
      out.push(...splitCorners(chain.map(pt), false, adj[i].length === 1 ? 'free' : 'join', adj[last].length === 1 ? 'free' : 'join', px[i]!, kind))
    }
  }
  for (let i = 0; i < S * S; i++) {
    if (adj[i].length !== 2) continue
    const j = adj[i][0]
    if (seen.has(key(i, j))) continue
    const chain = walk(i, j)
    if (chain[chain.length - 1] === i) chain.pop()
    out.push(...splitCorners(chain.map(pt), true, 'join', 'join', px[i]!, kind))
  }
  return out
}

/** Ángulo de giro (rad) en el vértice i, mirando `h` vértices a cada lado. */
function turn(p: Pt[], i: number, h: number, closed: boolean): number {
  const n = p.length
  const get = (j: number) => (closed ? p[((j % n) + n) % n] : p[Math.max(0, Math.min(n - 1, j))])
  const a = get(i - h)
  const b = p[i]
  const c = get(i + h)
  const ux = b.x - a.x
  const uy = b.y - a.y
  const vx = c.x - b.x
  const vy = c.y - b.y
  const lu = Math.hypot(ux, uy)
  const lv = Math.hypot(vx, vy)
  if (lu < 1e-6 || lv < 1e-6) return 0
  return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv))))
}

/** Parte una polilínea en sus esquinas (giros de más de ~55°): cada lado es una pincelada. */
export function splitCorners(pts: Pt[], closed: boolean, start: InkPath['start'], end: InkPath['end'], color: string, kind: InkPath['kind']): InkPath[] {
  const n = pts.length
  if (n < 5) return [{ pts, closed: closed && n > 2, start: closed ? 'join' : start, end: closed ? 'join' : end, color, kind }]
  const LIM = 0.96
  const ang = pts.map((_, i) => (!closed && (i < 2 || i > n - 3) ? 0 : turn(pts, i, 2, closed)))
  const corners: number[] = []
  for (let i = 0; i < n; i++) {
    if (ang[i] < LIM) continue
    const prev = ang[(i - 1 + n) % n]
    const next = ang[(i + 1) % n]
    if (ang[i] >= prev && ang[i] > next) corners.push(i)
  }
  if (!corners.length) return [{ pts, closed, start, end, color, kind }]
  const out: InkPath[] = []
  if (closed) {
    for (let c = 0; c < corners.length; c++) {
      const a = corners[c]
      const b = corners[(c + 1) % corners.length]
      const seg: Pt[] = []
      for (let i = a; ; i = (i + 1) % n) {
        seg.push(pts[i])
        if (i === b && seg.length > 1) break
        if (seg.length > n + 1) break
      }
      out.push({ pts: seg, closed: false, start: 'corner', end: 'corner', color, kind })
    }
    return out
  }
  let from = 0
  let s: InkPath['start'] = start
  for (const c of corners) {
    out.push({ pts: pts.slice(from, c + 1), closed: false, start: s, end: 'corner', color, kind })
    from = c
    s = 'corner'
  }
  out.push({ pts: pts.slice(from), closed: false, start: s, end, color, kind })
  return out
}

/** Suaviza una polilínea (media gaussiana a lo largo, con los extremos abiertos quietos): la escalera se vuelve curva. */
export function smoothPath(pts: Pt[], closed: boolean, sigma = 0.85, passes = 2): Pt[] {
  if (pts.length < 3) return pts.slice()
  const r = Math.ceil(sigma * 2)
  const w: number[] = []
  for (let d = -r; d <= r; d++) w.push(Math.exp(-(d * d) / (2 * sigma * sigma)))
  let cur = pts
  for (let p = 0; p < passes; p++) {
    const n = cur.length
    const next: Pt[] = []
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) {
        next.push(cur[i])
        continue
      }
      let sx = 0
      let sy = 0
      let sw = 0
      for (let d = -r; d <= r; d++) {
        let j = i + d
        if (closed) j = ((j % n) + n) % n
        else if (j < 0 || j >= n) continue
        // cerca de los extremos abiertos, la ventana se encoge (para no tirar de la punta)
        if (!closed && Math.abs(d) > Math.min(i, n - 1 - i)) continue
        const k = w[d + r]
        sx += cur[j].x * k
        sy += cur[j].y * k
        sw += k
      }
      next.push({ x: sx / sw, y: sy / sw })
    }
    cur = next
  }
  return cur
}

/** Reparte puntos cada `step` a lo largo de la polilínea con una spline Catmull-Rom (curva continua por los puntos). */
export function resample(pts: Pt[], closed: boolean, step: number): Pt[] {
  const n = pts.length
  if (n < 2) return pts.slice()
  const at = (i: number) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))])
  const segs = closed ? n : n - 1
  const out: Pt[] = []
  for (let s = 0; s < segs; s++) {
    const p0 = at(s - 1)
    const p1 = at(s)
    const p2 = at(s + 1)
    const p3 = at(s + 2)
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    const m = Math.max(1, Math.ceil(len / step))
    for (let k = 0; k < m; k++) {
      const t = k / m
      const t2 = t * t
      const t3 = t2 * t
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
      })
    }
  }
  if (!closed) out.push(pts[n - 1])
  return out
}

/**
 * Simplifica los colores de un personaje como lo haría un ilustrador: el pixel art sombrea con muchos tonos sueltos (y
 * tramados); la ilustración plana se queda con los tonos que de verdad son zonas (el cuerpo, la barriga, la luz grande) y
 * funde los tonos de sombreado en el tono vecino que manda. Nunca funde colores de otra familia (el azul con la crema).
 * Se calcula UNA vez por personaje (con su dibujo base) para que todos sus fotogramas usen los mismos colores.
 */
export function simplifyColors(base: Px[], line: Set<string>, strength = 0.08): Map<string, string> {
  const count = new Map<string, number>()
  for (const c of base) if (c && !line.has(c)) count.set(c, (count.get(c) ?? 0) + 1)
  const cols = [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)!)
  const lab = new Map(
    cols.map((c) => {
      const [L, C, h] = oklch(c)
      return [c, { L, C, h, a: C * Math.cos((h * Math.PI) / 180), b: C * Math.sin((h * Math.PI) / 180) }]
    })
  )
  const kept: string[] = []
  const out = new Map<string, string>()
  for (const c of cols) {
    const p = lab.get(c)!
    let best: string | null = null
    let bestD = Infinity
    for (const k of kept) {
      const q = lab.get(k)!
      // de otra familia: tonos lejanos con croma de verdad
      const dh = Math.abs(((p.h - q.h + 540) % 360) - 180)
      if (Math.min(p.C, q.C) > 0.02 && dh > 45) continue
      // la diferencia de luz pesa poco (es sombreado); la de croma y tono, mucho
      const d = Math.hypot((p.L - q.L) * 0.45, p.a - q.a, p.b - q.b)
      if (d < bestD) [best, bestD] = [k, d]
    }
    if (best && bestD < strength && count.get(c)! < count.get(best)! * 0.6) out.set(c, best)
    else kept.push(c)
  }
  return out
}

const lightCache = new Map<string, number>()
function lightL(c: string): number {
  let v = lightCache.get(c)
  if (v == null) lightCache.set(c, (v = oklch(c)[0]))
  return v
}

/**
 * Las familias de color de un personaje: cada color se une al tono principal (el más usado) del que es luz o sombra —sin
 * encadenar: se compara siempre con el principal—. Los rellenos se pintan planos con el principal y el resto de la familia
 * queda como sombreado suave. Los colores de otro material (la crema de la barriga junto al azul del gato) no se unen.
 */
export function familiesOf(base: Px[], line: Set<string>): Map<string, string> {
  const count = new Map<string, number>()
  for (const c of base) if (c && !line.has(c)) count.set(c, (count.get(c) ?? 0) + 1)
  const cols = [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)!)
  // contactos de lado entre colores: la luz y la sombra tocan a su tono principal
  const S = Math.round(Math.sqrt(base.length))
  const contact = new Map<string, number>()
  const touch = (a: string, b: string) => {
    const key = a < b ? a + b : b + a
    contact.set(key, (contact.get(key) ?? 0) + 1)
  }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const a = base[y * S + x]
      if (!a) continue
      const r = x + 1 < S ? base[y * S + x + 1] : null
      const d = y + 1 < S ? base[(y + 1) * S + x] : null
      if (r && r !== a) touch(a, r)
      if (d && d !== a) touch(a, d)
    }
  const contacts = (a: string, b: string) => contact.get(a < b ? a + b : b + a) ?? 0
  const mains: string[] = []
  const out = new Map<string, string>()
  for (const c of cols) {
    const [L, C, h] = oklch(c)
    let best: string | null = null
    let bestD = Infinity
    for (const m of mains) {
      const [Lm, Cm, hm] = oklch(m)
      const dh = Math.abs(((h - hm + 540) % 360) - 180)
      const dL = Math.abs(L - Lm)
      // luz o sombra de lo mismo: tono parecido, croma comparable y no demasiada distancia de luz
      const grays = Math.max(C, Cm) < 0.025
      const chromaOk = grays || (Math.min(C, Cm) < 0.03 && dh < 45) || Math.min(C, Cm) / Math.max(C, Cm) > 0.45
      const hueOk = grays || dh < (Math.min(C, Cm) < 0.03 ? 45 : 30)
      // un acento pequeño más vivo que su vecino (un pico, una nariz) se queda como está
      const accent = C > Cm + 0.03 && count.get(c)! <= 8
      if (!chromaOk || !hueOk || accent || dL > 0.17) continue
      // manda el que más toca; a igualdad, el más parecido
      const d = -contacts(c, m) + (dL + dh / 200) * 0.5
      if (d < bestD) [best, bestD] = [m, d]
    }
    if (best && count.get(c)! <= count.get(best)!) out.set(c, best)
    else mains.push(c)
  }
  return out
}

const familyCache = new Map<string, boolean>()
/** ¿Dos colores son tonos de lo mismo (luz y sombra de un pelaje, de una madera)? */
function family(a: string, b: string): boolean {
  if (a === b) return true
  const key = a < b ? a + b : b + a
  let v = familyCache.get(key)
  if (v == null) {
    const [La, Ca, ha] = oklch(a)
    const [Lb, Cb, hb] = oklch(b)
    const dh = Math.abs(((ha - hb + 540) % 360) - 180)
    v = Math.abs(La - Lb) < 0.42 && (Math.min(Ca, Cb) < 0.03 ? Math.max(Ca, Cb) < 0.09 || dh < 50 : dh < 32)
    familyCache.set(key, v)
  }
  return v
}

/**
 * Ordena el sombreado como lo haría un ilustrador: un filtro de moda entre tonos de una misma familia (nunca cruza la
 * línea ni otra familia). Quita el tramado y las motas sueltas y deja las zonas de luz y sombra en formas grandes y
 * sencillas; las zonas de verdad (la barriga, la cara) se quedan porque por dentro mandan ellas.
 */
export function tidyShading(px: Px[], S: number, line: Set<string>, passes = 2): Px[] {
  let cur = px
  for (let p = 0; p < passes; p++) {
    const next = cur.slice()
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const i = y * S + x
        const c = cur[i]
        if (!c || line.has(c)) continue
        const votes = new Map<string, number>()
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue
            const v = cur[ny * S + nx]
            if (!v || line.has(v) || !family(c, v)) continue
            votes.set(v, (votes.get(v) ?? 0) + (dx || dy ? 1 : 1.5))
          }
        let best = c
        let bestN = votes.get(c) ?? 0
        for (const [v, n] of votes) if (n > bestN) [best, bestN] = [v, n]
        if (best !== c && bestN >= 4) next[i] = best
      }
    cur = next
  }
  return cur
}
