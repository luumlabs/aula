import { describe, expect, it } from 'vitest'
import { setChemLanguage } from '@engine/chem/l10n'
import { arcPath, balanceView, chemErrorText, donutArcs, englishBalanceMessage, molarView } from './chem'

describe('molarView', () => {
  it('desglosa la masa molar', () => {
    const v = molarView('H2O')
    expect(v?.ok).toBe(true)
    if (!v?.ok) return
    expect(v.value).toBeCloseTo(18.015, 3)
    expect(v.parts.map((p) => [p.symbol, p.count])).toEqual([['H', 2], ['O', 1]])
    expect(v.parts.reduce((a, p) => a + p.percent, 0)).toBeCloseTo(100, 6)
  })
  it('acepta hidratos', () => {
    const v = molarView('CuSO4·5H2O')
    expect(v?.ok && v.value).toBeCloseTo(249.68, 2)
  })
  it('devuelve el error del motor', () => {
    const v = molarView('Xx2')
    expect(v?.ok).toBe(false)
    if (v && !v.ok) expect(chemErrorText(v.error, true)).toContain('Xx')
    expect(molarView('  ')).toBeNull()
  })
})

describe('balanceView', () => {
  it('balancea y cuenta los átomos', () => {
    const b = balanceView('Fe + O2 -> Fe2O3')
    expect(b?.status).toBe('balanced')
    expect(b?.terms.map((t) => t.coef)).toEqual([4, 3, 2])
    expect(b?.atoms).toEqual([
      { symbol: 'O', left: 6, right: 6 },
      { symbol: 'Fe', left: 4, right: 4 }
    ])
  })
  it('explica lo que no se puede balancear', () => {
    expect(balanceView('Fe -> Cu')?.status).toBe('impossible')
    expect(englishBalanceMessage('impossible')).toContain("can't")
  })
  it('lleva la carga de las ecuaciones iónicas', () => {
    const b = balanceView('Fe3+ + Cu -> Fe2+ + Cu2+')
    expect(b?.status).toBe('balanced')
    expect(b?.charge?.left).toBe(b?.charge?.right)
  })
})

describe('donut', () => {
  it('reparte la vuelta entera', () => {
    const arcs = donutArcs([25, 75], 0)
    expect(arcs[0].start).toBeCloseTo(-Math.PI / 2)
    expect(arcs[1].end).toBeCloseTo((3 * Math.PI) / 2)
    expect(arcPath(50, 50, 40, 0, Math.PI / 2)).toMatch(/^M 90\.00 50\.00 A 40 40 0 0 1/)
  })
})

describe('mensajes', () => {
  it('usa el idioma que se le da al motor', () => {
    setChemLanguage('en')
    const v = molarView('co2')
    expect(v && !v.ok && chemErrorText(v.error, false)).toContain('capital')
    setChemLanguage('es')
    const w = molarView('co2')
    expect(w && !w.ok && chemErrorText(w.error, true)).toContain('mayúscula')
    expect(chemErrorText(new Error(''), false)).toContain('calculate')
  })
})
