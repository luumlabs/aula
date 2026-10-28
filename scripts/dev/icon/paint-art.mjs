// El icono de Aula «pintado a mano», generado con código y reproducible (semilla fija, sin imágenes ni dependencias).
// Conserva la idea del icono actual (icon-art.mjs, «C · Sol de píxeles»): arco de papel, puerta y sol que sale, ladrillo.
//
// Se ejecuta en un navegador (Chromium del Electron del proyecto): pinta en búferes Float32 en luz lineal y al final
// vuelca a un <canvas>. Lo lanza paint-icons.mjs. El motor imita la pintura de verdad:
//   · papel: altura del grano (prensado en frío) que decide dónde agarra el pigmento o el grafito;
//   · aguada / acuarela: veladuras con Beer-Lambert (transparentes, se oscurecen al superponerse), borde húmedo
//     (el pigmento se acumula donde se secó el charco), granulación en los valles del papel y floración;
//   · pincel: cerdas que dejan surcos, carga que se gasta (pincel seco que solo toca las crestas del papel), principio
//     y final de pincelada distintos, empaste con relieve;
//   · lápiz y tinta: grafito que agarra en las crestas, plumilla con presión, rayado.
// Todas las medidas van en unidades de la caja del arte (824, la squircle de macOS), así que el mismo cuadro sale
// igual a cualquier resolución.
//
// Cuatro propuestas (PAINTINGS): gouache, watercolor (acuarela), ink (tinta y aguada) y sumi (sumi-e). API:
//   renderArt(id, { px, detail: 'full' | 'small', sun })  → el cuadro (detail 'small' = dibujo para ≤ 32 px;
//                                                            sun: false = sin sol, el resto idéntico, para la película)
//   composeIcon(arte, { size, platform: 'mac' | 'plain' | 'square' })  → con la squircle de macOS y su sombra
//   renderTray(px, color)  → plantilla monocroma «a pincel» para la barra de menús (opcional)
// Funciona en una página o en un worker (OffscreenCanvas). Sin dependencias; solo importa la squircle de icon-art.mjs.

import { squirclePath } from './icon-art.mjs'

export const BOX = 824
const CX = BOX / 2
export const MASK = squirclePath(0, 0, BOX, BOX, 185.4)

// ── Utilidades ───────────────────────────────────────────────────────────────────────────────────────────────────────
const rad = (deg) => (deg * Math.PI) / 180
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x)
const lerp = (a, b, t) => a + (b - a) * t
/** smoothstep que también vale con a > b. */
const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
/** '#rrggbb' → [r, g, b] en luz lineal. */
export function lin(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [toLin(((n >> 16) & 255) / 255), toLin(((n >> 8) & 255) / 255), toLin((n & 255) / 255)]
}
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
/** Rampa de colores (lineales) en t ∈ [0, 1]. */
function ramp(stops, t) {
  t = clamp(t) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(t))
  return mixc(stops[i], stops[i + 1], t - i)
}

/** Azar con semilla (mulberry32), con atajos. */
export function rng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  next.range = (lo, hi) => lo + (hi - lo) * next()
  next.gauss = () => {
    let u = 0
    while (u === 0) u = next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next())
  }
  next.pick = (arr) => arr[Math.floor(next() * arr.length)]
  next.int = () => Math.floor(next() * 2 ** 31)
  return next
}

/** Ruido simplex 2D con semilla (Gustavson), en [-1, 1]. */
function simplex(seed) {
  const r = rng(seed)
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    const t = p[i]
    p[i] = p[j]
    p[j] = t
  }
  const perm = new Uint8Array(512)
  const pm12 = new Uint8Array(512)
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255]
    pm12[i] = perm[i] % 12
  }
  const g = [1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1]
  const F2 = 0.5 * (Math.sqrt(3) - 1)
  const G2 = (3 - Math.sqrt(3)) / 6
  return (xin, yin) => {
    const s = (xin + yin) * F2
    const i = Math.floor(xin + s)
    const j = Math.floor(yin + s)
    const t = (i + j) * G2
    const x0 = xin - (i - t)
    const y0 = yin - (j - t)
    const i1 = x0 > y0 ? 1 : 0
    const j1 = 1 - i1
    const x1 = x0 - i1 + G2
    const y1 = y0 - j1 + G2
    const x2 = x0 - 1 + 2 * G2
    const y2 = y0 - 1 + 2 * G2
    const ii = i & 255
    const jj = j & 255
    let n = 0
    let t0 = 0.5 - x0 * x0 - y0 * y0
    if (t0 > 0) {
      const gi = pm12[ii + perm[jj]] * 2
      t0 *= t0
      n += t0 * t0 * (g[gi] * x0 + g[gi + 1] * y0)
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1
    if (t1 > 0) {
      const gi = pm12[ii + i1 + perm[jj + j1]] * 2
      t1 *= t1
      n += t1 * t1 * (g[gi] * x1 + g[gi + 1] * y1)
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2
    if (t2 > 0) {
      const gi = pm12[ii + 1 + perm[jj + 1]] * 2
      t2 *= t2
      n += t2 * t2 * (g[gi] * x2 + g[gi + 1] * y2)
    }
    return 70 * n
  }
}

/** Ruido 1D suave (valor) para lo que varía a lo largo de una pincelada. */
function noise1(seed) {
  const r = rng(seed)
  const T = new Float32Array(256)
  for (let i = 0; i < 256; i++) T[i] = r() * 2 - 1
  return (x) => {
    const i = Math.floor(x)
    const f = x - i
    const a = T[i & 255]
    const b = T[(i + 1) & 255]
    return a + (b - a) * f * f * (3 - 2 * f)
  }
}

// ── Lienzo ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Un lienzo de N×N píxeles que representa la caja del arte (824 unidades). Guarda el color en luz lineal, el grosor de
 * la pintura (para el empaste) y la altura del papel.
 */
export function painter(N, seed) {
  const P = {
    N,
    k: N / BOX,
    seed,
    R: new Float32Array(N * N),
    G: new Float32Array(N * N),
    B: new Float32Array(N * N),
    T: new Float32Array(N * N),
    H: new Float32Array(N * N),
    rand: rng(seed),
    cache: new Map()
  }
  return P
}

/**
 * Campo de ruido fBm (en unidades de la caja; `freq` en ciclos por unidad). Las frecuencias bajas se calculan en una
 * rejilla y se interpolan, que es mucho más barato y no se nota.
 */
function field(P, { freq, oct = 1, seed = 0, ridged = false, gain = 0.5, warp = 0, aniso = [1, 1] }) {
  const key = `${freq}|${oct}|${seed}|${ridged}|${gain}|${warp}|${aniso}`
  const hit = P.cache.get(key)
  if (hit) return hit
  const { N, k } = P
  const noise = simplex(P.seed * 7919 + seed * 104729 + 17)
  const wnoise = warp ? simplex(P.seed * 31 + seed * 7 + 5) : null
  const wl = k / (freq * 2 ** (oct - 1))
  const step = Math.max(1, Math.min(16, Math.floor(wl / 3)))
  const gw = Math.ceil(N / step) + 2
  const grid = new Float32Array(gw * gw)
  for (let gy = 0; gy < gw; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let u = ((gx * step) / k) * aniso[0]
      let v = ((gy * step) / k) * aniso[1]
      if (wnoise) {
        u += warp * wnoise(u * freq * 0.5, v * freq * 0.5)
        v += warp * wnoise(u * freq * 0.5 + 31.7, v * freq * 0.5 + 11.3)
      }
      let a = 0
      let amp = 1
      let f = freq
      let norm = 0
      for (let o = 0; o < oct; o++) {
        let n = noise(u * f + o * 17.31, v * f - o * 9.73)
        if (ridged) n = 1 - 2 * Math.abs(n)
        a += amp * n
        norm += amp
        amp *= gain
        f *= 2
      }
      grid[gy * gw + gx] = a / norm
    }
  }
  const out = new Float32Array(N * N)
  for (let y = 0; y < N; y++) {
    const gyf = y / step
    const y0 = Math.floor(gyf)
    const fy = gyf - y0
    for (let x = 0; x < N; x++) {
      const gxf = x / step
      const x0 = Math.floor(gxf)
      const fx = gxf - x0
      const i = y0 * gw + x0
      const a = grid[i] + (grid[i + 1] - grid[i]) * fx
      const b = grid[i + gw] + (grid[i + gw + 1] - grid[i + gw]) * fx
      out[y * N + x] = a + (b - a) * fy
    }
  }
  P.cache.set(key, out)
  return out
}

/** Recorre los píxeles de una caja (en unidades) con su índice y su posición en unidades. */
function each(P, bbox, fn) {
  const { N, k } = P
  const x0 = Math.max(0, Math.floor((bbox?.[0] ?? 0) * k))
  const y0 = Math.max(0, Math.floor((bbox?.[1] ?? 0) * k))
  const x1 = Math.min(N, Math.ceil((bbox?.[2] ?? BOX) * k))
  const y1 = Math.min(N, Math.ceil((bbox?.[3] ?? BOX) * k))
  for (let y = y0; y < y1; y++) {
    const v = (y + 0.5) / k
    for (let x = x0; x < x1; x++) fn(y * N + x, (x + 0.5) / k, v)
  }
}

// ── Papel ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Papel de acuarela: grano fino + celdas del prensado en frío + una ondulación grande. `H` (0–1) es la altura: el
 * pigmento líquido se queda en los valles y el pincel seco y el grafito solo tocan las crestas.
 */
export function paper(P, { color = '#F6EFE2', grain = 1, cell = 9, mottle = 0.025, seed = 1 } = {}) {
  const n1 = field(P, { freq: 1 / 2.6, oct: 2, seed: seed + 1 })
  const n2 = field(P, { freq: 1 / cell, oct: 2, seed: seed + 2, ridged: true })
  const n3 = field(P, { freq: 1 / 70, oct: 3, seed: seed + 3 })
  const H = P.H
  let mean = 0
  for (let i = 0; i < H.length; i++) {
    H[i] = 0.42 * n1[i] + 0.45 * n2[i] + 0.13 * n3[i]
    mean += H[i]
  }
  mean /= H.length
  let sd = 0
  for (let i = 0; i < H.length; i += 7) sd += (H[i] - mean) ** 2
  sd = Math.sqrt(sd / (H.length / 7))
  for (let i = 0; i < H.length; i++) H[i] = clamp(0.5 + ((H[i] - mean) / sd) * 0.2 * grain)
  const c = lin(color)
  for (let i = 0; i < H.length; i++) {
    const m = 1 + mottle * n3[i] + 0.035 * grain * (H[i] - 0.5)
    P.R[i] = c[0] * m
    P.G[i] = c[1] * m
    P.B[i] = c[2] * m
  }
}

/**
 * Relieve: ilumina desde arriba a la izquierda el grano del papel (y el grosor de la pintura si `impasto`). Se aplica
 * al final, como la luz rasante sobre el cuadro.
 */
export function relief(P, { tooth = 0.08, impasto = 0, blur = 1 } = {}) {
  const { N, H, T } = P
  let Tb = T
  if (impasto && blur) Tb = boxBlur(T, N, Math.max(1, Math.round(blur * P.k * 0.5)))
  const out = new Float32Array(N * N)
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      const i = y * N + x
      const gh = H[i - N - 1] - H[i + N + 1]
      const gt = Tb[i - N - 1] - Tb[i + N + 1]
      // el grano se ve menos donde hay mucha pintura (la gouache lo tapa)
      const cover = clamp(T[i] * 0.8)
      out[i] = 1 + tooth * gh * (1 - 0.6 * cover) * 4 + impasto * gt
    }
  }
  for (let i = 0; i < N * N; i++) {
    const f = out[i] || 1
    P.R[i] *= f
    P.G[i] *= f
    P.B[i] *= f
  }
}

/** Desenfoque de caja (3 pasadas ≈ gaussiano) de un campo N×N. */
function boxBlur(src, N, r) {
  let a = Float32Array.from(src)
  let b = new Float32Array(N * N)
  const w = 2 * r + 1
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < N; y++) {
      let acc = 0
      const row = y * N
      for (let x = -r; x <= r; x++) acc += a[row + clamp(x, 0, N - 1)]
      for (let x = 0; x < N; x++) {
        b[row + x] = acc / w
        acc += a[row + Math.min(N - 1, x + r + 1)] - a[row + Math.max(0, x - r)]
      }
    }
    for (let x = 0; x < N; x++) {
      let acc = 0
      for (let y = -r; y <= r; y++) acc += b[clamp(y, 0, N - 1) * N + x]
      for (let y = 0; y < N; y++) {
        a[y * N + x] = acc / w
        acc += b[Math.min(N - 1, y + r + 1) * N + x] - b[Math.max(0, y - r) * N + x]
      }
    }
  }
  return a
}

// ── Aguada (acuarela, veladura) ──────────────────────────────────────────────────────────────────────────────────────
/**
 * Una aguada transparente sobre una forma (`sdf` en unidades, negativa dentro). El borde se deforma con ruido; en unos
 * tramos es duro (con borde húmedo: el pigmento se acumula donde se secó) y en otros se pierde. Dentro, el pigmento
 * fluye (manchas suaves), granula en los valles del papel y puede florecer.
 */
export function wash(P, o) {
  const T = lin(o.color)
  const lnT = T.map((c) => Math.log(Math.max(c, 0.0005)))
  const s = o.seed ?? 0
  const e1 = field(P, {
    freq: o.edgeFreq ?? 1 / 46,
    oct: 4,
    seed: s + 11,
    warp: 8
  })
  const e2 = field(P, {
    freq: (o.edgeFreq ?? 1 / 46) * 5,
    oct: 2,
    seed: s + 12
  })
  const soft = field(P, { freq: 1 / 120, oct: 2, seed: s + 13 })
  const flow = field(P, {
    freq: o.flowFreq ?? 1 / 60,
    oct: 3,
    seed: s + 14,
    warp: 20,
    aniso: o.flowAniso ?? [1, 1]
  })
  const speck = field(P, { freq: 1 / 1.3, oct: 1, seed: s + 15 })
  // la granulación va por zonas (donde el agua se quedó más tiempo) y en grumos, no como un ruido uniforme
  const patch = field(P, { freq: 1 / 90, oct: 2, seed: s + 16 })
  const flocc = field(P, { freq: 1 / 4.5, oct: 2, seed: s + 17 })
  const edgeAmp = o.edge ?? 6
  const rough = o.rough ?? 0.2
  const softBase = o.soft ?? 1.2
  const softVar = o.softVar ?? 3
  const wet = o.wet ?? 0.5
  const wetW = o.wetWidth ?? 3
  const gran = o.gran ?? 0.35
  const fl = o.flow ?? 0.3
  const spk = o.speck ?? 0.05
  const dens = o.density ?? 1
  const blooms = o.blooms ?? []
  const H = P.H
  each(P, o.bbox, (i, u, v) => {
    let d = o.sdf(u, v)
    if (d > edgeAmp * 1.6 + softBase + softVar + 4) return
    d += edgeAmp * ((1 - rough) * e1[i] + rough * e2[i])
    // borde perdido o encontrado
    const sv = clamp(0.5 + soft[i] * 1.4)
    const sw = softBase + softVar * sv * sv
    const W = sstep(sw, -sw, d)
    if (W <= 0.001) return
    const hard = 1 - sv
    const di = Math.max(0, -d)
    let D = typeof dens === 'function' ? dens(u, v, i) : dens
    if (D <= 0) return
    D *= 1 + fl * flow[i]
    D *= 1 + wet * hard * (Math.exp(-di / wetW) * 0.9 + Math.exp(-di / (wetW * 5)) * 0.25)
    // flores: el agua que vuelve empuja el pigmento a un borde rizado
    for (const b of blooms) {
      const r = Math.hypot(u - b.x, v - b.y) + b.r * 0.35 * (e2[i] * 0.7 + e1[i] * 0.3)
      if (r < b.r) D *= 1 - b.k * (1 - sstep(b.r * 0.82, b.r, r))
      if (r >= b.r * 0.86 && r < b.r * 1.08) D *= 1 + b.k * 0.9 * (1 - Math.abs((r - b.r * 0.97) / (b.r * 0.11)))
    }
    const gr = gran * clamp(0.55 + patch[i] * 1.2)
    D *= 1 + gr * ((0.5 - H[i]) * 1.5 + 0.7 * flocc[i]) + spk * speck[i]
    D *= W
    if (D <= 0) return
    P.R[i] *= Math.exp(lnT[0] * D)
    P.G[i] *= Math.exp(lnT[1] * D)
    P.B[i] *= Math.exp(lnT[2] * D)
  })
}

// ── Pincel ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Camino suave (Catmull-Rom) por los puntos, remuestreado cada `ds` px, con normales y longitud acumulada. */
function samplePath(pts, ds) {
  const dense = []
  const p = [pts[0], ...pts, pts[pts.length - 1]]
  for (let i = 1; i < p.length - 2; i++) {
    const [p0, p1, p2, p3] = [p[i - 1], p[i], p[i + 1], p[i + 2]]
    const seg = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2))
    for (let s = 0; s < seg; s++) {
      const t = s / seg
      const t2 = t * t
      const t3 = t2 * t
      const f = (a, b, c, d) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  dense.push(pts[pts.length - 1])
  // por longitud de arco
  const xs = [dense[0][0]]
  const ys = [dense[0][1]]
  let acc = 0
  let want = ds
  for (let i = 1; i < dense.length; i++) {
    const [ax, ay] = dense[i - 1]
    const [bx, by] = dense[i]
    const l = Math.hypot(bx - ax, by - ay)
    while (acc + l >= want && l > 0) {
      const t = (want - acc) / l
      xs.push(ax + (bx - ax) * t)
      ys.push(ay + (by - ay) * t)
      want += ds
    }
    acc += l
  }
  const n = xs.length
  const nx = new Float32Array(n)
  const ny = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2)
    const b = Math.min(n - 1, i + 2)
    const dx = xs[b] - xs[a]
    const dy = ys[b] - ys[a]
    const l = Math.hypot(dx, dy) || 1
    nx[i] = -dy / l
    ny[i] = dx / l
  }
  return {
    x: Float32Array.from(xs),
    y: Float32Array.from(ys),
    nx,
    ny,
    n,
    L: (n - 1) * ds,
    ds
  }
}

/** Puntos de un arco de circunferencia (en unidades), de a0 a a1 (radianes, 0 = derecha, sentido de las agujas). */
export function arcPts(cx, cy, r, a0, a1, step = 14) {
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / step))
  const out = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return out
}

/** Línea recta muestreada (en unidades), para que el Catmull-Rom no la curve. */
export function linePts(x0, y0, x1, y1, step = 20) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step))
  const out = []
  for (let i = 0; i <= n; i++) out.push([lerp(x0, x1, i / n), lerp(y0, y1, i / n)])
  return out
}

/**
 * Una pincelada de cerdas. `s`:
 *   pts (unidades), w (ancho, unidades), color | colors [a, b] (dos tonos que el pincel recoge a la vez),
 *   kind 'flat' (pincel plano: canto recto, cerdas paralelas) | 'round' (pincel redondo: presión y punta),
 *   press(t) (multiplica el ancho; redondo), load(t) (carga; por defecto se gasta hacia el final),
 *   dry (cuánto se seca al final), streak (variación entre cerdas), tooth (cuánto manda el grano en el pincel seco),
 *   mode 'opaque' (gouache) | 'glaze' (tinta / acuarela con pincel), density (para 'glaze'), opacity, body (empaste),
 *   mask(u, v) (0–1, recorte suave), splay (cerdas que se abren al final), wobble (temblor de la mano, unidades).
 */
export function brush(P, s) {
  const { k, N } = P
  const r = rng(s.seed ?? P.rand.int())
  const W = s.w * k
  const wob = (s.wobble ?? 0.6) * k
  const wn = noise1(r.int())
  const pts = s.pts.map(([u, v]) => [u * k, v * k])
  // temblor de la mano: desplaza el trazo a lo largo de la normal con ruido lento
  const path = samplePath(pts, 0.5)
  if (path.n < 2) return
  for (let i = 0; i < path.n; i++) {
    const o = wob * wn(i * 0.5 * 0.012 + 3)
    path.x[i] += path.nx[i] * o
    path.y[i] += path.ny[i] * o
  }
  let bx0 = Infinity
  let by0 = Infinity
  let bx1 = -Infinity
  let by1 = -Infinity
  const pad = W * (0.7 + (s.splay ?? 0)) + 4
  for (let i = 0; i < path.n; i++) {
    bx0 = Math.min(bx0, path.x[i])
    by0 = Math.min(by0, path.y[i])
    bx1 = Math.max(bx1, path.x[i])
    by1 = Math.max(by1, path.y[i])
  }
  bx0 = Math.max(0, Math.floor(bx0 - pad))
  by0 = Math.max(0, Math.floor(by0 - pad))
  bx1 = Math.min(N, Math.ceil(bx1 + pad))
  by1 = Math.min(N, Math.ceil(by1 + pad))
  const bw = bx1 - bx0
  const bh = by1 - by0
  if (bw <= 0 || bh <= 0) return
  const cov = new Float32Array(bw * bh)
  const tone = new Float32Array(bw * bh)
  const flat = (s.kind ?? 'flat') === 'flat'
  const n = s.bristles ?? Math.max(5, Math.round(W / (flat ? 3.2 : 2.6)))
  const dry = s.dry ?? 0.55
  const dryStart = s.dryStart ?? 0.55
  const load = s.load ?? ((t) => 1 - dry * Math.pow(sstep(dryStart, 1.02, t), 1.3))
  const press = s.press ?? (() => 1)
  const streak = s.streak ?? 0.35
  const splay = s.splay ?? 0.15
  const L = path.L
  // las cerdas van en mechones: la carga y el tono cambian por grupos a lo ancho del pincel, más un poco cerda a cerda
  const toneN = noise1(r.int())
  const clumpN = noise1(r.int())
  const widthN = noise1(r.int())
  const toneOff = r() * 50
  const clumps = s.clumps ?? 11
  const feather = s.feather ?? 0.45
  const ragEnd = s.ragEnd ?? 0.12
  const widthVar = s.widthVar ?? 0.06
  const softStart = s.softStart ?? 0
  const side = new Float32Array(bw * bh)
  for (let j = 0; j < n; j++) {
    let o
    if (flat) o = (j + 0.5) / n - 0.5 + (r.gauss() * 0.22) / n
    else {
      // pincel redondo: más cerdas en el centro
      const q = (j + 0.5) / n
      o = 0.5 * Math.sign(q - 0.5) * Math.pow(Math.abs(2 * q - 1), 0.85) + (r.gauss() * 0.3) / n
    }
    const ao = Math.abs(o)
    const rad = Math.max(0.65, (W / n) * (s.bristleR ?? 1.1) * (0.85 + 0.3 * r()))
    let lb = 1 - streak * (0.5 + 0.5 * clumpN((o + 0.5) * clumps)) - (s.hair ?? 0.12) * r()
    // los lados del pincel llevan menos pintura: el borde se deshilacha en el pincel seco
    lb *= 1 - feather * sstep(0.3, 0.5, ao) * (0.4 + 0.6 * r())
    const tn = clamp(0.5 + 0.6 * toneN((o + 0.5) * (s.toneFreq ?? 5) + toneOff) + (s.toneJitter ?? 0.16) * (r() - 0.5))
    // pincel redondo: la punta es redonda, así que las cerdas de los lados tocan el papel un poco después
    const cap = flat ? 0 : Math.min(0.3, (W * (s.capK ?? 0.5)) / L) * (1 - Math.sqrt(Math.max(0, 1 - 4 * ao * ao)))
    const t0 = r() * (s.ragStart ?? 0.012) * (1 + 2 * ao) + cap * press(0)
    // unas cerdas se levantan antes que otras: la cola del trazo sale en hebras
    const t1 = 1 - Math.pow(r(), 0.8) * ragEnd - cap * press(1)
    const ph = r() * 1000
    const bn = noise1(r.int())
    // entrada suave: el pincel se posa sobre pintura fresca y no deja un canto recto
    const entry = softStart * (0.4 + 0.9 * r())
    const stride = Math.max(1, Math.floor((rad * 0.55) / path.ds))
    const ir = Math.ceil(rad + 1)
    for (let m = 0; m < path.n; m += stride) {
      const t = (m * path.ds) / L
      if (t < t0 || t > t1) continue
      const pw = press(t) * (1 + widthVar * widthN(m * path.ds * 0.012 + ph * 0.01))
      if (pw <= 0.01) continue
      const off = o * W * pw * (1 + splay * Math.pow(t, 3) * (1 + 0.5 * bn(ph * 0.1)))
      const x = path.x[m] + path.nx[m] * off - bx0
      const y = path.y[m] + path.ny[m] * off - by0
      // la cerda se va quedando sin pintura al acercarse a su final
      const tail = sstep(t1, t1 - 0.12, t) * (entry ? sstep(t0, t0 + entry, t) : 1)
      const dep = clamp(load(t) * lb * tail * (1 + (s.alongVar ?? 0.18) * bn(ph + m * path.ds * 0.02)))
      if (dep <= 0.01) continue
      const rr = flat ? rad : rad * Math.max(0.5, Math.sqrt(pw))
      const rr2 = rr * rr
      const xi0 = Math.max(0, Math.floor(x - ir))
      const xi1 = Math.min(bw - 1, Math.ceil(x + ir))
      const yi0 = Math.max(0, Math.floor(y - ir))
      const yi1 = Math.min(bh - 1, Math.ceil(y + ir))
      for (let yy = yi0; yy <= yi1; yy++) {
        const dy = yy + 0.5 - y
        for (let xx = xi0; xx <= xi1; xx++) {
          const dx = xx + 0.5 - x
          const d2 = dx * dx + dy * dy
          if (d2 >= rr2) continue
          const val = dep * Math.sqrt(1 - d2 / rr2)
          const li = yy * bw + xx
          if (val > cov[li]) {
            cov[li] = val
            tone[li] = tn
            side[li] = ao
          }
        }
      }
    }
  }
  // en lo mojado la tinta corre entre las huellas de las cerdas: se suaviza la cobertura a escala de cerda
  if (s.flowBlur) {
    const fr = Math.max(1, Math.round(s.flowBlur * k))
    const blurLocal = (src) => {
      const a = Float32Array.from(src)
      const b = new Float32Array(src.length)
      for (let pass = 0; pass < 2; pass++) {
        for (let y = 0; y < bh; y++) {
          let acc = 0
          let cnt = 0
          for (let x = 0; x <= Math.min(bw - 1, fr); x++) {
            acc += a[y * bw + x]
            cnt++
          }
          for (let x = 0; x < bw; x++) {
            b[y * bw + x] = acc / cnt
            if (x + fr + 1 < bw) {
              acc += a[y * bw + x + fr + 1]
              cnt++
            }
            if (x - fr >= 0) {
              acc -= a[y * bw + x - fr]
              cnt--
            }
          }
        }
        for (let x = 0; x < bw; x++) {
          let acc = 0
          let cnt = 0
          for (let y = 0; y <= Math.min(bh - 1, fr); y++) {
            acc += b[y * bw + x]
            cnt++
          }
          for (let y = 0; y < bh; y++) {
            a[y * bw + x] = acc / cnt
            if (y + fr + 1 < bh) {
              acc += b[(y + fr + 1) * bw + x]
              cnt++
            }
            if (y - fr >= 0) {
              acc -= b[(y - fr) * bw + x]
              cnt--
            }
          }
        }
      }
      return a
    }
    const cb = blurLocal(cov)
    // mezcla: donde hay mucha tinta manda lo suavizado; donde casi no hay, quedan las hebras del pincel seco
    for (let li = 0; li < cov.length; li++) {
      const wet = sstep(0.35, 0.75, cb[li])
      cov[li] = lerp(cov[li], Math.max(cov[li], cb[li]), wet)
    }
  }
  // composición
  const H = P.H
  const mode = s.mode ?? 'opaque'
  const colors = (s.colors ?? [s.color, s.color]).map((c) => (typeof c === 'string' ? lin(c) : c))
  const opacity = s.opacity ?? 1
  const tooth = s.tooth ?? 0.4
  const lo = s.dryLo ?? 0.22
  const hi = s.dryHi ?? 0.48
  const body = s.body ?? 1
  const dens = s.density ?? 1
  const ridge = s.ridge ?? 0.8
  const edgeDark = s.edgeDark ?? 0
  const lnA = colors[0].map((c) => Math.log(Math.max(c, 0.0005)))
  const lnB = colors[1].map((c) => Math.log(Math.max(c, 0.0005)))
  for (let yy = 0; yy < bh; yy++) {
    for (let xx = 0; xx < bw; xx++) {
      const li = yy * bw + xx
      const c = cov[li]
      if (c <= 0.004) continue
      const i = (yy + by0) * N + xx + bx0
      let a = sstep(lo, hi, c + tooth * (H[i] - 0.5))
      if (s.mask) a *= s.mask((xx + bx0 + 0.5) / k, (yy + by0 + 0.5) / k, i)
      a *= opacity
      if (a <= 0.002) continue
      const tn = tone[li]
      if (mode === 'opaque') {
        const col = mixc(colors[0], colors[1], tn)
        // donde la capa es fina se transparenta un poco lo de debajo
        const ao = a * (0.8 + 0.2 * c)
        P.R[i] += (col[0] - P.R[i]) * ao
        P.G[i] += (col[1] - P.G[i]) * ao
        P.B[i] += (col[2] - P.B[i]) * ao
        // la pintura que el pincel empuja hacia los lados forma una cresta
        P.T[i] += a * c * body * (1 + ridge * sstep(0.32, 0.47, side[li]))
      } else {
        // la tinta se acumula en los bordes del trazo
        const D = a * dens * (0.65 + 0.5 * c) * (1 + edgeDark * sstep(0.3, 0.48, side[li]))
        P.R[i] *= Math.exp(lerp(lnA[0], lnB[0], tn) * D)
        P.G[i] *= Math.exp(lerp(lnA[1], lnB[1], tn) * D)
        P.B[i] *= Math.exp(lerp(lnA[2], lnB[2], tn) * D)
        P.T[i] += a * c * body * 0.3
      }
    }
  }
}

// ── Lápiz y tinta ────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Línea de lápiz: varias pasadas un poco desplazadas, con sobretrazo en los extremos; el grafito solo se queda en las
 * crestas del papel.
 */
export function pencil(
  P,
  pts,
  { weight = 0.5, color = '#5B5148', width = 1.4, passes = 2, overshoot = 10, seed } = {}
) {
  const r = rng(seed ?? P.rand.int())
  const c = lin(color)
  const { k, N, H } = P
  for (let pass = 0; pass < passes; pass++) {
    const jx = r.gauss() * 1.2
    const jy = r.gauss() * 1.2
    // sobretrazo: prolonga los extremos
    const a = pts[0]
    const b = pts[1]
    const y = pts[pts.length - 1]
    const z = pts[pts.length - 2]
    const ext = (p, q, l) => {
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1
      return [p[0] + ((p[0] - q[0]) / d) * l, p[1] + ((p[1] - q[1]) / d) * l]
    }
    const pp = [ext(a, b, overshoot * r()), ...pts, ext(y, z, overshoot * r())].map(([u, v]) => [
      (u + jx) * k,
      (v + jy) * k
    ])
    const path = samplePath(pp, 0.6)
    const wn = noise1(r.int())
    const rad = Math.max(0.6, (width * k) / 2)
    const ir = Math.ceil(rad + 1)
    for (let m = 0; m < path.n; m++) {
      const t = m / path.n
      const p = weight * (0.55 + 0.45 * Math.sin(Math.PI * t)) * (0.75 + 0.25 * wn(m * 0.02)) * (pass ? 0.6 : 1)
      const x = path.x[m] + path.nx[m] * wn(m * 0.01 + 50) * k * 0.5
      const yv = path.y[m] + path.ny[m] * wn(m * 0.01 + 50) * k * 0.5
      for (let yy = Math.max(0, Math.floor(yv - ir)); yy <= Math.min(N - 1, Math.ceil(yv + ir)); yy++) {
        for (let xx = Math.max(0, Math.floor(x - ir)); xx <= Math.min(N - 1, Math.ceil(x + ir)); xx++) {
          const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - yv)
          if (d >= rad) continue
          const i = yy * N + xx
          const g = sstep(0.38, 0.72, H[i])
          const al = p * (1 - d / rad) * g * 0.34
          P.R[i] += (c[0] - P.R[i]) * al
          P.G[i] += (c[1] - P.G[i]) * al
          P.B[i] += (c[2] - P.B[i]) * al
        }
      }
    }
  }
}

/**
 * Trazo de plumilla o pincel fino: ancho según la presión (`press(t)`), la tinta se acumula un poco al empezar y al
 * acabar y, si va rápido (`dry`), se abre en las crestas. Es una veladura muy densa (la tinta superpuesta oscurece).
 */
export function ink(
  P,
  pts,
  {
    w = 3,
    color = '#2B1D14',
    press = (t) => 0.7 + 0.3 * Math.sin(Math.PI * t),
    density = 2.4,
    dry = 0.15,
    wobble = 0.5,
    drift = 1.2,
    nib = 0.55,
    seed,
    mask
  } = {}
) {
  const r = rng(seed ?? P.rand.int())
  const { k, N, H } = P
  const T = lin(color).map((c) => Math.log(Math.max(c, 0.0005)))
  const path = samplePath(
    pts.map(([u, v]) => [u * k, v * k]),
    0.4
  )
  if (path.n < 2) return
  const wn = noise1(r.int())
  const dn = noise1(r.int())
  const bleed = field(P, { freq: 1 / 1.6, oct: 2, seed: 77 })
  const ph = r() * 100
  // cobertura propia del trazo (máximo, para que los sellos no se sumen)
  let bx0 = Infinity
  let by0 = Infinity
  let bx1 = -Infinity
  let by1 = -Infinity
  for (let i = 0; i < path.n; i++) {
    bx0 = Math.min(bx0, path.x[i])
    by0 = Math.min(by0, path.y[i])
    bx1 = Math.max(bx1, path.x[i])
    by1 = Math.max(by1, path.y[i])
  }
  const pad = w * k + 4
  bx0 = Math.max(0, Math.floor(bx0 - pad))
  by0 = Math.max(0, Math.floor(by0 - pad))
  bx1 = Math.min(N, Math.ceil(bx1 + pad))
  by1 = Math.min(N, Math.ceil(by1 + pad))
  const bw = bx1 - bx0
  const bh = by1 - by0
  if (bw <= 0 || bh <= 0) return
  const cov = new Float32Array(bw * bh)
  for (let m = 0; m < path.n; m++) {
    const t = m / (path.n - 1)
    const pool = 1 + 0.35 * Math.exp(-t * 40) + 0.25 * Math.exp(-(1 - t) * 40)
    // plumilla flexible: se abre al bajar (trazo grueso) y se cierra al subir o ir de lado (fino)
    const down = sstep(-0.3, 0.9, -path.nx[m])
    const nibW = 1 - nib + nib * (0.3 + 0.9 * down)
    const rad = Math.max(0.45, ((w * k) / 2) * press(t) * nibW * pool * (1 + 0.12 * wn(m * 0.03 + ph)))
    // temblor fino y deriva lenta de la mano
    const o = wobble * k * wn(m * 0.004 + ph + 9) + drift * k * dn(m * 0.0011 + ph)
    const x = path.x[m] + path.nx[m] * o - bx0
    const y = path.y[m] + path.ny[m] * o - by0
    const ir = Math.ceil(rad + 1.5)
    for (let yy = Math.max(0, Math.floor(y - ir)); yy <= Math.min(bh - 1, Math.ceil(y + ir)); yy++) {
      for (let xx = Math.max(0, Math.floor(x - ir)); xx <= Math.min(bw - 1, Math.ceil(x + ir)); xx++) {
        const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y)
        const val = clamp(rad + 0.6 - d) // borde antialias de ~1 px
        const li = yy * bw + xx
        if (val > cov[li]) cov[li] = val
      }
    }
  }
  for (let yy = 0; yy < bh; yy++) {
    for (let xx = 0; xx < bw; xx++) {
      const c = cov[yy * bw + xx]
      if (c <= 0.003) continue
      const i = (yy + by0) * N + xx + bx0
      // pluma seca: en algunos puntos la tinta no llega a los valles
      let a = c * (1 - dry * sstep(0.62, 0.3, H[i]) * (0.5 + 0.5 * bleed[i]))
      if (mask) a *= mask((xx + bx0 + 0.5) / k, (yy + by0 + 0.5) / k)
      const D = a * density
      P.R[i] *= Math.exp(T[0] * D)
      P.G[i] *= Math.exp(T[1] * D)
      P.B[i] *= Math.exp(T[2] * D)
    }
  }
}

// ── Formas (distancias con signo, en unidades) ───────────────────────────────────────────────────────────────────────
/** Puerta en arco de medio punto: centro x, clave `top`, ancho `w`, base `bottom`. */
export function sdArch(u, v, cx, top, w, bottom) {
  const r = w / 2
  const cy = top + r
  if (v < cy) return Math.max(Math.hypot(u - cx, v - cy) - r, v - bottom)
  return Math.max(Math.abs(u - cx) - r, v - bottom)
}
export const sdCircle = (u, v, cx, cy, r) => Math.hypot(u - cx, v - cy) - r
export const sdBox = (u, v, x0, y0, x1, y1) => {
  const dx = Math.max(x0 - u, u - x1)
  const dy = Math.max(y0 - v, v - y1)
  return dx > 0 && dy > 0 ? Math.hypot(dx, dy) : Math.max(dx, dy)
}

/** Unión de cajas [x0, y0, x1, y1] (distancia con signo). */
export const sdBoxes = (u, v, boxes) => {
  let d = Infinity
  for (const b of boxes) d = Math.min(d, sdBox(u, v, b[0], b[1], b[2], b[3]))
  return d
}

/**
 * Máscara de una forma recortada a mano: el borde de `sdf` se tuerce un poco (la mano no es un vector) y se suaviza
 * `soft` unidades. Devuelve una función (u, v, i) → 0–1 para los pinceles.
 */
export function handMask(P, sdf, { wobble = 1.2, soft = 0.7, seed = 0, freq = 1 / 26 } = {}) {
  const a = field(P, { freq, oct: 3, seed: seed + 401 })
  const b = field(P, { freq: freq * 4, oct: 2, seed: seed + 402 })
  return (u, v, i) => sstep(soft, -soft, sdf(u, v) + wobble * (0.75 * a[i] + 0.25 * b[i]))
}

/**
 * Rellena una región con pinceladas paralelas (en filas, ángulo `angle`), cada una de un tono de `colors(t, u, v)`, y
 * la recorta con `mask`. Así pinta un ilustrador una forma plana: con el pincel, por dentro y cortando el borde.
 */
export function fillRegion(P, { bbox, mask, w, angle = 0, gap = 0.62, len = [120, 240], colors, seed, ...rest }) {
  const r = rng(seed ?? P.rand.int())
  const [x0, y0, x1, y1] = bbox
  const ca = Math.cos(angle)
  const sa = Math.sin(angle)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const R = Math.hypot(x1 - x0, y1 - y0) / 2 + w
  for (let q = -R; q <= R; q += w * gap) {
    let p = -R - r() * len[0]
    while (p < R) {
      const l = r.range(len[0], len[1])
      const pa = [cx + ca * p - sa * q, cy + sa * p + ca * q]
      const pb = [
        cx + ca * (p + l) - sa * (q + r.gauss() * w * 0.06),
        cy + sa * (p + l) + ca * (q + r.gauss() * w * 0.06)
      ]
      const mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2]
      // fuera de la caja no hace falta pintar
      if (mid[0] > x0 - l && mid[0] < x1 + l && mid[1] > y0 - w && mid[1] < y1 + w) {
        const [c0, c1] = colors(r(), mid[0], mid[1])
        const pts = linePts(pa[0], pa[1], pb[0], pb[1], 10)
        brush(P, {
          pts: r() < 0.5 ? pts : pts.reverse(),
          w: w * r.range(0.92, 1.08),
          colors: [c0, c1],
          mask,
          seed: r.int(),
          ...rest
        })
      }
      p += l * r.range(0.6, 0.85)
    }
  }
}

/** Un lienzo 2D: <canvas> en una página, OffscreenCanvas en un worker (p. ej. el compositor de la película). */
export function makeCanvas(w, h = w) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  return new OffscreenCanvas(w, h)
}

// ── Volcado ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Pasa el lienzo (lineal) a un <canvas> sRGB. */
export function toCanvas(P) {
  const { N } = P
  const c = makeCanvas(N)
  const g = c.getContext('2d')
  const img = g.createImageData(N, N)
  const d = img.data
  // tabla para la conversión (rápida y sin bandas)
  const LUT = new Uint8ClampedArray(4097)
  for (let i = 0; i <= 4096; i++) LUT[i] = Math.round(toSrgb(i / 4096) * 255)
  for (let i = 0; i < N * N; i++) {
    d[i * 4] = LUT[Math.round(clamp(P.R[i]) * 4096)]
    d[i * 4 + 1] = LUT[Math.round(clamp(P.G[i]) * 4096)]
    d[i * 4 + 2] = LUT[Math.round(clamp(P.B[i]) * 4096)]
    d[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
  return c
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// La escena: el arco del icono actual (C), la puerta y el sol que sale.

/** Geometría del arco según el detalle (en ≤ 32 px, más grande y con menos piezas). */
export function scene(detail) {
  const small = detail === 'small'
  const outer = small ? { w: 612, top: 92, bottom: 730 } : { w: 540, top: 118, bottom: 708 }
  const t = small ? 150 : 116
  const inner = {
    w: outer.w - 2 * t,
    top: outer.top + t,
    bottom: outer.bottom
  }
  const rO = outer.w / 2
  const rI = inner.w / 2
  const cy = outer.top + rO // el centro del arco es el mismo para las dos curvas
  return {
    small,
    outer,
    inner,
    t,
    rO,
    rI,
    cy,
    cx: CX,
    bottom: outer.bottom,
    /** distancia con signo al anillo del arco */
    ring: (u, v) =>
      Math.max(
        sdArch(u, v, CX, outer.top, outer.w, outer.bottom),
        -sdArch(u, v, CX, inner.top, inner.w, inner.bottom + 400)
      ),
    door: (u, v) => sdArch(u, v, CX, inner.top, inner.w, inner.bottom)
  }
}

/**
 * Recorrido de un «carril» del arco a distancia `d` del intradós: pierna izquierda de abajo arriba, la curva y la
 * pierna derecha hacia abajo. Devuelve los puntos y una función para cortar tramos por longitud.
 */
function laneSpan(S, d, from, to, over = 0) {
  const rr = S.rI + d
  const legL = S.bottom - S.cy + over
  const arcL = Math.PI * rr
  const total = 2 * legL + arcL
  const at = (s) => {
    if (s <= legL) return [S.cx - rr, S.bottom + over - s]
    if (s <= legL + arcL) {
      const a = Math.PI + (s - legL) / rr
      return [S.cx + Math.cos(a) * rr, S.cy + Math.sin(a) * rr]
    }
    return [S.cx + rr, S.cy + (s - legL - arcL)]
  }
  const a = clamp(from, 0, 1) * total
  const b = clamp(to, 0, 1) * total
  const n = Math.max(2, Math.ceil(Math.abs(b - a) / 12))
  const pts = []
  for (let i = 0; i <= n; i++) pts.push(at(lerp(a, b, i / n)))
  return pts
}

/** Medio sol de «píxeles»: filas de abajo arriba (celdas). */
const SUN_ROWS = [12, 12, 10, 10, 8, 6]

function pixelCells(S, cell) {
  const cells = []
  SUN_ROWS.forEach((wd, j) => {
    for (let i = 0; i < wd; i++) {
      const cx = -wd / 2 + i + 0.5
      const cy = j + 0.5
      const d = Math.hypot(cx, cy)
      cells.push({
        x: S.cx + (cx - 0.5) * cell,
        y: S.bottom - (j + 1) * cell,
        d,
        i,
        j,
        wd
      })
    }
  })
  return cells
}

// Paleta «Papel y luz» (styles.css e icon-art.mjs)
const C = {
  paper: '#F6EFE2',
  brick: '#B4502F',
  brickLight: '#C9653F',
  brickDark: '#A2452A',
  brickDeep: '#8A3A20',
  brickNight: '#5E2715',
  door0: '#4E1F10',
  door1: '#7A3018',
  door2: '#9A4226',
  door3: '#D9784C',
  sun: '#F2C275',
  sunMid: '#FAD99A',
  sunCore: '#FFF0CF',
  cream: '#FBF6EC',
  creamLight: '#FFFDF8',
  creamShade: '#EDE0CB',
  creamDeep: '#DCC6A6'
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 1 · GOUACHE: pintura densa y opaca, pinceladas planas con dirección y empaste. El sol de píxeles pintado como lo haría
// un ilustrador: cada tramo de «píxeles» del mismo tono, una pincelada corta de pincel plano.
function gouache(P, { detail, sun = true }) {
  const S = scene(detail)
  const small = detail === 'small'
  const r = rng(P.seed + 101)
  const lr = lin
  paper(P, { color: C.paper, seed: 3 })
  // 0. imprimación: una aguada de ladrillo tiñe el papel (lo que asome entre pinceladas ya es cálido, no blanco)
  wash(P, {
    sdf: () => -100,
    color: '#BC5E3B',
    density: 1,
    edge: 0,
    soft: 0.5,
    softVar: 0,
    wet: 0,
    gran: 0.6,
    flow: 0.35,
    seed: 31
  })
  // 1. la pared de ladrillo: brochazos anchos casi horizontales y una segunda capa más suelta (luz arriba, hondo abajo)
  const brickRamp = [lr('#CF6E45'), lr('#C46039'), lr(C.brick), lr('#A9492B'), lr('#9A4127')]
  for (let pass = 0; pass < 2; pass++) {
    const w = small ? 150 : pass ? 74 : 96
    const gap = small ? 110 : pass ? 78 : 62
    for (let y = -40; y < BOX + 60; y += gap) {
      let x = -60 - r() * 160
      while (x < BOX + 40) {
        const len = small ? 720 : r.range(220, 420)
        const ang = -0.04 + r.gauss() * (pass ? 0.13 : 0.05)
        const yy = y + r.gauss() * (pass ? 22 : 8)
        const x1 = x + Math.cos(ang) * len
        const y1 = yy + Math.sin(ang) * len
        const tv = clamp((yy + y1) / 2 / BOX + r.gauss() * 0.13)
        const c0 = ramp(brickRamp, tv)
        const c1 = ramp(brickRamp, clamp(tv + r.gauss() * 0.16))
        const mid = [(x + x1) / 2 + r.gauss() * 6, (yy + y1) / 2 + r.gauss() * 7]
        const pts = r() < 0.5 ? [[x1, y1], mid, [x, yy]] : [[x, yy], mid, [x1, y1]]
        brush(P, {
          pts,
          w: w * r.range(0.85, 1.15),
          colors: [c0, c1],
          opacity: pass ? r.range(0.5, 0.8) : 0.95,
          dry: pass ? 0.85 : 0.55,
          dryStart: pass ? 0.4 : 0.6,
          tooth: 0.5,
          body: pass ? 0.9 : 0.6,
          streak: 0.45,
          wobble: 2,
          softStart: pass ? 0.12 : 0.06
        })
        x += len * r.range(0.55, 0.8)
      }
    }
  }
  // 2. la sombra que el arco arroja en la pared (abajo a la derecha): veladura de ladrillo hondo
  if (!small)
    wash(P, {
      sdf: (u, v) => Math.max(S.ring(u - 15, v - 18), -S.ring(u, v) - 2),
      color: '#9A4A33',
      density: 0.8,
      edge: 3,
      soft: 3,
      softVar: 8,
      wet: 0.25,
      gran: 0.3,
      seed: 21
    })
  // 3. la puerta: oscura arriba y junto al arco, se enciende hacia el sol (un solo color en varios valores)
  const doorMask = (u, v) => sstep(2, -2, S.door(u, v) - 5)
  const lightAt = (u, v) => clamp(1 - Math.hypot(u - S.cx, (v - S.bottom) * 1.1) / (S.rI * 2.35))
  wash(P, {
    sdf: (u, v) => S.door(u, v) - 5,
    bbox: [S.cx - S.rI - 20, S.inner.top - 20, S.cx + S.rI + 20, S.bottom + 10],
    color: C.door1,
    density: (u, v) => 0.3 + 0.9 * (1 - lightAt(u, v)),
    edge: 1,
    soft: 1,
    softVar: 1,
    wet: 0.2,
    gran: 0.4,
    seed: 41
  })
  const doorRamp = [lr(C.door0), lr(C.door1), lr(C.door2), lr('#BC5E36'), lr(C.door3), lr('#E58E5E')]
  // como un cielo en gouache: pasadas horizontales de ida y vuelta, de lo oscuro a lo claro, fundiendo en fresco
  const dStrokes = []
  const rowH = small ? 34 : 15
  for (let v = S.inner.top - 6; v < S.bottom + 6; v += rowH) {
    const half = (v < S.cy ? Math.sqrt(Math.max(0, S.rI ** 2 - (S.cy - v) ** 2)) : S.rI) + 16
    let u = S.cx - half - r() * 40
    while (u < S.cx + half) {
      const len = small ? 2 * half + 60 : r.range(90, 200)
      const uu = u + len / 2
      const vv = v + r.gauss() * 5
      const t = clamp(lightAt(uu, vv) * 1.05 + r.gauss() * 0.05)
      dStrokes.push({ u: uu, v: vv, len, ang: r.gauss() * 0.06, t })
      u += len * r.range(0.5, 0.8)
    }
  }
  dStrokes.sort((a, b) => a.t - b.t + (r() - 0.5) * 0.08)
  for (const d of dStrokes) {
    const dx = (Math.cos(d.ang) * d.len) / 2
    const dy = (Math.sin(d.ang) * d.len) / 2
    const pts = [
      [d.u - dx, d.v - dy],
      [d.u + r.gauss() * 3, d.v + r.gauss() * 2],
      [d.u + dx, d.v + dy]
    ]
    brush(P, {
      pts: r() < 0.5 ? pts : pts.reverse(),
      w: small ? 60 : r.range(30, 40),
      colors: [ramp(doorRamp, d.t), ramp(doorRamp, clamp(d.t + r.gauss() * 0.07))],
      opacity: r.range(0.55, 0.85),
      dry: 0.75,
      dryStart: 0.4,
      tooth: 0.35,
      mask: doorMask,
      body: 0.6,
      wobble: 1.2,
      softStart: 0.12
    })
  }
  // 4. el sol: medio sol de píxeles pintado como lo haría un ilustrador: cada tono es una forma escalonada (alineada
  //    a la rejilla de píxeles, con el pulso de la mano en el borde) rellena con pinceladas cortas
  const cell = small ? 30 : 23
  if (sun) {
    // el sol tiene su propio azar: sin él (prólogo de la película) el resto del cuadro sale idéntico
    const rs = rng(P.seed + 777)
    const tones = [lr(C.sun), lr(C.sunMid), lr(C.sunCore)]
    const alts = [lr('#F6CE8A'), lr('#FCE2AE'), lr('#FFF8E8')]
    const cells = pixelCells(S, cell)
    const level = (d) => (d < 2.4 ? 2 : d < 4.2 ? 1 : 0)
    for (let L = 0; L < 3; L++) {
      const boxes = []
      for (let j = 0; j < SUN_ROWS.length; j++) {
        const row = cells.filter((c) => c.j === j && level(c.d) >= L)
        if (!row.length) continue
        const xs = row.map((c) => c.x)
        boxes.push([Math.min(...xs), row[0].y, Math.max(...xs) + cell, row[0].y + cell + (j === 0 ? 6 : 0.5)])
      }
      const bb = [
        Math.min(...boxes.map((b) => b[0])),
        Math.min(...boxes.map((b) => b[1])),
        Math.max(...boxes.map((b) => b[2])),
        Math.max(...boxes.map((b) => b[3]))
      ]
      fillRegion(P, {
        bbox: bb,
        mask: handMask(P, (u, v) => sdBoxes(u, v, boxes), {
          wobble: small ? 0.3 : 1.1,
          soft: 0.6,
          seed: 10 + L
        }),
        seed: rs.int(),
        w: small ? 30 : 17,
        angle: rs.gauss() * 0.04,
        len: [50, 110],
        colors: () => [tones[L], alts[L]],
        dry: 0.3,
        dryStart: 0.7,
        softStart: 0.1,
        tooth: 0.25,
        body: 0.7,
        ridge: 0.3,
        streak: 0.25,
        wobble: 0.4
      })
    }
    // rayos y estrellas: «píxeles» sueltos, cada uno un toque de pincel recortado en cuadrado
    if (!small) {
      // (los rayos de 164° y 16° quedarían bajo el arco)
      const dots = [128, 90, 52].map((deg) => {
        const R = 7.7 * cell
        return [S.cx + Math.cos(rad(deg)) * R - cell / 2, S.bottom - Math.sin(rad(deg)) * R - cell / 2, cell, C.sunMid]
      })
      dots.push(
        ...[
          [-4.6, 14.2, 0.7],
          [3.6, 15.6, 0.55]
        ].map(([i, j, sz]) => [S.cx + i * cell, S.bottom - j * cell, cell * sz, C.sunCore])
      )
      dots.forEach(([x, y, sz, col], n) => {
        fillRegion(P, {
          bbox: [x, y, x + sz, y + sz],
          mask: handMask(P, (u, v) => sdBox(u, v, x, y, x + sz, y + sz), {
            wobble: 0.8,
            soft: 0.6,
            seed: 30 + n
          }),
          seed: rs.int(),
          w: sz * 0.75,
          gap: 0.6,
          len: [sz * 1.6, sz * 2],
          colors: () => [lr(col), lr(C.sunCore)],
          dry: 0.2,
          tooth: 0.2,
          body: 0,
          ridge: 0
        })
      })
    }
  }
  // 5. el umbral: una pincelada de ladrillo bajo la puerta que deja limpia la base del sol
  brush(P, {
    pts: linePts(S.cx - S.rI - 30, S.bottom + 24, S.cx + S.rI + 30, S.bottom + 24, 20),
    w: 44,
    colors: [lr('#A3462A'), lr('#AE4D2E')],
    dry: 0.4,
    body: 0.7,
    wobble: 0.6
  })
  // 6. el arco: el canto en sombra bajo el intradós y, encima, carriles de crema que siguen la curva
  const ringMask = (u, v) => sstep(2.5, -1.5, S.ring(u, v) - 2)
  const archLight = lr('#FFF9EE')
  const archMid = lr('#F8EEDB')
  const archShade = lr('#EADABF')
  if (!small)
    brush(P, {
      pts: arcPts(S.cx, S.cy + 10, S.rI + 1, Math.PI * 1.0, Math.PI * 2.0, 8),
      w: 22,
      colors: [lr('#D8C09C'), lr('#CDB38F')],
      dry: 0.3,
      press: (t) => 0.25 + 0.75 * Math.sin(Math.PI * t),
      kind: 'round',
      body: 0.8,
      mask: (u, v) => sstep(-1, 1, S.ring(u, v))
    })
  const lanes = small ? 2 : 3
  const bw = (S.t / lanes) * 1.5
  // tono a lo largo del arco (luz de arriba a la izquierda): la pierna derecha y el intradós, un poco en sombra
  const archTone = (s) => mixc(mixc(archLight, archMid, 0.5), archShade, clamp(sstep(0.42, 0.95, s) * 0.85))
  // por carril: las dos piernas desde abajo (el canto del pincel deja la base limpia) y la curva encima, cubriendo
  // las juntas; la última pincelada de cada carril se seca al final y deja hebras
  const pieces = [
    [0, 0.36, 'up'],
    [0.64, 1, 'down'],
    [0.24, 0.76, 'any']
  ]
  for (let q = 0; q < lanes; q++) {
    const d = bw / 2 + ((S.t - bw) * q) / (lanes - 1)
    for (const [a0, a1, how] of pieces) {
      const j0 = how === 'up' ? 0 : a0 + r.gauss() * 0.02
      const j1 = how === 'down' ? 1 : a1 + r.gauss() * 0.02
      let pts = laneSpan(S, d + r.gauss() * 1.2, j0, j1, 10)
      if (how === 'down' || (how === 'any' && r() < 0.5)) pts = pts.reverse()
      const c0 = mixc(archTone((j0 + j1) / 2), archShade, q === 0 ? 0.12 : 0)
      const c1 = mixc(c0, r() < 0.5 ? archLight : lr('#F3E5CA'), 0.55)
      brush(P, {
        pts,
        w: bw * r.range(0.96, 1.04),
        colors: [c0, c1],
        dry: small ? 0.15 : how === 'any' ? 0.6 : 0.35,
        dryStart: 0.75,
        opacity: 0.97,
        mask: q === lanes - 1 ? (u, v) => sstep(4, -1, S.ring(u, v) - 2) : ringMask,
        tooth: 0.3,
        body: 1.1,
        ridge: 0.5,
        wobble: 1,
        ragStart: 0.004,
        softStart: how === 'any' ? 0.07 : 0,
        splay: 0.05
      })
    }
  }
  relief(P, {
    tooth: small ? 0.015 : 0.05,
    impasto: small ? 0 : 0.45,
    blur: 2.5
  })
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 2 · ACUARELA: transparente y ligera. El arco es el blanco del papel (reservado, sin pintar); la pared, dos veladuras
// de ladrillo que granulan y dejan borde húmedo; la puerta, una aguada que se aclara hasta dejar el papel encendido
// alrededor del sol. Debajo se ve el dibujo a lápiz. Las estrellas, toques de gouache blanca.
function watercolor(P, { detail, sun = true }) {
  const S = scene(detail)
  const small = detail === 'small'
  const r = rng(P.seed + 202)
  const lr = lin
  paper(P, { color: '#F8F2E6', grain: small ? 0.6 : 1.25, cell: 10, seed: 5 })
  const outerArch = (u, v) => sdArch(u, v, CX, S.outer.top, S.outer.w, S.outer.bottom)
  const sunR = small ? 132 : 112
  const sunD = (u, v) => Math.hypot(u - S.cx, v - S.bottom)
  // 1. el dibujo a lápiz: contornos del arco, el umbral y el sol (con sobretrazo y alguna línea de encaje)
  if (!small) {
    const g = { weight: 1, width: 1.7 }
    // el pintor pinta un pelo por fuera de la línea: el lápiz queda a la vista sobre el papel reservado
    for (const d of [4, S.t - 4])
      pencil(P, laneSpan(S, d + r.gauss() * 1.2, 0, 1, 0), {
        ...g,
        overshoot: 14
      })
    pencil(P, arcPts(S.cx, S.bottom, sunR + 9, Math.PI * 1.02, Math.PI * 1.98, 10), { ...g, weight: 0.7 })
    // líneas de encaje: el eje, que cruza la clave, y la línea de arranque del arco sobre la pierna izquierda
    pencil(P, linePts(S.cx + 1, S.outer.top - 14, S.cx - 1, S.inner.top + 10, 10), {
      weight: 0.6,
      width: 1.3,
      passes: 1
    })
    pencil(P, linePts(S.cx - S.rO + 6, S.cy + 2, S.cx - S.rI - 6, S.cy - 1, 20), { weight: 0.5, width: 1.3, passes: 1 })
  }
  // 2. la pared: primera veladura de ladrillo (todo menos el arco y la puerta), con flores en dos sitios
  wash(P, {
    sdf: (u, v) => -outerArch(u, v),
    color: '#C25F38',
    density: (u, v) => 0.95 + 0.35 * (v / BOX),
    edge: small ? 1.5 : 4.5,
    edgeFreq: 1 / 50,
    rough: 0.1,
    soft: 0.8,
    softVar: small ? 0.5 : 1.4,
    wet: 0.9,
    wetWidth: 2.4,
    gran: small ? 0.1 : 0.45,
    speck: small ? 0.02 : 0.06,
    flow: 0.32,
    flowFreq: 1 / 80,
    blooms: small
      ? []
      : [
          { x: 150, y: 260, r: 62, k: 0.35 },
          { x: 690, y: 790, r: 74, k: 0.3 }
        ],
    seed: 51
  })
  // segunda veladura: hondo en lo bajo y a la derecha, con el borde perdido hacia arriba; y la sombra del arco
  if (!small) {
    wash(P, {
      sdf: (u, v) => Math.max(-outerArch(u, v), 520 - v - 0.35 * u + 40 * Math.sin(u / 90)),
      color: '#A9482A',
      density: 0.5,
      edge: 14,
      edgeFreq: 1 / 70,
      soft: 4,
      softVar: 26,
      wet: 0.6,
      gran: 0.5,
      flow: 0.4,
      seed: 52
    })
    wash(P, {
      sdf: (u, v) => Math.max(sdArch(u - 15, v - 18, CX, S.outer.top, S.outer.w, S.outer.bottom), -outerArch(u, v)),
      color: '#8E3B22',
      density: 0.6,
      edge: 3,
      soft: 1,
      softVar: 6,
      wet: 0.8,
      gran: 0.4,
      seed: 53
    })
  }
  // 3. la puerta: aguada de ladrillo hondo, densa arriba, que se pierde hacia el sol y deja papel limpio a su alrededor
  const lightAt = (u, v) => clamp(1 - sunD(u, v * 1.0) / (S.rI * 2.4))
  const crown = small ? 0 : 15
  wash(P, {
    sdf: (u, v) => sdArch(u, v, CX, S.inner.top + crown, S.inner.w, S.inner.bottom),
    bbox: [S.cx - S.rI - 20, S.inner.top - 10, S.cx + S.rI + 20, S.bottom + 10],
    color: '#7E3219',
    density: (u, v) =>
      (0.12 + 1.75 * Math.pow(1 - lightAt(u, v), 1.25)) * (sun ? sstep(sunR + 4, sunR + 40, sunD(u, v)) : 1),
    edge: small ? 1 : 2.5,
    soft: 0.8,
    softVar: 2,
    wet: 0.8,
    wetWidth: 2.5,
    gran: small ? 0.15 : 0.4,
    flow: 0.35,
    seed: 54
  })
  // el canto del arco bajo la clave: un gris cálido muy suave (el papel tiene grosor)
  if (!small)
    wash(P, {
      sdf: (u, v) => Math.max(S.door(u, v), -sdArch(u, v, CX, S.inner.top + crown, S.inner.w, S.inner.bottom)),
      color: '#B49477',
      density: 0.55,
      edge: 1,
      soft: 0.6,
      softVar: 0.6,
      wet: 0.6,
      gran: 0.5,
      seed: 55
    })
  // 4. el sol: amarillo sobre papel blanco, con su borde húmedo, y un halo pálido que se funde
  if (sun) {
    if (!small)
      wash(P, {
        sdf: (u, v) => Math.max(sunD(u, v) - sunR * 1.55, v - S.bottom, S.door(u, v)),
        color: '#F7D9A0',
        density: 0.55,
        edge: 6,
        soft: 6,
        softVar: 14,
        wet: 0,
        gran: 0.2,
        seed: 56
      })
    wash(P, {
      sdf: (u, v) => Math.max(sunD(u, v) - sunR, v - S.bottom),
      color: '#F2B954',
      density: (u, v) => 0.75 + 0.35 * clamp(sunD(u, v) / sunR),
      edge: small ? 1 : 2.2,
      edgeFreq: 1 / 30,
      soft: 0.7,
      softVar: 1.5,
      wet: 0.9,
      wetWidth: 2.2,
      gran: 0.3,
      flow: 0.25,
      seed: 57
    })
  }
  // 5. la sombra del arco: crece a lo largo de la curva hacia la pierna derecha (la luz viene de arriba a la izquierda)
  const along = (u, v) => (v >= S.cy ? (u < S.cx ? 0 : 1) : 1 - Math.atan2(S.cy - v, u - S.cx) / Math.PI)
  if (!small)
    wash(P, {
      sdf: (u, v) => S.ring(u, v) - 1,
      bbox: [S.cx - S.rO - 10, S.outer.top - 10, S.cx + S.rO + 10, S.bottom + 10],
      color: '#CDB79C',
      density: (u, v) => 0.55 * sstep(0.45, 0.85, along(u, v)) * (0.75 + 0.25 * sstep(S.cx + S.rI, S.cx + S.rO, u)),
      edge: 2,
      soft: 0.8,
      softVar: 2,
      wet: 0.5,
      gran: 0.3,
      seed: 58
    })
  // 6. estrellas de píxel en gouache blanca, y unas salpicaduras
  if (!small) {
    const cell = 22
    ;[
      [-4.2, 13.6, 0.8],
      [3.2, 15.4, 0.6],
      [4.4, 11.4, 0.7],
      [-2.4, 9.2, 0.5]
    ].forEach(([i, j, sz], n) => {
      const x = S.cx + i * cell
      const y = S.bottom - j * cell
      const s = cell * sz
      fillRegion(P, {
        bbox: [x, y, x + s, y + s],
        mask: handMask(P, (u, v) => sdBox(u, v, x, y, x + s, y + s), {
          wobble: 0.9,
          soft: 0.6,
          seed: 60 + n
        }),
        w: s * 0.8,
        len: [s * 1.6, s * 2],
        colors: () => [lr('#FFF9EE'), lr('#FFF3DA')],
        dry: 0.2,
        tooth: 0.3,
        body: 0,
        ridge: 0
      })
    })
    for (let q = 0; q < 14; q++) {
      const x = r.range(560, 800)
      const y = r.range(720, 820)
      const rr = Math.pow(r(), 2.2) * 5 + 0.8
      wash(P, {
        sdf: (u, v) => sdCircle(u, v, x, y, rr),
        bbox: [x - rr - 8, y - rr - 8, x + rr + 8, y + rr + 8],
        color: '#9E4126',
        density: 0.9,
        edge: rr * 0.25,
        edgeFreq: 1 / 3,
        soft: 0.4,
        softVar: 0.3,
        wet: 1.2,
        wetWidth: 0.8,
        gran: 0.4,
        seed: 70
      })
    }
  }
  relief(P, { tooth: small ? 0.03 : 0.1 })
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 3 · TINTA Y AGUADA: primero aguadas sueltas (un poco desplazadas de la línea, como hace un ilustrador con prisa) y
// encima el dibujo a plumilla en tinta sepia: contornos con presión, rayado en lo alto de la puerta y en la sombra, y
// unas hiladas de ladrillo sugeridas en la pared. Las estrellas son papel reservado.

/** Segmentos de una recta (punto, dirección) que quedan dentro de una máscara (función ≤ 0 dentro), muestreando. */
function clipLine(x0, y0, dx, dy, len, inside, step = 3) {
  const segs = []
  let cur = null
  for (let s = 0; s <= len; s += step) {
    const x = x0 + dx * s
    const y = y0 + dy * s
    if (inside(x, y)) {
      if (!cur) cur = [[x, y]]
      else cur[1] = [x, y]
    } else if (cur) {
      if (cur[1]) segs.push(cur)
      cur = null
    }
  }
  if (cur && cur[1]) segs.push(cur)
  return segs
}

function inkWash(P, { detail, sun = true }) {
  const S = scene(detail)
  const small = detail === 'small'
  const r = rng(P.seed + 303)
  const lr = lin
  paper(P, { color: '#F5EDDF', grain: small ? 0.5 : 1, seed: 7 })
  const outerArch = (u, v) => sdArch(u, v, CX, S.outer.top, S.outer.w, S.outer.bottom)
  const sunR = small ? 130 : 104
  const sunD = (u, v) => Math.hypot(u - S.cx, v - S.bottom)
  const off = small ? [0, 0] : [7, 5] // registro: la aguada no cae justo en la línea
  const stars = small
    ? []
    : [
        [-4.0, 13.2, 15],
        [3.0, 15.2, 11],
        [4.2, 11.0, 13],
        [-2.2, 8.8, 9]
      ].map(([i, j, sz]) => [S.cx + i * 22, S.bottom - j * 22, sz])
  // 1. aguadas
  wash(P, {
    sdf: (u, v) => -outerArch(u - off[0], v - off[1]),
    color: '#C66940',
    density: (u, v) => (small ? 1.15 : 0.92) + 0.25 * (v / BOX),
    edge: small ? 1 : 5,
    edgeFreq: 1 / 60,
    rough: 0.1,
    soft: 1,
    softVar: small ? 0.5 : 3,
    wet: 0.7,
    gran: small ? 0.1 : 0.3,
    flow: 0.22,
    flowFreq: 1 / 90,
    flowAniso: [0.6, 1.3],
    seed: 81
  })
  const lightAt = (u, v) => clamp(1 - sunD(u, v) / (S.rI * 2.3))
  wash(P, {
    sdf: (u, v) => S.door(u - off[0] * 0.6, v - off[1] * 0.6),
    bbox: [S.cx - S.rI - 20, S.inner.top - 10, S.cx + S.rI + 20, S.bottom + 10],
    color: '#7C3A20',
    density: (u, v) => {
      let d = (0.15 + 1.25 * Math.pow(1 - lightAt(u, v), 1.2)) * (sun ? sstep(sunR + 2, sunR + 30, sunD(u, v)) : 1)
      for (const [x, y, sz] of stars)
        if (u > x - 2 && u < x + sz + 2 && v > y - 2 && v < y + sz + 2)
          d *= sstep(-1, 1.5, sdBox(u, v, x, y, x + sz, y + sz))
      return d
    },
    edge: small ? 1 : 3,
    soft: 0.8,
    softVar: 2,
    wet: 0.7,
    gran: 0.3,
    flow: 0.3,
    seed: 82
  })
  if (sun)
    wash(P, {
      sdf: (u, v) => Math.max(sunD(u + off[0] * 0.7, v + 3) - sunR, v - S.bottom),
      color: '#EDB458',
      density: 0.95,
      edge: small ? 1 : 3,
      soft: 0.8,
      softVar: 2,
      wet: 0.8,
      gran: 0.25,
      seed: 83
    })
  if (!small) {
    // sombra del arco en la pared y lado derecho del arco
    wash(P, {
      sdf: (u, v) => Math.max(sdArch(u - 18, v - 20, CX, S.outer.top, S.outer.w, S.outer.bottom), -outerArch(u, v) + 3),
      color: '#9A4528',
      density: 0.55,
      edge: 3,
      soft: 1,
      softVar: 4,
      wet: 0.6,
      gran: 0.3,
      seed: 84
    })
    const along = (u, v) => (v >= S.cy ? (u < S.cx ? 0 : 1) : 1 - Math.atan2(S.cy - v, u - S.cx) / Math.PI)
    wash(P, {
      sdf: (u, v) => S.ring(u - 4, v - 3) - 1,
      bbox: [S.cx - S.rO - 10, S.outer.top - 10, S.cx + S.rO + 14, S.bottom + 10],
      color: '#DCC3A0',
      density: (u, v) => 0.6 * sstep(0.5, 0.8, along(u, v)),
      edge: 3,
      soft: 1,
      softVar: 3,
      wet: 0.6,
      gran: 0.3,
      seed: 85
    })
  }
  // 2. la plumilla (tinta sepia)
  const INK = '#33200F'
  const W = small ? 9 : 4.2
  const pen = (pts, o = {}) =>
    ink(P, pts, {
      w: W,
      color: INK,
      density: 2.3,
      ...o,
      seed: o.seed ?? r.int()
    })
  // contornos del arco: cada uno en dos trazos que se encuentran (con un pequeño cruce) cerca de la clave
  for (const d of [S.t, 0]) {
    const m = 0.5 + r.gauss() * 0.04
    pen(laneSpan(S, d + r.gauss(), 0, m + 0.02, 4), {
      press: (t) => 0.65 + 0.5 * Math.sin(Math.PI * t) ** 2
    })
    pen(laneSpan(S, d + r.gauss(), m - 0.015, 1, 4).reverse(), {
      press: (t) => 0.6 + 0.5 * Math.sin(Math.PI * t) ** 2
    })
    // una segunda pasada suelta en algunos tramos (la mano repasa la línea)
    if (!small)
      for (const [a0, a1] of [
        [0.12, 0.34],
        [0.62, 0.86]
      ])
        pen(laneSpan(S, d + (d ? 2.4 : -2.4) + r.gauss(), a0 + r.gauss() * 0.02, a1 + r.gauss() * 0.02, 4), {
          w: 1.5,
          density: 1.4,
          press: (t) => Math.sin(Math.PI * t),
          drift: 1.8
        })
  }
  // bases de las piernas y el suelo
  for (const side of [-1, 1]) {
    const xa = S.cx + side * (S.rO + 3)
    const xb = S.cx + side * (S.rI - 3)
    pen(linePts(xa, S.bottom + r.gauss(), xb, S.bottom + r.gauss(), 12), {
      w: W * 0.9,
      nib: 0.2
    })
  }
  pen(linePts(S.cx - S.rI + 2, S.bottom + 1.5, S.cx + S.rI + 4, S.bottom - 0.5, 16), { w: W * 0.8, nib: 0.2 })
  if (!small) {
    pen(linePts(S.cx - S.rO - 64, S.bottom + 3, S.cx - S.rO - 10, S.bottom + 1, 14), { w: 2.4, nib: 0.2 })
    pen(linePts(S.cx + S.rO + 12, S.bottom + 2, S.cx + S.rO + 88, S.bottom + 5, 14), { w: 2.4, nib: 0.2 })
    // el grosor del arco bajo la clave
    pen(arcPts(S.cx, S.cy + 15, S.rI + 1, Math.PI * 1.12, Math.PI * 1.88, 8), {
      w: 1.8,
      press: (t) => Math.sin(Math.PI * t)
    })
  }
  // el sol: medio círculo en dos trazos, con un respiro arriba
  if (sun) {
    // con su propio azar, para que sin sol el resto del dibujo salga idéntico
    const rs = rng(P.seed + 777)
    pen(arcPts(S.cx, S.bottom, sunR, Math.PI * 1.0, Math.PI * 1.44, 8), {
      w: W * 0.8,
      seed: rs.int()
    })
    pen(arcPts(S.cx, S.bottom, sunR + 1, Math.PI * 1.52, Math.PI * 2.0, 8), {
      w: W * 0.8,
      seed: rs.int()
    })
  }
  // rayado: líneas sueltas, cada una con su ángulo, su largo y su arranque (nada de rejilla)
  const hatch = (inside, { ang, gap, jitter = 0.05, w = 1.3, density = 1.3, reach, seed: hs }) => {
    const hr = rng(hs)
    for (let c = -620; c < 620; c += gap * hr.range(0.75, 1.25)) {
      const a = ang + hr.gauss() * jitter
      const dx = Math.cos(a)
      const dy = Math.sin(a)
      const segs = clipLine(S.cx - dy * c - dx * 500, 420 + dx * c - dy * 500, dx, dy, 1000, inside, 2)
      for (const [p0, p1] of segs) {
        const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        const s0 = hr() * 5
        const s1 = L * (reach ? reach(p0, p1, hr) : 1) - hr() * 4
        if (s1 - s0 < 8) continue
        const A = [p0[0] + dx * s0, p0[1] + dy * s0]
        const B = [p0[0] + dx * s1, p0[1] + dy * s1]
        const M = [(A[0] + B[0]) / 2 + hr.gauss() * 1.2, (A[1] + B[1]) / 2 + hr.gauss() * 1.2]
        pen([A, M, B], {
          w,
          density,
          nib: 0.3,
          press: (t) => 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 1.3)),
          wobble: 0.3,
          drift: 0.4,
          seed: hr.int()
        })
      }
    }
  }
  if (!small) {
    // en lo alto de la puerta: diagonales que se quedan cortas hacia la luz; cruzadas solo en lo más hondo
    const top = S.inner.top
    const span = S.bottom - S.inner.top
    hatch((u, v) => S.door(u, v) < -4 && v < top + span * 0.6, {
      ang: -0.78,
      gap: 12,
      seed: 501,
      reach: (p0, p1, hr) =>
        clamp(1.15 - Math.max(0, Math.max(p0[1], p1[1]) - top - span * 0.25) / (span * 0.5) + hr.gauss() * 0.15, 0.1, 1)
    })
    hatch((u, v) => S.door(u, v) < -4 && v < top + span * 0.26, {
      ang: 0.82,
      gap: 16,
      seed: 502,
      w: 1.1,
      density: 1.1
    })
    // la sombra del arco en la pared
    hatch(
      (u, v) =>
        v < S.bottom - 3 &&
        sdArch(u - 18, v - 20, CX, S.outer.top, S.outer.w, S.outer.bottom) < -1 &&
        outerArch(u, v) > 3,
      { ang: -1.05, gap: 9, seed: 503, w: 1.2, density: 1.1 }
    )
    // unos pocos ladrillos sugeridos: aguada más honda, cada uno a su aire, con la junta a plumilla en un par de lados
    const bW = 62
    const bH = 25
    const gapB = 6
    const clusters = [
      [
        96,
        128,
        [
          [0, 0],
          [1, 0],
          [0.5, 1],
          [1.5, 1],
          [0, 2]
        ]
      ],
      [
        548,
        744,
        [
          [0.5, 0],
          [1.5, 0],
          [0, 1],
          [1, 1]
        ]
      ]
    ]
    clusters.forEach(([cx0, cy0, bricks], ci) => {
      bricks.forEach(([i, j], bi) => {
        const x = cx0 + i * (bW + gapB) + r.gauss() * 1.5
        const y = cy0 + j * (bH + gapB) + r.gauss() * 1.2
        const w = bW * r.range(0.92, 1.04)
        wash(P, {
          sdf: (u, v) => sdBox(u, v, x + 2, y + 2, x + w - 2, y + bH - 2) - 2,
          bbox: [x - 10, y - 10, x + w + 10, y + bH + 10],
          color: '#A3452A',
          density: r.range(0.32, 0.55),
          edge: 1.6,
          edgeFreq: 1 / 14,
          soft: 0.5,
          softVar: 0.6,
          wet: 1,
          wetWidth: 1.2,
          gran: 0.4,
          seed: 120 + ci
        })
        const lw = {
          w: 1.5,
          color: '#5E2A17',
          density: 1.3,
          nib: 0.2,
          drift: 0.3
        }
        if (r() < 0.75)
          pen(linePts(x - 2, y + bH + 1, x + w + 3, y + bH + 0.5, 10), {
            ...lw,
            press: (t) => 0.3 + 0.7 * Math.sin(Math.PI * t)
          })
        if (r() < 0.55) pen(linePts(x + w + 1.5, y - 1, x + w + 2, y + bH + 1, 6), lw)
      })
    })
  }
  relief(P, { tooth: small ? 0.02 : 0.07 })
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 4 · SUMI-E: un solo gesto. El arco es UNA pincelada de pincel grueso en tinta de ladrillo sobre papel de arroz: se
// posa con fuerza abajo a la izquierda (la tinta se corre en las fibras), sube, da la vuelta y, al bajar, el pincel se
// queda sin tinta y se abre en «blanco volante». El sol es un toque dorado apretado y girado, saliendo sobre una línea
// de suelo seca; abajo a la derecha, un sello con el arco y el sol en píxeles.

/** Fibras del papel de arroz: hebras finas, unas más claras y otras más oscuras que el papel. */
function fibers(P, { n = 260, seed = 9 } = {}) {
  const r = rng(seed)
  const { k, N } = P
  const light = lin('#FFFBF2')
  const dark = lin('#D9C9AE')
  for (let q = 0; q < n; q++) {
    let x = r() * BOX
    let y = r() * BOX
    let a = r() * Math.PI * 2
    const len = r.range(14, 60)
    const col = r() < 0.5 ? light : dark
    const al = r.range(0.25, 0.6)
    for (let s = 0; s < len; s += 0.4 / k) {
      a += r.gauss() * 0.05
      x += Math.cos(a) * (0.4 / k)
      y += Math.sin(a) * (0.4 / k)
      const xi = Math.floor(x * k)
      const yi = Math.floor(y * k)
      if (xi < 0 || yi < 0 || xi >= N || yi >= N) continue
      const i = yi * N + xi
      const f = al * Math.sin((Math.PI * s) / len)
      P.R[i] += (col[0] - P.R[i]) * f
      P.G[i] += (col[1] - P.G[i]) * f
      P.B[i] += (col[2] - P.B[i]) * f
    }
  }
}

function sumi(P, { detail, sun = true }) {
  const S = scene(detail)
  const small = detail === 'small'
  const r = rng(P.seed + 404)
  const lr = lin
  paper(P, {
    color: '#F4ECDC',
    grain: small ? 0.4 : 0.9,
    cell: 14,
    mottle: 0.04,
    seed: 9
  })
  if (!small) fibers(P, { n: 420, seed: 19 })
  const W = small ? S.t * 1.18 : S.t * 1.22
  const mid = small ? S.t / 2 : S.t / 2 + 2
  // 1. una luz muy pálida dentro de la puerta (agua con un poco de tinta dorada), sin contorno
  if (!small)
    wash(P, {
      sdf: (u, v) => sdArch(u, v, CX, S.inner.top + 30, S.inner.w - 40, S.bottom - 6),
      color: '#F1D6A8',
      density: (u, v) => 0.6 * sstep(S.inner.top, S.bottom, v) + 0.12,
      edge: 18,
      edgeFreq: 1 / 45,
      rough: 0.25,
      soft: 3,
      softVar: 22,
      wet: 0.35,
      gran: 0.2,
      seed: 91
    })
  // 2. la línea de suelo: un trazo seco y rápido, de lado a lado
  brush(P, {
    pts: linePts(S.cx - S.rO - (small ? 20 : 92), S.bottom + 10, S.cx + S.rO + (small ? 20 : 110), S.bottom + 4, 30),
    w: small ? 46 : 26,
    kind: 'round',
    colors: ['#A9532F', '#8E3E22'],
    mode: 'glaze',
    density: small ? 1.6 : 1.05,
    press: (t) => (0.35 + 0.65 * sstep(0, 0.12, t)) * (1 - 0.45 * sstep(0.6, 1, t)),
    load: (t) => 1 - 0.7 * sstep(0.35, 1, t),
    tooth: 0.3,
    dryLo: 0.3,
    dryHi: 0.42,
    streak: 0.5,
    hair: 0.06,
    clumps: 6,
    body: 0,
    wobble: 1.5,
    seed: 401
  })
  // 3. el sol: un toque redondo y apretado (el «punto» de la caligrafía): la tinta dorada hace charco con borde
  //    oscuro y, dentro, el giro del pincel deja dos o tres medias lunas; lo recorta la línea de suelo
  if (sun) {
    const R = small ? 120 : 96
    const sc = [S.cx, S.bottom - R * 0.12]
    const inSun = (u, v) => Math.max(sdCircle(u, v, sc[0], sc[1], R), v - S.bottom + 3)
    wash(P, {
      sdf: inSun,
      bbox: [sc[0] - R - 20, sc[1] - R - 20, sc[0] + R + 20, S.bottom + 4],
      color: '#EDA63F',
      density: (u, v) => 1 + 0.2 * sstep(R * 0.4, R, Math.hypot(u - sc[0], v - sc[1])),
      edge: small ? 1.2 : 2.2,
      edgeFreq: 1 / 12,
      rough: 0.3,
      soft: 0.6,
      softVar: 1,
      wet: 1.1,
      wetWidth: 2.2,
      gran: 0.25,
      flow: 0.25,
      seed: 95
    })
  }
  // 4. el arco: un solo gesto (bajo-izquierda → arriba → bajo-derecha)
  const path = laneSpan(S, mid, 0, 1, small ? 0 : 10)
  const gesture = (t) => {
    // se posa con fuerza, avanza firme y se levanta al final
    const land = 1 + 0.1 * Math.exp(-t * 30)
    const lift = 1 - 0.5 * sstep(0.94, 1, t)
    return land * lift * (1 - 0.07 * t)
  }
  brush(P, {
    pts: path,
    w: W,
    kind: 'round',
    capK: 0.3,
    ragStart: 0,
    colors: ['#BC5A33', '#A24426'],
    mode: 'glaze',
    density: small ? 1.6 : 1.2,
    press: gesture,
    load: (t) => 1 - (small ? 0.15 : 0.56) * Math.pow(sstep(0.45, 1, t), 1.1),
    flowBlur: 5,
    bristleR: 1.4,
    tooth: small ? 0.1 : 0.16,
    dryLo: 0.12,
    dryHi: 0.28,
    streak: small ? 0.15 : 0.55,
    hair: 0.03,
    clumps: 7,
    toneFreq: 5,
    // los lados se deshilachan solo cuando el pincel ya va seco
    feather: 0.1,
    ragEnd: 0.04,
    splay: 0.1,
    body: 0,
    edgeDark: 0.3,
    alongVar: 0.22,
    wobble: 2,
    seed: 403
  })
  // 5. el sello: un cuadrado bermellón con el arco y el sol en píxeles en blanco
  if (!small) {
    const x0 = 694
    const y0 = 698
    const sz = 62
    const px = sz / 9
    // celdas que quedan en blanco (rejilla 9×9): el arco y el medio sol
    const hole = new Set()
    const arch = [
      '.........',
      '..#####..',
      '.##...##.',
      '.#.....#.',
      '.#.....#.',
      '.#..#..#.',
      '.#.###.#.',
      '.#.###.#.',
      '.........'
    ]
    arch.forEach((row, j) => [...row].forEach((ch, i) => ch === '#' && hole.add(`${i},${j}`)))
    const sealMask = handMask(
      P,
      (u, v) => {
        const d = sdBox(u, v, x0, y0, x0 + sz, y0 + sz)
        if (d > 0) return d
        const i = Math.floor((u - x0) / px)
        const j = Math.floor((v - y0) / px)
        if (!hole.has(`${i},${j}`)) return d
        // dentro de una celda blanca: distancia a su borde (positiva = fuera del rojo)
        return -sdBox(u, v, x0 + i * px, y0 + j * px, x0 + (i + 1) * px, y0 + (j + 1) * px)
      },
      { wobble: 0.7, soft: 0.5, seed: 93, freq: 1 / 12 }
    )
    // el sello se estampa: rojo plano con zonas sin tinta según el grano
    const red = lr('#B23A22').map((c) => Math.log(Math.max(c, 0.0005)))
    const stamp = field(P, { freq: 1 / 7, oct: 3, seed: 94 })
    each(P, [x0 - 4, y0 - 4, x0 + sz + 4, y0 + sz + 4], (i, u, v) => {
      const m = sealMask(u, v, i)
      if (m <= 0) return
      const D = 1.5 * m * sstep(0.2, 0.5, P.H[i] * 0.6 + 0.4 + 0.3 * stamp[i])
      P.R[i] *= Math.exp(red[0] * D)
      P.G[i] *= Math.exp(red[1] * D)
      P.B[i] *= Math.exp(red[2] * D)
    })
  }
  relief(P, { tooth: small ? 0.015 : 0.05 })
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// SUMI-E MÍNIMO (el dueño eligió el sumi-e, «más minimalista»): menos trazos, más aire de papel y un gesto seguro.
// El arco es un trazo de color casi plano con la mano a la vista: se posa (arranque redondo, la tinta se acumula un
// poco en el borde), se afina un pelo al girar la muñeca arriba y se levanta al final, y SOLO ahí se abren las cerdas.
// El sol, un disco o medio disco ámbar plano. El grano del papel, apenas.

const MIN = {
  paper: '#F6F0E4',
  brick: ['#C4613A', '#B95533'],
  amber: '#E99E3E'
}

/** Papel casi liso: un grano muy suave y una leve variación de tono. */
function quietPaper(P, small) {
  paper(P, { color: MIN.paper, grain: small ? 0.15 : 0.32, cell: 14, mottle: 0.012, seed: 21 })
}

/**
 * El gesto del arco: eje con las piernas en cx ± R, la clave del eje en `top` y la base en `bottom`; `w` es el ancho
 * del pincel. `dry` (0–1): cuánto se abre al levantarse.
 */
function archGesture(P, { R, top, bottom, w, dry = 1, small = false, seed }) {
  const S = { cx: CX, rI: R, cy: top + R, bottom }
  // la punta redonda se come un poco de cada extremo: el arranque baja un pelo y la cola sigue hasta pasar la base,
  // para que el pincel se levante justo a la altura donde se posó
  const pts = laneSpan(S, 0, 0, 1, 0)
  pts.unshift([CX - R, bottom + w * 0.12])
  const tail = w * 0.55 + 18
  for (let q = 1; q <= 3; q++) pts.push([CX + R + 0.5 * q, bottom + (tail * q) / 3])
  brush(P, {
    pts,
    w,
    kind: 'round',
    capK: 0.32,
    ragStart: 0,
    colors: MIN.brick,
    mode: 'glaze',
    density: 0.95,
    // se posa (bulbo), la muñeca afina un poco arriba y se levanta al final
    press: (t) =>
      (1 + 0.12 * Math.exp(-t * 26)) *
      (1 - 0.08 * Math.exp(-(((t - 0.5) / 0.13) ** 2))) *
      (1 - 0.5 * sstep(0.86, 1, t)),
    load: (t) => 1 - 0.66 * dry * Math.pow(sstep(0.83, 1, t), 1.2),
    // la tinta corre entre las cerdas: cuanto más ancho el pincel, más se funde (color casi plano)
    flowBlur: Math.max(4, w * 0.11),
    bristleR: 1.5,
    tooth: small ? 0.05 : 0.14,
    dryLo: 0.14,
    dryHi: 0.3,
    streak: small ? 0.04 : 0.18,
    hair: 0.01,
    clumps: 5,
    toneFreq: 2,
    toneJitter: 0.03,
    feather: 0.04,
    widthVar: 0.02,
    ragEnd: 0.06 * dry,
    splay: 0.05 * dry,
    body: 0,
    edgeDark: 0.14,
    alongVar: 0.08,
    wobble: small ? 0.6 : 0.9,
    seed
  })
}

/** Un disco de color plano con el borde de la mano (no un círculo de compás); `cut` lo corta por abajo. */
function flatSun(P, { x, y, r, cut = Infinity, color = MIN.amber, small = false, seed = 0 }) {
  wash(P, {
    sdf: (u, v) => Math.max(sdCircle(u, v, x, y, r), v - cut),
    bbox: [x - r - 12, y - r - 12, x + r + 12, Math.min(cut, y + r) + 12],
    color,
    density: 1,
    edge: small ? 0.6 : 1.6,
    edgeFreq: 1 / 34,
    rough: 0.15,
    soft: 0.6,
    softVar: 0.4,
    wet: 0.35,
    wetWidth: 2,
    gran: small ? 0 : 0.12,
    speck: 0,
    flow: 0.08,
    seed: 600 + seed
  })
}

/** Escala la composición alrededor del centro para ≤ 32 px: el mismo dibujo, más grande y más grueso. */
const grow = (small, k = 1.24) => (small ? (v) => CX + (v - CX) * k : (v) => v)

// A · «Un gesto»: un único trazo de arco y un sol entero suspendido en la puerta. Lo más aireado.
function sumiA(P, { detail, sun = true }) {
  const small = detail === 'small'
  const g = grow(small)
  quietPaper(P, small)
  if (sun) flatSun(P, { x: CX, y: g(512), r: (small ? 1.3 : 1) * 50, small, seed: 1 })
  archGesture(P, {
    R: (small ? 1.24 : 1) * 160,
    top: g(236),
    bottom: g(604),
    w: small ? 128 : 92,
    small,
    dry: small ? 0.2 : 1,
    seed: 711
  })
  relief(P, { tooth: small ? 0.008 : 0.018 })
}

// B · «Horizonte»: el arco, un pincelazo de horizonte que lo cruza en la base y el medio sol que sale sobre él.
function sumiB(P, { detail, sun = true }) {
  const small = detail === 'small'
  const g = grow(small)
  quietPaper(P, small)
  const H = g(600)
  if (sun) flatSun(P, { x: CX, y: H, r: (small ? 1.24 : 1) * 70, cut: H + 2, small, seed: 2 })
  archGesture(P, {
    R: (small ? 1.24 : 1) * 158,
    top: g(222),
    bottom: H,
    w: small ? 120 : 88,
    small,
    dry: small ? 0.2 : 0.8,
    seed: 712
  })
  // el horizonte: un pincelazo rápido, que entra fino, se apoya y sale seco por la derecha. Va encima y es opaco
  // (del mismo color que deja la tinta del arco sobre el papel): las piernas y el sol se apoyan en él sin manchar
  brush(P, {
    pts: linePts(g(158), H + 9, g(682), H + 1, 40),
    w: small ? 40 : 24,
    kind: 'round',
    capK: 0.4,
    ragStart: 0,
    colors: ['#B95933', '#B0532F'],
    mode: 'opaque',
    press: (t) => (0.45 + 0.55 * sstep(0, 0.1, t)) * (1 - 0.55 * sstep(0.72, 1, t)),
    load: (t) => 1 - (small ? 0.1 : 0.55) * Math.pow(sstep(0.68, 1, t), 1.1),
    flowBlur: 3,
    bristleR: 1.4,
    tooth: small ? 0.05 : 0.16,
    dryLo: 0.14,
    dryHi: 0.3,
    streak: small ? 0.05 : 0.3,
    hair: 0.02,
    clumps: 5,
    feather: 0.05,
    ragEnd: small ? 0.02 : 0.08,
    body: 0,
    wobble: 0.8,
    seed: 713
  })
  relief(P, { tooth: small ? 0.008 : 0.018 })
}

// C · «Esencial»: lo más depurado que se sigue leyendo a 16 px. Arco grueso, medio sol en la base, nada más.
function sumiC(P, { detail, sun = true }) {
  const small = detail === 'small'
  const g = grow(small, 1.16)
  quietPaper(P, small)
  const bottom = g(616)
  if (sun) flatSun(P, { x: CX, y: bottom, r: (small ? 1.16 : 1) * 64, cut: bottom, small, seed: 3 })
  archGesture(P, {
    R: (small ? 1.16 : 1) * 150,
    top: g(214),
    bottom,
    w: small ? 148 : 124,
    small,
    dry: small ? 0.15 : 0.6,
    seed: 714
  })
  relief(P, { tooth: small ? 0.008 : 0.015 })
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Las propuestas. `detail`: esquina (unidades de la caja) del recorte que enseña la textura a tamaño real. */
export const PAINTINGS = {
  gouache: {
    name: 'Gouache denso',
    paint: gouache,
    seed: 7,
    detail: [440, 470]
  },
  watercolor: {
    name: 'Acuarela transparente',
    paint: watercolor,
    seed: 11,
    detail: [96, 96]
  },
  ink: { name: 'Tinta y aguada', paint: inkWash, seed: 13, detail: [300, 196] },
  sumi: {
    name: 'Sumi-e, pincel grueso',
    paint: sumi,
    seed: 17,
    detail: [470, 370]
  },
  // sumi-e mínimo (segunda ronda: el dueño eligió el sumi-e, más minimalista)
  sumiA: { name: 'Sumi-e mínimo A · un gesto', paint: sumiA, seed: 31, detail: [478, 452] },
  sumiB: {
    name: 'Sumi-e mínimo B · arco y horizonte',
    paint: sumiB,
    seed: 37,
    detail: [478, 452],
    // la plantilla de la barra de menús (icon-art.mjs, traySvg) lleva también el horizonte
    tray: { horizon: true }
  },
  sumiC: { name: 'Sumi-e mínimo C · esencial', paint: sumiC, seed: 41, detail: [196, 470] }
}

/**
 * Plantilla monocroma de la barra de menús «a pincel»: el arco de un trazo (se posa y se afina al levantarse) y el
 * medio sol. Se pinta grande con el mismo pincel y se reduce; solo cuenta el alfa (macOS la tiñe).
 */
export function renderTray(px, color = '#000000') {
  const big = 256
  const P = painter(big, 5)
  P.R.fill(1)
  P.G.fill(1)
  P.B.fill(1)
  P.H.fill(0.5)
  const S = { cx: CX, rI: 174, t: 112, cy: 330, bottom: 700 }
  const path = laneSpan(S, S.t / 2, 0, 1, 0)
  brush(P, {
    pts: path,
    w: 112,
    kind: 'round',
    capK: 0.25,
    ragStart: 0,
    colors: ['#000000', '#000000'],
    mode: 'glaze',
    density: 9,
    press: (t) => (1 + 0.12 * Math.exp(-t * 25)) * (1 - 0.42 * sstep(0.62, 1, t)),
    load: () => 1,
    flowBlur: 6,
    tooth: 0,
    streak: 0,
    hair: 0,
    feather: 0,
    ragEnd: 0,
    splay: 0,
    wobble: 3,
    seed: 7
  })
  const sun = (u, v) => Math.max(sdCircle(u, v, CX, 700, 104), v - 700)
  each(P, [CX - 130, 580, CX + 130, 710], (i, u, v) => {
    const a = sstep(1.5, -1.5, sun(u, v))
    P.R[i] *= 1 - a
    P.G[i] *= 1 - a
    P.B[i] *= 1 - a
  })
  // a canvas con alfa, reducido por pasos
  const src = toCanvas(P)
  const g0 = src.getContext('2d')
  const img = g0.getImageData(0, 0, big, big)
  const [cr, cg, cb] = [1, 3, 5].map((o) => parseInt(color.slice(o, o + 2), 16))
  for (let i = 0; i < big * big; i++) {
    const a = 255 - img.data[i * 4]
    img.data[i * 4] = cr
    img.data[i * 4 + 1] = cg
    img.data[i * 4 + 2] = cb
    img.data[i * 4 + 3] = a
  }
  g0.putImageData(img, 0, 0)
  let cur = src
  while (cur.width / 2 >= px) {
    const h = makeCanvas(cur.width / 2)
    const hg = h.getContext('2d')
    hg.imageSmoothingQuality = 'high'
    hg.drawImage(cur, 0, 0, h.width, h.height)
    cur = h
  }
  return cur
}

/** Pinta una propuesta a N px (la caja del arte entera, sin máscara) y la devuelve en un <canvas>. */
export function renderArt(id, { px, detail = 'full', sun = true, seed } = {}) {
  const def = PAINTINGS[id]
  const P = painter(px, seed ?? def.seed)
  def.paint(P, { detail, sun })
  return toCanvas(P)
}

/**
 * Coloca el arte en el lienzo del icono: 'mac' (squircle de 824 en (100,100) de 1024, con sombra, como icon-art.mjs) o
 * 'plain' (casi a sangre, para Windows/Linux), o 'square' (el cuadro tal cual).
 */
export function composeIcon(art, { size, platform = 'mac' }) {
  const c = makeCanvas(size)
  const g = c.getContext('2d')
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  const s = size / 1024
  if (platform === 'square') {
    g.drawImage(art, 0, 0, size, size)
    return c
  }
  const box = platform === 'mac' ? { x: 100, y: 100, s: 824 } : { x: 32, y: 32, s: 960 }
  const k = box.s / BOX
  const mask = new Path2D(MASK)
  const at = (dx, dy) => {
    g.setTransform(s * k, 0, 0, s * k, (box.x + dx) * s, (box.y + dy) * s)
  }
  if (platform === 'mac') {
    g.save()
    at(0, 12)
    g.filter = `blur(${14 * s}px)`
    g.globalAlpha = 0.28
    g.fill(mask)
    g.restore()
    g.save()
    at(0, 3)
    g.filter = `blur(${3 * s}px)`
    g.globalAlpha = 0.14
    g.fill(mask)
    g.restore()
  }
  g.save()
  at(0, 0)
  g.clip(mask)
  g.setTransform(1, 0, 0, 1, 0, 0)
  // el arte, reducido desde el original con buena calidad (en pasos de ½ si hace falta)
  let src = art
  const target = box.s * s
  while (src.width > target * 2.2) {
    const h = makeCanvas(Math.round(src.width / 2))
    const hg = h.getContext('2d')
    hg.imageSmoothingQuality = 'high'
    hg.drawImage(src, 0, 0, h.width, h.height)
    src = h
  }
  g.drawImage(src, box.x * s, box.y * s, target, target)
  // filo de luz por dentro del borde (el canto del papel), como el icono actual
  at(0, 0)
  if (size >= 64) {
    g.strokeStyle = 'rgba(255,255,255,0.35)'
    g.lineWidth = 5
    g.stroke(mask)
  }
  if (platform === 'plain') {
    g.strokeStyle = 'rgba(90,58,30,0.22)'
    g.lineWidth = size <= 32 ? 22 : 8
    g.stroke(mask)
  }
  g.restore()
  return c
}
