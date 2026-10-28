import { describe, expect, it } from 'vitest'
import { ALL_ELEMENTS, PeriodicTable } from '@engine/chem/elements'
import { ElectronConfiguration } from '@engine/chem/electron-config'
import { COVALENT_RADIUS, DISCOVERY_YEAR, configTokens, covalentRadius, discovery, propertyScale, propertyValue, scalePosition } from './extra'

describe('datos extra de los elementos', () => {
  it('cubre los 118 elementos', () => {
    expect(COVALENT_RADIUS).toHaveLength(118)
    expect(DISCOVERY_YEAR).toHaveLength(118)
  })
  it('sigue la tendencia periódica del radio', () => {
    // baja a lo largo de un periodo y sube en un grupo
    expect(covalentRadius(3)!).toBeGreaterThan(covalentRadius(9)!)
    expect(covalentRadius(55)!).toBeGreaterThan(covalentRadius(37)!)
    expect(covalentRadius(118)).toBeNull()
  })
  it('da los años de descubrimiento', () => {
    expect(discovery(26)).toBe('ancient')
    expect(discovery(74)).toEqual({ year: 1783, approx: false })
    expect(discovery(33)).toEqual({ year: 1250, approx: true })
    expect(discovery(118)).toEqual({ year: 2002, approx: false })
  })
})

describe('mapa de calor', () => {
  it('lee las propiedades del motor', () => {
    const f = PeriodicTable.bySymbol('F')!
    expect(propertyValue(f, 'electronegativity')).toBe(3.98)
    expect(propertyValue(PeriodicTable.bySymbol('Tc')!, 'mass')).toBeNull()
  })
  it('coloca los valores en la escala', () => {
    const s = propertyScale(ALL_ELEMENTS, 'electronegativity')
    expect(s.max).toBe(3.98)
    expect(scalePosition(3.98, s)).toBe(1)
    const d = propertyScale(ALL_ELEMENTS, 'density')
    expect(d.log).toBe(true)
    expect(scalePosition(22.59, d)).toBeGreaterThan(0.95)
  })
})

describe('configuración', () => {
  it('parte la configuración abreviada', () => {
    const fe = ElectronConfiguration.groundState(PeriodicTable.bySymbol('Fe')!)
    const tok = configTokens(fe.text({ abbreviated: true, notation: 'plain' }))
    expect(tok.core).toBe('Ar')
    expect(tok.parts).toEqual([{ orbital: '4s', count: '2' }, { orbital: '3d', count: '6' }])
    expect(fe.shells).toEqual([2, 8, 14, 2])
  })
})
