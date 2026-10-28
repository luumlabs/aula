import { describe, expect, it } from 'vitest'
import type { Answer } from '@shared/schema/exercises'
import { chemKeys, functionsIn, KEYS, keysFor, variablesIn } from './keys'

const labels = (groups: { label: string }[][]): string[][] => groups.map((g) => g.map((k) => k.label))

describe('teclas de símbolos (port de AnswerKeyboard)', () => {
  it('encuentra las variables sin funciones ni constantes', () => {
    expect(variablesIn('1 + sin(x)')).toEqual(['x'])
    expect(variablesIn('a*x^2 + b*x + c')).toEqual(['a', 'x', 'b', 'c'])
    expect(variablesIn('2*pi*r + e^t')).toEqual(['r', 't'])
    expect(variablesIn('cos(theta)')).toEqual(['θ'])
    expect(variablesIn('xy')).toEqual(['x', 'y'])
  })
  it('encuentra las funciones de la respuesta esperada', () => {
    expect(functionsIn('1 + sin(x)')).toEqual(['sin'])
    expect(functionsIn('ln(x) + exp(2x)')).toEqual(['ln', 'exp'])
    expect(functionsIn('x^2')).toEqual([])
    // «sinh» no es «sin»
    expect(functionsIn('sinh(x)')).toEqual([])
  })
  it('las teclas que retroceden dejan el cursor dentro', () => {
    expect(KEYS.sqrt.insert).toBe('√()')
    expect(KEYS.sqrt.caretBack).toBe(1)
    expect(KEYS.pi.caretBack).toBe(0)
  })
  it('numérico en grados ofrece la tecla de grado', () => {
    const deg: Answer = { kind: 'numeric', value: '30', alternatives: [], absTol: 0, relTol: 0, form: 'any', unitMode: 'ignore', angle: 'degrees' }
    const groups = labels(keysFor(deg))
    expect(groups[0]).toContain('π')
    expect(groups.flat()).toContain('°')
  })
  it('expresión: variables, básicas y funciones', () => {
    const a: Answer = { kind: 'expression', expected: '1 + sin(x)', domainMin: -1, domainMax: 1, form: 'any', forbidden: [], angle: 'radians' }
    const groups = labels(keysFor(a))
    expect(groups[0]).toEqual(['x'])
    expect(groups[groups.length - 1]).toEqual(['sin'])
    const fn = keysFor(a).flat().find((k) => k.label === 'sin')
    expect(fn).toMatchObject({ insert: 'sin()', caretBack: 1, plain: true })
  })
  it('química según el modo', () => {
    expect(labels(chemKeys('equation'))[0]).toEqual(['→', '⇌', '+'])
    expect(labels(chemKeys('configuration'))[0]).toContain('[Ar]')
    expect(chemKeys('name')).toEqual([])
  })
  it('sin teclado en lo que no es matemático', () => {
    expect(keysFor({ kind: 'truefalse', value: true, explainWhy: false })).toEqual([])
  })
})
