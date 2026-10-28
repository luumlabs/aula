// Portado de la app Swift anterior: Tests/ChemKitTests/CalculationsTests.swift.

import { describe, expect, it } from 'vitest'
import { ChemError } from './errors'
import { Formula } from './formula'
import { ChemQuantity } from './quantity'
import { SigFigCount } from './sigfigs'
import { ChemConstants, Stoichiometry } from './stoichiometry'
import { Gases, Solutions } from './solutions'
import { AcidBase } from './acid-base'

const q = (s: string): ChemQuantity => ChemQuantity.parse(s)
const F = (s: string): Formula => Formula.parse(s)
const near = (actual: number | null | undefined, expected: number, tolerance: number, label?: string): void => {
  expect(Math.abs((actual ?? Number.NaN) - expected), label).toBeLessThanOrEqual(tolerance)
}

describe('Cantidades y unidades', () => {
  it('lectura de cantidades', () => {
    expect(q('10 g').unit).toBe('gram')
    expect(q('0,5 mol').value).toBe(0.5)
    near(q('250 mL').baseValue, 0.25, 1e-12)
    expect(q('250mL').unit).toBe('milliliter')
    near(q('25 °C').baseValue, 298.15, 1e-9)
    expect(q('25 ºC').unit).toBe('celsius')
    expect(q('6.02e23 moléculas').unit).toBe('particles')
    near(q('6.022×10^23 átomos').value, 6.022e23, 1e17)
    near(q('6.022 x 10^23 particles').value, 6.022e23, 1e17)
    near(q('1.2 atm').baseValue, 121_590, 1e-6)
    near(q('760 mmHg').baseValue, 101_325, 1e-6)
    expect(q('0.1 M').unit).toBe('molar')
    expect(q('0.1 m').unit).toBe('molal')
    near(q('2 mM').baseValue, 0.002, 1e-15)
    expect(q('3 kilogramos').baseValue).toBe(3000)
    expect(q('10 g de NaCl').unit).toBe('gram')
    expect(q('0.250 L').sigFigs.equals(new SigFigCount(3))).toBe(true)
    expect(q('1.5 mol/L').unit).toBe('molar')
    for (const bad of ['10', 'diez gramos', '10 gramitos', '', '1'.repeat(400) + ' g']) expect(() => q(bad), bad).toThrow(ChemError)
  })

  it('conversiones de unidades', () => {
    near(q('1 atm').convertedTo('kilopascal').value, 101.325, 1e-9)
    near(q('1 atm').convertedTo('millimeterOfMercury').value, 760, 1e-9)
    near(q('1 atm').convertedTo('torr').value, 760, 1e-9)
    near(q('1 atm').convertedTo('bar').value, 1.01325, 1e-12)
    near(q('0 °C').convertedTo('kelvin').value, 273.15, 1e-9)
    near(q('300 K').convertedTo('celsius').value, 26.85, 1e-9)
    near(q('-40 °C').convertedTo('fahrenheit').value, -40, 1e-9)
    near(q('98.6 °F').convertedTo('celsius').value, 37, 1e-9)
    near(q('1 L').convertedTo('milliliter').value, 1000, 1e-9)
    near(q('1 cal').convertedTo('joule').value, 4.184, 1e-12)
    expect(() => q('1 atm').convertedTo('gram')).toThrow(ChemError)
  })
})

describe('Conversiones químicas', () => {
  it('gramos, moles y partículas', () => {
    const water = Stoichiometry.convert('10 g', 'mol', 'H2O')
    near(water.value, 10 / 18.015, 1e-9)
    expect(water.unit).toBe('mol')
    near(Stoichiometry.convert('2.00 mol', 'moléculas', 'CO2').value, 2 * 6.02214076e23, 1e15)
    near(Stoichiometry.convert('3.01e23 moléculas', 'mol', 'H2O').value, 3.01e23 / 6.02214076e23, 1e-9)
    const grams = Stoichiometry.convert('0.250 mol', 'g', 'NaCl')
    near(grams.value, 0.25 * 58.44, 1e-9)
    expect(grams.formatted).toBe('14.6 g')
    near(Stoichiometry.convert('500 mg', 'mmol', 'C6H12O6').value, (0.5 / 180.156) * 1000, 1e-9)
    const stp = Stoichiometry.convert('2 mol', 'L CN', 'N2')
    near(stp.value, 44.828, 1e-9)
    expect(stp.formatted).toBe('44.8 L')
    expect(stp.strictFormatted).toBe('4 × 10¹ L')
    near(Stoichiometry.convert('5.6 L CN', 'g', 'O2').value, (5.6 / 22.414) * 31.998, 1e-9)
    expect(() => Stoichiometry.convert('10 g', 'mol', null)).toThrow(ChemError)
    expect(() => Stoichiometry.convert('10 g', 'L', 'H2O')).toThrow(ChemError)
    expect(() => Stoichiometry.convert('10 g', 'furlongs', 'H2O')).toThrow(ChemError)
    expect(() => Stoichiometry.convert('10 g', 'mol', 'Xy')).toThrow(ChemError)
  })

  it('las temperaturas conservan los decimales', () => {
    const a = Stoichiometry.convert('25 °C', 'K', null)
    near(a.value, 298.15, 1e-9)
    expect(a.formatted).toBe('298 K')
    expect(Stoichiometry.convert('25.0 °C', 'K', null).formatted).toBe('298.2 K')
    expect(Stoichiometry.convert('298.15 K', '°C', null).formatted).toBe('25.00 °C')
    expect(Stoichiometry.convert('0 °C', 'K', null).formatted).toBe('273 K')
    expect(Stoichiometry.convert('1.00 atm', 'kPa', null).formatted).toBe('101 kPa')
    expect(Stoichiometry.convert('101.325 kPa', 'atm', null).formatted).toBe('1.00000 atm')
  })
})

describe('Problemas de estequiometría', () => {
  it('reactivo limitante: óxido de hierro', () => {
    const r = Stoichiometry.solve('Fe + O2 -> Fe2O3', { Fe: '10.0 g', O2: '0.500 mol' }, 'Fe2O3')
    expect(r.equation.unicodeText).toBe('4 Fe + 3 O₂ → 2 Fe₂O₃')
    expect(r.limitingReagent?.plainText).toBe('Fe')
    near(r.targetGrams, 14.297, 0.001)
    near(r.targetMoles, 0.089533, 1e-6)
    const o2 = r.lines.find((l) => l.formula.plainText === 'O2')
    near(o2?.remainingMoles, 0.5 - (0.179067 * 3) / 4, 1e-5)
    expect(r.significantFigures).toBe(3)
    expect(r.summary).toContain('14.3 g')
  })

  it('rendimiento del amoníaco', () => {
    const r = Stoichiometry.solve('N2 + H2 -> NH3', { N2: '28.0 g', H2: '10.0 g' }, 'NH3', '25.0 g')
    expect(r.limitingReagent?.plainText).toBe('N2')
    near(r.targetGrams, 34.045, 0.001)
    near(r.percentYield, 73.43, 0.01)
    expect(r.summary).toContain('73.4 %')
  })

  it('agua a partir de hidrógeno y oxígeno', () => {
    const r = Stoichiometry.solve('H2 + O2 -> H2O', { H2: '4.0 g', O2: '32 g' }, 'H2O')
    expect(r.limitingReagent?.plainText).toBe('H2')
    near(r.targetGrams, (4.0 / 2.016) * 18.015, 1e-6)
    const o2 = r.lines.find((l) => l.formula.plainText === 'O2')
    near(o2?.remainingMoles, 32 / 31.998 - 4.0 / 2.016 / 2, 1e-9)
  })

  it('un solo reactivo: los demás en exceso', () => {
    const r = Stoichiometry.solve('CH4 + O2 -> CO2 + H2O', { CH4: '16.0 g' }, 'CO2')
    expect(r.limitingReagent).toBeNull()
    near(r.targetGrams, (16.0 / 16.043) * 44.009, 1e-6)
    expect(r.steps.some((s) => s.includes('en exceso'))).toBe(true)
  })

  it('dado un producto, calcula el reactivo necesario', () => {
    const r = Stoichiometry.solve('KClO3 -> KCl + O2', { O2: '9.60 g' }, 'KClO3')
    near(r.targetGrams, ((9.6 / 31.998) * 2) / 3 * 122.545, 1e-6)
    expect(r.steps.some((s) => s.includes('reaccionan'))).toBe(true)
  })

  it('cantidades en disolución y de gases', () => {
    near(Stoichiometry.solve('HCl + NaOH -> NaCl + H2O', { NaOH: '25.0 mL 0.100 M' }, 'HCl').targetMoles, 0.0025, 1e-12)
    near(Stoichiometry.solve('Zn + HCl -> ZnCl2 + H2', { H2: '2.24 L CN' }, 'Zn').targetGrams, (2.24 / 22.414) * 65.38, 1e-6)
    const ideal = Stoichiometry.solve('CaCO3 -> CaO + CO2', { CO2: '1.00 L a 25 °C y 1.00 atm' }, 'CaCO3')
    near(ideal.targetMoles, 1.0 / (ChemConstants.gasConstantLatm * 298.15), 1e-9)
    near(Stoichiometry.solve('H2 + O2 -> H2O', { H2: '6.022e23 moléculas', O2: '1 mol' }, 'H2O').targetMoles, 1.0, 1e-3)
  })

  it('errores', () => {
    const bad: [string, Record<string, string>, string][] = [
      ['Fe + O2 -> Fe2O3', { Cu: '10 g' }, 'Fe2O3'],
      ['Fe + O2 -> Fe2O3', { Fe: '10 g' }, 'FeO'],
      ['Fe + O2 -> Fe2O3', {}, 'Fe2O3'],
      ['H2 -> O2', { H2: '1 g' }, 'O2'],
      ['Fe + O2 -> Fe2O3', { Fe: '10 L' }, 'Fe2O3'],
      ['Fe + O2 -> Fe2O3', { Fe: '-10 g' }, 'Fe2O3'],
      ['Fe + O2 -> Fe2O3', { Fe: '10 g', Fe2O3: '5 g' }, 'O2'],
    ]
    for (const [eq, given, find] of bad) expect(() => Stoichiometry.solve(eq, given, find), `${eq} ${JSON.stringify(given)}`).toThrow(ChemError)
  })
})

describe('Disoluciones', () => {
  it('molaridad', () => {
    const r = Solutions.molarity(q('5.85 g'), F('NaCl'), q('250 mL'))
    near(r.value, 5.85 / 58.44 / 0.25, 1e-9)
    expect(r.formatted).toBe('0.400 M')
    near(Solutions.molarity(q('0.50 mol'), null, q('2.0 L')).value, 0.25, 1e-12)
    expect(() => Solutions.molarity(q('5 g'), null, q('1 L'))).toThrow(ChemError) // falta la fórmula
    expect(() => Solutions.molarity(q('5 g'), F('NaCl'), q('1 atm'))).toThrow(ChemError)
    near(Solutions.soluteMass(q('0.100 M'), q('500 mL'), F('NaOH')).value, 0.05 * 39.997, 1e-9)
  })

  it('dilución', () => {
    const v1 = Solutions.dilution(q('2.0 M'), null, q('0.50 M'), q('100 mL'))
    near(v1.value, 25, 1e-9)
    expect(v1.unit).toBe('mL')
    near(Solutions.dilution(q('6.0 M'), q('10.0 mL'), null, q('250 mL')).value, 0.24, 1e-12)
    near(Solutions.dilution(null, q('50 mL'), q('0.10 M'), q('500 mL')).value, 1.0, 1e-12)
    near(Solutions.dilution(q('1.0 M'), q('1.0 L'), q('0.25 M'), null).value, 4.0, 1e-12)
    expect(() => Solutions.dilution(null, null, q('1 M'), q('1 L'))).toThrow(ChemError)
    expect(() => Solutions.dilution(q('1 M'), q('1 L'), q('1 M'), q('1 L'))).toThrow(ChemError)
  })

  it('molalidad y porcentajes', () => {
    near(Solutions.molality(q('10.0 g'), F('NaCl'), q('500 g')).value, 10 / 58.44 / 0.5, 1e-9)
    near(Solutions.massPercent(q('5 g'), q('100 g')).value, 5, 1e-12)
    near(Solutions.massPercentWithSolvent(q('5 g'), q('95 g')).value, 5, 1e-12)
    near(Solutions.massVolumePercent(q('10 g'), q('250 mL')).value, 4, 1e-12)
    near(Solutions.ppm(q('2 mg'), q('1 kg')).value, 2, 1e-9)
    near(Solutions.ppmByVolume(q('5 mg'), q('2 L')).value, 2.5, 1e-12)
    expect(Solutions.massPercent(q('50 g'), q('20 g')).steps.some((s) => s.includes('más del 100'))).toBe(true)
  })
})

describe('Gases', () => {
  it('ley de los gases ideales', () => {
    const v = Gases.idealGas({ pressure: q('1.00 atm'), volume: null, amount: q('1.00 mol'), temperature: q('273.15 K') })
    near(v.value, 22.414, 0.0005)
    expect(v.unit).toBe('L')
    const p = Gases.idealGas({ pressure: null, volume: q('10.0 L'), amount: q('2.00 mol'), temperature: q('300 K') })
    near(p.value, (2 * ChemConstants.gasConstantLatm * 300) / 10, 1e-9)
    const pk = Gases.idealGas({ pressure: null, volume: q('10.0 L'), amount: q('2.00 mol'), temperature: q('300 K'), resultUnit: 'kilopascal' })
    near(pk.value, p.value * 101.325, 1e-6)
    const n = Gases.idealGas({ pressure: q('1.00 atm'), volume: q('24.5 L'), amount: null, temperature: q('25 °C') })
    near(n.value, 24.5 / (ChemConstants.gasConstantLatm * 298.15), 1e-9)
    const t = Gases.idealGas({ pressure: q('1 atm'), volume: q('24.5 L'), amount: q('1 mol'), temperature: null })
    near(t.value, 24.5 / ChemConstants.gasConstantLatm, 1e-6)
    const grams = Gases.idealGas({
      pressure: q('1.00 atm'), volume: q('22.414 L'), amount: null, temperature: q('273.15 K'), formula: F('CO2'), resultUnit: 'gram',
    })
    near(grams.value, 44.009, 0.001)
    const fromMass = Gases.idealGas({ pressure: null, volume: q('1.00 L'), amount: q('4.0 g'), temperature: q('0 °C'), formula: F('He') })
    near(fromMass.value, (4.0 / 4.0026) * ChemConstants.gasConstantLatm * 273.15, 1e-9)
    expect(() => Gases.idealGas({ pressure: q('1 atm'), volume: null, amount: null, temperature: q('300 K') })).toThrow(ChemError)
    expect(() => Gases.idealGas({ pressure: q('1 atm'), volume: null, amount: q('1 mol'), temperature: q('-300 °C') })).toThrow(ChemError)
  })

  it('condiciones normales', () => {
    near(Gases.molarVolume(q('0 °C'), q('1 atm')).value, 22.414, 0.0005)
    near(Gases.molarVolume(q('0 °C'), q('1 bar')).value, 22.711, 0.0005)
    near(Gases.molarVolume(q('25 °C'), q('1 bar')).value, 24.79, 0.0005)
    expect(Gases.standardConditionsNote).toContain('22.414')
    expect(Gases.standardConditionsNote).toContain('22.711')
    near(ChemConstants.gasConstantLatm, 0.082057, 1e-6)
    expect(ChemConstants.avogadro).toBe(6.02214076e23)
  })

  it('ley combinada y densidad', () => {
    near(Gases.combined(q('1.00 atm'), q('2.00 L'), q('300 K'), q('2.00 atm'), null, q('600 K')).value, 2.0, 1e-12)
    const t2 = Gases.combined(q('1.00 atm'), q('2.00 L'), q('27 °C'), q('1.00 atm'), q('4.00 L'), null)
    near(t2.value, 600.3 - 273.15, 1e-9) // 2 × 300.15 K, en °C como T₁
    expect(t2.unit).toBe('°C')
    near(Gases.combined(q('760 mmHg'), q('1.0 L'), q('273 K'), null, q('0.50 L'), q('273 K')).value, 1520, 1e-9)
    near(Gases.density(F('CO2'), q('1 atm'), q('0 °C')).value, 44.009 / 22.414, 0.0005)
  })
})

describe('pH', () => {
  it('ácidos y bases fuertes', () => {
    const hcl = AcidBase.solve('HCl 0.010 M')
    near(hcl.pH, 2.0, 1e-12)
    expect(hcl.formattedPH).toBe('2.00')
    expect(AcidBase.solve('0.01 M HCl').formattedPH).toBe('2.0')
    const naoh = AcidBase.solve('NaOH 0.0010 M')
    near(naoh.pH, 11.0, 1e-9)
    near(naoh.pOH, 3.0, 1e-9)
    near(AcidBase.solve('Ba(OH)2 0.0050 M').pH, 12.0, 1e-9)
    near(AcidBase.solve('HNO3 2.5e-3 M').pH, -Math.log10(2.5e-3), 1e-12)
    near(AcidBase.solve('KOH 0,05 mol/L').pH, 14 + Math.log10(0.05), 1e-9)
    // Muy diluido: el agua cuenta (no sale pH 8).
    const dilute = AcidBase.solve('HCl 1.0e-8 M')
    near(dilute.pH, 6.98, 0.005)
    expect(dilute.pH).toBeLessThan(7)
  })

  it('ácido sulfúrico', () => {
    const r = AcidBase.solve('H2SO4 0.010 M')
    near(r.pH, 1.84, 0.005)
    expect(r.steps.some((s) => s.includes('1.70'))).toBe(true)
  })

  it('ácidos y bases débiles', () => {
    const acetic = AcidBase.solve('CH3COOH 0.10 M Ka=1.8e-5')
    near(acetic.pH, 2.875, 0.001)
    expect(acetic.formattedPH).toBe('2.88')
    expect(acetic.approximationValid).toBe(true)
    near(acetic.percentIonization, 1.33, 0.01)
    const hf = AcidBase.solve('HF 0.10 M Ka = 6.8e-4')
    expect(hf.approximationValid).toBe(false) // ionización > 5 %
    near(hf.pH, 2.1017, 0.001) // cuadrática exacta
    expect(Math.abs((hf.approximatePH ?? 0) - hf.pH)).toBeGreaterThan(0.01)
    near(AcidBase.solve('HF 0.10 M pKa=3.17').pH, hf.pH, 0.01)
    near(AcidBase.solve('NH3 0.10 M Kb=1.8e-5').pH, 11.125, 0.001)
    // Sin Ka: valor de tablas con aviso, solo para acético y amoníaco.
    expect(AcidBase.solve('NH3 0.10 M').steps[0]).toContain('valor de tablas')
    let message = ''
    try {
      AcidBase.solve('HF 0.10 M')
    } catch (e) {
      message = e instanceof ChemError ? e.message : ''
    }
    expect(message).toContain('Ka')
    // Ácido débil muy diluido: no puede salir pH > 7.
    expect(AcidBase.weakAcid(1e-9, 1.8e-5).pH).toBeLessThan(7.0)
    expect(AcidBase.weakBase(1e-9, 1.8e-5).pH).toBeGreaterThan(7.0)
  })

  it('pH a partir de concentraciones y al revés', () => {
    near(AcidBase.solve('[H+] = 1e-3').pH, 3.0, 1e-12)
    near(AcidBase.solve('[H3O+]=2.5e-4 M').pH, -Math.log10(2.5e-4), 1e-12)
    near(AcidBase.solve('[OH-] = 1.0e-2').pH, 12.0, 1e-9)
    near(AcidBase.solve('pH = 4.50').hydronium, 3.1623e-5, 1e-8)
    near(AcidBase.solve('pOH 4.2').pH, 9.8, 1e-12)
    for (const bad of ['', 'HCl', 'pH = abc', '[H+] = -1', 'Xy 0.1 M']) expect(() => AcidBase.solve(bad), bad).toThrow(ChemError)
  })
})
