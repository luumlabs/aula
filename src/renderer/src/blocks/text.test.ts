// Pruebas del texto de los bloques: fórmulas en pantalla y cifras en las tablas.
import { describe, expect, it } from 'vitest'
import { normalizeMath, isNumericCell } from './text'
import { columnAligns } from './TableBlocks'

describe('fórmulas en el texto', () => {
  it('pasa $$…$$ en una línea a un bloque propio', () => {
    expect(normalizeMath('Mira:\n\n$$\\int_0^1 x\\,dx$$\n\nY sigue.')).toBe('Mira:\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nY sigue.')
  })
  it('entiende \\[…\\] y \\(…\\)', () => {
    expect(normalizeMath('a \\(x^2\\) b')).toBe('a $x^2$ b')
    expect(normalizeMath('\\[ y = 2 \\]')).toBe('\n$$\ny = 2\n$$\n')
  })
  it('no toca el texto sin fórmulas ni los saltos \\\\[2pt]', () => {
    expect(normalizeMath('Hola, $x$.')).toBe('Hola, $x$.')
    const m = '$$\n\\begin{aligned} a \\\\[2pt] b \\end{aligned}\n$$'
    expect(normalizeMath(m)).toBe(m)
  })
})

describe('cifras en las tablas', () => {
  it('reconoce cifras con separadores, signos y unidades', () => {
    for (const s of ['3', '0,866', '−12 %', '1 200', '4.50 €', '25 °', '9,8 m', '$0.5$']) expect(isNumericCell(s)).toBe(true)
    for (const s of ['$\\frac{\\pi}{6}$', 'Uno', '', '30 grados de más']) expect(isNumericCell(s)).toBe(false)
  })
  it('alinea a la derecha las columnas de cifras salvo que el autor diga otra cosa', () => {
    const rows = [['a', '1,5', 'x'], ['b', '22', 'y']]
    expect(columnAligns(['A', 'B', 'C'], rows, [])).toEqual(['left', 'right', 'left'])
    expect(columnAligns(['A', 'B', 'C'], rows, ['center'])).toEqual(['center', 'right', 'left'])
  })
})

describe('fracciones a tamaño de texto', () => {
  it('cambia \\frac por \\dfrac y deja \\tfrac y \\dfrac', async () => {
    const { displayFractions } = await import('./text')
    expect(displayFractions('$\\frac{\\pi}{6}$ y $\\tfrac12$')).toBe('$\\dfrac{\\pi}{6}$ y $\\tfrac12$')
    expect(displayFractions('$\\dfrac{a}{b}$')).toBe('$\\dfrac{a}{b}$')
  })
})
