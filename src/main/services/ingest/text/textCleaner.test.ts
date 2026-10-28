import { describe, expect, it } from 'vitest'
import { foldMath } from '../extract/mathLinearizer'
import { firstHeading, parseHeading } from './headingDetector'
import { collapseSpaces, finalizeText, isPageNumber, isProse, joinLines, looksLikeGarbage, normalizeBullet, normalizeCharacters, reflow, startsWithBullet } from './textCleaner'

describe('TextCleaner', () => {
  it('ligaduras y caracteres invisibles', () => {
    expect(normalizeCharacters('ﬁnal ﬂujo ﬀ ﬃ ﬄ')).toBe('final flujo ff ffi ffl')
    expect(normalizeCharacters('a b c​d­e﻿f')).toBe('a b cdef')
    expect(normalizeCharacters('uno\r\ndos\rtres\u000Ccuatro cinco')).toBe('uno\ndos\ntres\ncuatro\ncinco')
    expect(normalizeCharacters('a\u0000b\u0007c\u001Bd')).toBe('abcd')
    expect(normalizeCharacters('tab\tsigue')).toBe('tab\tsigue')
  })

  it('alfanuméricos matemáticos', () => {
    expect(normalizeCharacters('𝑥² + 𝑦 = 𝟐𝐱')).toBe('x² + y = 2x')
    expect(foldMath('𝐀𝐚𝑨𝒂𝟘𝟡ℎ')).toBe('AaAa09h')
  })

  it('fuente Symbol en el área privada', () => {
    expect(normalizeCharacters('     x  ')).toBe('α π ≤ ∞ • √x ∑ ±')
    expect(normalizeCharacters('ab')).toBe('ab')
  })

  it('las fórmulas quedan intactas', () => {
    const formulas = 'sen²θ + cos²θ = 1\ntan θ = sen θ / cos θ\n√(x² + y²) ≤ |x| + |y|\nΔx → 0, ∫₀¹ x dx'
    expect(normalizeCharacters(formulas)).toBe(formulas)
  })

  it('viñetas', () => {
    expect(normalizeBullet('• Primero')).toBe('- Primero')
    expect(normalizeBullet('   ●   Segundo')).toBe('   - Segundo')
    expect(normalizeBullet('▪Tercero')).toBe('- Tercero')
    expect(normalizeBullet('* cuarto')).toBe('- cuarto')
    expect(normalizeBullet('– quinto elemento')).toBe('- quinto elemento')
    expect(normalizeBullet('– 3 + 4')).toBe('– 3 + 4')
    expect(normalizeBullet('-3x + 2')).toBe('-3x + 2')
    expect(normalizeBullet('Texto • con punto')).toBe('Texto • con punto')
    expect(normalizeBullet('•')).toBe('•')
    for (const s of ['- uno', '• dos', '1. tres', '2) cuatro', '(3) cinco', 'a) seis', 'iv. siete', '  - con sangría']) expect(startsWithBullet(s), s).toBe(true)
    for (const s of ['Texto normal', '3.14 es pi', '-3x', '1.5 metros', 'a continuación', 'Fin.']) expect(startsWithBullet(s), s).toBe(false)
  })

  it('números de página', () => {
    for (const s of ['12', ' 7 ', '- 12 -', '– 3 –', 'Página 12', 'página 3 de 80', 'Page 4 of 9', 'p. 5', 'pág. 10', '12 de 80', '3 / 10', 'iv', 'XII', 'xiv']) expect(isPageNumber(s), s).toBe(true)
    for (const s of ['', 'Capítulo 3', '3 + 4 = 7', '12345', 'El 12', 'Tema 3: Funciones', 'ábaco', 'mix', '100%', '2026-10-07', 'mimí']) expect(isPageNumber(s), s).toBe(false)
  })

  it('guiones de partición', () => {
    expect(joinLines('la matemá-', 'tica es bella')).toBe('la matemática es bella')
    expect(joinLines('ecuación de Navier-', 'Stokes')).toBe('ecuación de Navier-Stokes')
    expect(joinLines('sección 3-', '4 del libro')).toBe('sección 3- 4 del libro')
    expect(joinLines('una línea normal', 'continúa aquí')).toBe('una línea normal continúa aquí')
    expect(joinLines('resultado -', '3')).toBe('resultado - 3')
    expect(joinLines('soft­', 'hyphen')).toBe('softhyphen')
    expect(joinLines('', 'solo')).toBe('solo')
    expect(joinLines('solo', '')).toBe('solo')
  })

  it('reflujo sin geometría', () => {
    const text = 'La trigonometría estudia las relaciones entre los lados y los\nángulos de los triángulos. El teorema de Pitágoras establece que\nen todo triángulo rectángulo el cuadrado de la hipotenusa es igual\na la suma de los cuadrados de los catetos.\n\nSegundo párrafo corto.'
    expect(reflow(text)).toBe('La trigonometría estudia las relaciones entre los lados y los ángulos de los triángulos. El teorema de Pitágoras establece que en todo triángulo rectángulo el cuadrado de la hipotenusa es igual a la suma de los cuadrados de los catetos.\n\nSegundo párrafo corto.')
    const hyphen = 'Esta frase tiene una palabra partida al final de la línea: la matemá-\ntica nos ayuda a entender el mundo que nos rodea cada día de nuestra vida.\nY esta otra línea sigue más abajo con bastante texto para ser prosa larga.'
    expect(reflow(hyphen)).toContain('la matemática nos ayuda')
    const formulas = 'sen²θ + cos²θ = 1\ntan θ = sen θ / cos θ\n1 + tan²θ = sec²θ\ncot θ = cos θ / sen θ'
    expect(reflow(formulas)).toBe(formulas)
    const list = 'Temas del examen:\n• Funciones trigonométricas\n• Identidades y ecuaciones\n• Triángulos oblicuos\n\nFÓRMULAS'
    expect(reflow(list)).toBe('Temas del examen:\n- Funciones trigonométricas\n- Identidades y ecuaciones\n- Triángulos oblicuos\n\nFÓRMULAS')
  })

  it('prosa', () => {
    expect(isProse('El cuadrado de la hipotenusa es igual a la suma')).toBe(true)
    expect(isProse('sen²θ + cos²θ = 1')).toBe(false)
    expect(isProse('x = 3, y = 4, z = 5')).toBe(false)
    expect(isProse('Corto')).toBe(false)
    expect(isProse('12 34 56 78 90 12 34 56 78')).toBe(false)
  })

  it('cierre, basura y espacios', () => {
    expect(finalizeText('  uno   dos \n\n\n\n tres\t\tcuatro  \n')).toBe('uno dos\n\ntres cuatro')
    expect(finalizeText('')).toBe('')
    expect(finalizeText('\n\n  \n')).toBe('')
    expect(looksLikeGarbage('�'.repeat(40) + ' texto')).toBe(true)
    expect(looksLikeGarbage('��a��b��c��d��')).toBe(true)
    expect(looksLikeGarbage('\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u000E\u000F\u0010\u0011\u0012\u0013')).toBe(true)
    expect(looksLikeGarbage('El seno de 30° vale 1/2 y sen²θ + cos²θ = 1 siempre.')).toBe(false)
    expect(looksLikeGarbage('corto')).toBe(false)
    expect(looksLikeGarbage('∑ᵢ xᵢ ≤ ∫ f(x) dx → ∞ ∀ε>0 ∃δ>0')).toBe(false)
    expect(collapseSpaces('  a \t b   c  ')).toBe('a b c')
    expect(collapseSpaces('')).toBe('')
  })
})

describe('HeadingDetector', () => {
  const h = parseHeading
  it('Markdown', () => {
    expect(h('# Título')).toEqual({ level: 1, title: 'Título' })
    expect(h('### Sub sección ###')).toEqual({ level: 3, title: 'Sub sección' })
    expect(h('###### Seis')).toEqual({ level: 6, title: 'Seis' })
    expect(h('####### siete')).toBeNull()
    expect(h('#sinespacio')).toBeNull()
    expect(h('#')).toBeNull()
  })

  it('numerados', () => {
    expect(h('3.2 Círculo unidad')).toEqual({ level: 2, title: '3.2 Círculo unidad' })
    expect(h('3.2.1. Ángulos de referencia')?.level).toBe(3)
    expect(h('10.4 ¿Qué es un límite?')?.level).toBe(2)
    for (const s of ['3.14 es una aproximación de pi', '2.5 millones de personas', '1.5 = 3/2', '3.2 Una frase completa que termina con punto.', '1. Calcula el valor de x', '3.2 Círculo unidad ........ 14']) expect(h(s), s).toBeNull()
  })

  it('con palabra clave', () => {
    expect(h('Capítulo 3: Trigonometría')?.level).toBe(1)
    expect(h('CAPITULO IV')?.level).toBe(1)
    expect(h('Chapter 7 – Conic sections')?.level).toBe(1)
    expect(h('Sección 2.1')?.level).toBe(2)
    expect(h('Section 5')?.level).toBe(2)
    expect(h('Tema 5. Funciones')?.level).toBe(1)
    expect(h('Unidad 2')?.level).toBe(1)
    expect(h('Parte A')?.level).toBe(1)
    expect(h('Apéndice B')?.level).toBe(1)
    expect(h('Capítulo anterior fue largo')).toBeNull()
    expect(h('Sección de ejercicios del libro')).toBeNull()
  })

  it('en mayúsculas', () => {
    expect(h('FÓRMULAS DE TRIGONOMETRÍA')?.level).toBe(1)
    expect(h('MATH140 FORMULA SHEET')?.level).toBe(1)
    expect(h('RESUMEN:')?.level).toBe(1)
    for (const s of ['ABC', 'NOTA: esto sigue en minúsculas', 'SIN X = 1/2.', 'X = 3 Y = 4 Z = 5 W = 6 V = 7 U = 8 T = 9', 'A B C D E F G H I J K L M N O P']) expect(h(s), s).toBeNull()
  })

  it('lo que no es un título', () => {
    for (const s of ['- elemento de lista', '> cita', 'a | b | c', '', '   ', 'A'.repeat(200), 'Un párrafo normal de texto.']) expect(h(s), s).toBeNull()
  })

  it('primer título', () => {
    expect(firstHeading('texto\n\n## Dos\n\n# Uno')).toBe('Dos')
    expect(firstHeading('intro\nFÓRMULAS BÁSICAS\nabc')).toBe('FÓRMULAS BÁSICAS')
    expect(firstHeading('solo texto normal\notra línea')).toBeNull()
    expect(firstHeading('')).toBeNull()
  })
})
