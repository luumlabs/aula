// Sólidos geométricos del visor 3D (port de Model3DScene.polyhedron/dimensionLabels en StudyUI/Blocks/Model3D/Model3DView.swift):
// vértices y caras de los poliedros con la arista pedida, las medidas que se rotulan y el radio que ocupa cada sólido.
// Lógica pura (con pruebas: la arista del dodecaedro mide `a`, no a/φ).
import type { Solid3D } from '@shared/schema/visual'
import type { Vec3 } from './molecules'

export interface Polyhedron { vertices: Vec3[]; faces: number[][] }

const PHI = (1 + Math.sqrt(5)) / 2

/** Medidas seguras (0,01…500): un archivo dañado no debe llegar a la geometría. */
export function sanitizeSolid(s: Solid3D): Solid3D {
  const d = (v: number | undefined): number | undefined => (v === undefined ? undefined : Number.isFinite(v) ? Math.min(Math.max(v, 0.01), 500) : 1)
  const p = (v: number): number => (Number.isFinite(v) ? Math.min(Math.max(v, -1000), 1000) : 0)
  return {
    ...s, a: d(s.a), w: d(s.w), h: d(s.h), d: d(s.d), r: d(s.r), r2: s.r2 === undefined ? undefined : Number.isFinite(s.r2) ? Math.min(Math.max(s.r2, 0), 500) : 0,
    x: p(s.x), y: p(s.y), z: p(s.z), opacity: s.opacity === undefined ? undefined : Number.isFinite(s.opacity) ? Math.min(Math.max(s.opacity, 0), 1) : 1
  }
}

export function polyhedron(s: Solid3D): Polyhedron | undefined {
  const a = s.a ?? s.w ?? 2
  switch (s.shape) {
    case 'cube': case 'box': {
      const w = (s.shape === 'cube' ? a : s.w ?? s.a ?? 2) / 2, h = (s.shape === 'cube' ? a : s.h ?? s.a ?? 2) / 2, d = (s.shape === 'cube' ? a : s.d ?? s.a ?? 2) / 2
      return {
        vertices: [[-w, -h, -d], [w, -h, -d], [w, h, -d], [-w, h, -d], [-w, -h, d], [w, -h, d], [w, h, d], [-w, h, d]],
        faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]]
      }
    }
    case 'prism': case 'pyramid': {
      const n = Math.max(3, Math.min(24, s.sides ?? (s.shape === 'pyramid' ? 4 : 3)))
      const h = s.h ?? 3
      // radio de la base para que la arista mida a
      const r = a / (2 * Math.sin(Math.PI / n))
      const base: Vec3[] = Array.from({ length: n }, (_, k) => {
        const t = (2 * Math.PI * k) / n + Math.PI / n - Math.PI / 2
        return [r * Math.cos(t), -h / 2, r * Math.sin(t)]
      })
      if (s.shape === 'prism') {
        const top = base.map((v) => [v[0], h / 2, v[2]] as Vec3)
        const faces = [Array.from({ length: n }, (_, k) => n - 1 - k), Array.from({ length: n }, (_, k) => n + k)]
        for (let k = 0; k < n; k++) faces.push([k, (k + 1) % n, n + ((k + 1) % n), n + k])
        return { vertices: [...base, ...top], faces }
      }
      const faces = [Array.from({ length: n }, (_, k) => n - 1 - k)]
      for (let k = 0; k < n; k++) faces.push([k, (k + 1) % n, n])
      return { vertices: [...base, [0, h / 2, 0]], faces }
    }
    case 'tetrahedron': {
      const k = a / (2 * Math.SQRT2)
      return { vertices: [[k, k, k], [k, -k, -k], [-k, k, -k], [-k, -k, k]], faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]] }
    }
    case 'octahedron': {
      const k = a / Math.SQRT2
      return {
        vertices: [[k, 0, 0], [-k, 0, 0], [0, k, 0], [0, -k, 0], [0, 0, k], [0, 0, -k]],
        faces: [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]]
      }
    }
    case 'icosahedron': {
      const k = a / 2
      const raw: Vec3[] = [[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]]
      return {
        vertices: raw.map((v) => [v[0] * k, v[1] * k, v[2] * k] as Vec3),
        faces: [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
      }
    }
    case 'dodecahedron': {
      // Las coordenadas canónicas tienen arista 2/φ; con k = a·φ/2 la arista mide a. Dividir otra vez por φ la dejaba en a/φ (UIJ35).
      const q = 1 / PHI, k = (a * PHI) / 2
      const raw: Vec3[] = [[1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1], [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
        [0, q, PHI], [0, q, -PHI], [0, -q, PHI], [0, -q, -PHI], [q, PHI, 0], [q, -PHI, 0], [-q, PHI, 0], [-q, -PHI, 0], [PHI, 0, q], [PHI, 0, -q], [-PHI, 0, q], [-PHI, 0, -q]]
      return {
        vertices: raw.map((v) => [v[0] * k, v[1] * k, v[2] * k] as Vec3),
        faces: [[0, 8, 10, 2, 16], [0, 16, 17, 1, 12], [0, 12, 14, 4, 8], [1, 17, 3, 11, 9], [1, 9, 5, 14, 12], [2, 10, 6, 15, 13], [2, 13, 3, 17, 16], [3, 13, 15, 7, 11], [4, 14, 5, 19, 18], [4, 18, 6, 10, 8], [5, 9, 11, 7, 19], [6, 18, 19, 7, 15]]
      }
    }
    default: return undefined
  }
}

/** Aristas únicas de un poliedro (pares de vértices). */
export function polyEdges(p: Polyhedron): Array<[number, number]> {
  const seen = new Set<string>()
  const out: Array<[number, number]> = []
  for (const f of p.faces) for (let k = 0; k < f.length; k++) {
    const a = f[k], b = f[(k + 1) % f.length]
    const key = `${Math.min(a, b)}-${Math.max(a, b)}`
    if (!seen.has(key)) { seen.add(key); out.push([a, b]) }
  }
  return out
}

/** Triángulos de las caras (abanico), con la normal de cada cara (para sombrear plano). */
export function faceTriangles(p: Polyhedron): { positions: number[]; normals: number[] } {
  const positions: number[] = [], normals: number[] = []
  for (const f of p.faces) {
    if (f.length < 3) continue
    const a = p.vertices[f[0]], b = p.vertices[f[1]], c = p.vertices[f[2]]
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const l = Math.hypot(n[0], n[1], n[2]) || 1
    n = n.map((x) => x / l)
    for (let k = 1; k < f.length - 1; k++) {
      for (const idx of [f[0], f[k], f[k + 1]]) {
        positions.push(...p.vertices[idx])
        normals.push(...n)
      }
    }
  }
  return { positions, normals }
}

/** Radio del sólido (desde su centro): de los vértices o de sus medidas. */
export function solidRadius(s: Solid3D): number {
  const p = polyhedron(s)
  if (p) return p.vertices.reduce((m, v) => Math.max(m, Math.hypot(v[0], v[1], v[2])), 0)
  const r = s.r ?? (s.a ?? 2) / 2, h = s.h ?? 3
  switch (s.shape) {
    case 'sphere': return r
    case 'torus': return r + (s.r2 ?? r / 3)
    case 'cylinder': case 'cone': case 'capsule': return Math.hypot(r, Math.max(h, 2 * r) / 2)
    default: return Math.sqrt(3)
  }
}

export const PLATONIC = new Set(['tetrahedron', 'octahedron', 'icosahedron', 'dodecahedron'])

/** Medidas que se rotulan (texto y posición, relativa al centro del sólido). `n` da formato a los números. */
export function dimensionLabels(s: Solid3D, n: (v: number) => string): Array<{ text: string; at: Vec3 }> {
  switch (s.shape) {
    case 'cube': { const a = (s.a ?? 2) / 2; return [{ text: `a = ${n(s.a ?? 2)}`, at: [0, -a - 0.35, a] }] }
    case 'box': {
      const w = (s.w ?? 2) / 2, h = (s.h ?? 2) / 2, d = (s.d ?? 2) / 2
      return [{ text: n(s.w ?? 2), at: [0, -h - 0.35, d] }, { text: n(s.h ?? 2), at: [w + 0.35, 0, d] }, { text: n(s.d ?? 2), at: [w + 0.35, -h - 0.2, 0] }]
    }
    case 'sphere': { const r = s.r ?? 1; return [{ text: `r = ${n(r)}`, at: [r / 2, 0.25, r] }] }
    case 'cylinder': case 'cone': {
      const r = s.r ?? 1, h = s.h ?? 3
      return [{ text: `r = ${n(r)}`, at: [r / 2, -h / 2 - 0.3, r] }, { text: `h = ${n(h)}`, at: [r + 0.45, 0, 0] }]
    }
    case 'prism': case 'pyramid': { const h = s.h ?? 3; return [{ text: `a = ${n(s.a ?? 2)}`, at: [0, -h / 2 - 0.35, s.a ?? 2] }, { text: `h = ${n(h)}`, at: [(s.a ?? 2) + 0.3, 0, 0] }] }
    default:
      // los sólidos platónicos: la arista, encima del sólido
      return PLATONIC.has(s.shape) ? [{ text: `a = ${n(s.a ?? 2)}`, at: [0, solidRadius(s) + 0.4, 0] }] : []
  }
}

/** Longitud de la arista más corta (para comprobar la escala de los poliedros). */
export function shortestEdge(p: Polyhedron): number {
  return polyEdges(p).reduce((m, [a, b]) => {
    const u = p.vertices[a], v = p.vertices[b]
    return Math.min(m, Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]))
  }, Infinity)
}
