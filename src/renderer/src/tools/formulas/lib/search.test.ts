import { describe, expect, it } from 'vitest'
import katex from 'katex'
import 'katex/contrib/mhchem'
import { CONSTANTS, FORMULAS, texOf } from './data'
import { fold, groupByTopic, localizeDecimal, searchConstants, searchFormulas } from './search'

describe('hoja de fórmulas', () => {
  it('todas las fórmulas y constantes son LaTeX válido', () => {
    for (const f of FORMULAS) for (const lang of ['es', 'en'] as const) expect(() => katex.renderToString(texOf(f, lang), { throwOnError: true, displayMode: true }), `${f.id} (${lang})`).not.toThrow()
    for (const c of CONSTANTS) expect(() => katex.renderToString(`${c.symbol} = ${c.value}`, { throwOnError: true }), c.id).not.toThrow()
  })
  it('A4-P1-2: en inglés, ninguna fórmula lleva palabras ni notación en español', () => {
    // palabras de \text{…} y subíndices que delatan la hoja española (E_c, E_p, V_{cil}, op/hip, soluto, pila…)
    const SPANISH = /\\text\{[^}]*\b(casos|favorables|posibles|op|hip|cont|cil|cono|rend|real|te[oó]rico|soluto|disoluci[oó]n|disolvente|pila|c[aá]t|[aá]n|prod|reac)\b|E_c\b|E_p\b|E_\{c,|E_\{p,|T_e\b|K_e\b|F_r\b|V_\{n,k\}/
    const bad = FORMULAS.filter((f) => SPANISH.test(texOf(f, 'en'))).map((f) => f.id)
    expect(bad).toEqual([])
    // y en español siguen como estaban
    expect(texOf(FORMULAS.find((f) => f.id === 'laplace')!, 'es')).toContain('casos favorables')
    expect(texOf(FORMULAS.find((f) => f.id === 'sohcahtoa')!, 'en')).toContain('\\text{opp}')
  })
  it('las fórmulas bilingües no se quedan con el mismo texto en los dos idiomas', () => {
    for (const f of FORMULAS) if (typeof f.tex !== 'string') expect(f.tex.en, f.id).not.toBe(f.tex.es)
  })
  it('se busca en el LaTeX del idioma de la interfaz', () => {
    expect(searchFormulas('solute', 'en').map((f) => f.id)).toContain('molarity')
    expect(searchFormulas('soluto', 'es').map((f) => f.id)).toContain('molarity')
  })
  it('los identificadores no se repiten', () => {
    expect(new Set(FORMULAS.map((f) => f.id)).size).toBe(FORMULAS.length)
    expect(new Set(CONSTANTS.map((c) => c.id)).size).toBe(CONSTANTS.length)
  })
})

describe('búsqueda', () => {
  it('ignora acentos y mayúsculas', () => {
    expect(fold('Péndulo')).toBe('pendulo')
    expect(searchFormulas('pendulo', 'es')[0].id).toBe('pendulum')
  })
  it('busca en los dos idiomas y prioriza el nombre', () => {
    expect(searchFormulas('pythagorean', 'en')[0].id).toBe('pythagoras')
    expect(searchFormulas('ideal', 'en')[0].id).toBe('idealgas')
  })
  it('exige todas las palabras y filtra por materia', () => {
    expect(searchFormulas('ley ohm', 'es').map((f) => f.id)).toContain('ohm')
    expect(searchFormulas('ohm', 'es', 'chemistry')).toHaveLength(0)
    expect(searchFormulas('', 'es', 'physics').every((f) => f.subject === 'physics')).toBe(true)
  })
  it('busca constantes por nombre o símbolo', () => {
    expect(searchConstants('avogadro', 'es')[0].id).toBe('NA')
    expect(searchConstants('planck', 'en')[0].id).toBe('h')
  })
  it('agrupa por tema y cambia el decimal', () => {
    const g = groupByTopic(searchFormulas('', 'es', 'math'), 'es')
    expect(g[0].topic).toBe('Álgebra')
    expect(localizeDecimal('1{,}0\\times10^{-14}', 'en')).toBe('1.0\\times10^{-14}')
  })
})
