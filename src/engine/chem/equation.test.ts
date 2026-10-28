// Portado de la app Swift anterior: Tests/ChemKitTests/EquationParsingTests.swift, BalancerTests.swift y
// NonProportionalBalanceTests.swift.

import { describe, expect, it } from 'vitest'
import { ChemError } from './errors'
import { PeriodicTable } from './elements'
import { ChemicalEquation, effectiveCoefficient, type Term } from './equation'
import { AtomKey } from './formula'
import { balance, balanceEquation } from './balancer'
import { checkEquation } from './checker'
import { Rational } from './rational'
import { TEXTBOOK } from './balancer-fixtures.testutil'

const parse = (s: string): ChemicalEquation => ChemicalEquation.parse(s)

function sides(text: string): [string[], string[]] {
  const e = parse(text)
  const show = (t: Term): string => t.formula.withCoefficient(t.coefficient).text('plain', true, false)
  return [e.reactants.map(show), e.products.map(show)]
}

function message(s: string): string {
  try {
    parse(s)
    return 'OK'
  } catch (e) {
    return e instanceof ChemError ? e.message : String(e)
  }
}

describe('Lectura de ecuaciones', () => {
  it('flechas', () => {
    for (const arrow of ['->', '→', '⟶', '=', '-->', '=>', '==>', '\\rightarrow', '\\longrightarrow', '\\to', '⇒']) {
      const e = parse(`H2 + O2 ${arrow} H2O`)
      expect(e.arrow, arrow).toBe('forward')
      expect(e.reactants.length, arrow).toBe(2)
      expect(e.products.length, arrow).toBe(1)
    }
    for (const arrow of ['⇌', '<=>', '<->', '⇄', '↔', '\\rightleftharpoons', '\\leftrightarrow', '<==>']) {
      expect(parse(`N2 + 3H2 ${arrow} 2NH3`).arrow, arrow).toBe('reversible')
    }
  })

  it('signos «+» frente a cargas', () => {
    expect(sides('Fe3+ + e- -> Fe2+')[0]).toEqual(['Fe^3+', 'e^-'])
    expect(sides('Fe3++e-->Fe2+')[0]).toEqual(['Fe^3+', 'e^-'])
    expect(sides('Fe3++e-->Fe2+')[1]).toEqual(['Fe^2+'])
    expect(sides('Cu2++2e-->Cu')[0]).toEqual(['Cu^2+', '2e^-'])
    expect(sides('2H2+O2->2H2O')[0]).toEqual(['2H2', 'O2'])
    expect(sides('Na^+ + Cl^- -> NaCl')[0]).toEqual(['Na^+', 'Cl^-'])
    expect(sides('Fe+3 + e- -> Fe+2')[0]).toEqual(['Fe^3+', 'e^-'])
    expect(sides('Fe+3 + e- -> Fe+2')[1]).toEqual(['Fe^2+'])
    expect(sides('NH4+ + OH- -> NH3 + H2O')[0]).toEqual(['NH4^+', 'OH^-'])
    expect(sides('H+ + OH- -> H2O')[0]).toEqual(['H^+', 'OH^-'])
    expect(sides('Fe^{3+} + e^{-} -> Fe^{2+}')[0]).toEqual(['Fe^3+', 'e^-'])
    expect(sides('Fe³⁺ + e⁻ → Fe²⁺')[0]).toEqual(['Fe^3+', 'e^-'])
    expect(sides('SO4 2- + Ba2+ -> BaSO4')[0]).toEqual(['SO4^2-', 'Ba^2+'])
    expect(sides('Cu2++2e- -> Cu')[0]).toEqual(['Cu^2+', '2e^-'])
    expect(sides('Fe3+ +e- -> Fe2+')[0]).toEqual(['Fe^3+', 'e^-'])
    expect(sides('Ag+ + Cl- -> AgCl')[0]).toEqual(['Ag^+', 'Cl^-'])
    // Carga seguida del estado (ecuaciones iónicas netas).
    expect(sides('Ag+(aq) + Cl-(aq) -> AgCl(s)')[0]).toEqual(['Ag^+', 'Cl^-'])
    expect(sides('Fe3+(aq) + 3OH-(aq) -> Fe(OH)3(s)')[0]).toEqual(['Fe^3+', '3OH^-'])
    expect(sides('Ag+(aq)+Cl-(aq)->AgCl(s)')[0]).toEqual(['Ag^+', 'Cl^-'])
    expect(sides('Fe3+ (aq) + e- -> Fe2+ (aq)')[0]).toEqual(['Fe^3+', 'e^-'])
    expect(balance('Ba2+(aq) + SO4^2-(aq) -> BaSO4(s)').status).toBe('alreadyBalanced')
    expect(balance('Fe3+(aq) + OH-(aq) -> Fe(OH)3(s)').coefficients).toEqual([1, 3, 1])
    expect(balance('Ba^{2+}(aq) + SO_4^{2-}(aq) \\rightarrow BaSO_4(s)').status).toBe('alreadyBalanced')
  })

  it('coeficientes y estados', () => {
    const e = parse('2 NaCl(aq) + 1/2 O2(g) -> Na2O(s) + Cl2(g)')
    expect(e.reactants.map((t) => t.coefficient?.toString())).toEqual(['2', '1/2'])
    expect(e.reactants.map((t) => t.formula.state)).toEqual(['aq', 'g'])
    expect(e.products.map((t) => t.formula.state)).toEqual(['s', 'g'])
    expect(parse('H2 + ½O2 -> H2O').reactants[1].coefficient?.toString()).toBe('1/2')
    expect(parse('H2 + 0.5 O2 -> H2O').reactants[1].coefficient?.toString()).toBe('1/2')
    expect(parse('H2 + O2 -> H2O').reactants[0].coefficient).toBeNull()
    expect(parse('AgNO3(ac) + NaCl(ac) -> AgCl(s) + NaNO3(ac)').products[0].formula.state).toBe('s')
  })

  it('condiciones sobre la flecha', () => {
    const a = parse('CaCO3 ->[Δ] CaO + CO2')
    expect(a.conditions).toBe('Δ')
    expect(a.products.length).toBe(2)
    expect(a.unicodeText).toBe('CaCO₃ →[Δ] CaO + CO₂')
    expect(a.ce).toBe('\\ce{CaCO3 ->[\\Delta] CaO + CO2}')
    expect(parse('CaCO3 ->[\\Delta] CaO + CO2').conditions).toBe('Δ')
    expect(parse('N2 + H2 ->[Fe][450 °C] NH3').conditions).toBe('Fe, 450 °C')
    expect(parse('N2 + H2 ->[T = 450 °C, P = 200 atm] NH3').conditions).toBe('T = 450 °C, P = 200 atm')
    expect(parse('CaCO3 \\xrightarrow{\\Delta} CaO + CO2').conditions).toBe('Δ')
    // Un complejo detrás de la flecha es una especie, no una condición.
    const complex = parse('Fe3+ + 6 CN- ->[Fe(CN)6]3-')
    expect(complex.conditions).toBeNull()
    expect(complex.products[0]?.formula.charge).toBe(-3)
    expect(parse('Ni + 4 CO ->[Ni(CO)4]').products[0]?.formula.plainText).toBe('[Ni(CO)4]')
    expect(balance('CaCO3 ->[Δ] CaO + CO2').equation?.conditions).toBe('Δ')
  })

  it('las palabras de energía se ignoran con un aviso', () => {
    const e = parse('CaCO3 + calor -> CaO + CO2')
    expect(e.reactants.length).toBe(1)
    expect(e.notes[0] ?? '').toContain('calor')
    expect(parse('H2 + Cl2 + luz -> HCl').reactants.length).toBe(2)
    expect(parse('CH4 + 2O2 -> CO2 + 2H2O + energía').products.length).toBe(2)
  })

  it('ecuaciones en LaTeX', () => {
    expect(parse('\\ce{2H2 + O2 -> 2H2O}').isBalanced).toBe(true)
    expect(parse('$\\mathrm{H_2} + \\mathrm{O_2} \\rightarrow \\mathrm{H_2O}$').products[0]?.formula.plainText).toBe('H2O')
    expect(parse('\\mathrm{Fe^{3+}} + \\mathrm{e^{-}} \\longrightarrow \\mathrm{Fe^{2+}}').isBalanced).toBe(true)
    expect(parse('2\\,\\mathrm{H_{2}} + \\mathrm{O_{2}} \\longrightarrow 2\\,\\mathrm{H_{2}O}').isBalanced).toBe(true)
    // Lo que produce ChemKit en LaTeX (y mhchem) se vuelve a leer.
    const balanced = balance('MnO4- + Fe2+ + H+ -> Mn2+ + Fe3+ + H2O').equation
    expect(balanced).not.toBeNull()
    if (!balanced) return
    expect(parse(balanced.latex).isBalanced).toBe(true)
    expect(parse(balanced.unicodeText).isBalanced).toBe(true)
    expect(parse(balanced.plainText).isBalanced).toBe(true)
    expect(parse(balanced.ce).isBalanced).toBe(true)
  })

  it('errores', () => {
    expect(message('')).toBe('La ecuación está vacía.')
    expect(message('H2 + O2')).toBe('Falta la flecha (→) entre reactivos y productos.')
    expect(message('H2 -> O2 -> H2O')).toBe('La ecuación tiene más de una flecha: escribe una sola reacción.')
    expect(message('-> H2O')).toBe('Faltan los reactivos de la ecuación.')
    expect(message('H2 + O2 ->')).toBe('Faltan los productos de la ecuación.')
    expect(message('H2 + + O2 -> H2O')).toBe('Sobra un «+» en los reactivos: falta una especie.')
    expect(message('H2 + Xy -> H2O')).toContain('«Xy» no es un símbolo químico')
    expect(message('h2 + o2 -> h2o')).toContain('mayúscula')
    expect(message('H'.repeat(60_000) + ' -> H')).toBe('El texto es demasiado largo (máximo 50000 caracteres).')
    expect(message('calor -> calor')).not.toBe('OK')
  })

  it('totales y comprobación del balanceo', () => {
    const e = parse('2 H2 + O2 -> 2 H2O')
    expect(e.isBalanced).toBe(true)
    const hydrogen = PeriodicTable.bySymbol('H')
    if (!hydrogen) throw new Error('falta H')
    expect(e.atomTotals('reactants').get(AtomKey.ofElement(hydrogen))?.toString()).toBe('4')
    expect(parse('H2 + O2 -> H2O').isBalanced).toBe(false)
    expect(parse('Fe3+ -> Fe2+').isBalanced).toBe(false) // la carga no cuadra
    expect(parse('Fe3+ + e- -> Fe2+').chargeTotal('reactants').equals(Rational.int(2))).toBe(true)
    expect(parse('H2 + O2 -> H2O').withCoefficients([2, 1, 2]).plainText).toBe('2 H2 + O2 -> 2 H2O')
  })

  it('JSON de ida y vuelta', () => {
    const e = parse('2H2 + O2 -> 2H2O')
    const json = JSON.stringify(e)
    expect(json).toBe('"2 H2 + O2 -> 2 H2O"')
    expect(ChemicalEquation.fromJSON(JSON.parse(json) as string).equals(e)).toBe(true)
  })
})

describe('Balanceo exacto', () => {
  it('ecuaciones de libro de texto', () => {
    expect(TEXTBOOK.length).toBeGreaterThanOrEqual(80)
    for (const [text, expected] of TEXTBOOK) {
      const r = balance(text)
      const ok = r.status === 'balanced' || (r.status === 'alreadyBalanced' && expected.every((c) => c === 1))
      expect(ok, `${text}: ${r.status} ${r.message}`).toBe(true)
      expect(r.coefficients, text).toEqual(expected)
      expect(r.equation?.isBalanced, text).toBe(true)
      expect(r.steps.length, text).toBeGreaterThan(0)
    }
  })

  it('balancear y comprobar siempre da «correcta»', () => {
    for (const [text] of TEXTBOOK) {
      const eq = balance(text).equation
      if (!eq) continue
      expect(eq.isBalanced, text).toBe(true)
      const reparsed = parse(eq.plainText)
      expect(reparsed.isBalanced, text).toBe(true)
      expect(balanceEquation(reparsed).status, text).toBe('alreadyBalanced')
      expect(checkEquation(eq.plainText, text).status, text).toBe('correct')
      expect(checkEquation(eq.unicodeText, text).status, text).toBe('correct')
    }
  })

  it('no depende del orden; la inversa usa los mismos coeficientes; un múltiplo es «parcial»', () => {
    // Generador congruencial lineal de 64 bits (el mismo que la prueba Swift).
    let seed = 0x5eedc0den
    const mask = (1n << 64n) - 1n
    const next = (): bigint => {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) & mask
      return seed >> 33n
    }
    const shuffle = <T>(xs: T[]): T[] => {
      for (let i = xs.length - 1; i > 0; i--) {
        const j = Number(next() % BigInt(i + 1))
        ;[xs[i], xs[j]] = [xs[j], xs[i]]
      }
      return xs
    }
    for (const [text, expected] of TEXTBOOK) {
      const eq = parse(text)
      const coefficientOf = new Map<string, number>()
      eq.terms.forEach((t, i) => coefficientOf.set(t.formula.identityKey, expected[i]))
      const shuffled = balanceEquation(new ChemicalEquation({ reactants: shuffle([...eq.reactants]), products: shuffle([...eq.products]) }))
      expect(shuffled.isBalanced, text).toBe(true)
      for (const t of shuffled.equation?.terms ?? []) expect(effectiveCoefficient(t).intValue, text).toBe(coefficientOf.get(t.formula.identityKey))
      const reversed = balanceEquation(new ChemicalEquation({ reactants: eq.products, products: eq.reactants }))
      expect(reversed.isBalanced, `inversa de ${text}`).toBe(true)
      for (const t of reversed.equation?.terms ?? []) {
        expect(effectiveCoefficient(t).intValue, `inversa de ${text}`).toBe(coefficientOf.get(t.formula.identityKey))
      }
      const tripled = eq.withCoefficients(expected.map((c) => c * 3))
      expect(tripled.isBalanced, text).toBe(true)
      expect(checkEquation(tripled.plainText, text).status, text).toBe('partial')
    }
  })

  it('ya balanceadas', () => {
    const a = balance('2H2 + O2 -> 2H2O')
    expect(a.status).toBe('alreadyBalanced')
    expect(a.coefficients).toEqual([2, 1, 2])
    expect(a.message).toBe('La ecuación ya estaba balanceada: 2 H₂ + O₂ → 2 H₂O')
    const b = balance('4H2 + 2O2 -> 4H2O')
    expect(b.status).toBe('alreadyBalanced')
    expect(b.coefficients).toEqual([2, 1, 2])
    expect(b.message).toContain('no son los mínimos')
    const c = balance('H2 + 1/2 O2 -> H2O')
    expect(c.status).toBe('alreadyBalanced')
    expect(c.message).toContain('fracciones')
    expect(balance('Fe3+ + e- -> Fe2+').status).toBe('alreadyBalanced')
  })

  it('imposibles', () => {
    const h = balance('H2 -> O2')
    expect(h.status).toBe('impossible')
    expect(h.message).toContain('el H solo aparece en los reactivos')
    expect(balance('NaCl -> KBr').status).toBe('impossible')
    expect(balance('C + O2 -> CO2 + H2O').status).toBe('impossible')
    const h2o = balance('H2O -> H2O2')
    expect(h2o.status).toBe('impossible')
    expect(h2o.message).toContain('No hay coeficientes')
    expect(balance('CO -> CO2').status).toBe('impossible')
    const charge = balance('Fe3+ -> Fe2+')
    expect(charge.status).toBe('impossible')
    expect(charge.message).toContain('carga')
  })

  it('varias soluciones independientes', () => {
    const r = balance('H2 + O2 -> H2O + H2O2')
    expect(r.status).toBe('multipleSolutions')
    expect(r.alternatives.length).toBe(2)
    expect(r.alternatives.every((a) => a.isBalanced)).toBe(true)
    const alts = new Set(r.alternatives.map((a) => a.unicodeText))
    expect(alts.has('2 H₂ + O₂ → 2 H₂O')).toBe(true)
    expect(alts.has('H₂ + O₂ → H₂O₂')).toBe(true)
    expect(r.equation?.isBalanced).toBe(true) // una combinación válida de ejemplo
    expect(r.isBalanced).toBe(false)
    const given = balance('3 H2 + 2 O2 -> 2 H2O + H2O2')
    expect(given.status).toBe('alreadyBalanced')
    expect(given.coefficients).toEqual([3, 2, 2, 1])
    expect(given.message).toContain('otras combinaciones')
    for (const text of ['C + O2 -> CO + CO2', 'Fe + O2 -> FeO + Fe2O3', 'Cu + HNO3 -> Cu(NO3)2 + NO + NO2 + H2O']) {
      expect(balance(text).status, text).toBe('multipleSolutions')
    }
  })

  it('especie con coeficiente cero', () => {
    const r = balance('NaOH + HCl -> NaCl + H2O + Cl2')
    expect(r.status).toBe('impossible')
    expect(r.message).toContain('Cl₂ sobra')
    expect(r.alternatives[0]?.unicodeText).toBe('NaOH + HCl → NaCl + H₂O')
  })

  it('especie en el lado equivocado', () => {
    const r = balance('H2O2 + O2 -> H2O')
    expect(r.status).toBe('impossible')
    expect(r.message).toContain('O₂ tendría que estar en los productos')
    expect(r.alternatives[0]?.unicodeText).toBe('2 H₂O₂ → 2 H₂O + O₂')
  })

  it('especies repetidas', () => {
    const both = balance('H2O + NaCl -> NaCl + H2')
    expect(both.status).toBe('impossible')
    expect(both.message).toContain('a los dos lados')
    const same = balance('H2 + H2 -> H4')
    expect(same.status).toBe('impossible')
    expect(same.message).toContain('dos veces')
  })

  it('entradas no válidas', () => {
    expect(balance('').status).toBe('invalid')
    expect(balance('H2 + O2').status).toBe('invalid')
    expect(balance('H2 + Xy -> H2O').status).toBe('invalid')
    expect(balance('H2 + Xy -> H2O').message).toContain('«Xy»')
  })

  it('el medio completa las ecuaciones redox', () => {
    const acid = balance('MnO4- + Fe2+ -> Mn2+ + Fe3+', 'acidic')
    expect(acid.status).toBe('balanced')
    expect(acid.equation?.unicodeText).toBe('MnO₄⁻ + 5 Fe²⁺ + 8 H⁺ → Mn²⁺ + 5 Fe³⁺ + 4 H₂O')
    expect(balance('Cr2O7^2- + Fe2+ -> Cr3+ + Fe3+', 'acidic').equation?.unicodeText).toBe('Cr₂O₇²⁻ + 6 Fe²⁺ + 14 H⁺ → 2 Cr³⁺ + 6 Fe³⁺ + 7 H₂O')
    expect(balance('MnO4- + H2O2 -> Mn2+ + O2', 'acidic').equation?.unicodeText).toBe('2 MnO₄⁻ + 5 H₂O₂ + 6 H⁺ → 2 Mn²⁺ + 5 O₂ + 8 H₂O')
    expect(balance('MnO4- + I- -> MnO2 + IO3-', 'basic').equation?.unicodeText).toBe('2 MnO₄⁻ + I⁻ + H₂O → 2 MnO₂ + IO₃⁻ + 2 OH⁻')
    expect(balance('Cr(OH)3 + ClO3- -> CrO4^2- + Cl-', 'basic').equation?.unicodeText).toBe('2 Cr(OH)₃ + ClO₃⁻ + 4 OH⁻ → 2 CrO₄²⁻ + Cl⁻ + 5 H₂O')
    // Si H2O ya está escrita, no se duplica.
    expect(balance('MnO4- + Fe2+ + H+ -> Mn2+ + Fe3+ + H2O', 'acidic').coefficients).toEqual([1, 5, 8, 1, 5, 4])
  })

  it('los pasos explican el álgebra', () => {
    const r = balance('Fe + O2 -> Fe2O3')
    expect(r.steps[0]).toBe('Pongo un coeficiente desconocido a cada especie: a Fe + b O₂ → c Fe₂O₃')
    expect(r.steps).toContain('• Fe: a = 2c')
    expect(r.steps).toContain('• O: 2b = 3c')
    expect(r.steps.some((s) => s.includes('a = 4, b = 3, c = 2'))).toBe(true)
    expect(r.steps).toContain('Compruebo (izquierda = derecha): Fe: 4 = 4; O: 6 = 6.')
    const ionic = balance('Fe3+ + Sn2+ -> Fe2+ + Sn4+')
    expect(ionic.steps.some((s) => s.startsWith('• Carga:'))).toBe(true)
    expect(ionic.equation?.unicodeText).toBe('2 Fe³⁺ + Sn²⁺ → 2 Fe²⁺ + Sn⁴⁺')
  })

  it('texto en los tres estilos', () => {
    const eq = balance('Fe + O2 -> Fe2O3').equation
    expect(eq?.plainText).toBe('4 Fe + 3 O2 -> 2 Fe2O3')
    expect(eq?.unicodeText).toBe('4 Fe + 3 O₂ → 2 Fe₂O₃')
    expect(eq?.latex).toBe('4\\,\\mathrm{Fe} + 3\\,\\mathrm{O_{2}} \\longrightarrow 2\\,\\mathrm{Fe_{2}O_{3}}')
    expect(eq?.ce).toBe('\\ce{4 Fe + 3 O2 -> 2 Fe2O3}')
    const rev = parse('N2 + 3 H2 <=> 2 NH3')
    expect(rev.arrow).toBe('reversible')
    expect(rev.unicodeText).toBe('N₂ + 3 H₂ ⇌ 2 NH₃')
    expect(rev.latex).toContain('\\rightleftharpoons')
    expect(rev.plainText).toBe('N2 + 3 H2 <=> 2 NH3')
    expect(rev.ce).toBe('\\ce{N2 + 3 H2 <=> 2 NH3}')
  })

  it('rendimiento con 15 especies y con la más grande de libro', () => {
    const text = 'Na + K + Ca + Mg + Al + Fe + Zn + Cl2 -> NaCl + KCl + CaCl2 + MgCl2 + AlCl3 + FeCl3 + ZnCl2'
    const eq = parse(text)
    const start = Date.now()
    const r = balanceEquation(eq)
    expect(r.status).toBe('multipleSolutions')
    expect(Date.now() - start).toBeLessThan(250)
    const big = 'K4Fe(CN)6 + KMnO4 + H2SO4 -> KHSO4 + Fe2(SO4)3 + MnSO4 + HNO3 + CO2 + H2O'
    const t0 = Date.now()
    for (let i = 0; i < 20; i++) balance(big)
    expect((Date.now() - t0) / 20).toBeLessThan(50)
  })

  it('ecuaciones hostiles', () => {
    expect(balance('H2 + '.repeat(3000) + 'O2 -> H2O').status).toBe('impossible')
    expect(balance('H2 -> -> H2').status).toBe('invalid')
    expect(balance('🧪'.repeat(1000)).status).toBe('invalid')
    const r = balance('C999999H999998 + O2 -> CO2 + H2O')
    expect(r.status === 'balanced' || r.status === 'impossible', r.status).toBe(true)
  })
})

describe('Coeficientes que cuadran pero no son proporcionales', () => {
  const redox = 'KMnO4 + H2O2 + H2SO4 -> K2SO4 + MnSO4 + O2 + H2O'

  it('mensaje honesto si cuadra pero no es proporcional', () => {
    const r = checkEquation('2KMnO4 + 7H2O2 + 3H2SO4 -> K2SO4 + 2MnSO4 + 6O2 + 10H2O', redox)
    expect(r.status).toBe('partial')
    expect(r.feedback).not.toContain('demasiado grandes')
    expect(r.feedback).toContain('5 H₂O₂')
  })

  it('las respuestas proporcionales no cambian', () => {
    expect(checkEquation('2KMnO4 + 5H2O2 + 3H2SO4 -> K2SO4 + 2MnSO4 + 5O2 + 8H2O', redox).status).toBe('correct')
    const double = checkEquation('4KMnO4 + 10H2O2 + 6H2SO4 -> 2K2SO4 + 4MnSO4 + 10O2 + 16H2O', redox)
    expect(double.status).toBe('partial')
    expect(double.feedback).toContain('divídelos')
    expect(checkEquation('2H2 + O2 -> 2H2O', 'H2 + O2 -> H2O').status).toBe('correct')
  })
})
