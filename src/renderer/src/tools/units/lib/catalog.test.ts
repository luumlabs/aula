import { describe, expect, it } from 'vitest'
import { CATEGORIES, categoryById, convert, ratio, unitIn } from './catalog'

const conv = (cat: string, v: number, a: string, b: string) => {
  const c = categoryById(cat)
  return convert(v, unitIn(c, a), unitIn(c, b))
}

describe('conversor', () => {
  it('convierte longitudes exactas', () => {
    expect(conv('length', 1, 'mi', 'km')).toBeCloseTo(1.609344, 12)
    expect(conv('length', 12, 'in', 'ft')).toBeCloseTo(1, 12)
  })
  it('convierte temperaturas con desplazamiento sin ruido', () => {
    expect(conv('temperature', 100, 'C', 'F')).toBeCloseTo(212, 10)
    expect(conv('temperature', 32, 'F', 'C')).toBe(0)
    expect(conv('temperature', 0, 'C', 'K')).toBeCloseTo(273.15, 10)
    expect(conv('temperature', -40, 'C', 'F')).toBeCloseTo(-40, 10)
  })
  it('usa factores por definición', () => {
    expect(conv('mass', 1, 'kg', 'lb')).toBeCloseTo(2.20462262185, 10)
    expect(conv('pressure', 1, 'atm', 'mmHg')).toBeCloseTo(760, 9)
    expect(conv('speed', 36, 'kmh', 'ms')).toBeCloseTo(10, 12)
    expect(conv('data', 1, 'GiB', 'MiB')).toBe(1024)
    expect(conv('angle', 180, 'deg', 'rad')).toBeCloseTo(Math.PI, 12)
    expect(conv('energy', 1, 'kcal', 'kJ')).toBeCloseTo(4.184, 12)
  })
  it('da la razón entre unidades salvo con temperaturas', () => {
    const l = categoryById('length')
    expect(ratio(unitIn(l, 'km'), unitIn(l, 'm'))).toBe(1000)
    const t = categoryById('temperature')
    expect(ratio(unitIn(t, 'C'), unitIn(t, 'F'))).toBeNull()
  })
  it('tiene unidades por defecto que existen', () => {
    for (const c of CATEGORIES) {
      expect(c.units.some((x) => x.id === c.from)).toBe(true)
      expect(c.units.some((x) => x.id === c.to)).toBe(true)
      expect(new Set(c.units.map((x) => x.id)).size).toBe(c.units.length)
    }
  })
})
