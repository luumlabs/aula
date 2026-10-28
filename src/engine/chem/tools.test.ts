// Portado de la app Swift anterior: Tests/ChemKitTests/ChemToolsTests.swift y
// la app Swift anterior: Tests/StudyEngineTests/ChemistryToolsTests.swift (la herramienta única «chemistry»).

import { describe, expect, it } from 'vitest'
import { ChemTools } from './tools'
import { CHEMISTRY_ACTIONS, CHEMISTRY_TOOL, runChemistryTool } from './chemistry-tool'
import { Nomenclature } from './nomenclature'

const T = ChemTools
const near = (actual: number | null | undefined, expected: number, tolerance: number): void => {
  expect(Math.abs((actual ?? Number.NaN) - expected)).toBeLessThanOrEqual(tolerance)
}

describe('Herramientas de química para la IA', () => {
  it('elemento', () => {
    const fe = T.elementInfo('Fe')
    expect(fe.ok).toBe(true)
    expect(fe.value).toBe(55.845)
    expect(fe.unit).toBe('g/mol')
    expect(fe.text.startsWith('Hierro (Fe) — número atómico 26')).toBe(true)
    expect(fe.text).toContain('[Ar] 4s² 3d⁶')
    expect(fe.text).toContain('Grupo 8, periodo 4, bloque d — Metal de transición')
    expect(fe.text).toContain('1.83')
    expect(fe.text).toContain('+2, +3')
    expect(T.elementInfo('hierro').value).toBe(55.845)
    expect(T.elementInfo('26').value).toBe(55.845)
    expect(T.elementInfo('Iron').value).toBe(55.845)
    expect(T.elementInfo('Cr').text).toContain('excepción')
    expect(T.elementInfo('Tc').text).toContain('[98]')
    expect(T.elementInfo('La').text).toContain('Sin número de grupo')
    expect(T.elementInfo('Fe3+').text).toContain('Ion Fe³⁺: [Ar] 3d⁵')
    expect(T.elementInfo('Cl-').text).toContain('isoelectrónico con el argón')
    const bad = T.elementInfo('xyz')
    expect(bad.ok).toBe(false)
    expect(bad.text).toContain('No encuentro')
  })

  it('configuración electrónica', () => {
    const r = T.electronConfiguration('Fe2+')
    expect(r.ok).toBe(true)
    expect(r.text.startsWith('Fe²⁺: [Ar] 3d⁶')).toBe(true)
    expect(r.text).toContain('paramagnético')
    expect(r.latex).toBe('[\\mathrm{Ar}]\\,3\\mathrm{d}^{6}')
    expect(T.electronConfiguration('Zn2+').text).toContain('diamagnético')
    expect(T.electronConfiguration('Cu').text).toContain('excepción')
    expect(T.electronConfiguration('NaCl').ok).toBe(false)
  })

  it('masa molar', () => {
    const r = T.molarMass('Ca(OH)2')
    expect(r.ok).toBe(true)
    near(r.value, 74.092, 1e-9)
    expect(r.unit).toBe('g/mol')
    expect(r.latex).toBe('M(\\mathrm{Ca(OH)_{2}}) = 74.092\\ \\mathrm{g/mol}')
    expect(r.text).toContain('• Ca: 1 × 40.078 g/mol = 40.078 g/mol')
    expect(r.text).toContain('• O: 2 × 15.999 g/mol = 31.998 g/mol')
    expect(T.molarMass('SO4^2-').text).toContain('electrones')
    expect(T.molarMass('TcO4-').text).toContain('aproximado')
    const bad = T.molarMass('co2')
    expect(bad.ok).toBe(false)
    expect(bad.text).toContain('CO2 (dióxido de carbono)')
  })

  it('balanceo', () => {
    const r = T.balance('Fe + O2 -> Fe2O3')
    expect(r.ok).toBe(true)
    expect(r.text.startsWith('Ecuación balanceada: 4 Fe + 3 O₂ → 2 Fe₂O₃')).toBe(true)
    expect(r.latex).toBe('4\\,\\mathrm{Fe} + 3\\,\\mathrm{O_{2}} \\longrightarrow 2\\,\\mathrm{Fe_{2}O_{3}}')
    const acid = T.balance('MnO4- + Fe2+ -> Mn2+ + Fe3+ (medio ácido)')
    expect(acid.ok).toBe(true)
    expect(acid.text).toContain('MnO₄⁻ + 5 Fe²⁺ + 8 H⁺ → Mn²⁺ + 5 Fe³⁺ + 4 H₂O')
    expect(T.balance('MnO4- + I- -> MnO2 + IO3- en medio básico').ok).toBe(true)
    const impossible = T.balance('H2 -> O2')
    expect(impossible.ok).toBe(false)
    expect(impossible.latex).toBeUndefined()
    expect(T.balance('NaOH + HCl -> NaCl + H2O + Cl2').text).toContain('Quizá querías: NaOH + HCl → NaCl + H₂O')
    expect(T.balance('H2 + O2 -> H2O + H2O2').ok).toBe(false)
    expect(T.balance('').ok).toBe(false)
  })

  it('estequiometría', () => {
    const r = T.stoichiometry('Fe + O2 -> Fe2O3', { Fe: '10.0 g', O2: '0.500 mol' }, 'Fe2O3')
    expect(r.ok).toBe(true)
    near(r.value, 14.297, 0.001)
    expect(r.unit).toBe('g')
    expect(r.text.startsWith('Reactivo limitante: Fe.')).toBe(true)
    expect(r.latex).toBe('m(\\mathrm{Fe_{2}O_{3}}) = 14.3\\ \\mathrm{g}')
    const lowSig = T.stoichiometry('Fe + O2 -> Fe2O3', { Fe: '10 g', O2: '0.5 mol' }, 'Fe2O3')
    expect(lowSig.text).toContain('14.3 g')
    expect(lowSig.text).toContain('habría que dar 1 × 10¹ g')
    const yieldR = T.stoichiometry('N2 + H2 -> NH3', { N2: '28.0 g', H2: '10.0 g' }, 'NH3', '25.0 g')
    expect(yieldR.text).toContain('rendimiento 73.4 %')
    expect(T.stoichiometry('Fe + O2 -> Fe2O3', { Fe: 'diez' }, 'Fe2O3').ok).toBe(false)
  })

  it('números de oxidación y redox', () => {
    const r = T.oxidationStates('KMnO4')
    expect(r.ok).toBe(true)
    expect(r.text.startsWith('Números de oxidación en KMnO₄: K: +1, Mn: +7, O: -2')).toBe(true)
    const eq = T.oxidationStates('Zn + Cu2+ -> Zn2+ + Cu')
    expect(eq.ok).toBe(true)
    expect(eq.value).toBe(2)
    expect(eq.text).toContain('El Zn se oxida')
    expect(T.redox('MnO4- + Fe2+ + H+ -> Mn2+ + Fe3+ + H2O').value).toBe(5)
    expect(T.oxidationStates('CuFeS2').ok).toBe(false)
  })

  it('conversiones', () => {
    const r = T.convert('10 g', 'mol', 'H2O')
    expect(r.ok).toBe(true)
    near(r.value, 0.55509, 1e-5)
    expect(r.unit).toBe('mol')
    expect(r.text.startsWith('10 g de H₂O = 0.555 mol')).toBe(true)
    expect(r.text).toContain('habría que dar 0.56 mol') // «10» tiene 1–2 cifras: se toman 2
    expect(T.convert('25 °C', 'K', null).text.startsWith('25 °C = 298 K')).toBe(true)
    near(T.convert('1.00 atm', 'mmHg', null).value, 760, 1e-9)
    expect(T.convert('2.00 mol', 'moléculas', 'CO2').text).toContain('1.20 × 10²⁴ partículas')
    expect(T.convert('10 g', 'mol', null).ok).toBe(false)
    expect(T.convert('diez', 'mol', 'H2O').ok).toBe(false)
  })

  it('pH', () => {
    const r = T.pH('HCl 0.010 M')
    expect(r.ok).toBe(true)
    near(r.value, 2.0, 1e-12)
    expect(r.latex).toBe('\\mathrm{pH} = 2.00')
    expect(r.text.startsWith('pH = 2.00')).toBe(true)
    expect(T.pH('CH3COOH 0.10 M Ka=1.8e-5').text).toContain('La aproximación vale')
    expect(T.pH('HF 0.1 M').ok).toBe(false)
  })

  it('nombres', () => {
    const a = T.name('NaCl')
    expect(a.ok).toBe(true)
    expect(a.text.startsWith('NaCl: cloruro de sodio')).toBe(true)
    expect(a.text).toContain('Tradicional: cloruro sódico')
    expect(a.latex).toBe('\\mathrm{NaCl}')
    const b = T.name('sulfato de hierro(III)')
    expect(b.ok).toBe(true)
    expect(b.text.startsWith('sulfato de hierro(III): Fe₂(SO₄)₃')).toBe(true)
    expect(b.latex).toBe('\\mathrm{Fe_{2}(SO_{4})_{3}}')
    expect(T.name('agua').text).toContain('H₂O')
    expect(T.name('C8H18').ok).toBe(false)
    expect(T.name('cloruro de hierro').ok).toBe(false)
  })

  it('cifras significativas y fórmula empírica', () => {
    expect(T.significantFigures('0.00450').value).toBe(3)
    expect(T.significantFigures('1200').text).toContain('ambiguo')
    expect(T.significantFigures('abc').ok).toBe(false)
    const emp = T.empiricalFormula('C 40.0%, H 6.7%, O 53.3%', '180.16')
    expect(emp.ok).toBe(true)
    expect(emp.latex).toBe('\\mathrm{C_{6}H_{12}O_{6}}')
    expect(T.empiricalFormula('C: 2.4 g; H: 0.4 g; O: 3.2 g').text).toContain('CH₂O')
    expect(T.empiricalFormula('hola').ok).toBe(false)
  })
})

describe('Correctores', () => {
  it('fórmulas', () => {
    expect(T.checkFormula('H2O', 'H2O').status).toBe('correct')
    expect(T.checkFormula('H_2O', 'H₂O').status).toBe('correct')
    expect(T.checkFormula('C2H4O2', 'CH3COOH').status).toBe('partial')
    expect(T.checkFormula('CH3COOH', 'C2H4O2').status).toBe('correct')
    expect(T.checkFormula('CH2O', 'C6H12O6').status).toBe('incorrect')
    expect(T.checkFormula('Fe2+', 'Fe3+').status).toBe('incorrect')
    expect(T.checkFormula('co', 'CO').status).toBe('invalid')
    expect(T.checkFormula('H2O', 'Xy').status).toBe('invalid')
    const wrong = T.checkFormula('H2SO3', 'H2SO4')
    expect(wrong.status).toBe('incorrect')
    expect(wrong.feedback).toBe('No es correcta: Debería haber 4 O y tienes 3.')
    const state = T.checkFormula('NaCl(s)', 'NaCl(aq)')
    expect(state.status).toBe('partial')
    expect(state.feedback).toContain('(aq)')
    expect(T.checkFormula('NaCl', 'NaCl(aq)').status).toBe('correct')
    expect(T.checkFormula('Co', 'CO').feedback).toContain('mayúsculas')
    expect(T.checkFormula('NaCl2', 'NaCl').feedback).toContain('Debería haber 1 Cl y tienes 2')
    expect(T.checkFormula('KCl', 'NaCl').feedback).toContain('Falta el Na')
  })

  it('ecuaciones', () => {
    expect(T.checkEquation('2 H2 + O2 -> 2 H2O', 'H2 + O2 -> H2O').status).toBe('correct')
    const multiple = T.checkEquation('4 H2 + 2 O2 -> 4 H2O', 'H2 + O2 -> H2O')
    expect(multiple.status).toBe('partial')
    expect(multiple.feedback).toContain('divídelos todos entre 2')
    const unbalanced = T.checkEquation('H2 + O2 -> H2O', 'H2 + O2 -> H2O')
    expect(unbalanced.status).toBe('incorrect')
    expect(unbalanced.feedback).toContain('Hay 2 O a la izquierda y 1 a la derecha.')
    expect(T.checkEquation('2 Fe + 2 O2 -> Fe2O3', 'Fe + O2 -> Fe2O3').feedback).toContain('Hay 4 O a la izquierda y 3 a la derecha.')
    const charge = T.checkEquation('Fe3+ -> Fe2+', 'Fe3+ + e- -> Fe2+')
    expect(charge.status).toBe('incorrect')
    expect(charge.feedback).toContain('Falta el e⁻')
    expect(T.checkEquation('Fe3+ + 2e- -> Fe2+', 'Fe3+ + e- -> Fe2+').feedback).toContain('La carga total es +1 a la izquierda y +2 a la derecha')
    expect(T.checkEquation('2 H2O -> 2 H2 + O2', 'H2 + O2 -> H2O').status).toBe('incorrect')
    expect(T.checkEquation('2 H2O -> 2 H2 + O2', 'H2 + O2 -> H2O').feedback).toContain('al revés')
    expect(T.checkEquation('H2 + H2O -> O2', 'H2O -> H2 + O2').feedback).toContain('El H₂ es un producto, no un reactivo.')
    expect(T.checkEquation('2 H2 -> 2 H2O', 'H2 + O2 -> H2O').feedback).toContain('Falta el O₂ en los reactivos.')
    expect(T.checkEquation('H2 + 1/2 O2 -> H2O', 'H2 + O2 -> H2O').status).toBe('partial')
    expect(T.checkEquation('H2 + 1/2 O2 -> H2O', 'H2 + 1/2 O2 -> H2O').status).toBe('correct')
    expect(T.checkEquation('hola', 'H2 + O2 -> H2O').status).toBe('invalid')
    expect(T.checkEquation('H2 + O2 -> H2O', 'nada').status).toBe('invalid')
    expect(T.checkEquation('CH3COOH + 2 O2 -> 2 CO2 + 2 H2O', 'C2H4O2 + O2 -> CO2 + H2O').status).toBe('correct')
    const states = T.checkEquation('AgNO3(aq) + NaCl(aq) -> AgCl(aq) + NaNO3(aq)', 'AgNO3(aq) + NaCl(aq) -> AgCl(s) + NaNO3(aq)')
    expect(states.feedback).toContain('debería ser (s)')
    expect(T.checkEquation('N2 + 3 H2 -> 2 NH3', 'N2 + H2 <=> NH3').feedback).toContain('⇌')
  })

  it('nombres', () => {
    expect(T.checkName('sulfato de hierro(III)', 'Fe2(SO4)3').status).toBe('correct')
    expect(T.checkName('sulfato férrico', 'Fe2(SO4)3').status).toBe('correct')
    const ii = T.checkName('sulfato de hierro(II)', 'Fe2(SO4)3')
    expect(ii.status).toBe('incorrect')
    expect(ii.feedback).toContain('Ese nombre corresponde a FeSO₄')
    expect(ii.feedback).toContain('número de oxidación')
    expect(T.checkName('dióxido de carbono', 'CO2').status).toBe('correct')
    expect(T.checkName('CO2', 'dióxido de carbono').status).toBe('incorrect')
    expect(T.checkName('sulfito de sodio', 'Na2SO4').status).toBe('incorrect')
    expect(T.checkName('blablá', 'NaCl').status).toBe('invalid')
    expect(T.checkName('cloruro sódico', 'cloruro de sodio').status).toBe('correct')
    expect(T.checkName('cloruro sódico', 'NaCl').feedback).toContain('cloruro de sodio')
    expect(T.checkName('ion sulfato', 'SO4^2-').status).toBe('correct')
    expect(T.checkName('ácido sulfúrico', 'H2SO4').status).toBe('correct')
    expect(T.checkName('x', '???').status).toBe('invalid')
    // La referencia de checkFormula puede ser un nombre, y si el alumno escribe el nombre se le avisa.
    expect(T.checkFormula('Fe2(SO4)3', 'sulfato de hierro(III)').status).toBe('correct')
    expect(T.checkFormula('sulfato de hierro(III)', 'Fe2(SO4)3').status).toBe('partial')
    expect(T.checkFormula('sulfato de hierro(II)', 'Fe2(SO4)3').status).toBe('incorrect')
    expect(Nomenclature.name('CuCl')?.systematic).toBe('monocloruro de cobre')
    expect(Nomenclature.formulaForName('monocloruro de yodo')?.plainText).toBe('ICl')
  })

  it('números y configuraciones', () => {
    expect(T.checkNumber('14.3', 14.2974, 3).status).toBe('correct')
    expect(T.checkNumber('14', 14.2974, 3).status).toBe('partial')
    expect(T.checkElectronConfiguration('[Ar] 3d5 4s1', 'Cr').status).toBe('correct')
    expect(T.checkElectronConfiguration('[Ar] 4s2 3d4', 'Cr').status).toBe('incorrect')
    expect(T.checkElectronConfiguration('[Ar] 3d6', 'Fe2+').status).toBe('correct')
    expect(T.checkElectronConfiguration('1s2 2s2 2p6', '[He] 2s2 2p6').status).toBe('correct')
    expect(T.checkElectronConfiguration('1s3', 'Li').status).toBe('invalid')
    expect(T.checkElectronConfiguration('1s2', '???').status).toBe('invalid')
  })
})

describe('Registro para la IA', () => {
  it('las especificaciones están bien formadas', () => {
    const names = T.specs.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.length).toBeGreaterThanOrEqual(11)
    for (const spec of T.specs) {
      expect(spec.name.startsWith('chem_'), spec.name).toBe(true)
      expect(spec.description.length).toBeGreaterThan(0)
      expect(spec.parameters.type, spec.name).toBe('object')
      for (const required of spec.parameters.required ?? []) expect(spec.parameters.properties[required], `${spec.name}.${required}`).toBeDefined()
      // Sin argumentos responden con un error amable.
      expect(T.run(spec.name, {}).text.length, spec.name).toBeGreaterThan(0)
    }
  })

  it('distribuidor', () => {
    near(T.run('chem_molar_mass', { formula: 'H2O' }).value, 18.015, 1e-9)
    expect(T.run('chem_balance', { equation: 'H2 + O2 -> H2O' }).ok).toBe(true)
    near(T.run('chem_stoichiometry', { equation: 'Fe + O2 -> Fe2O3', given: { Fe: '10.0 g', O2: '0.500 mol' }, find: 'Fe2O3' }).value, 14.297, 0.001)
    near(T.run('chem_stoichiometry', { equation: 'Fe + O2 -> Fe2O3', given: 'Fe=10.0 g; O2: 0.500 mol', find: 'Fe2O3' }).value, 14.297, 0.001)
    expect(T.run('chem_convert', { quantity: '10 g', to: 'mol', formula: 'H2O' }).unit).toBe('mol')
    expect(T.run('chem_ph', { description: 'NaOH 0.01 M' }).ok).toBe(true)
    expect(T.run('chem_name', { text: 'NaCl' }).ok).toBe(true)
    expect(T.run('chem_element', { query: 26 }).ok).toBe(true) // número en lugar de texto
    expect(T.run('chem_oxidation_states', { species: 'SO4^2-' }).ok).toBe(true)
    expect(T.run('chem_electron_configuration', { query: 'Cu+' }).ok).toBe(true)
    expect(T.run('chem_empirical_formula', { data: 'C 85.6%, H 14.4%' }).ok).toBe(true)
    expect(T.run('chem_sig_figs', { number: '1.20e3' }).ok).toBe(true)
    expect(T.run('chem_nope', {}).ok).toBe(false)
  })

  it('los resultados son datos JSON', () => {
    const r = T.molarMass('H2O')
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
    const c = T.checkFormula('H2O', 'H2O')
    expect(JSON.parse(JSON.stringify(c))).toEqual(c)
    expect(JSON.stringify({ status: 'partial', feedback: 'x' })).toContain('"partial"')
  })
})

describe('Herramienta única «chemistry»', () => {
  it('descripción con esquema JSON', () => {
    expect(CHEMISTRY_TOOL.name).toBe('chemistry')
    expect(CHEMISTRY_TOOL.parameters.required).toEqual(['action', 'input'])
    expect(CHEMISTRY_TOOL.parameters.properties.action?.enum).toEqual([...CHEMISTRY_ACTIONS])
    for (const a of CHEMISTRY_ACTIONS) expect(CHEMISTRY_TOOL.description).toContain(a)
  })

  it('masa molar, balanceo, elemento y estequiometría', () => {
    const mm = runChemistryTool({ action: 'molar_mass', input: 'H2O' })
    expect(mm.isError).toBe(false)
    near(mm.json.value as number, 18.015, 0.01)
    const bal = runChemistryTool({ action: 'balance', input: 'Fe + O2 -> Fe2O3' })
    expect(bal.isError).toBe(false)
    const text = String(bal.json.result)
    expect(text.includes('4') && text.includes('3') && text.includes('2')).toBe(true)
    const el = runChemistryTool('{"action":"element","input":"hierro"}') // también como texto JSON
    expect(el.isError).toBe(false)
    expect(String(el.json.result)).toContain('Fe')
    const st = runChemistryTool({ action: 'stoichiometry', input: '2 H2 + O2 -> 2 H2O', given: { H2: '4 g', O2: '16 g' }, find: 'H2O' })
    expect(st.isError, String(st.json.result)).toBe(false)
    expect(String(st.json.result).toLowerCase()).toContain('limitante')
    // El texto para la IA es JSON compacto con las claves ordenadas.
    expect(JSON.parse(mm.text)).toEqual(mm.json)
    expect(mm.text.indexOf('"latex"')).toBeLessThan(mm.text.indexOf('"ok"'))
  })

  it('las entradas malas son errores que la IA puede leer', () => {
    const r = runChemistryTool({ action: 'molar_mass', input: 'Xy2' })
    expect(r.isError).toBe(true)
    expect(String(r.json.result).length).toBeGreaterThan(0)
    expect(runChemistryTool({ action: 'teleport', input: 'H2O' }).isError).toBe(true)
    expect(runChemistryTool({ action: 'balance' }).isError).toBe(true)
    expect(runChemistryTool(null).isError).toBe(true)
    expect(runChemistryTool({ action: 'stoichiometry', input: 'H2 + O2 -> H2O' }).json.error).toContain('find')
    expect(runChemistryTool({ action: 'convert', input: '10 g' }).json.error).toContain('to')
    // Sinónimos de las acciones, como en la app Swift.
    expect(runChemistryTool({ action: 'MASS', input: 'NaCl' }).isError).toBe(false)
    expect(runChemistryTool({ action: 'configuration', input: 'Fe' }).isError).toBe(false)
  })
})
