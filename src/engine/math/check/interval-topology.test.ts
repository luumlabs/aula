import { describe, expect, it } from 'vitest'
import { MathParser } from '../parse/parser'
import { toPlain } from '../print/plain'
import { has } from '../test-support.testutil'
import { AnswerChecker } from './answer-checker'
import { IntervalParsing, RealSet, type RealInterval } from './interval-checker'

/** Siguiente `number` hacia +∞ (`Double.nextUp`), para x ≥ 0 finito. */
function nextUp(x: number): number {
  const f = new Float64Array([x])
  const u = new BigUint64Array(f.buffer)
  u[0] += 1n
  return f[0]
}

const span = (lo: number, hi: number, lc = false, hc = false): RealInterval => ({ lo, hi, loClosed: lc, hiClosed: hc, loExpr: null, hiExpr: null })

function component(set: RealSet, index: number, lo: number, hi: number, lc: boolean, hc: boolean): void {
  const i = set.intervals[index]
  expect(i, `componente ${index}`).toBeDefined()
  if (!i) return
  expect(i.lo).toBe(lo)
  expect(i.hi).toBe(hi)
  expect(i.loClosed).toBe(lc)
  expect(i.hiClosed).toBe(hc)
}

const check = (input: string, expected: string) => AnswerChecker.checkInterval(input, expected)

describe('IntervalTopologyTests', () => {
  it('positive widths survive at tiny, large, adjacent and subnormal scales', () => {
    const bounds: Array<[number, number]> = [[0, 1e-13], [1e12, 1e12 + 1], [1, nextUp(1)], [0, Number.MIN_VALUE], [Number.MIN_VALUE, nextUp(Number.MIN_VALUE)]]
    for (const [lo, hi] of bounds) {
      const set = new RealSet([span(lo, hi)])
      expect(set.isEmpty).toBe(false)
      expect(set.intervals.length).toBe(1)
      component(set, 0, lo, hi, false, false)
    }
  })

  it('closed adjacent endpoints remain an interval', () => {
    const set = new RealSet([span(1, nextUp(1), true, true)])
    expect(set.intervals.length).toBe(1)
    component(set, 0, 1, nextUp(1), true, true)
  })

  it('an empty answer cannot replace a positive-width interval', () => {
    for (const key of ['(0;1e-13)', '(1000000000000;1000000000001)', '(1;1.0000000000000002)']) {
      const v = check('∅', key)
      expect(v.status, key).toBe('incorrect')
      expect(v.credit, key).toBe(0)
      expect(has(v, 'missingSolution'), key).toBe(true)
      expect(check(key, key).status, key).toBe('correct')
    }
  })

  it('singleton and short closed interval differ in both directions', () => {
    const missing = check('{1}', '[1;1.0000000000000002]')
    expect(missing.status).toBe('incorrect')
    expect(missing.credit).toBe(0)
    expect(has(missing, 'missingSolution')).toBe(true)
    const extra = check('[1;1.0000000000000002]', '{1}')
    expect(extra.status).toBe('incorrect')
    expect(extra.credit).toBe(0)
    expect(has(extra, 'extraSolution')).toBe(true)
  })

  it('nearby points do not merge', () => {
    const set = new RealSet([span(0, 0, true, true), span(1e-13, 1e-13, true, true)])
    expect(set.intervals.length).toBe(2)
    component(set, 0, 0, 0, true, true)
    component(set, 1, 1e-13, 1e-13, true, true)
    expect(set.contains(5e-14)).toBe(false)
    expect(check('{0}', '{0;1e-13}').status).not.toBe('correct')
  })

  it('membership does not thicken closed bounds or points', () => {
    const point = new RealSet([span(0, 0, true, true)])
    expect(point.contains(0)).toBe(true)
    expect(point.contains(1e-13)).toBe(false)
    const set = new RealSet([span(0, 1, true, true)])
    expect(set.contains(0)).toBe(true)
    expect(set.contains(1)).toBe(true)
    expect(set.contains(-1e-13)).toBe(false)
    expect(set.contains(nextUp(1))).toBe(false)
  })

  it('a positive gap remains in the union', () => {
    const set = new RealSet([span(0, 1, true, true), span(1.0000000000001, 2, true, true)])
    expect(set.intervals.length).toBe(2)
    component(set, 0, 0, 1, true, true)
    component(set, 1, 1.0000000000001, 2, true, true)
    expect(set.contains(1.00000000000005)).toBe(false)
    const v = check('[0;2]', '[0;1] U [1.0000000000001;2]')
    expect(v.status).toBe('incorrect')
    expect(has(v, 'extraSolution')).toBe(true)
  })

  it('a nested smaller upper does not close the outer upper', () => {
    const set = new RealSet([span(0, 1), span(0.5, 0.9999999999999, false, true)])
    expect(set.intervals.length).toBe(1)
    component(set, 0, 0, 1, false, false)
    expect(set.contains(1)).toBe(false)
    expect(check('(0;1) U (0.5;0.9999999999999]', '(0;1)').status).toBe('correct')
  })

  it('intersection keeps the closure of the larger lower', () => {
    const set = new RealSet([span(1e-13, 1, true, true)]).intersection(new RealSet([span(0, 2, false, true)]))
    expect(set.intervals.length).toBe(1)
    component(set, 0, 1e-13, 1, true, true)
    expect(check('x>=1e-13 y x>0 y x<=1', '[1e-13;1]').status).toBe('correct')
  })

  it('intersection keeps the closure of the smaller upper', () => {
    const set = new RealSet([span(0, 1, true, true)]).intersection(new RealSet([span(-1, 1.0000000000001, true, false)]))
    expect(set.intervals.length).toBe(1)
    component(set, 0, 0, 1, true, true)
    expect(check('x<=1 y x<1.0000000000001 y x>=0', '[0;1]').status).toBe('correct')
  })

  it('exact sorting is independent of input order', () => {
    const items = [span(2, 3, true, true), span(2.5, 2.9, true, true), span(1, 1, true, true), span(nextUp(1), nextUp(1), true, true), span(0, 0.5, true, true)]
    for (const permutation of [items, [...items].reverse(), [...items.slice(1), items[0]]]) {
      const set = new RealSet(permutation)
      expect(set.intervals.length).toBe(4)
      component(set, 0, 0, 0.5, true, true)
      component(set, 1, 1, 1, true, true)
      component(set, 2, nextUp(1), nextUp(1), true, true)
      component(set, 3, 2, 3, true, true)
    }
  })

  it('closed contacts and real overlaps still merge', () => {
    for (const items of [[span(0, 1, true, false), span(1, 2, true, true)], [span(0, 1, true, true), span(1, 2, false, true)]]) {
      const set = new RealSet(items)
      expect(set.intervals.length).toBe(1)
      component(set, 0, 0, 2, true, true)
    }
    const overlap = new RealSet([span(0, 2), span(1, 3)])
    expect(overlap.intervals.length).toBe(1)
    component(overlap, 0, 0, 3, false, false)
  })

  it('a both-open contact keeps the missing point', () => {
    const set = new RealSet([span(0, 1), span(1, 2)])
    expect(set.intervals.length).toBe(2)
    expect(set.contains(1)).toBe(false)
    const v = check('(0;1) U (1;2)', '(0;2)')
    expect(v.status).toBe('partial')
    expect(v.credit).toBe(0.5)
    expect(has(v, 'wrongInterval')).toBe(true)
  })

  it('genuine empty, singleton and infinity controls', () => {
    expect(RealSet.empty.isEmpty).toBe(true)
    expect(RealSet.empty.complement().equals(RealSet.all)).toBe(true)
    expect(RealSet.all.complement().isEmpty).toBe(true)
    expect(check('[2;2]', '{2}').status).toBe('correct')
    expect(check('∅', 'x<1 y x>2').status).toBe('correct')
    expect(check('R', '(-inf;inf)').status).toBe('correct')
    expect(check('[0;inf]', '[0;inf)').status).toBe('formatProblem')
    expect(RealSet.all.contains(Infinity)).toBe(false)
    expect(RealSet.all.contains(-Infinity)).toBe(false)
  })

  it('the complement retains cells between adjacent points', () => {
    const hi = nextUp(1)
    const points = new RealSet([span(1, 1, true, true), span(hi, hi, true, true)])
    const complement = points.complement()
    expect(complement.intervals.length).toBe(3)
    component(complement, 0, -Infinity, 1, false, false)
    component(complement, 1, 1, hi, false, false)
    component(complement, 2, hi, Infinity, false, false)
    const restored = complement.complement()
    expect(restored.intervals.length).toBe(2)
    component(restored, 0, 1, 1, true, true)
    component(restored, 1, hi, hi, true, true)
  })

  it('huge finite cells do not become endpoint-only differences', () => {
    const input = '(1e300*1e8;1e300*1.7e8)'
    const expected = '(1e300*1e8;1e300*1.79e8)'
    for (const fixture of [input, expected]) expect(IntervalParsing.parse(fixture).ok, fixture).toBe(true)
    const v = check(input, expected)
    expect(v.status).toBe('incorrect')
    expect(v.credit).toBe(0)
    expect(has(v, 'missingSolution')).toBe(true)
  })

  it('huge tails do not need an offset sample', () => {
    const input = '(-1e300*1e8;inf)'
    const expected = '(-inf;-1e300*1e8)'
    for (const fixture of [input, expected]) expect(IntervalParsing.parse(fixture).ok, fixture).toBe(true)
    const v = check(input, expected)
    expect(v.status).toBe('incorrect')
    expect(has(v, 'wrongInterval')).toBe(true)
    expect(has(v, 'signError')).toBe(true)
  })

  it('distinct cuts expose a missing narrow gap', () => {
    const v = check('[0;1] U [1.0000000000001;2]', '[0;2]')
    expect(v.status).toBe('incorrect')
    expect(v.credit).toBe(0)
    expect(has(v, 'missingSolution')).toBe(true)
  })

  it('only endpoint differences keep partial credit', () => {
    const v = check('[2;5]', '(2;5)')
    expect(v.status).toBe('partial')
    expect(v.credit).toBe(0.5)
    expect(v.diagnosis).toEqual(['wrongInterval'])
    expect(v.message).toBeDefined()
  })

  it('corresponding endpoint tolerance remains compatible', () => {
    expect(check('[1.414213562;2]', '[sqrt(2);2]').status).toBe('correct')
    expect(check('[1.0000000005;3]', '[1;3]').status).toBe('correct')
    expect(check('{1.0000000005}', '{1}').status).toBe('correct')
    expect(check('{1e-13}', '{0}').status).toBe('correct')
    expect(check('{0}', '{1e-13}').status).not.toBe('correct')
  })

  it('syntax and degree label controls remain available', () => {
    expect(check('2<x<=7', '(2;7]').status).toBe('correct')
    expect(check('{x | x ≠ 1}', '(-inf;1) U (1;inf)').status).toBe('correct')
    expect(check('[1,5;3]', '[1.5;3]').status).toBe('correct')
    expect(check('[0°;90°)', '[0;90)').status).toBe('correct')
    expect(check('[0;90)', '[0°;90°)').status).toBe('correct')
    expect(AnswerChecker.checkInterval('[0;asin(1/2)]', '[0;30]', 'degrees').status).toBe('correct')
  })

  it('invalid intervals keep format problems', () => {
    for (const [input, key] of [['(5;2)', '(2;5)'], ['(1;1)', '(0;1)'], ['x<y', '(0;1)'], ['', '(0;1)'], ['(0;1)', '(2;1)']]) {
      expect(check(input, key).status, `${input} / ${key}`).toBe('formatProblem')
    }
  })

  it('the upper expression tracks the really larger endpoint', () => {
    const hi = MathParser.parse('1.0000000000001')
    const a: RealInterval = { lo: 0, hi: 1, loClosed: true, hiClosed: false, loExpr: MathParser.parse('0'), hiExpr: MathParser.parse('1') }
    const b: RealInterval = { lo: 0.5, hi: 1.0000000000001, loClosed: false, hiClosed: true, loExpr: MathParser.parse('0.5'), hiExpr: hi }
    const set = new RealSet([a, b])
    expect(set.intervals.length).toBe(1)
    component(set, 0, 0, 1.0000000000001, true, true)
    const he = set.intervals[0]?.hiExpr
    expect(he ? toPlain(he) : null).toBe(toPlain(hi))
    expect(set.plain).toContain(toPlain(hi))
  })
})
