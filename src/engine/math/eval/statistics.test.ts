import { describe, expect, it } from 'vitest'
import { MV, type MathValue } from '../core/types'
import { evaluate, evaluateDouble } from './evaluate'
import { simplify } from '../algebra/simplify'
import { MathParser } from '../parse/parser'
import { toLatex } from '../print/latex'
import { toPlain } from '../print/plain'
import { P, Q, R, errorOf, exact, expectClose, expectValue, num, parseError, plainOf } from '../test-support.testutil'

/**
 * Estadística con nombres de calculadora TI: descriptiva, normal, binomial, Poisson, t de Student y ji cuadrado.
 * Los valores de referencia se calcularon con mpmath a 40 cifras y quedan fijos aquí.
 */
const REFERENCE: Array<[string, number]> = [
  ['normalcdf(-1.96, 1.96)', 0.95000420970355913],
  ['normalcdf(-1, 1)', 0.68268949213708590],
  ['normalcdf(-2, 2)', 0.95449973610364159],
  ['normalcdf(-3, 3)', 0.99730020393673981],
  ['normalcdf(-inf, 1.645)', 0.95001509446087864],
  ['normalcdf(1.645, inf)', 0.049984905539121363],
  ['normalcdf(-1e99, 0)', 0.50000000000000000],
  ['normalcdf(5, 1e99)', 2.8665157187919391e-7],
  ['normalcdf(8, inf)', 6.2209605742717841e-16],
  ['normalcdf(-inf, -8)', 6.2209605742717841e-16],
  ['normalcdf(60, 75, 70, 5)', 0.81859461412036374],
  ['normalcdf(85, inf, 70, 10)', 0.066807201268858066],
  ['normalcdf(0.5, 1.5)', 0.24173033745712883],
  ['normalcdf(-inf, inf)', 1.0000000000000000],
  ['normalcdf(100, 120, 110, 15)', 0.49501492490615417],
  ['normalcdf(2, 1)', -0.13590512198327784],
  ['normalpdf(0)', 0.39894228040143268],
  ['normalpdf(1)', 0.24197072451914335],
  ['normalpdf(1.5, 1, 2)', 0.19333405840142460],
  ['normalpdf(70, 70, 5)', 0.079788456080286536],
  ['normalpdf(-3)', 0.0044318484119380072],
  ['invnorm(0.975)', 1.9599639845400539],
  ['invnorm(0.95)', 1.6448536269514723],
  ['invnorm(0.5)', 0],
  ['invnorm(0.99)', 2.3263478740408408],
  ['invnorm(0.025)', -1.9599639845400542],
  ['invnorm(0.01)', -2.3263478740408411],
  ['invnorm(1e-10)', -6.3613409024040562],
  ['invnorm(0.999999)', 4.7534243088228989],
  ['invnorm(0.9, 100, 15)', 119.22327348316901],
  ['invnorm(0.3)', -0.52440051270804082],
  ['invnorm(0.02425)', -1.9729610513118849],
  ['invnorm(0.97575)', 1.9729610513118849],
  ['tcdf(-2.228, 2.228, 10)', 0.94998822818288863],
  ['tcdf(-inf, 2.228138851986274, 10)', 0.97499999999999997],
  ['tcdf(1.5, inf, 4)', 0.10400000000000000],
  ['tcdf(-inf, -3, 1)', 0.10241638234956673],
  ['tcdf(-1, 1, 1)', 0.50000000000000000],
  ['tcdf(0, 2, 2)', 0.40824829046386302],
  ['tcdf(-2, 3, 30)', 0.96999249548568247],
  ['tcdf(1, 2, 2.5)', 0.12333476576015374],
  ['tcdf(4, inf, 100)', 6.0761822150380839e-5],
  ['tcdf(-0.5, 0.25, 7)', 0.27891363923143198],
  ['invt(0.975, 10)', 2.2281388519862742],
  ['invt(0.95, 1)', 6.3137515146750374],
  ['invt(0.05, 5)', -2.0150483733330242],
  ['invt(0.995, 30)', 2.7499956535672250],
  ['invt(0.9, 2)', 1.8856180831641270],
  ['invt(0.5, 12)', 0],
  ['invt(0.999, 3)', 10.214531852407383],
  ['invt(0.975, 1000)', 1.9623390808264081],
  ['invt(0.25, 4.5)', -0.73286668623599450],
  ['chi2cdf(0, 3.841458820694124, 1)', 0.94999999999999994],
  ['chi2cdf(0, 5.991, 2)', 0.94998838497342091],
  ['chi2cdf(3.84, inf, 1)', 0.050043521248705103],
  ['chi2cdf(2, 8, 5)', 0.69290940850688731],
  ['chi2cdf(0, 1, 10)', 0.00017211562995584078],
  ['chi2cdf(20, 1e99, 10)', 0.029252688076961073],
  ['chi2cdf(-5, 2, 3)', 0.42759329552912017],
  ['chi2cdf(50, 60, 40)', 0.11170136564425955],
  ['chi2cdf(0.5, 1.5, 0.5)', 0.15625856855303718],
  ['chi2pdf(1, 1)', 0.24197072451914335],
  ['chi2pdf(2, 2)', 0.18393972058572116],
  ['chi2pdf(3, 5)', 0.15418032980376928],
  ['chi2pdf(10, 10)', 0.087733684883925353],
  ['binompdf(10, 0.5, 5)', 0.24609375000000000],
  ['binompdf(20, 0.3, 5)', 0.17886305056987974],
  ['binompdf(10, 0.5, 11)', 0],
  ['binompdf(5, 1/6, 2)', 0.16075102880658436],
  ['binompdf(100, 0.01, 1)', 0.36972963764972677],
  ['binompdf(2000, 0.5, 1000)', 0.017839011145854321],
  ['binompdf(1500, 0.1, 150)', 0.034316202851940247],
  ['binomcdf(10, 0.5, 5)', 0.62304687500000000],
  ['binomcdf(20, 0.3, 5)', 0.41637082944748138],
  ['binomcdf(10, 0.5, 10)', 1.0000000000000000],
  ['binomcdf(10, 0.5, -1)', 0],
  ['binomcdf(50, 0.2, 15)', 0.96919657721795240],
  ['binomcdf(300, 0.4, 100)', 0.010216914102379592],
  ['binomcdf(2000, 0.5, 980)', 0.19158842766761875],
  ['binomcdf(5000, 0.02, 120)', 0.97843772850438474],
  ['binomcdf(12, 0.25, 3)', 0.64877861738204956],
  ['poissonpdf(3, 2)', 0.22404180765538774],
  ['poissonpdf(2.5, 0)', 0.082084998623898795],
  ['poissonpdf(10, 10)', 0.12511003572113330],
  ['poissonpdf(0.5, 3)', 0.012636055410679863],
  ['poissonpdf(800, 800)', 0.014103270421583719],
  ['poissoncdf(3, 2)', 0.42319008112684352],
  ['poissoncdf(2.5, 0)', 0.082084998623898795],
  ['poissoncdf(10, 15)', 0.95125959669602130],
  ['poissoncdf(4, 1)', 0.091578194443670901],
  ['poissoncdf(100, 90)', 0.17138511932176140],
  ['poissoncdf(800, 820)', 0.76656773510420367],
  ['poissoncdf(3, -1)', 0],
  ['zscore(85, 70, 10)', 1.5000000000000000],
  ['zscore(60, 70, 5)', -2.0000000000000000],
  ['mean(1, 2, 3, 4)', 2.5000000000000000],
  ['median(5, 1, 3)', 3.0000000000000000],
  ['median(4, 1, 3, 2)', 2.5000000000000000],
  ['var(2, 4, 4, 4, 5, 5, 7, 9)', 4.5714285714285714],
  ['pvar(2, 4, 4, 4, 5, 5, 7, 9)', 4.0000000000000000],
  ['stdev(2, 4, 4, 4, 5, 5, 7, 9)', 2.1380899352993951],
  ['pstdev(2, 4, 4, 4, 5, 5, 7, 9)', 2.0000000000000000],
  ['sum(1.5, 2.5, 3)', 7.0000000000000000],
  ['mode(1, 2, 2, 3)', 2.0000000000000000],
  ['stdev(1.2, 3.4, 5.6, 7.8)', 2.8401877872187724],
  ['mean(sqrt(2), pi)', 2.2779031079814441],
  ['var(sqrt(2), pi, e)', 0.81060410367631957],
]

const ev = (s: string): number => evaluateDouble(P(s))

describe('StatisticsTests', () => {
  it('reference values', () => {
    expect(REFERENCE.length).toBeGreaterThanOrEqual(100)
    for (const [input, expected] of REFERENCE) {
      const e = MathParser.parse(input)
      const v = evaluateDouble(e)
      const tol = 1e-11 * Math.max(Math.abs(expected), 1e-300) + (Math.abs(expected) < 1e-12 ? 1e-26 : 0)
      const ok = Math.abs(v - expected) <= Math.max(tol, 1e-14 * Math.max(1, Math.abs(expected))) || Math.abs(v - expected) <= 1e-11 * Math.abs(expected)
      expect(ok, `«${input}»: ${v} frente a ${expected}`).toBe(true)
      // la evaluación exacta da el mismo número
      const exactValue = MV.double(evaluate(e))
      expect(Math.abs(exactValue - v) <= 1e-12 * Math.max(1, Math.abs(v)), `«${input}» exacto: ${exactValue} frente a ${v}`).toBe(true)
    }
  })

  it('tails keep relative precision', () => {
    const rows: Array<[string, number]> = [['normalcdf(8, inf)', 6.2209605742717841e-16], ['normalcdf(-inf, -8)', 6.2209605742717841e-16],
      ['normalcdf(5, 1e99)', 2.8665157187919391e-7], ['tcdf(4, inf, 100)', 6.0761822150380839e-5]]
    for (const [s, expected] of rows) {
      const v = ev(s)
      expect(Math.abs(v - expected) / expected, `«${s}»: ${v}`).toBeLessThan(1e-9)
    }
  })

  // MARK: Exactitud

  it('descriptive statistics are exact with rationals', () => {
    const rows: Array<[string, MathValue]> = [
      ['sum(1, 2, 3)', Q(6)], ['sum(1/2, 1/3)', Q(5, 6)], ['mean(1, 2, 3, 4)', Q(5, 2)],
      ['mean(1/3, 1/6)', Q(1, 4)], ['median(3, 1, 2)', Q(2)], ['median(1, 2, 3, 4)', Q(5, 2)],
      ['mode(1, 2, 2, 3)', Q(2)], ['var(1, 2, 3, 4)', Q(5, 3)], ['pvar(1, 2, 3, 4)', Q(5, 4)],
      ['pstdev(2, 4, 4, 4, 5, 5, 7, 9)', Q(2)], ['stdev(1, 3)', R(Math.sqrt(2))], ['zscore(85, 70, 10)', Q(3, 2)],
      ['binompdf(10, 0.5, 5)', Q(63, 256)], ['binomcdf(4, 1/2, 2)', Q(11, 16)], ['binompdf(5, 1/6, 2)', Q(625, 3888)],
      ['nCr(10, 3)', Q(120)], ['nPr(10, 3)', Q(720)], ['binom(10, 3)', Q(120)],
      ['mean({1, 2, 3})', Q(2)], ['sum([1; 2; 3])', Q(6)], ['mean({1,5; 2,5})', Q(2)],
    ]
    for (const [s, v] of rows) expectValue(exact(s), v, `«${s}»`)
    expect(MV.isExact(exact('normalcdf(-1, 1)') as MathValue), 'las distribuciones continuas dan un real').toBe(false)
    expect(toPlain(simplify(P('mean(1, 2, 3, 4)'))), 'se pliega como constante exacta').toBe('5/2')
  })

  // MARK: Sintaxis

  it('names, aliases and syntax', () => {
    const rows: Array<[string, string]> = [
      ['invNorm(0.975)', 'invnorm(0.975)'], ['InvT(0.975, 10)', 'invt(0.975, 10)'], ['normalCdf(-1, 1)', 'normalcdf(-1, 1)'],
      ['χ²cdf(0, 3.84, 1)', 'chi2cdf(0, 3.84, 1)'], ['chi2cdf(0, 3.84, 1)', 'chi2cdf(0, 3.84, 1)'], ['chisqcdf(0, 3.84, 1)', 'chi2cdf(0, 3.84, 1)'],
      ['χ²pdf(1, 1)', 'chi2pdf(1, 1)'], ['media(1, 2)', 'mean(1, 2)'], ['promedio(1, 2)', 'mean(1, 2)'], ['mediana(1, 2)', 'median(1, 2)'],
      ['moda(1, 1)', 'mode(1, 1)'], ['varianza(1, 2)', 'var(1, 2)'], ['desvest(1, 2)', 'stdev(1, 2)'], ['stdevp(1, 2)', 'pstdev(1, 2)'],
      ['suma(1, 2)', 'sum(1, 2)'], ['normpdf(0)', 'normalpdf(0)'], ['mean({1, 2, 3})', 'mean(1, 2, 3)'], ['max([1, 5, 2])', 'max(1, 5, 2)'],
      ['normalcdf(-∞, 1.96)', 'normalcdf(-inf, 1.96)'], ['binompdf(10; 0,5; 3)', 'binompdf(10, 0.5, 3)'],
    ]
    for (const [input, plain] of rows) expect(plainOf(input), `«${input}»`).toBe(plain)
    for (const [, plain] of rows) expect(plainOf(plain)).toBe(plain)
    expect(toLatex(P('invnorm(0.975)'))).toBe('\\operatorname{invNorm}\\left(0.975\\right)')
    expect(toLatex(P('chi2cdf(0, 3.84, 1)'))).toBe('\\chi^{2}\\operatorname{cdf}\\left(0,3.84,1\\right)')
    expect(toLatex(P('mean(1, 2)'))).toBe('\\operatorname{mean}\\left(1,2\\right)')
    expectClose(num('2*normalcdf(1.96, inf)'), 0.04999579029644087)
    expectClose(num('1 - binomcdf(10, 0.5, 7)'), 56 / 1024)
  })

  // MARK: Errores en español

  it('invalid arguments give Spanish errors', () => {
    const rows: Array<[string, string]> = [
      ['normalcdf(0, 1, 0, -1)', 'σ debe ser un número positivo'], ['normalpdf(0, 0, 0)', 'σ debe ser un número positivo'],
      ['invnorm(1.2)', 'entre 0 y 1'], ['invnorm(0)', 'entre 0 y 1'], ['invnorm(1)', 'entre 0 y 1'],
      ['binompdf(10, 1.5, 3)', 'p debe estar entre 0 y 1'], ['binompdf(10.5, 0.5, 3)', 'debe ser un número entero'],
      ['binomcdf(10, 0.5, 2.5)', 'k (número de éxitos) debe ser un número entero'], ['binompdf(-3, 0.5, 1)', 'no puede ser negativo'],
      ['poissonpdf(-1, 2)', 'λ debe ser un número positivo'], ['poissoncdf(2, 1.5)', 'k debe ser un número entero'],
      ['tcdf(0, 1, 0)', 'grados de libertad'], ['invt(0.5, -2)', 'grados de libertad'], ['invt(1, 5)', 'entre 0 y 1'],
      ['chi2cdf(0, 1, -1)', 'grados de libertad'], ['var(5)', 'al menos 2 datos'], ['stdev(5)', 'al menos 2 datos'],
      ['mode(1, 2, 3)', 'ningún valor se repite'], ['mode(1, 1, 2, 2)', 'No hay una moda única'], ['zscore(1, 0, 0)', 'σ debe ser positiva'],
    ]
    for (const [input, fragment] of rows) {
      const e = errorOf(input)
      expect(e, `«${input}» debería dar error`).not.toBeNull()
      if (!e) continue
      expect(e.kind, `«${input}»: ${e.message}`).toBe('domain')
      expect(e.message, `«${input}»`).toContain(fragment)
    }
    const arity = parseError('binompdf(10, 0.5)')
    expect(arity?.kind).toBe('syntax')
    expect(arity?.message).toContain('binompdf(n, p, k)')
    expect(parseError('mean({1, 2}, 3)'), 'tras la lista entre llaves solo cabe cerrar el paréntesis').not.toBeNull()
    expect(parseError('mean({})')).not.toBeNull()
  })

  it('distribution identities', () => {
    for (const z of [0.1, 0.7, 1.3, 2.9, 4.4]) {
      expect(Math.abs(ev(`normalcdf(-inf, ${z}) + normalcdf(${z}, inf)`) - 1)).toBeLessThanOrEqual(1e-15)
      expect(Math.abs(ev(`invnorm(normalcdf(-inf, ${z}))`) - z)).toBeLessThanOrEqual(1e-9)
      expect(Math.abs(ev(`tcdf(-inf, ${z}, 7) + tcdf(-inf, -${z}, 7)`) - 1)).toBeLessThanOrEqual(1e-14)
      expect(Math.abs(ev(`invt(tcdf(-inf, ${z}, 7), 7)`) - z)).toBeLessThanOrEqual(1e-8)
    }
    for (let k = 0; k <= 12; k++) expect(Math.abs(ev(`binomcdf(12, 0.3, ${k}) + 1 - binomcdf(12, 0.3, ${k})`) - 1)).toBeLessThanOrEqual(1e-15)
    expect(Math.abs(ev('sum(binompdf(6, 0.4, 0), binompdf(6, 0.4, 1), binompdf(6, 0.4, 2))') - ev('binomcdf(6, 0.4, 2)'))).toBeLessThanOrEqual(1e-15)
    expect(Math.abs(ev('chi2cdf(0, 3.841458820694124, 1)') - ev('normalcdf(-1.959963984540054, 1.959963984540054)')), 'χ²(1) es el cuadrado de una normal').toBeLessThanOrEqual(1e-12)
    expect(Math.abs(ev('tcdf(-inf, 1, 1)') - 0.75), 't(1) es la distribución de Cauchy').toBeLessThanOrEqual(1e-15)
  })

  it('heavy calls are reasonably fast', () => {
    const start = Date.now()
    ev('binomcdf(1000000, 0.3, 300500)')
    ev('poissoncdf(100000, 100300)')
    ev('invt(1e-12, 1)')
    ev('chi2cdf(0, 1000, 1000)')
    expect(Date.now() - start).toBeLessThan(2000)
  })
})
