// Azar con semilla para la pintura: el mismo dibujo en cada arranque (y en cada máquina).

/** Semilla estable de un texto (FNV-1a de 32 bits). */
export function seedOf(text: string | number): number {
  const s = String(text)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export type Rng = () => number

/** mulberry32: rápido, de 32 bits y reproducible. Devuelve [0, 1). */
export function rngFrom(seed: number): Rng {
  let a = seed >>> 0 || 0x9e3779b9
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Normal estándar (Box-Muller), acotada a ±3 σ para que ningún punto salga disparado. */
export function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng())
  const v = rng()
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  return Math.max(-3, Math.min(3, z))
}

export function between(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng()
}
