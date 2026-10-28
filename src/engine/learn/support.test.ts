// Generador con semilla, matemática Beta y utilidades (de SupportTests.swift y BetaMathTests.swift).
import { describe, expect, it } from 'vitest'
import { SplitMix64, learnKitSeed } from './seededRandom'
import { BetaMath } from './betaMath'
import { clamp, finiteOr, incremented, INT_MAX, Spanish } from './support'
import { safeInt } from './studyPlanner'

describe('SplitMix64', () => {
  it('respuestas conocidas (implementación independiente en Python)', () => {
    const take = (g: SplitMix64, n: number) => Array.from({ length: n }, () => g.next())
    expect(take(new SplitMix64(0), 3)).toEqual([0xe220a8397b1dcdafn, 0x6e789e6aa1b965f4n, 0x06c45d188009454fn])
    expect(take(new SplitMix64(1), 3)).toEqual([0x910a2dec89025cc1n, 0xbeeb8da1658eec67n, 0xf893a2eefb32555en])
    expect(take(new SplitMix64(42), 3)).toEqual([0xbdd732262feb6e95n, 0x28efe333b266f103n, 0x47526757130f9f52n])
    expect(take(new SplitMix64(0xdeadbeef), 3)).toEqual([0x4adfb90f68c9eb9bn, 0xde586a3141a10922n, 0x021fbc2f8e1cfc1dn])
  })

  it('flujos deterministas y distintos', () => {
    const a = SplitMix64.withStream(7, 0), b = SplitMix64.withStream(7, 3)
    expect([a.next(), a.next()]).toEqual([0xe6984080bab12a02n, 0x953aeb70673e29cbn])
    expect([b.next(), b.next()]).toEqual([0x3fdabe86cbbeaa11n, 0x77cbc4a133c2d0f6n])
    expect(new SplitMix64(7).next()).not.toBe(SplitMix64.withStream(7, 0).next())
    expect(SplitMix64.withStream(7, 1).next()).not.toBe(SplitMix64.withStream(7, 2).next())
  })

  it('unidad y enteros acotados', () => {
    expect(Math.abs(new SplitMix64(123).nextUnit() - 0.7064912217637067)).toBeLessThan(1e-15)
    const h = new SplitMix64(5)
    expect([h.nextInt(7), h.nextInt(10), h.nextInt(100), h.nextInt(3), h.nextInt(2)]).toEqual([2, 7, 23, 0, 0])
    const r = new SplitMix64(99)
    for (let i = 0; i < 10_000; i++) {
      const u = r.nextUnit(); expect(u >= 0 && u < 1).toBe(true)
      const k = r.nextInt(13); expect(k >= 0 && k < 13).toBe(true)
    }
    expect(r.nextInt(0)).toBe(0); expect(r.nextInt(1)).toBe(0); expect(r.nextInt(-5)).toBe(0)
  })

  it('enteros uniformes', () => {
    const g = new SplitMix64(2024)
    const counts = new Array(10).fill(0)
    const n = 100_000
    for (let i = 0; i < n; i++) counts[g.nextInt(10)] += 1
    for (const c of counts) expect(Math.abs(c / n - 0.1)).toBeLessThan(0.006)
  })

  it('barajar: permutación reproducible', () => {
    const base = Array.from({ length: 50 }, (_, i) => i)
    const s1 = new SplitMix64(11).shuffled(base), s2 = new SplitMix64(11).shuffled(base), s3 = new SplitMix64(12).shuffled(base)
    expect(s1).toEqual(s2)
    expect(s1).not.toEqual(s3)
    expect([...s1].sort((a, b) => a - b)).toEqual(base)
    expect(s1).not.toEqual(base)
    const g = new SplitMix64(1)
    expect(g.shuffled([])).toEqual([]); expect(g.shuffled([7])).toEqual([7])
    const first: Record<number, number> = {}
    for (let seed = 0; seed < 2000; seed++) { const v = new SplitMix64(seed).shuffled([0, 1, 2, 3])[0]; first[v] = (first[v] ?? 0) + 1 }
    for (let k = 0; k < 4; k++) expect(Math.abs((first[k] ?? 0) / 2000 - 0.25)).toBeLessThan(0.05)
  })

  it('índice ponderado', () => {
    const g = new SplitMix64(77)
    expect(g.weightedIndex([])).toBeNull()
    const counts = [0, 0, 0]
    for (let i = 0; i < 30_000; i++) counts[g.weightedIndex([1, 2, 7]) as number] += 1
    expect(Math.abs(counts[0] / 30_000 - 0.1)).toBeLessThan(0.01)
    expect(Math.abs(counts[1] / 30_000 - 0.2)).toBeLessThan(0.012)
    expect(Math.abs(counts[2] / 30_000 - 0.7)).toBeLessThan(0.012)
    for (let i = 0; i < 500; i++) expect(g.weightedIndex([0, -3, NaN, 5, Infinity])).toBe(3)
    const seen = new Set<number>()
    for (let i = 0; i < 500; i++) seen.add(g.weightedIndex([0, 0, 0, 0]) as number)
    expect([...seen].sort()).toEqual([0, 1, 2, 3])
  })

  it('semillas desde texto (FNV-1a)', () => {
    expect(learnKitSeed('')).toBe(0xcbf29ce484222325n)
    expect(learnKitSeed('a')).toBe(0xaf63dc4c8601ec8cn)
    expect(learnKitSeed('foobar')).toBe(0x85944171f73967e8n)
    expect(learnKitSeed('tarjeta-1')).toBe(0x39480102664acb80n)
    expect(learnKitSeed('Aula')).toBe(0xdb8f728b3cafcf9cn)
    expect(learnKitSeed('tarjeta-1')).not.toBe(learnKitSeed('tarjeta-2'))
  })
})

describe('utilidades', () => {
  it('acotar, finitos, incrementos y formatos en español', () => {
    expect(clamp(5, 0, 1)).toBe(1); expect(clamp(-5, 0, 1)).toBe(0); expect(clamp(NaN, 0, 1)).toBe(0)
    expect(clamp(Infinity, 0, 1)).toBe(1); expect(clamp(-Infinity, 0, 1)).toBe(0); expect(clamp(0.3, 0, 1)).toBe(0.3)
    expect(finiteOr(NaN, 4)).toBe(4); expect(finiteOr(Infinity, 4)).toBe(4); expect(finiteOr(2, 4)).toBe(2)
    expect(incremented(5)).toBe(6); expect(incremented(INT_MAX)).toBe(INT_MAX)
    expect(Spanish.plural(1, 'día', 'días')).toBe('1 día'); expect(Spanish.plural(0, 'día', 'días')).toBe('0 días'); expect(Spanish.plural(5, 'día', 'días')).toBe('5 días')
    expect(Spanish.oneDecimal(1)).toBe('1'); expect(Spanish.oneDecimal(1.5)).toBe('1,5'); expect(Spanish.oneDecimal(12.04)).toBe('12')
    expect(Spanish.oneDecimal(0.96)).toBe('1'); expect(Spanish.oneDecimal(-1.25)).toBe('-1,3'); expect(Spanish.oneDecimal(NaN)).toBe('0')
    expect(Spanish.percent(0.354)).toBe('35 %'); expect(Spanish.percent(1.7)).toBe('100 %'); expect(Spanish.percent(-1)).toBe('0 %')
    expect(Spanish.percent(NaN)).toBe('0 %'); expect(Spanish.percentValue(0.995)).toBe(100)
    expect(Spanish.points(12.3)).toBe('12'); expect(Spanish.points(7.5)).toBe('7,5'); expect(Spanish.points(0.04)).toBe('0')
    expect(Spanish.points(9.96)).toBe('10'); expect(Spanish.points(100)).toBe('100'); expect(Spanish.points(Infinity)).toBe('0')
    expect(safeInt(Infinity)).toBe(1_000_000_000_000); expect(safeInt(-Infinity)).toBe(0)
    expect(safeInt(NaN)).toBe(0); expect(safeInt(1e30)).toBe(1_000_000_000_000); expect(safeInt(42.9)).toBe(42)
  })
})

describe('BetaMath', () => {
  const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b), `${a} ≠ ${b}`).toBeLessThanOrEqual(tol)

  it('la acumulada coincide con fórmulas cerradas', () => {
    for (let x = 0.01; x <= 0.99 + 1e-9; x += 0.02) {
      near(BetaMath.cdf(x, 1, 1), x, 1e-12)
      near(BetaMath.cdf(x, 2.5, 1), Math.pow(x, 2.5), 1e-12)
      near(BetaMath.cdf(x, 1, 3.7), 1 - Math.pow(1 - x, 3.7), 1e-12)
      near(BetaMath.cdf(x, 2, 2), 3 * x * x - 2 * x * x * x, 1e-12)
      near(BetaMath.cdf(x, 3, 2), 4 * Math.pow(x, 3) - 3 * Math.pow(x, 4), 1e-12)
      near(BetaMath.cdf(x, 0.5, 0.5), (2 / Math.PI) * Math.asin(Math.sqrt(x)), 1e-11)
    }
  })

  it('simetría y mediana', () => {
    for (const [a, b] of [[0.3, 0.7], [2, 5], [10, 3], [50, 50], [0.25, 2.25]]) {
      for (const x of [0.05, 0.3, 0.5, 0.77, 0.95]) near(BetaMath.cdf(x, a, b), 1 - BetaMath.cdf(1 - x, b, a), 1e-11)
    }
    for (const a of [0.3, 1, 5, 50, 300]) near(BetaMath.cdf(0.5, a, a), 0.5, 1e-10)
  })

  it('bordes y monotonía', () => {
    expect(BetaMath.cdf(0, 2, 3)).toBe(0); expect(BetaMath.cdf(-1, 2, 3)).toBe(0)
    expect(BetaMath.cdf(1, 2, 3)).toBe(1); expect(BetaMath.cdf(7, 2, 3)).toBe(1); expect(BetaMath.cdf(NaN, 2, 3)).toBe(0)
    let last = 0
    for (let i = 0; i <= 100; i++) {
      const c = BetaMath.cdf(i / 100, 4.2, 1.7)
      expect(c).toBeGreaterThanOrEqual(last - 1e-15)
      expect(c >= 0 && c <= 1).toBe(true)
      last = c
    }
  })

  it('parámetros grandes ≈ normal', () => {
    const a = 300, b = 100
    const mean = a / (a + b), sd = Math.sqrt(BetaMath.variance(a, b))
    near(BetaMath.cdf(mean, a, b), 0.5, 0.02)
    near(BetaMath.cdf(mean + 1.2816 * sd, a, b), 0.9, 0.01)
    near(BetaMath.cdf(mean - 1.2816 * sd, a, b), 0.1, 0.01)
  })

  it('el cuantil invierte la acumulada', () => {
    for (const [a, b] of [[1, 1], [0.25, 2.25], [2, 7], [9, 1], [40, 12], [0.5, 0.5]]) {
      for (const p of [0.001, 0.1, 0.25, 0.5, 0.9, 0.999]) near(BetaMath.cdf(BetaMath.quantile(p, a, b), a, b), p, 1e-9)
    }
    expect(BetaMath.quantile(0, 2, 3)).toBe(0); expect(BetaMath.quantile(1, 2, 3)).toBe(1)
    expect(BetaMath.quantile(-0.2, 2, 3)).toBe(0); expect(BetaMath.quantile(1.7, 2, 3)).toBe(1)
    near(BetaMath.quantile(0.5, 6, 6), 0.5, 1e-12)
    near(BetaMath.quantile(0.2, 9, 1), Math.pow(0.2, 1 / 9), 1e-12)
  })

  it('ajuste por momentos', () => {
    for (const [a, b] of [[2, 5], [0.3, 0.9], [30, 4], [1, 1]]) {
      const m = BetaMath.match(BetaMath.mean(a, b), BetaMath.variance(a, b))
      expect(m).not.toBeNull()
      near(m!.a, a, 1e-9); near(m!.b, b, 1e-9)
    }
    expect(BetaMath.match(0, 0.01)).toBeNull(); expect(BetaMath.match(1, 0.01)).toBeNull(); expect(BetaMath.match(0.5, 0)).toBeNull()
    expect(BetaMath.match(0.5, 0.3)).toBeNull(); expect(BetaMath.match(NaN, 0.01)).toBeNull()
  })

  it('media, varianza y log Γ', () => {
    near(BetaMath.mean(2, 6), 0.25, 1e-15); near(BetaMath.variance(1, 1), 1 / 12, 1e-15); near(BetaMath.variance(2, 2), 0.05, 1e-15)
    near(BetaMath.logGamma(1), 0, 1e-13); near(BetaMath.logGamma(2), 0, 1e-13)
    near(BetaMath.logGamma(5), Math.log(24), 1e-12); near(BetaMath.logGamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-12)
  })
})
