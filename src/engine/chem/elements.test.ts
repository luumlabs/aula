// Portado de la app Swift anterior: Tests/ChemKitTests/ElementsTests.swift.

import { describe, expect, it } from 'vitest'
import {
  ALL_ELEMENTS, ELEMENT_CATEGORIES, PeriodicTable, categoryTitle, describeElement, phaseAt, type Element, type ElementCategory,
  type PeriodicBlock,
} from './elements'
import { ElectronConfiguration, Subshell } from './electron-config'

const all = ALL_ELEMENTS

function el(s: string): Element {
  const e = PeriodicTable.bySymbol(s)
  if (!e) throw new Error(`Falta ${s}`)
  return e
}

const symbolsWhere = (f: (e: Element) => boolean): Set<string> => new Set(all.filter(f).map((e) => e.symbol))

describe('Elementos: completitud y coherencia', () => {
  it('los 118 elementos, en orden y sin repetir', () => {
    expect(all.length).toBe(118)
    all.forEach((e, i) => expect(e.atomicNumber).toBe(i + 1))
    expect(new Set(all.map((e) => e.symbol)).size).toBe(118)
    expect(new Set(all.map((e) => e.name)).size).toBe(118)
    expect(new Set(all.map((e) => e.englishName)).size).toBe(118)
    for (const e of all) {
      expect(e.symbol).toMatch(/^[A-Z][a-z]?$/)
      expect(e.name.length).toBeGreaterThan(0)
      expect(e.name[0]).toBe(e.name[0].toUpperCase())
    }
  })

  it('periodos a partir del número atómico', () => {
    for (const e of all) {
      const z = e.atomicNumber
      const expected = z <= 2 ? 1 : z <= 10 ? 2 : z <= 18 ? 3 : z <= 36 ? 4 : z <= 54 ? 5 : z <= 86 ? 6 : 7
      expect(e.period, e.symbol).toBe(expected)
    }
  })

  it('grupos, bloques y cuadrícula coherentes', () => {
    const positions = new Set<string>()
    for (const e of all) {
      const z = e.atomicNumber
      const isLanthanide = z >= 57 && z <= 71
      const isActinide = z >= 89 && z <= 103
      expect(e.category === 'lanthanide', e.symbol).toBe(isLanthanide)
      expect(e.category === 'actinide', e.symbol).toBe(isActinide)
      if (isLanthanide || isActinide) {
        expect(e.group, e.symbol).toBeNull()
        expect(e.block, e.symbol).toBe('f')
        expect(e.gridRow).toBe(isLanthanide ? 9 : 10)
        expect(e.gridColumn).toBe(3 + z - (isLanthanide ? 57 : 89))
      } else {
        const g = e.group
        expect(g, `${e.symbol} sin grupo`).not.toBeNull()
        if (g === null) continue
        expect(g >= 1 && g <= 18).toBe(true)
        expect(e.gridColumn).toBe(g)
        expect(e.gridRow).toBe(e.period)
        const block: PeriodicBlock = g <= 2 || z === 2 ? 's' : g <= 12 ? 'd' : 'p'
        expect(e.block, e.symbol).toBe(block)
      }
      const key = `${e.gridColumn},${e.gridRow}`
      expect(positions.has(key), `Posición repetida: ${e.symbol}`).toBe(false)
      positions.add(key)
    }
    expect(PeriodicTable.inGroup(1).map((e) => e.symbol)).toEqual(['H', 'Li', 'Na', 'K', 'Rb', 'Cs', 'Fr'])
    expect(PeriodicTable.inGroup(17).map((e) => e.symbol)).toEqual(['F', 'Cl', 'Br', 'I', 'At', 'Ts'])
    expect(PeriodicTable.inGroup(18).map((e) => e.symbol)).toEqual(['He', 'Ne', 'Ar', 'Kr', 'Xe', 'Rn', 'Og'])
    expect(PeriodicTable.inGroup(3).map((e) => e.symbol)).toEqual(['Sc', 'Y'])
    expect(PeriodicTable.inGroup(12).map((e) => e.symbol)).toEqual(['Zn', 'Cd', 'Hg', 'Cn'])
    expect(PeriodicTable.inPeriod(6).length).toBe(32)
    expect(PeriodicTable.inPeriod(1).length).toBe(2)
    expect(el('He').block).toBe('s')
    expect(el('He').group).toBe(18)
  })

  it('categorías', () => {
    const symbols = (c: ElementCategory): Set<string> => symbolsWhere((e) => e.category === c)
    expect(symbols('alkaliMetal')).toEqual(new Set(['Li', 'Na', 'K', 'Rb', 'Cs', 'Fr']))
    expect(symbols('alkalineEarthMetal')).toEqual(new Set(['Be', 'Mg', 'Ca', 'Sr', 'Ba', 'Ra']))
    expect(symbols('halogen')).toEqual(new Set(['F', 'Cl', 'Br', 'I', 'At']))
    expect(symbols('nobleGas')).toEqual(new Set(['He', 'Ne', 'Ar', 'Kr', 'Xe', 'Rn']))
    expect(symbols('metalloid')).toEqual(new Set(['B', 'Si', 'Ge', 'As', 'Sb', 'Te']))
    expect(symbols('reactiveNonmetal')).toEqual(new Set(['H', 'C', 'N', 'O', 'P', 'S', 'Se']))
    expect(symbols('postTransitionMetal')).toEqual(new Set(['Al', 'Ga', 'In', 'Sn', 'Tl', 'Pb', 'Bi', 'Po']))
    expect(symbols('lanthanide').size).toBe(15)
    expect(symbols('actinide').size).toBe(15)
    expect(symbols('unknown')).toEqual(new Set(['Mt', 'Ds', 'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og']))
    expect(symbols('transitionMetal').size).toBe(34) // 10 + 10 + 9 (Hf–Hg) + 5 (Rf–Hs)
    expect(el('Fe').isMetal).toBe(true)
    expect(el('O').isMetal).toBe(false)
    expect(el('Og').isMetal).toBeNull()
    expect(categoryTitle('halogen')).toBe('Halógeno')
    expect(ELEMENT_CATEGORIES.length).toBe(11)
  })

  it('estados a 25 °C', () => {
    expect(symbolsWhere((e) => e.standardState === 'gas')).toEqual(new Set(['H', 'He', 'N', 'O', 'F', 'Ne', 'Cl', 'Ar', 'Kr', 'Xe', 'Rn']))
    expect(symbolsWhere((e) => e.standardState === 'liquid')).toEqual(new Set(['Br', 'Hg']))
    expect(el('Ga').standardState).toBe('solid') // funde a 29.8 °C
    expect(el('Cs').standardState).toBe('solid') // funde a 28.5 °C
    expect(el('Og').standardState).toBe('unknown')
    expect(el('Fm').standardState).toBe('unknown')
  })
})

describe('Masas atómicas (IUPAC, abreviadas)', () => {
  it('coinciden con la tabla abreviada', () => {
    const expected: Record<string, string> = {
      H: '1.008', He: '4.0026', Li: '6.94', Be: '9.0122', B: '10.81', C: '12.011', N: '14.007', O: '15.999',
      F: '18.998', Ne: '20.180', Na: '22.990', Mg: '24.305', Al: '26.982', Si: '28.085', P: '30.974', S: '32.06',
      Cl: '35.45', Ar: '39.95', K: '39.098', Ca: '40.078', Sc: '44.956', Ti: '47.867', V: '50.942', Cr: '51.996',
      Mn: '54.938', Fe: '55.845', Co: '58.933', Ni: '58.693', Cu: '63.546', Zn: '65.38', Ga: '69.723', Ge: '72.630',
      As: '74.922', Se: '78.971', Br: '79.904', Kr: '83.798', Rb: '85.468', Sr: '87.62', Y: '88.906', Zr: '91.224',
      Nb: '92.906', Mo: '95.95', Ru: '101.07', Rh: '102.91', Pd: '106.42', Ag: '107.87', Cd: '112.41', In: '114.82',
      Sn: '118.71', Sb: '121.76', Te: '127.60', I: '126.90', Xe: '131.29', Cs: '132.91', Ba: '137.33', La: '138.91',
      Ce: '140.12', Nd: '144.24', Gd: '157.25', Lu: '174.97', Hf: '178.49', W: '183.84', Pt: '195.08', Au: '196.97',
      Hg: '200.59', Tl: '204.38', Pb: '207.2', Bi: '208.98', Th: '232.04', Pa: '231.04', U: '238.03',
    }
    for (const [symbol, text] of Object.entries(expected)) {
      const e = el(symbol)
      expect(e.atomicWeight.isStandard, symbol).toBe(true)
      expect(e.atomicWeight.text, symbol).toBe(text)
      expect(e.molarMass, symbol).toBeCloseTo(Number(text), 12)
    }
    // El error de la app anterior: cifras de incertidumbre pegadas (4.0026022, 9.01218315…).
    expect(el('He').molarMass).toBeCloseTo(4.0026, 9)
    expect(el('Be').molarMass).toBeCloseTo(9.0122, 9)
    expect(el('Na').atomicWeight.text).toBe('22.990')
    expect(el('Na').atomicWeight.decimalPlaces).toBe(3)
    expect(el('Cl').atomicWeight.decimalPlaces).toBe(2)
  })

  it('a lo sumo 5 cifras significativas y valores razonables', () => {
    for (const e of all) {
      if (!e.atomicWeight.isStandard) continue
      const digits = e.atomicWeight.text.replace(/\D/g, '').replace(/^0+/, '')
      expect(digits.length, `${e.symbol}: ${e.atomicWeight.text}`).toBeLessThanOrEqual(5)
      expect(e.molarMass, e.symbol).toBeGreaterThan(e.atomicNumber)
      expect(e.molarMass, e.symbol).toBeLessThan(e.atomicNumber * 2.7 + 2)
    }
  })

  it('sin masa estándar: número másico del isótopo más estable', () => {
    const isotopes = symbolsWhere((e) => !e.atomicWeight.isStandard)
    const expected = new Set(['Tc', 'Pm', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac'])
    for (let z = 93; z <= 118; z++) expected.add(all[z - 1].symbol)
    expect(isotopes).toEqual(expected)
    expect(el('Tc').atomicWeight.massNumber).toBe(98)
    expect(el('Tc').atomicWeight.text).toBe('[98]')
    expect(el('Pm').atomicWeight.text).toBe('[145]')
    expect(el('Rn').atomicWeight.text).toBe('[222]')
    expect(el('Pu').atomicWeight.text).toBe('[244]')
    expect(el('Og').atomicWeight.text).toBe('[294]')
    expect(el('Tc').molarMass).toBe(98)
  })
})

describe('Electronegatividad, ionización, oxidación', () => {
  it('electronegatividades de Pauling', () => {
    const expected: Record<string, number> = {
      H: 2.2, Li: 0.98, C: 2.55, N: 3.04, O: 3.44, F: 3.98, Na: 0.93, Mg: 1.31, Al: 1.61, Si: 1.9, P: 2.19, S: 2.58, Cl: 3.16,
      K: 0.82, Ca: 1.0, Fe: 1.83, Cu: 1.9, Zn: 1.65, Br: 2.96, I: 2.66, Cs: 0.79, Au: 2.54, Kr: 3.0, Xe: 2.6,
    }
    for (const [s, v] of Object.entries(expected)) expect(el(s).electronegativity ?? -1, s).toBeCloseTo(v, 9)
    for (const s of ['He', 'Ne', 'Ar', 'Rn', 'Am', 'Og']) expect(el(s).electronegativity, s).toBeNull()
    const measured = all.filter((e) => e.electronegativity !== null)
    const max = measured.reduce((a, b) => ((b.electronegativity ?? 0) > (a.electronegativity ?? 0) ? b : a))
    expect(max.symbol).toBe('F')
  })

  it('primeras energías de ionización', () => {
    const expected: Record<string, number> = {
      H: 1312.0, He: 2372.3, Li: 520.2, C: 1086.5, N: 1402.3, O: 1313.9, F: 1681.0, Ne: 2080.7, Na: 495.8, Mg: 737.7, Al: 577.5,
      Cl: 1251.2, Ar: 1520.6, K: 418.8, Fe: 762.5, Cu: 745.5, Zn: 906.4, Br: 1139.9, I: 1008.4, Cs: 375.7, Hg: 1007.1,
    }
    for (const [s, v] of Object.entries(expected)) expect(Math.abs((el(s).firstIonizationEnergy ?? -1) - v), s).toBeLessThan(0.05)
    const measured = all.filter((e) => e.firstIonizationEnergy !== null)
    const ie = (e: Element): number => e.firstIonizationEnergy ?? 0
    expect(measured.reduce((a, b) => (ie(b) > ie(a) ? b : a)).symbol).toBe('He')
    expect(measured.reduce((a, b) => (ie(b) < ie(a) ? b : a)).symbol).toBe('Cs')
    // Anomalías de la tendencia que se enseñan: N > O y Be > B, Mg > Al.
    expect(ie(el('N'))).toBeGreaterThan(ie(el('O')))
    expect(ie(el('Be'))).toBeGreaterThan(ie(el('B')))
    expect(ie(el('Mg'))).toBeGreaterThan(ie(el('Al')))
    expect(el('Og').firstIonizationEnergy).toBeNull()
  })

  it('estados de oxidación comunes', () => {
    expect(el('Fe').commonOxidationStates).toEqual([2, 3])
    expect(el('Cu').commonOxidationStates).toEqual([1, 2])
    expect(el('O').commonOxidationStates).toEqual([-2])
    expect(el('F').commonOxidationStates).toEqual([-1])
    expect(el('Na').commonOxidationStates).toEqual([1])
    expect(el('Cl').commonOxidationStates).toEqual([-1, 1, 3, 5, 7])
    expect(el('Mn').commonOxidationStates).toEqual([2, 3, 4, 6, 7])
    expect(el('He').commonOxidationStates).toEqual([])
    for (const e of all) expect(e.commonOxidationStates, e.symbol).toEqual([...e.commonOxidationStates].sort((a, b) => a - b))
    for (const e of all.filter((x) => x.category === 'alkaliMetal')) expect(e.commonOxidationStates).toEqual([1])
    for (const e of all.filter((x) => x.category === 'alkalineEarthMetal')) expect(e.commonOxidationStates).toEqual([2])
  })
})

describe('Configuraciones electrónicas', () => {
  it('tienen Z electrones y se vuelven a leer igual', () => {
    for (const e of all) {
      const c = ElectronConfiguration.groundState(e)
      expect(c.electronCount, e.symbol).toBe(e.atomicNumber)
      expect(c.shells.reduce((a, b) => a + b, 0), e.symbol).toBe(e.atomicNumber)
      for (const [s, k] of c.occupancy) expect(k, `${e.symbol} ${s}`).toBeLessThanOrEqual(s.capacity)
      expect(ElectronConfiguration.parse(c.full).equals(c), e.symbol).toBe(true)
      expect(ElectronConfiguration.parse(c.abbreviated).equals(c), e.symbol).toBe(true)
    }
  })

  it('ejemplos', () => {
    const expected: Record<string, string> = {
      H: '1s1', He: '1s2', Li: '[He] 2s1', C: '[He] 2s2 2p2', O: '[He] 2s2 2p4', Ne: '[He] 2s2 2p6', Na: '[Ne] 3s1',
      Cl: '[Ne] 3s2 3p5', Ar: '[Ne] 3s2 3p6', K: '[Ar] 4s1', Sc: '[Ar] 4s2 3d1', Fe: '[Ar] 4s2 3d6', Zn: '[Ar] 4s2 3d10',
      Ga: '[Ar] 4s2 3d10 4p1', Br: '[Ar] 4s2 3d10 4p5', Sr: '[Kr] 5s2', I: '[Kr] 5s2 4d10 5p5', Ba: '[Xe] 6s2',
      Pr: '[Xe] 6s2 4f3', Eu: '[Xe] 6s2 4f7', Tb: '[Xe] 6s2 4f9', Yb: '[Xe] 6s2 4f14', Lu: '[Xe] 6s2 4f14 5d1',
      W: '[Xe] 6s2 4f14 5d4', Hg: '[Xe] 6s2 4f14 5d10', Pb: '[Xe] 6s2 4f14 5d10 6p2', Rn: '[Xe] 6s2 4f14 5d10 6p6',
      Pu: '[Rn] 7s2 5f6', No: '[Rn] 7s2 5f14', Og: '[Rn] 7s2 5f14 6d10 7p6',
    }
    for (const [s, text] of Object.entries(expected)) expect(ElectronConfiguration.groundState(el(s)).abbreviated, s).toBe(text)
    const fe = ElectronConfiguration.groundState(el('Fe'))
    expect(fe.full).toBe('1s2 2s2 2p6 3s2 3p6 4s2 3d6')
    expect(fe.text({ abbreviated: true, order: 'shell' })).toBe('[Ar] 3d6 4s2')
    expect(fe.text({ abbreviated: true, notation: 'unicode' })).toBe('[Ar] 4s² 3d⁶')
    expect(ElectronConfiguration.groundState(el('Na')).text({ abbreviated: true, notation: 'latex' })).toBe('[\\mathrm{Ne}]\\,3\\mathrm{s}^{1}')
    expect(fe.shells).toEqual([2, 8, 14, 2])
    expect(ElectronConfiguration.groundState(el('Xe')).shells).toEqual([2, 8, 18, 18, 8])
  })

  it('excepciones reales', () => {
    const exceptions: Record<string, string> = {
      Cr: '[Ar] 3d5 4s1', Cu: '[Ar] 3d10 4s1', Nb: '[Kr] 4d4 5s1', Mo: '[Kr] 4d5 5s1', Ru: '[Kr] 4d7 5s1',
      Rh: '[Kr] 4d8 5s1', Pd: '[Kr] 4d10', Ag: '[Kr] 4d10 5s1', La: '[Xe] 5d1 6s2', Ce: '[Xe] 4f1 5d1 6s2',
      Gd: '[Xe] 4f7 5d1 6s2', Pt: '[Xe] 4f14 5d9 6s1', Au: '[Xe] 4f14 5d10 6s1', Ac: '[Rn] 6d1 7s2', Th: '[Rn] 6d2 7s2',
      Pa: '[Rn] 5f2 6d1 7s2', U: '[Rn] 5f3 6d1 7s2', Np: '[Rn] 5f4 6d1 7s2', Cm: '[Rn] 5f7 6d1 7s2', Lr: '[Rn] 5f14 7s2 7p1',
    }
    for (const [s, text] of Object.entries(exceptions)) {
      expect(ElectronConfiguration.groundState(el(s)).text({ abbreviated: true, order: 'shell' }), s).toBe(text)
      expect(ElectronConfiguration.isException(el(s)), s).toBe(true)
    }
    const cr = ElectronConfiguration.groundState(el('Cr'))
    expect(cr.text({ abbreviated: true })).toBe('[Ar] 4s1 3d5')
    expect(cr.unpairedElectrons).toBe(6)
    expect(ElectronConfiguration.isException(el('Fe'))).toBe(false)
    expect(ElectronConfiguration.isException(el('W'))).toBe(false)
    expect(Object.keys(ElectronConfiguration.exceptions).length).toBe(20)
  })

  it('iones', () => {
    const cases: [string, number, string][] = [
      ['Fe', 2, '[Ar] 3d6'], ['Fe', 3, '[Ar] 3d5'], ['Cl', -1, '[Ne] 3s2 3p6'], ['Cu', 1, '[Ar] 3d10'], ['Cu', 2, '[Ar] 3d9'],
      ['Zn', 2, '[Ar] 3d10'], ['Cr', 3, '[Ar] 3d3'], ['Mn', 2, '[Ar] 3d5'], ['Co', 2, '[Ar] 3d7'], ['Ni', 2, '[Ar] 3d8'],
      ['Na', 1, '[He] 2s2 2p6'], ['O', -2, '[He] 2s2 2p6'], ['N', -3, '[He] 2s2 2p6'], ['Ag', 1, '[Kr] 4d10'],
      ['Sn', 2, '[Kr] 4d10 5s2'], ['Sn', 4, '[Kr] 4d10'], ['Pb', 2, '[Xe] 4f14 5d10 6s2'], ['Eu', 3, '[Xe] 4f6'],
      ['Ce', 4, '[Kr] 4d10 5s2 5p6'], ['Ti', 4, '[Ne] 3s2 3p6'], ['Ga', 3, '[Ar] 3d10'], ['Au', 3, '[Xe] 4f14 5d8'],
      ['H', -1, '1s2'], ['S', -2, '[Ne] 3s2 3p6'],
    ]
    for (const [s, q, text] of cases) {
      expect(ElectronConfiguration.ion(el(s), q).text({ abbreviated: true, order: 'shell' }), `${s} ${q}`).toBe(text)
    }
    expect(ElectronConfiguration.ion(el('H'), 1).electronCount).toBe(0)
    expect(() => ElectronConfiguration.ion(el('H'), 2)).toThrow()
    expect(() => ElectronConfiguration.ion(el('Fe'), 12)).toThrow()
    expect(ElectronConfiguration.ion(el('Fe'), 3).unpairedElectrons).toBe(5)
    expect(ElectronConfiguration.ion(el('Zn'), 2).unpairedElectrons).toBe(0)
  })

  it('lee las configuraciones que escribe el alumno', () => {
    const fe = ElectronConfiguration.groundState(el('Fe'))
    for (const text of [
      '[Ar] 4s2 3d6', '[Ar] 3d6 4s2', '[Ar]4s²3d⁶', '1s2 2s2 2p6 3s2 3p6 4s2 3d6', '1s^2 2s^2 2p^6 3s^2 3p^6 4s^2 3d^6',
      '1s22s22p63s23p64s23d6', '[Ar] 3d^{6} 4s^{2}', '1s² 2s² 2p⁶ 3s² 3p⁶ 3d⁶ 4s²',
    ]) {
      expect(ElectronConfiguration.parse(text).equals(fe), text).toBe(true)
    }
    expect(ElectronConfiguration.parse('[Kr] 4d10 5s2 5p6').electronCount).toBe(54)
    for (const bad of ['', '[Xx] 4s2', '1s3', '2d1', '4s2 4s2', 'hola', '[Ar 4s2', '1s2 '.repeat(200)]) {
      expect(() => ElectronConfiguration.parse(bad), bad).toThrow()
    }
  })

  it('orden de llenado de Madelung', () => {
    expect(Subshell.fillingOrder.slice(0, 19).map((s) => s.toString())).toEqual([
      '1s', '2s', '2p', '3s', '3p', '4s', '3d', '4p', '5s', '4d', '5p', '6s', '4f', '5d', '6p', '7s', '5f', '6d', '7p',
    ])
    expect(Subshell.of(1, 1)).toBeNull()
    expect(Subshell.of(4, 3)?.capacity).toBe(14)
  })
})

describe('Búsquedas', () => {
  it('por símbolo distingue mayúsculas', () => {
    expect(PeriodicTable.bySymbol('Co')?.name).toBe('Cobalto')
    expect(PeriodicTable.bySymbol('CO')).toBeNull()
    expect(PeriodicTable.bySymbol('co')).toBeNull()
    expect(PeriodicTable.bySymbol('Xy')).toBeNull()
  })

  it('por nombre sin acentos ni mayúsculas', () => {
    const cases: [string, string][] = [
      ['hierro', 'Fe'], ['Iron', 'Fe'], ['fosforo', 'P'], ['Fósforo', 'P'], ['FÓSFORO', 'P'], ['aluminum', 'Al'], ['aluminio', 'Al'],
      ['Aluminium', 'Al'], ['tungsteno', 'W'], ['wolframio', 'W'], ['cinc', 'Zn'], ['zinc', 'Zn'], ['nitrogeno', 'N'], ['oro', 'Au'],
      ['gold', 'Au'], ['plata', 'Ag'], ['sodium', 'Na'], ['sodio', 'Na'], ['oganesón', 'Og'], ['teneso', 'Ts'], ['nihonio', 'Nh'],
      ['  Oxígeno ', 'O'], ['criptón', 'Kr'], ['kriptón', 'Kr'], ['lawrencio', 'Lr'], ['laurencio', 'Lr'],
    ]
    for (const [name, symbol] of cases) expect(PeriodicTable.byName(name)?.symbol, name).toBe(symbol)
    expect(PeriodicTable.byName('kryptonita')).toBeNull()
  })

  it('búsqueda flexible', () => {
    expect(PeriodicTable.search('Fe')?.symbol).toBe('Fe')
    expect(PeriodicTable.search('26')?.symbol).toBe('Fe')
    expect(PeriodicTable.search('hierro')?.symbol).toBe('Fe')
    expect(PeriodicTable.search('Z=26')?.symbol).toBe('Fe')
    expect(PeriodicTable.search('número atómico 8')?.symbol).toBe('O')
    expect(PeriodicTable.search('fe')?.symbol).toBe('Fe')
    expect(PeriodicTable.search('')).toBeNull()
    expect(PeriodicTable.search('0')).toBeNull()
    expect(PeriodicTable.search('119')).toBeNull()
    expect(PeriodicTable.search('-1')).toBeNull()
    expect(PeriodicTable.search('xyz')).toBeNull()
    expect(PeriodicTable.search('a'.repeat(10_000))).toBeNull()
    expect(PeriodicTable.byNumber(118)?.symbol).toBe('Og')
    expect(PeriodicTable.byNumber(0)).toBeNull()
  })

  it('configuraciones predichas y descripción', () => {
    expect(el('Rf').isConfigurationPredicted).toBe(true)
    expect(el('Lr').isConfigurationPredicted).toBe(false)
    expect(describeElement(el('Fe'))).toBe('Hierro (Fe)')
  })
})

describe('Datos físicos (tabla de la interfaz)', () => {
  it('estado a otra temperatura', () => {
    expect(phaseAt(el('Fe'), 298)).toBe('solid')
    expect(phaseAt(el('Fe'), 2000)).toBe('liquid')
    expect(phaseAt(el('Hg'), 298)).toBe('liquid')
    expect(phaseAt(el('O'), 298)).toBe('gas')
    expect(phaseAt(el('C'), 4000)).toBe('gas') // sublima
    expect(phaseAt(el('Og'), 298)).toBe('unknown')
    expect(el('O').densityUnit).toBe('g/L')
    expect(el('Fe').densityGramsPerCm3).toBeCloseTo(7.874, 6)
    expect(el('Na').valenceElectrons).toBe(1)
    expect(el('He').valenceElectrons).toBe(2)
    expect(el('Cl').valenceElectrons).toBe(7)
    expect(el('Fe').valenceElectrons).toBeNull()
  })
})
