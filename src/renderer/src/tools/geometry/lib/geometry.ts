// Geometría (pura): resolución de triángulos (LLL, LAL, ALA, AAL y el caso ambiguo LLA), áreas y perímetros de figuras
// y la calculadora del círculo (arco, sector, cuerda, segmento). Ángulos en grados; lados a, b, c opuestos a A, B, C.

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

export type TriMode = 'SSS' | 'SAS' | 'ASA' | 'AAS' | 'SSA'

/** Datos que pide cada caso (en este orden). */
export const TRI_FIELDS: Record<TriMode, ('a' | 'b' | 'c' | 'A' | 'B' | 'C')[]> = {
  SSS: ['a', 'b', 'c'],
  SAS: ['b', 'A', 'c'],
  ASA: ['B', 'a', 'C'],
  AAS: ['A', 'B', 'a'],
  SSA: ['a', 'b', 'A']
}

export interface Triangle {
  a: number
  b: number
  c: number
  A: number
  B: number
  C: number
}

export interface TriangleInfo extends Triangle {
  area: number
  perimeter: number
  /** Alturas sobre a, b y c. */
  ha: number
  hb: number
  hc: number
  /** Radios de las circunferencias circunscrita e inscrita. */
  R: number
  r: number
  bySides: 'equilateral' | 'isosceles' | 'scalene'
  byAngles: 'acute' | 'right' | 'obtuse'
}

export type TriError = 'missing' | 'nonPositive' | 'inequality' | 'angleSum' | 'noSolution'

const EPS = 1e-9

function complete(t: Triangle): TriangleInfo {
  const s = (t.a + t.b + t.c) / 2
  const area = Math.sqrt(Math.max(0, s * (s - t.a) * (s - t.b) * (s - t.c)))
  const near = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y))
  const bySides = near(t.a, t.b) && near(t.b, t.c) ? 'equilateral' : near(t.a, t.b) || near(t.b, t.c) || near(t.a, t.c) ? 'isosceles' : 'scalene'
  const maxAngle = Math.max(t.A, t.B, t.C)
  const byAngles = Math.abs(maxAngle - 90) < 1e-7 ? 'right' : maxAngle > 90 ? 'obtuse' : 'acute'
  return {
    ...t,
    area,
    perimeter: 2 * s,
    ha: (2 * area) / t.a,
    hb: (2 * area) / t.b,
    hc: (2 * area) / t.c,
    R: (t.a * t.b * t.c) / (4 * area),
    r: area / s,
    bySides,
    byAngles
  }
}

/** Ángulo opuesto a `opp` por el teorema del coseno. */
function lawOfCosinesAngle(opp: number, x: number, y: number): number {
  return deg(Math.acos(Math.max(-1, Math.min(1, (x * x + y * y - opp * opp) / (2 * x * y)))))
}

/**
 * Resuelve un triángulo. Devuelve 0, 1 o 2 soluciones (dos solo en el caso ambiguo LLA) o el motivo por el que no hay.
 */
export function solveTriangle(mode: TriMode, g: Partial<Triangle>): { ok: true; solutions: TriangleInfo[] } | { ok: false; error: TriError } {
  const need = TRI_FIELDS[mode]
  if (need.some((k) => g[k] === undefined || !Number.isFinite(g[k] as number))) return { ok: false, error: 'missing' }
  if (need.some((k) => (g[k] as number) <= 0)) return { ok: false, error: 'nonPositive' }
  const { a = 0, b = 0, c = 0, A = 0, B = 0, C = 0 } = g
  switch (mode) {
    case 'SSS': {
      if (a + b <= c + EPS || a + c <= b + EPS || b + c <= a + EPS) return { ok: false, error: 'inequality' }
      const AA = lawOfCosinesAngle(a, b, c)
      const BB = lawOfCosinesAngle(b, a, c)
      return { ok: true, solutions: [complete({ a, b, c, A: AA, B: BB, C: 180 - AA - BB })] }
    }
    case 'SAS': {
      if (A >= 180) return { ok: false, error: 'angleSum' }
      const aa = Math.sqrt(b * b + c * c - 2 * b * c * Math.cos(rad(A)))
      const BB = lawOfCosinesAngle(b, aa, c)
      return { ok: true, solutions: [complete({ a: aa, b, c, A, B: BB, C: 180 - A - BB })] }
    }
    case 'ASA': {
      const AA = 180 - B - C
      if (AA <= EPS) return { ok: false, error: 'angleSum' }
      const k = a / Math.sin(rad(AA))
      return { ok: true, solutions: [complete({ a, b: k * Math.sin(rad(B)), c: k * Math.sin(rad(C)), A: AA, B, C })] }
    }
    case 'AAS': {
      const CC = 180 - A - B
      if (CC <= EPS) return { ok: false, error: 'angleSum' }
      const k = a / Math.sin(rad(A))
      return { ok: true, solutions: [complete({ a, b: k * Math.sin(rad(B)), c: k * Math.sin(rad(CC)), A, B, C: CC })] }
    }
    case 'SSA': {
      if (A >= 180) return { ok: false, error: 'angleSum' }
      const sinB = (b * Math.sin(rad(A))) / a
      if (sinB > 1 + 1e-12) return { ok: false, error: 'noSolution' }
      const B1 = deg(Math.asin(Math.min(1, sinB)))
      const out: TriangleInfo[] = []
      for (const BB of Math.abs(sinB - 1) < 1e-12 ? [90] : [B1, 180 - B1]) {
        const CC = 180 - A - BB
        if (CC <= EPS) continue
        const cc = (a * Math.sin(rad(CC))) / Math.sin(rad(A))
        out.push(complete({ a, b, c: cc, A, B: BB, C: CC }))
      }
      return out.length ? { ok: true, solutions: out } : { ok: false, error: 'noSolution' }
    }
  }
}

/** Vértices para dibujar (A en el origen, B sobre el eje x, C arriba). */
export function triangleVertices(t: Triangle): { A: [number, number]; B: [number, number]; C: [number, number] } {
  return { A: [0, 0], B: [t.c, 0], C: [t.b * Math.cos(rad(t.A)), t.b * Math.sin(rad(t.A))] }
}

// MARK: Figuras

export type ShapeId = 'rectangle' | 'square' | 'parallelogram' | 'trapezoid' | 'rhombus' | 'polygon' | 'ellipse'

export const SHAPE_FIELDS: Record<ShapeId, string[]> = {
  rectangle: ['b', 'h'],
  square: ['l'],
  parallelogram: ['b', 'h', 's'],
  trapezoid: ['B', 'b', 'h'],
  rhombus: ['D', 'd'],
  polygon: ['n', 'l'],
  ellipse: ['a', 'b']
}

export interface ShapeResult {
  area: number
  perimeter: number
  /** LaTeX de las fórmulas (con los símbolos, sin números). */
  areaTex: string
  perimeterTex: string
  extra?: { apothem?: number; diagonal?: number; side?: number; interiorAngle?: number }
}

/** Área y perímetro de una figura. `null` si faltan datos o no tienen sentido. */
export function shapeMeasures(id: ShapeId, v: Record<string, number | undefined>): ShapeResult | null {
  const need = SHAPE_FIELDS[id]
  if (need.some((k) => v[k] === undefined || !Number.isFinite(v[k] as number) || (v[k] as number) <= 0)) return null
  const g = (k: string) => v[k] as number
  switch (id) {
    case 'rectangle':
      return { area: g('b') * g('h'), perimeter: 2 * (g('b') + g('h')), areaTex: 'A = b\\cdot h', perimeterTex: 'P = 2(b + h)', extra: { diagonal: Math.hypot(g('b'), g('h')) } }
    case 'square':
      return { area: g('l') ** 2, perimeter: 4 * g('l'), areaTex: 'A = l^2', perimeterTex: 'P = 4l', extra: { diagonal: g('l') * Math.SQRT2 } }
    case 'parallelogram':
      if (g('h') > g('s')) return null
      return { area: g('b') * g('h'), perimeter: 2 * (g('b') + g('s')), areaTex: 'A = b\\cdot h', perimeterTex: 'P = 2(b + s)' }
    case 'trapezoid': {
      // isósceles: los lados iguales salen de la altura y la diferencia de bases
      const leg = Math.hypot(g('h'), Math.abs(g('B') - g('b')) / 2)
      return { area: ((g('B') + g('b')) * g('h')) / 2, perimeter: g('B') + g('b') + 2 * leg, areaTex: 'A = \\frac{(B + b)\\,h}{2}', perimeterTex: 'P = B + b + 2\\sqrt{h^2 + \\left(\\frac{B-b}{2}\\right)^2}', extra: { side: leg } }
    }
    case 'rhombus': {
      const side = Math.hypot(g('D') / 2, g('d') / 2)
      return { area: (g('D') * g('d')) / 2, perimeter: 4 * side, areaTex: 'A = \\frac{D\\cdot d}{2}', perimeterTex: 'P = 4\\sqrt{\\left(\\frac{D}{2}\\right)^2 + \\left(\\frac{d}{2}\\right)^2}', extra: { side } }
    }
    case 'polygon': {
      const n = Math.round(g('n'))
      if (n < 3 || n > 100) return null
      const ap = g('l') / (2 * Math.tan(Math.PI / n))
      return { area: (n * g('l') * ap) / 2, perimeter: n * g('l'), areaTex: 'A = \\frac{P\\cdot a_p}{2}', perimeterTex: 'P = n\\,l', extra: { apothem: ap, interiorAngle: ((n - 2) * 180) / n } }
    }
    case 'ellipse': {
      const a = Math.max(g('a'), g('b'))
      const b = Math.min(g('a'), g('b'))
      // perímetro: aproximación de Ramanujan
      const h = ((a - b) / (a + b)) ** 2
      return { area: Math.PI * a * b, perimeter: Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h))), areaTex: 'A = \\pi a b', perimeterTex: 'P \\approx \\pi(a+b)\\left(1 + \\frac{3h}{10+\\sqrt{4-3h}}\\right)' }
    }
  }
}

// MARK: Círculo

export interface CircleInfo {
  diameter: number
  circumference: number
  area: number
  arc: number
  sector: number
  chord: number
  segment: number
}

/** Medidas del círculo de radio r y de su sector de θ grados. */
export function circleMeasures(r: number, theta: number): CircleInfo | null {
  if (!(r > 0) || !(theta >= 0) || theta > 360) return null
  const t = rad(theta)
  return {
    diameter: 2 * r,
    circumference: 2 * Math.PI * r,
    area: Math.PI * r * r,
    arc: r * t,
    sector: (r * r * t) / 2,
    chord: 2 * r * Math.sin(t / 2),
    segment: (r * r * (t - Math.sin(t))) / 2
  }
}
