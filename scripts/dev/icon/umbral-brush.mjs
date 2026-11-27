// Motor de pincel para la propuesta de Aula: convierte un trazo (línea central + presión) en un contorno relleno con el
// mismo carácter que el faro de Faro: tinta plana, borde orgánico, presión que respira, cabezas redondas donde el
// pincel se apoya y colas que se afinan o se curvan donde se levanta. Puro, sin DOM: lo usan el icono y la maqueta.

/** Generador pseudoaleatorio estable (xorshift32). */
export function rng(seed) {
  let s = (Math.imul(seed | 0, 2654435761) >>> 0) || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

/** Ruido de valor 1D suave y periódico. */
export function noise(seed, n = 128) {
  const r = rng(seed)
  const v = Array.from({ length: n }, () => r() * 2 - 1)
  return (x) => {
    const i = Math.floor(x)
    const f = x - i
    const u = f * f * (3 - 2 * f)
    const a = v[((i % n) + n) % n]
    const b = v[(((i + 1) % n) + n) % n]
    return a + (b - a) * u
  }
}

const sstep = (t) => t * t * (3 - 2 * t)

/** Remuestrea una polilínea a pasos iguales de arco. */
export function resample(pts, step) {
  const out = [pts[0]]
  let need = step
  for (let i = 1; i < pts.length; i++) {
    let [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    let seg = Math.hypot(x1 - x0, y1 - y0)
    while (seg >= need && seg > 0) {
      const k = need / seg
      x0 += (x1 - x0) * k
      y0 += (y1 - y0) * k
      out.push([x0, y0])
      seg -= need
      need = step
    }
    need -= seg
  }
  const last = pts[pts.length - 1]
  const tail = out[out.length - 1]
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.35) out.push(last)
  else out[out.length - 1] = last
  return out
}

/** Spline de Catmull-Rom que pasa por todos los puntos, muestreada cada `step`. */
export function spline(pts, step = 2.5) {
  if (pts.length === 2) return resample(pts, step)
  const P = [pts[0], ...pts, pts[pts.length - 1]]
  const dense = []
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1]
    const p1 = P[i]
    const p2 = P[i + 1]
    const p3 = P[i + 2]
    const n = Math.max(4, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 1.5))
    for (let k = 0; k < n; k++) {
      const t = k / n
      const t2 = t * t
      const t3 = t2 * t
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  dense.push(pts[pts.length - 1])
  return resample(dense, step)
}

/** Interpola la presión por fotogramas clave [[t, w], …] con transiciones suaves. */
function profileAt(profile, t) {
  if (t <= profile[0][0]) return profile[0][1]
  for (let i = 1; i < profile.length; i++) {
    const [t1, w1] = profile[i]
    const [t0, w0] = profile[i - 1]
    if (t <= t1) return w0 + (w1 - w0) * sstep((t - t0) / (t1 - t0 || 1))
  }
  return profile[profile.length - 1][1]
}

/**
 * Un trazo de pincel: devuelve el contorno cerrado (lista de puntos).
 * - `w`: ancho base. `profile`: presión a lo largo del trazo.
 * - `seed`: carácter propio del trazo (el mismo número da siempre el mismo trazo).
 * - `wobble`: temblor de la línea central (px). `edge`: aspereza del borde (fracción del medio ancho).
 * - `swell`: cuánto respira el ancho (fracción). `startBlob`/`endBlob`: cuánto se alarga la cabeza redonda.
 */
export function stroke(center, o = {}) {
  const { w = 28, profile = [[0, 1], [1, 1]], seed = 1, wobble = 0.9, edge = 0.06, swell = 0.1, startBlob = 1.05, endBlob = 1.0, jitter = 0 } = o
  let ctl = center
  if (jitter) {
    const r = rng(seed * 31 + 7)
    ctl = center.map(([x, y], i) => (i === 0 || i === center.length - 1 ? [x + (r() - 0.5) * jitter, y + (r() - 0.5) * jitter] : [x + (r() - 0.5) * jitter * 1.4, y + (r() - 0.5) * jitter * 1.4]))
  }
  const pts = spline(ctl, 2.2)
  const n = pts.length
  const s = [0]
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const L = s[n - 1] || 1
  const nW = noise(seed * 13 + 1)
  const nW2 = noise(seed * 13 + 2)
  const nL = noise(seed * 13 + 3)
  const nR = noise(seed * 13 + 4)
  const nC = noise(seed * 13 + 5)
  const left = []
  const right = []
  const frames = []
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 2)]
    const b = pts[Math.min(n - 1, i + 2)]
    let tx = b[0] - a[0]
    let ty = b[1] - a[1]
    const tl = Math.hypot(tx, ty) || 1
    tx /= tl
    ty /= tl
    const nx = -ty
    const ny = tx
    const t = s[i] / L
    const wi = w * profileAt(profile, t) * (1 + swell * nW(s[i] / 85) + swell * 0.38 * nW2(s[i] / 24))
    // El temblor se apaga en las puntas (el pincel se apoya y se levanta firme).
    const fade = Math.min(1, s[i] / 24, (L - s[i]) / 24)
    const c = wobble * nC(s[i] / 58) * fade
    const hl = (wi / 2) * (1 + edge * nL(s[i] / 11))
    const hr = (wi / 2) * (1 + edge * nR(s[i] / 11))
    const [x, y] = pts[i]
    left.push([x + nx * (c + hl), y + ny * (c + hl)])
    right.push([x + nx * (c - hr), y + ny * (c - hr)])
    frames.push({ x: x + nx * c, y: y + ny * c, tx, ty, nx, ny, r: (hl + hr) / 2 })
  }
  const cap = (f, from, to, stretch, k) => {
    const out = []
    const steps = 14
    for (let j = 1; j < steps; j++) {
      const th = from + ((to - from) * j) / steps
      const cs = Math.cos(th)
      const sn = Math.sin(th)
      // La cabeza del trazo: algo más gruesa donde el pincel carga tinta, con un leve bulto irregular.
      const rr = f.r * (1 + 0.05 * Math.sin(th * 3 + k))
      out.push([f.x + (f.tx * cs * stretch + f.nx * sn) * rr, f.y + (f.ty * cs * stretch + f.ny * sn) * rr])
    }
    return out
  }
  const first = frames[0]
  const last = frames[n - 1]
  const poly = [
    ...right,
    ...cap(last, -Math.PI / 2, Math.PI / 2, endBlob, seed),
    ...left.reverse(),
    ...cap(first, Math.PI / 2, (3 * Math.PI) / 2, startBlob, seed + 1),
  ]
  return poly
}

/** Área con signo (para orientar todos los contornos igual: nada se resta al rellenar). */
function area(poly) {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]
    const [x1, y1] = poly[(i + 1) % poly.length]
    a += x0 * y1 - x1 * y0
  }
  return a / 2
}

function resampleClosed(poly, step) {
  return resample([...poly, poly[0]], step).slice(0, -1)
}

/** Contorno → camino SVG suave (Catmull-Rom cerrado a cúbicas), redondeado a `decimals` (0,1 por defecto). */
export function toPath(poly, step = 6.5, decimals = 1) {
  let q = resampleClosed(poly, step)
  if (area(q) < 0) q = q.reverse()
  const scale = decimals === 0 ? 1 : 10 ** decimals
  const r = (v) => (scale === 1 ? Math.round(v) : Math.round(v * scale) / scale)
  const m = q.length
  let d = `M${r(q[0][0])},${r(q[0][1])}`
  for (let i = 0; i < m; i++) {
    const p0 = q[(i - 1 + m) % m]
    const p1 = q[i]
    const p2 = q[(i + 1) % m]
    const p3 = q[(i + 2) % m]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += `C${r(c1[0])},${r(c1[1])},${r(c2[0])},${r(c2[1])},${r(p2[0])},${r(p2[1])}`
  }
  return d + 'Z'
}

/** Puntos de un arco de circunferencia (ángulos en grados, sentido matemático, y hacia abajo en pantalla). */
export function arc(cx, cy, r, a0, a1, step = 8, ry = r) {
  const out = []
  const len = (Math.abs(a1 - a0) * Math.PI * Math.max(r, ry)) / 180
  const k = Math.max(3, Math.ceil(len / step))
  for (let i = 0; i <= k; i++) {
    const a = ((a0 + ((a1 - a0) * i) / k) * Math.PI) / 180
    out.push([cx + Math.cos(a) * r, cy - Math.sin(a) * ry])
  }
  return out
}

/** Atajo: trazo → camino SVG. */
export const brush = (center, o) => toPath(stroke(center, o), o?.smooth ?? 6.5, o?.decimals ?? 1)

/**
 * Una pincelada redonda que se aprieta y se levanta (el sol rojo de la tinta china): media luna llena si `half`, con
 * la base casi recta. Borde vivo de pincel, nunca un círculo de compás.
 */
export function dab(cx, cy, r, { seed = 1, half = true, edge = 0.03, base = 0.06, squash = 1, lean = 0.05, smooth = 5.5, decimals = 1 } = {}) {
  const nE = noise(seed * 17 + 1)
  const nB = noise(seed * 17 + 2)
  const pts = []
  const a0 = half ? 0 : 0
  const a1 = half ? 180 : 360
  const k = 90
  for (let i = 0; i <= k; i++) {
    const a = a0 + ((a1 - a0) * i) / k
    const rad = (a * Math.PI) / 180
    const rr = r * (1 + edge * nE(a / 22) + 0.012 * Math.sin(rad * 5 + seed))
    const y = cy - Math.sin(rad) * rr * squash
    // El pincel se inclina un poco hacia la derecha al apretar (la cúpula no es simétrica).
    pts.push([cx + Math.cos(rad) * rr + (cy - y) * lean, y])
  }
  if (half) {
    // La base: el pincel se arrastra un poco al levantarse (no es una regla).
    const m = 24
    for (let i = 1; i < m; i++) {
      const t = i / m
      const x = cx - r + 2 * r * t
      const sag = Math.sin(t * Math.PI) * r * base + nB(t * 4) * r * 0.012
      pts.push([x, cy + sag])
    }
    pts.reverse()
  }
  return toPath(pts, smooth, decimals)
}
