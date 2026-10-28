// Pruebas de los valores JSON (port de JSONValueTests en la app Swift anterior: Tests/BaseKitTests/BaseKitTests.swift).
import { describe, expect, it } from 'vitest'
import {
  asBool, asDouble, asInt, asText, compactJSON, jsonDepth, jsonEqual, numberText, parseJSON, parseJSONValue, RawNumber, Schema, stringifyJSON, toPlainJSON,
  type JSONObject
} from './json'

describe('JSONValue', () => {
  it('ida y vuelta y accesos', () => {
    const v: JSONObject = { a: 1, b: [true, null, 'x'], c: { d: 2.5 } }
    const back = parseJSON(stringifyJSON(v)) as JSONObject
    expect(back).toEqual(v)
    expect(back.a).toBe(1)
    expect((back.b as unknown[])[2]).toBe('x')
    expect((back.c as JSONObject).d).toBe(2.5)
    expect(asText(3)).toBe('3')
  })

  it('escribe como el codificador de Swift: claves ordenadas, sin escapar «/», sin claves undefined', () => {
    expect(stringifyJSON({ b: 1, a: 'x/y', c: undefined }, { pretty: false })).toBe('{"a":"x/y","b":1}')
    expect(stringifyJSON({ z: [], y: {} })).toBe('{\n  "y": {},\n  "z": []\n}')
    expect(stringifyJSON([1, Number.NaN, Infinity], { pretty: false })).toBe('[1,null,null]')
  })

  it('conserva los enteros grandes (semillas UInt64) sin perder cifras', () => {
    const v = parseJSON('{"seed": 18446744073709551615, "small": 42, "f": 1.5}') as JSONObject
    expect(v.seed).toBeInstanceOf(RawNumber)
    expect(String(v.seed)).toBe('18446744073709551615')
    expect(v.small).toBe(42)
    expect(stringifyJSON(v, { pretty: false })).toBe('{"f":1.5,"seed":18446744073709551615,"small":42}')
    expect(toPlainJSON(v)).toEqual({ seed: 18446744073709552000, small: 42, f: 1.5 })
  })

  it('rechaza el anidamiento absurdo', () => {
    expect(() => parseJSONValue('['.repeat(600) + ']'.repeat(600))).toThrow()
    expect(() => parseJSONValue('['.repeat(60) + '1' + ']'.repeat(60))).not.toThrow()
    expect(jsonDepth({ a: [{ b: 1 }] })).toBe(3)
  })

  it('lee valores con tolerancia', () => {
    expect(asBool('sí')).toBe(true)
    expect(asBool('no')).toBe(false)
    expect(asBool('quizá')).toBeUndefined()
    expect(asDouble(' 2.5 ')).toBe(2.5)
    expect(asDouble('abc')).toBeUndefined()
    expect(asInt('3.6')).toBe(4)
    expect(asText(true)).toBe('true')
    expect(asText(null)).toBe('')
    expect(asText({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('escribe los números como Double.description de Swift', () => {
    expect(numberText(3)).toBe('3')
    expect(numberText(2.5)).toBe('2.5')
    expect(numberText(0.00001)).toBe('1e-05')
    expect(numberText(1.5e20)).toBe('1.5e+20')
  })

  it('compara sin importar el orden de las claves', () => {
    expect(jsonEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true)
    expect(compactJSON({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}')
  })

  it('construye esquemas para las herramientas', () => {
    const s = Schema.object([['q', Schema.string('pregunta')], ['n', Schema.integer(undefined, 1)]], { required: ['q'] })
    expect((s.required as string[])[0]).toBe('q')
    expect(((s.properties as JSONObject).n as JSONObject).type).toBe('integer')
    expect(((s.properties as JSONObject).n as JSONObject).minimum).toBe(1)
    expect(s.additionalProperties).toBe(false)
  })
})
