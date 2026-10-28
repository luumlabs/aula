import { describe, expect, it } from 'vitest'
import { LIBRARY, angleBetween, domainDirections, measuredAngle, moleculeFor, vseprFromFormula, type Molecule } from './vsepr'

const mol = (f: string): Molecule => {
  const r = moleculeFor(f)
  if (!r.ok) throw new Error(`${f}: ${r.reason}`)
  return r.molecule
}

describe('VSEPR', () => {
  it('clasifica las formas clásicas', () => {
    const cases: [string, string, number, number][] = [
      ['CO2', 'linear', 2, 0], ['BF3', 'trigonalPlanar', 3, 0], ['SO2', 'bent', 2, 1], ['CH4', 'tetrahedral', 4, 0], ['NH3', 'trigonalPyramidal', 3, 1],
      ['H2O', 'bent', 2, 2], ['PCl5', 'trigonalBipyramidal', 5, 0], ['SF4', 'seesaw', 4, 1], ['ClF3', 'tShaped', 3, 2], ['XeF2', 'linear', 2, 3],
      ['SF6', 'octahedral', 6, 0], ['BrF5', 'squarePyramidal', 5, 1], ['XeF4', 'squarePlanar', 4, 2], ['O3', 'bent', 2, 1], ['I3-', 'linear', 2, 3],
      ['NH4+', 'tetrahedral', 4, 0], ['H3O+', 'trigonalPyramidal', 3, 1], ['NO3-', 'trigonalPlanar', 3, 0], ['SO4^2-', 'tetrahedral', 4, 0]
    ]
    for (const [f, shape, n, m] of cases) {
      const x = mol(f)
      expect([f, x.shape, x.axe]).toEqual([f, shape, { n, m }])
    }
  })
  it('cierra el ángulo con los pares solitarios', () => {
    expect(measuredAngle(mol('H2O'))).toBeCloseTo(104.5, 1)
    expect(measuredAngle(mol('NH3'))).toBeCloseTo(107.8, 1)
    expect(measuredAngle(mol('CH4'))).toBeCloseTo(109.47, 1)
  })
  it('pone enlaces múltiples donde hacen falta', () => {
    expect(mol('CO2').bonds.map((b) => b.order)).toEqual([2, 2])
    expect(mol('HCN').bonds.map((b) => b.order).sort()).toEqual([1, 3])
    expect(mol('NO3-').bonds.filter((b) => b.order === 2)).toHaveLength(1)
    expect(mol('SO3').bonds.every((b) => b.order === 2)).toBe(true)
    expect(mol('CH4').bonds.every((b) => b.order === 1)).toBe(true)
  })
  it('decide la polaridad por la simetría', () => {
    expect(mol('CO2').polar).toBe(false)
    expect(mol('H2O').polar).toBe(true)
    expect(mol('XeF4').polar).toBe(false)
    expect(mol('CH2O').polar).toBe(true)
  })
  it('da la hibridación', () => {
    expect(mol('CH4').hybrid).toBe('sp³')
    expect(mol('SF6').hybrid).toBe('sp³d²')
  })
  it('rechaza lo que no es ABn', () => {
    expect(vseprFromFormula('Xx')).toMatchObject({ ok: false })
    expect(vseprFromFormula('C3H8')).toMatchObject({ ok: false, reason: 'notABn' })
    expect(vseprFromFormula('FeCl3')).toMatchObject({ ok: false, reason: 'transition' })
  })
  it('construye toda la biblioteca', () => {
    for (const g of LIBRARY) for (const f of g.formulas) expect(mol(f).atoms.length).toBeGreaterThan(1)
    expect(mol('C6H6').atoms).toHaveLength(12)
    expect(mol('O2').bonds[0].order).toBe(2)
  })
  it('las direcciones ideales tienen los ángulos de libro', () => {
    const t = domainDirections(4, 0).ligands
    expect(angleBetween(t[0], t[1])).toBeCloseTo(109.47, 1)
    const o = domainDirections(6, 2).ligands
    expect(angleBetween(o[0], o[1])).toBeCloseTo(180, 5)
  })
})
