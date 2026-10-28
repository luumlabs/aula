// Pruebas del Markdown ligero (port de RichTextTests, RichTextHostileTests y MathAffixTests de
// la app Swift anterior: Tests/StudyModelTests).
import { describe, expect, it } from 'vitest'
import { RichText, type Inline, type RichBlock } from './richText'

const T = (text: string): Inline => ({ kind: 'text', text })
const B = (...children: Inline[]): Inline => ({ kind: 'bold', children })
const I = (...children: Inline[]): Inline => ({ kind: 'italic', children })
const M = (tex: string): Inline => ({ kind: 'math', tex })
const P = (...inlines: Inline[]): RichBlock => ({ kind: 'paragraph', inlines })
const inline = (s: string): Inline[] => RichText.parseInline(s)

describe('RichText en línea', () => {
  it('texto y énfasis', () => {
    expect(inline('hola')).toEqual([T('hola')])
    expect(inline('a **negrita** y *cursiva*')).toEqual([T('a '), B(T('negrita')), T(' y '), I(T('cursiva'))])
    expect(inline('***ambas***')).toEqual([B(I(T('ambas')))])
    expect(inline('~~fuera~~ ==clave==')).toEqual([{ kind: 'strike', children: [T('fuera')] }, T(' '), { kind: 'highlight', children: [T('clave')] }])
    expect(inline('snake_case_name y 2*3*4')).toEqual([T('snake_case_name y 2'), I(T('3')), T('4')])
  })

  it('código y escapes', () => {
    expect(inline('usa `x*y` aquí')).toEqual([T('usa '), { kind: 'code', text: 'x*y' }, T(' aquí')])
    expect(inline(String.raw`precio \$5 y \*no cursiva\*`)).toEqual([T('precio $5 y *no cursiva*')])
  })

  it('matemáticas en línea', () => {
    expect(inline('Sea $x^2+1$ positivo')).toEqual([T('Sea '), M('x^2+1'), T(' positivo')])
    expect(inline(String.raw`Con \(\frac{a}{b}\) hecho`)).toEqual([T('Con '), M(String.raw`\frac{a}{b}`), T(' hecho')])
    expect(inline('**$a*b$ importa**')).toEqual([B(M('a*b'), T(' importa'))])
  })

  it('los importes en dólares no son matemáticas', () => {
    expect(inline('cuesta $5 y luego $6 más')).toEqual([T('cuesta $5 y luego $6 más')])
    expect(inline('un $ suelto')).toEqual([T('un $ suelto')])
    expect(inline('$ x $ no')).toEqual([T('$ x $ no')])
  })

  it('enlaces', () => {
    expect(inline('ver [la guía](https://a.b/c) ahora')).toEqual([T('ver '), { kind: 'link', children: [T('la guía')], url: 'https://a.b/c' }, T(' ahora')])
    expect(inline('[p. 12](aula://source/abc?page=12)')).toEqual([{ kind: 'link', children: [T('p. 12')], url: 'aula://source/abc?page=12' }])
    expect(inline('[no cierra')).toEqual([T('[no cierra')])
  })

  it('saltos de línea', () => {
    expect(RichText.parse('uno\ndos')).toEqual([P(T('uno dos'))])
    expect(RichText.parse('uno  \ndos')).toEqual([P(T('uno'), { kind: 'lineBreak' }, T('dos'))])
  })
})

describe('RichText en bloques', () => {
  it('títulos, listas, citas, código, fórmulas y regla', () => {
    const md = [
      '# Título', '', 'Un párrafo con $x$.', '', '- uno', '- dos', '  - anidado', '- tres', '', '1. paso', '2. otro paso', '',
      '> cita **fuerte**', '', '```python', 'print(1)', '```', '', '$$', String.raw`\frac{a}{b}`, '$$', '', '---'
    ].join('\n')
    const b = RichText.parse(md)
    expect(b).toHaveLength(8)
    const h = b[0]
    if (h.kind !== 'heading') throw new Error('título')
    expect(h.level).toBe(1)
    expect(RichText.inlineText(h.inlines)).toBe('Título')
    const list = b[2]
    if (list.kind !== 'list') throw new Error('lista')
    expect(list.ordered).toBe(false)
    expect(list.items).toHaveLength(3)
    const nested = list.items[1][1]
    if (nested.kind !== 'list') throw new Error('lista anidada')
    expect(nested.items).toHaveLength(1)
    const ol = b[3]
    if (ol.kind !== 'list') throw new Error('numerada')
    expect([ol.ordered, ol.start, ol.items.length]).toEqual([true, 1, 2])
    const q = b[4]
    if (q.kind !== 'quote') throw new Error('cita')
    expect(RichText.plainText(q.blocks)).toBe('cita fuerte')
    expect(b[5]).toEqual({ kind: 'code', language: 'python', text: 'print(1)' })
    expect(b[6]).toEqual({ kind: 'displayMath', tex: String.raw`\frac{a}{b}` })
    expect(b[7]).toEqual({ kind: 'rule' })
  })

  it('una lista interrumpe el párrafo', () => {
    const b = RichText.parse('Pasos:\n1. primero\n2. segundo')
    expect(b).toHaveLength(2)
    expect(b[1]).toMatchObject({ kind: 'list', ordered: true, start: 1 })
  })

  it('tablas', () => {
    const b = RichText.parse('| Ángulo | sin |\n|:--|--:|\n| $30^\\circ$ | $\\frac12$ |\n| $45^\\circ$ | $\\frac{\\sqrt2}{2}$ |')
    const t = b[0]
    if (t.kind !== 'table') throw new Error('tabla')
    expect(t.header).toHaveLength(2)
    expect(t.align).toEqual(['left', 'right'])
    expect(t.rows).toHaveLength(2)
    expect(RichText.hasMath(t.rows[0][0])).toBe(true)
  })

  it('fórmulas en pantalla de una línea', () => {
    expect(RichText.parse('$$x^2 + y^2 = r^2$$')).toEqual([{ kind: 'displayMath', tex: 'x^2 + y^2 = r^2' }])
    expect(RichText.parse(String.raw`\[ a=b \]`)).toEqual([{ kind: 'displayMath', tex: 'a=b' }])
  })

  it('aguanta la basura', () => {
    for (const s of ['', '*', '**', '***', '`', '$', '$$', '[', '](', '\\', '|', '- ', '1.', '>', '```', '| a |\n|-|', '*'.repeat(500), '[a]('.repeat(100)]) {
      expect(() => { RichText.parse(s); RichText.parseInline(s) }).not.toThrow()
    }
    const big = Array.from({ length: 2000 }, (_, i) => `línea ${i} con **negrita** y $x_${i}$`).join('\n')
    expect(RichText.parse(big).length).toBeGreaterThan(0)
  })

  it('reconoce las líneas como las expresiones regulares de antes', () => {
    expect(RichText.parse('# Título #')).toEqual([{ kind: 'heading', level: 1, inlines: [T('Título')] }])
    expect(RichText.parse('### C#')).toEqual([{ kind: 'heading', level: 3, inlines: [T('C')] }])
    expect(RichText.parse('####### siete')).toEqual([P(T('####### siete'))])
    expect(RichText.parse('#sin espacio')).toEqual([P(T('#sin espacio'))])
    expect(RichText.parse('- - -')).toEqual([{ kind: 'rule' }])
    expect(RichText.parse('   ***  ')).toEqual([{ kind: 'rule' }])
    expect(RichText.parse('    ---')).toEqual([P(T('---'))])
    expect(RichText.parse('| a | b |\n|:--|--:|\n| 1 | 2 |')[0]).toMatchObject({ kind: 'table', align: ['left', 'right'] })
    expect(RichText.parse('1234567890. diez cifras')).toEqual([P(T('1234567890. diez cifras'))])
    expect(RichText.parse('3) tres\n4) cuatro')[0]).toMatchObject({ kind: 'list', ordered: true, start: 3 })
  })
})

describe('RichText hostil', () => {
  const cases: Array<[string, string]> = [
    ['título con espacios', '# a' + ' '.repeat(4000) + 'b'],
    ['título con espacios y almohadillas', '## ' + ' #'.repeat(3000) + ' x'],
    ['separador de tabla con espacios', 'a|b\n' + ' '.repeat(50_000) + 'x'],
    ['separador de tabla con guion y espacios', 'a|b\n-' + ' '.repeat(50_000) + 'x'],
    ['citas anidadas', '>'.repeat(20_000) + ' x'],
    ['listas anidadas', '- '.repeat(10_000) + 'x'],
    ['listas numeradas anidadas', '1. '.repeat(8_000) + 'x'],
    ['dólar seguido de cifra', '$1'.repeat(25_000)],
    ['énfasis sin cierre', '*a '.repeat(16_000)],
    ['corchetes sin cerrar', '['.repeat(50_000)],
    ['enlaces anidados', '['.repeat(5_000) + 'a' + '](u)'.repeat(5_000)],
    ['énfasis anidado', '*_'.repeat(10_000) + 'a' + '_*'.repeat(10_000)],
    ['tachado y resaltado', '~~='.repeat(15_000)],
    ['matemáticas \\( sin cierre', '\\('.repeat(25_000)],
    ['comillas invertidas crecientes', Array.from({ length: 300 }, (_, i) => '`'.repeat(i + 1) + 'a').join('')],
    ['regla con espacios', '-' + ' '.repeat(50_000) + '-x'],
    ['lista con espacios', '- ' + ' '.repeat(50_000) + ' x']
  ]

  it('el Markdown patológico es rápido y no desborda la pila', () => {
    for (const [name, text] of cases) {
      const t0 = performance.now()
      RichText.parse(text)
      RichText.parseInline(text)
      const dt = (performance.now() - t0) / 1000
      expect(dt, `«${name}» tardó ${dt} s`).toBeLessThan(2)
    }
  })

  it('el anidamiento se acota pero el contenido se conserva', () => {
    const quoteDepth = (b: RichBlock[]): number => Math.max(0, ...b.map((x) => (x.kind === 'quote' ? 1 + quoteDepth(x.blocks) : 0)))
    const q = RichText.parse('>'.repeat(20_000) + ' fin')
    expect(quoteDepth(q)).toBe(RichText.maxBlockDepth)
    expect(RichText.plainText(q)).toContain('fin')
    const deep = '**a '.repeat(40) + 'x' + ' a**'.repeat(40)
    expect(RichText.inlineText(RichText.parseInline(deep))).toContain('x')
  })
})

describe('RichText.tightMathAffix', () => {
  it('pega los espacios de dentro de la fórmula del prefijo', () => {
    expect(RichText.tightMathAffix('$\\theta = $')).toBe('$\\theta =$')
    expect(RichText.tightMathAffix('$ x =$')).toBe('$x =$')
    expect(RichText.tightMathAffix('Área: $ A = $')).toBe('Área: $A =$')
    // ya bien, sin fórmula o con más de una: igual
    expect(RichText.tightMathAffix('$x =$')).toBe('$x =$')
    expect(RichText.tightMathAffix('x =')).toBe('x =')
    expect(RichText.tightMathAffix('$5 y $6 y $7')).toBe('$5 y $6 y $7')
    // y el resultado sí se dibuja como fórmula
    expect(RichText.parseInline(RichText.tightMathAffix('$\\theta = $')).some((x) => x.kind === 'math')).toBe(true)
  })
})
