import { describe, expect, it } from 'vitest'
import {
  blankWidth, chemTex, formatPoint, insertAt, intervalTex, isTypingTarget, looseText, mathPreview, moveItem, normalizeDecimal,
  optionIndexForKey, optionLetter, parsePoint, previewIsUseful, splitList, texDecimalComma, trueFalseForKey, usesDecimalComma, wordCount
} from './normalize'
import type { Answer } from '@shared/schema/exercises'

describe('insertAt', () => {
  it('inserta en el cursor y deja el cursor dentro de los paréntesis', () => {
    expect(insertAt('2+', 2, 2, '√()', 1)).toEqual({ value: '2+√()', caret: 4 })
  })
  it('reemplaza la selección', () => {
    expect(insertAt('abcdef', 1, 4, 'X')).toEqual({ value: 'aXef', caret: 2 })
  })
  it('acota posiciones fuera de rango', () => {
    expect(insertAt('ab', 10, 20, 'π')).toEqual({ value: 'abπ', caret: 3 })
    expect(insertAt('ab', -3, -1, 'π')).toEqual({ value: 'πab', caret: 1 })
  })
})

describe('texto', () => {
  it('cuenta palabras', () => {
    expect(wordCount('  hola   mundo \n otra ')).toBe(3)
    expect(wordCount('   ')).toBe(0)
  })
  it('ancho de los huecos entre 4 y 28', () => {
    expect(blankWidth('')).toBe(4)
    expect(blankWidth('radio')).toBe(6)
    expect(blankWidth('', '2π radianes')).toBe(12)
    expect(blankWidth('x'.repeat(80))).toBe(28)
  })
  it('compara sin tildes, mayúsculas ni punto final', () => {
    expect(looseText('  Ángulo   de REFERENCIA. ')).toBe('angulo de referencia')
    expect(looseText('x’')).toBe("x'")
  })
})

describe('coma decimal', () => {
  it('sabe qué idiomas la usan', () => {
    expect(usesDecimalComma('es-ES')).toBe(true)
    expect(usesDecimalComma('en')).toBe(false)
    expect(usesDecimalComma(undefined)).toBe(false)
  })
  it('normaliza números escritos a mano', () => {
    expect(normalizeDecimal('0,25')).toBe('0.25')
    expect(normalizeDecimal('−3')).toBe('-3')
    expect(normalizeDecimal('1 234,5')).toBe('1234.5')
    expect(normalizeDecimal('1.234,5')).toBe('1234.5')
    expect(normalizeDecimal('3.5')).toBe('3.5')
    expect(normalizeDecimal('(1, 2)')).toBe('(1, 2)')
  })
  it('dibuja la coma en LaTeX', () => {
    expect(texDecimalComma('3.5 + x')).toBe('3{,}5 + x')
  })
  it('separa listas con coma o punto y coma', () => {
    expect(splitList('{1, 2, 3}', false)).toEqual(['1', '2', '3'])
    expect(splitList('1,5; 2', true)).toEqual(['1,5', '2'])
    expect(splitList('1,5', true)).toEqual(['1,5'])
    expect(splitList('', true)).toEqual([])
  })
})

describe('vista previa', () => {
  const numeric: Answer = { kind: 'numeric', value: '1', alternatives: [], absTol: 0, relTol: 0, form: 'any', unitMode: 'ignore', angle: 'radians' }
  const expression: Answer = { kind: 'expression', expected: 'x', domainMin: -1, domainMax: 1, form: 'any', forbidden: [], angle: 'radians' }

  it('lee una fracción y la dibuja', () => {
    const p = mathPreview('4*pi/3', numeric)
    expect(p.error).toBeUndefined()
    expect(p.tex).toContain('\\frac')
    expect(p.tex).toContain('\\pi')
  })
  it('vacío no enseña nada', () => {
    expect(mathPreview('   ', expression)).toEqual({})
  })
  it('una expresión mal escrita no da LaTeX', () => {
    expect(mathPreview('(2+', expression).tex).toBeUndefined()
  })
  it('las ecuaciones llevan su igual', () => {
    expect(mathPreview('y = 2x + 1', { kind: 'equation', expected: 'y = 2x + 1' }).tex).toMatch(/=/)
  })
  it('los puntos van entre paréntesis', () => {
    expect(mathPreview('(1, 2)', { kind: 'point', expected: ['1', '2'], absTol: 0 }).tex).toMatch(/^\\left\(.*\\right\)$/)
  })
  it('con coma decimal, los decimales salen con coma', () => {
    expect(mathPreview('2.5', numeric, true).tex).toContain('{,}')
  })
  it('intervalos: extremos, infinito y unión', () => {
    expect(intervalTex('(-inf, 2]')).toBe('\\left(-\\infty,\\ 2\\right]')
    expect(intervalTex('[0, 1) U (2, 3)')).toContain('\\cup')
    expect(intervalTex('x >= 3')).toContain('\\ge')
    expect(() => intervalTex('0, 1')).toThrow()
  })
  it('un número suelto no necesita vista previa', () => {
    expect(previewIsUseful('45', '45')).toBe(false)
    expect(previewIsUseful('3,5', '3{,}5')).toBe(false)
    expect(previewIsUseful('1/2', '\\frac{1}{2}')).toBe(true)
    expect(previewIsUseful('x', undefined)).toBe(false)
  })
})

describe('química', () => {
  it('ecuaciones con flechas de mhchem', () => {
    expect(chemTex('CH4 + 2 O2 → CO2 + 2 H2O', 'equation')).toBe('\\ce{CH4 + 2 O2 -> CO2 + 2 H2O}')
    expect(chemTex('N2 + 3H2 <=> 2NH3', 'equation')).toBe('\\ce{N2 + 3H2 <=> 2NH3}')
    expect(chemTex('CuSO4·5H2O', 'formula')).toBe('\\ce{CuSO4*5H2O}')
  })
  it('configuración electrónica con superíndices', () => {
    expect(chemTex('[Ar] 4s2 3d6', 'configuration')).toBe('[\\mathrm{Ar}]\\,4\\mathrm{s}^{2}\\,3\\mathrm{d}^{6}')
  })
  it('nombres y números no se dibujan', () => {
    expect(chemTex('metano', 'name')).toBeUndefined()
    expect(chemTex('', 'formula')).toBeUndefined()
  })
  it('no deja pasar llaves ni barras (no se sale de \\ce)', () => {
    expect(chemTex('H2O}\\textbf{x', 'formula')).toBe('\\ce{H2Otextbfx}')
  })
})

describe('teclado', () => {
  it('letras y números eligen opciones', () => {
    expect(optionIndexForKey('a')).toBe(0)
    expect(optionIndexForKey('C')).toBe(2)
    expect(optionIndexForKey('1')).toBe(0)
    expect(optionIndexForKey('9')).toBe(8)
    expect(optionIndexForKey('0')).toBeNull()
    expect(optionIndexForKey('Enter')).toBeNull()
  })
  it('verdadero y falso', () => {
    expect(trueFalseForKey('V')).toBe(true)
    expect(trueFalseForKey('t')).toBe(true)
    expect(trueFalseForKey('1')).toBe(true)
    expect(trueFalseForKey('f')).toBe(false)
    expect(trueFalseForKey('2')).toBe(false)
    expect(trueFalseForKey('x')).toBeNull()
  })
  it('sabe cuándo el foco está escribiendo', () => {
    const input = (type = 'text', readOnly = false) => ({ tagName: 'INPUT', readOnly, getAttribute: (n: string) => (n === 'type' ? type : null) })
    expect(isTypingTarget(input())).toBe(true)
    expect(isTypingTarget(input('checkbox'))).toBe(false)
    // ya comprobado (solo lectura): ↩ sigue al siguiente
    expect(isTypingTarget(input('text', true))).toBe(false)
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
  it('letras de las opciones', () => {
    expect(optionLetter(0)).toBe('A')
    expect(optionLetter(25)).toBe('Z')
    expect(optionLetter(26)).toBe('27')
  })
})

describe('listas y puntos', () => {
  it('mueve elementos sin salirse', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b', 'c'], 2, -5)).toEqual(['c', 'a', 'b'])
    expect(moveItem(['a', 'b'], 7, 0)).toEqual(['a', 'b'])
  })
  it('puntos «x,y» de ida y vuelta', () => {
    expect(parsePoint(formatPoint(0.25, 0.5))).toEqual({ x: 0.25, y: 0.5 })
    expect(parsePoint(' 0.1 ; -0.2 ')).toEqual({ x: 0.1, y: -0.2 })
    expect(parsePoint('arriba')).toBeNull()
  })
})
