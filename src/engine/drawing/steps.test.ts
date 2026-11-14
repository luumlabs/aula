import { describe, expect, it } from 'vitest'
import { makeSimParam } from '@shared/schema/visual'
import type { DrawingStep } from '@shared/schema/drawing'
import { glideEase, glideValues, highlightIndices, stepState, visibleAt } from './steps'

const params = [makeSimParam('v', undefined, 0, 10, 1, 2)]
const steps: DrawingStep[] = [
  { md: 'uno', show: 1, highlight: ['a'] },
  { md: 'dos', params: { v: 8 } },
  { md: 'tres', show: 3, params: { v: 99, nope: 1 } }
]

describe('pasos de un dibujo', () => {
  it('sin paso: todo visible, en reposo y sin rodear nada', () => {
    expect(stepState(steps, params, null)).toEqual({ show: Infinity, values: { v: 2 }, highlight: [] })
  })
  it('lo que fijan los pasos anteriores se arrastra; los valores se acotan y los nombres desconocidos se ignoran', () => {
    expect(stepState(steps, params, 0)).toEqual({ show: 1, values: { v: 2 }, highlight: ['a'] })
    expect(stepState(steps, params, 1)).toEqual({ show: 1, values: { v: 8 }, highlight: [] })
    expect(stepState(steps, params, 2)).toEqual({ show: 3, values: { v: 10 }, highlight: [] })
  })
  it('visibilidad por etapa', () => {
    expect(visibleAt({ kind: 'line' }, 0)).toBe(true)
    expect(visibleAt({ kind: 'line', stage: 2 }, 1)).toBe(false)
    expect(visibleAt({ kind: 'line', stage: 2 }, Infinity)).toBe(true)
  })
  it('índices rodeados por id', () => {
    expect([...highlightIndices([{ kind: 'line', id: 'a' }, { kind: 'line' }, { kind: 'dot', id: 'b' }], ['b', 'zz'])]).toEqual([2])
  })
  it('solo se rodea lo que ya se ve en el paso (si no, se atenuaría todo sin rodear nada)', () => {
    const items = [{ kind: 'line' as const, id: 'a' }, { kind: 'dot' as const, id: 'P', stage: 2 }]
    const at = (k: number): number => stepState([{ md: 'uno', show: 1, highlight: ['P'] }, { md: 'dos', show: 2, highlight: ['P'] }], [], k).show
    expect([...highlightIndices(items, ['P'], at(0))]).toEqual([])
    expect([...highlightIndices(items, ['P', 'a'], at(0))]).toEqual([0])
    expect([...highlightIndices(items, ['P'], at(1))]).toEqual([1])
  })
  it('el deslizamiento empieza y acaba donde debe y siempre avanza', () => {
    expect(glideEase(0)).toBe(0)
    expect(glideEase(1)).toBe(1)
    let prev = -1
    for (let k = 0; k <= 1.0001; k += 0.05) {
      const e = glideEase(k)
      expect(e).toBeGreaterThanOrEqual(prev)
      prev = e
    }
    expect(glideValues({ v: 0 }, { v: 10 }, 0.5).v).toBeCloseTo(5)
    expect(glideValues({}, { v: 10 }, 0.2).v).toBe(10)
  })
})
