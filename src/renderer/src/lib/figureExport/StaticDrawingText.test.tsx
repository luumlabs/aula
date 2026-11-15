import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticDrawingText, preflightDrawingTexts } from './StaticDrawingText'
const render = (text: string) => renderToStaticMarkup(<StaticDrawingText text={text} language="ar" direction="rtl" />)

describe('texto estático del dibujo', () => {
  it('conserva fracciones, raíces, subíndices y RTL', () => {
    const html = render('مرحبا $\\frac{a_1}{\\sqrt{b}}$')
    expect(html).toContain('dir="rtl"')
    expect(html).toContain('katex-html')
    expect(html).toContain('mfrac')
    expect(html).toContain('sqrt')
    expect(html).toContain('مرحبا')
  })
  it('acepta entornos de fórmula display y limita dimensiones negativas extremas', () => {
    expect(() => render('$$\n\\begin{align}a&=b\\\\c&=d\\end{align}\n$$')).not.toThrow()
    expect(() => render('$a\\kern{-100000em}b$')).toThrow()
    expect(() => render('$\\raisebox{-100000em}{a}$')).toThrow()
  })
  it('los enlaces son texto con su estilo, sin destino efectivo; las URLs literales siguen visibles', () => {
    const html = render('[**referencia**](https://example.org/private) https://example.org/plain')
    expect(html).toContain('<strong>referencia</strong>')
    expect(html).not.toMatch(/<a\b|href=|src=/)
    expect(html).not.toContain('/private')
    expect(html).toContain('https://example.org/plain')
    expect(html).toContain('text-decoration:underline')
  })
  it('las citas y enlaces inválidos conservan su tinta sin subrayado', () => {
    for (const link of ['[p. 3](#aula-page-3)', '[local](file:///tmp/a)', '[relativo](other)']) {
      const html = render(link)
      expect(html).not.toMatch(/href=|src=|text-decoration/)
      expect(html).toContain('color:var(--accent-text)')
    }
    expect(render('[correo](mailto:student@example.org)')).toContain('text-decoration:underline')
  })
  it.each(['![alt](https://example.org/a.png)', '![alt][asset]\n\n[asset]: file:///tmp/a', '<img src="https://example.org/a">', '$\\includegraphics{https://example.org/a}$', '$\\href{https://example.org}{A}$'])('rechaza recursos sin omitirlos: %s', (text) => {
    expect(() => render(text)).toThrow()
  })
  it('rechaza expansiones infinitas y tamaños que KaTeX recortaría', () => {
    expect(() => render('$\\def\\a{\\a}\\a$')).toThrow()
    expect(() => render('$\\rule{100000em}{1em}$')).toThrow()
    expect(() => render('$\\rule{1em}{1em}$')).not.toThrow()
  })
  it('presupuesta expansiones agregadas antes de montar el DOM', () => {
    expect(() => preflightDrawingTexts(['$x$ '.repeat(1000)])).toThrow()
    expect(() => preflightDrawingTexts(Array.from({ length: 50 }, () => '$x$ '.repeat(30)))).toThrow()
    expect(() => preflightDrawingTexts(['$x$', '$\\frac{a}{b}$'], 100)).not.toThrow()
  })
  it('aplica también los límites a bloques de código que rehype interpreta como math', () => {
    expect(() => render('```math\n\\rule{100000em}{1em}\n```')).toThrow()
    expect(() => preflightDrawingTexts(['```math\n\\def\\a{\\a}\\a\n```'])).toThrow()
    expect(() => render('```math\n\\frac{1}{2}\n```')).not.toThrow()
  })
  it('conserva definiciones entre expresiones de una misma etiqueta', () => {
    expect(() => render('$\\gdef\\foo{42}$ $\\foo$')).not.toThrow()
    expect(() => preflightDrawingTexts(['$\\gdef\\foo{42}$ $\\foo$'])).not.toThrow()
  })
  it('una macro definida por una etiqueta no cambia las siguientes', () => {
    expect(() => render('$\\gdef\\private{42}\\private$')).not.toThrow()
    expect(() => render('$\\private$')).toThrow()
  })
})
