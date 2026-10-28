import { describe, expect, it } from 'vitest'
import { angleAt, bondsByDistance, buildMolecule, keyBondAngles, moleculeFor, parseFormula, formulaKey } from './molecules'
import { dimensionLabels, polyEdges, polyhedron, shortestEdge, solidRadius } from './solids'
import type { Solid3D } from '@shared/schema/visual'

const solid = (shape: string, more: Partial<Solid3D> = {}): Solid3D => ({ shape, wireframe: false, edges: true, dims: false, x: 0, y: 0, z: 0, ...more })

describe('fórmulas', () => {
  it('lee subíndices, paréntesis y cargas', () => {
    expect(parseFormula('Ca(OH)2')?.counts).toEqual({ Ca: 1, O: 2, H: 2 })
    expect(parseFormula('SO4^2-')?.charge).toBe(-2)
    expect(parseFormula('NO3-')?.charge).toBe(-1)
    expect(parseFormula('NH4+')?.counts).toEqual({ N: 1, H: 4 })
    expect(formulaKey(parseFormula('C2H5OH')!)).toBe('C2H6O1')
    expect(parseFormula('Xx2')).toBeUndefined()
    expect(parseFormula('(H2)5000')).toBeUndefined()
    expect(parseFormula('O^9999-')).toBeUndefined()
  })
})

describe('VSEPR', () => {
  it('agua: angular, AX2E2, ángulo H–O–H de 104,5°', () => {
    const m = buildMolecule('H2O')!
    expect(m.vsepr).toBe('AX2E2')
    expect(m.geometry).toBe('bent')
    expect(m.lonePairs).toHaveLength(2)
    expect(angleAt(m, 0, 1, 2)).toBeCloseTo(104.5, 1)
  })
  it('amoniaco: piramidal trigonal (~107°)', () => {
    const m = buildMolecule('amoniaco')!
    expect(m.geometry).toBe('trigonalPyramidal')
    expect(m.vsepr).toBe('AX3E')
    expect(angleAt(m, 0, 1, 2)).toBeGreaterThan(105)
    expect(angleAt(m, 0, 1, 2)).toBeLessThan(109)
  })
  it('metano: tetraédrica (109,47°)', () => {
    const m = buildMolecule('CH4')!
    expect(m.geometry).toBe('tetrahedral')
    expect(angleAt(m, 0, 1, 2)).toBeCloseTo(109.47, 1)
    expect(m.bonds.every((b) => b.order === 1)).toBe(true)
  })
  it('CO2: lineal con dos dobles enlaces', () => {
    const m = buildMolecule('CO2')!
    expect(m.geometry).toBe('linear')
    expect(m.bonds.map((b) => b.order)).toEqual([2, 2])
    expect(angleAt(m, 0, 1, 2)).toBeCloseTo(180, 5)
  })
  it('SF6 octaédrica, XeF4 plana cuadrada, BF3 trigonal plana, SF4 balancín', () => {
    expect(buildMolecule('SF6')?.geometry).toBe('octahedral')
    expect(buildMolecule('XeF4')?.geometry).toBe('squarePlanar')
    expect(buildMolecule('BF3')?.geometry).toBe('trigonalPlanar')
    expect(buildMolecule('SF4')?.geometry).toBe('seesaw')
    expect(buildMolecule('ClF3')?.geometry).toBe('tShaped')
  })
  it('HCN: triple enlace al nitrógeno', () => {
    const m = buildMolecule('HCN')!
    expect(m.bonds.find((b) => m.atoms[b.b].element === 'N')?.order).toBe(3)
  })
  it('diatómicas: N2 triple, O2 doble', () => {
    expect(buildMolecule('N2')?.bonds[0].order).toBe(3)
    expect(buildMolecule('O2')?.bonds[0].order).toBe(2)
  })
})

describe('biblioteca', () => {
  it('benceno: anillo plano de 6 C con enlaces aromáticos', () => {
    const m = buildMolecule('benceno')!
    expect(m.atoms.filter((a) => a.element === 'C')).toHaveLength(6)
    expect(m.bonds.filter((b) => b.order === 1.5)).toHaveLength(6)
    expect(m.atoms.every((a) => Math.abs(a.z) < 1e-9)).toBe(true)
  })
  it('etanol por fórmula o por nombre, centrado en el origen', () => {
    const m = buildMolecule('C2H5OH')!
    expect(m.atoms).toHaveLength(9)
    const cx = m.atoms.reduce((s, a) => s + a.x, 0) / m.atoms.length
    expect(Math.abs(cx)).toBeLessThan(1e-9)
    expect(buildMolecule('ethanol')?.atoms).toHaveLength(9)
  })
  it('NaCl: red cúbica 3×3×3 con 54 enlaces', () => {
    const m = buildMolecule('NaCl')!
    expect(m.atoms).toHaveLength(27)
    expect(m.bonds).toHaveLength(54)
    expect(m.geometry).toBe('cubicLattice')
  })
  it('redes cristalinas: bcc, fcc y diamante con sus vecinos', () => {
    const fe = buildMolecule('hierro')!
    expect(fe.atoms).toHaveLength(9)
    expect(fe.bonds).toHaveLength(8)
    expect(fe.geometry).toBe('bccLattice')
    expect(buildMolecule('fcc')!.atoms).toHaveLength(14)
    const d = buildMolecule('diamante')!
    expect(d.atoms).toHaveLength(18)
    expect(d.bonds).toHaveLength(16)
    expect(buildMolecule('cloruro de cesio')!.atoms.filter((a) => a.element === 'Cs')).toHaveLength(1)
  })
  it('deduce enlaces por distancia y respeta los átomos escritos', () => {
    const atoms = [{ element: 'O', x: 0, y: 0, z: 0 }, { element: 'H', x: 0.96, y: 0, z: 0 }, { element: 'H', x: -0.24, y: 0.93, z: 0 }]
    expect(bondsByDistance(atoms)).toHaveLength(2)
    const m = moleculeFor({ atoms, bonds: [], formula: 'H2O', lonePairs: true })!
    expect(m.lonePairs).toHaveLength(2)
    expect(m.geometry).toBe('bent')
  })
  it('elige los ángulos que vale la pena rotular', () => {
    expect(keyBondAngles(buildMolecule('H2O')!)[0].degrees).toBeCloseTo(104.5, 1)
    expect(keyBondAngles(buildMolecule('SF6')!).map((a) => Math.round(a.degrees))).toEqual([90])
    expect(keyBondAngles(buildMolecule('NaCl')!)).toEqual([])
  })
})

describe('sólidos', () => {
  it('cada poliedro platónico tiene la arista pedida', () => {
    for (const shape of ['tetrahedron', 'octahedron', 'icosahedron', 'dodecahedron', 'cube']) {
      const p = polyhedron(solid(shape, { a: 2.5 }))!
      expect(shortestEdge(p), shape).toBeCloseTo(2.5, 6)
    }
  })
  it('número de caras y aristas (Euler: V − A + C = 2)', () => {
    for (const [shape, faces] of [['tetrahedron', 4], ['cube', 6], ['octahedron', 8], ['dodecahedron', 12], ['icosahedron', 20]] as const) {
      const p = polyhedron(solid(shape))!
      expect(p.faces).toHaveLength(faces)
      expect(p.vertices.length - polyEdges(p).length + p.faces.length).toBe(2)
    }
  })
  it('prisma y pirámide con n lados y arista a', () => {
    const pr = polyhedron(solid('prism', { a: 2, h: 3, sides: 6 }))!
    expect(pr.vertices).toHaveLength(12)
    expect(pr.faces).toHaveLength(8)
    const py = polyhedron(solid('pyramid', { a: 2, h: 3, sides: 4 }))!
    expect(py.faces).toHaveLength(5)
    expect(shortestEdge(py)).toBeCloseTo(2, 6)
  })
  it('radio y medidas rotuladas', () => {
    expect(solidRadius(solid('sphere', { r: 1.5 }))).toBe(1.5)
    expect(solidRadius(solid('cube', { a: 2 }))).toBeCloseTo(Math.sqrt(3), 6)
    expect(dimensionLabels(solid('cylinder', { r: 1, h: 3 }), String).map((d) => d.text)).toEqual(['r = 1', 'h = 3'])
    expect(dimensionLabels(solid('dodecahedron', { a: 2 }), String)[0].text).toBe('a = 2')
  })
})
