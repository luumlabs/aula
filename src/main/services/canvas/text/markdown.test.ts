import { describe, expect, it } from 'vitest'
import { decodeEntities } from './entities'
import { htmlToMarkdown, htmlToPlainText, latexFromEquationSrc, looksLikeHTML } from './markdown'
import { mathMLToLatex } from './mathml'
import { parseHTML, rawText } from './parser'

const O = 'https://uni.instructure.com'

describe('analizador HTML tolerante', () => {
  it('etiquetas sin cerrar, atributos sin comillas, comentarios y guiones', () => {
    const root = parseHTML('<ul><li>uno<li>dos</ul><!-- nota --><script>if (a < b) {}</script><p class=x data-y=1>hola &amp; adiós<p>otro')
    const ul = root.children[0]
    expect(ul.children.map((c) => c.tag)).toEqual(['li', 'li'])
    expect(rawText(ul)).toBe('unodos')
    const ps = root.children.filter((c) => c.tag === 'p')
    expect(ps).toHaveLength(2)
    expect(ps[0].attrs).toEqual({ class: 'x', 'data-y': '1' })
    expect(rawText(ps[0])).toBe('hola & adiós')
  })

  it('«<» suelto es texto y nunca se cuelga con basura', () => {
    expect(rawText(parseHTML('x < 5 y 3 <b>negrita'))).toBe('x < 5 y 3 negrita')
    expect(() => parseHTML('<<<>>><div<<<a href="')).not.toThrow()
    expect(() => parseHTML('<div>'.repeat(5000))).not.toThrow()
  })

  it('entidades', () => {
    expect(decodeEntities('&eacute;&#233;&#xE9; &nbsp;&lt;b&gt; &desconocida; &#0;')).toBe('ééé  <b> &desconocida; �')
  })
})

describe('HTML → Markdown', () => {
  it('títulos, párrafos, listas, enlaces absolutos y negritas', () => {
    const md = htmlToMarkdown('<h2>Tema 1</h2><p>Lee el <strong>capítulo 3</strong> y <a href="/courses/1/files/2">los apuntes</a>.</p><ol><li>Uno</li><li>Dos<ul><li>Dos-a</li></ul></li></ol>', O)
    expect(md).toBe('## Tema 1\n\nLee el **capítulo 3** y [los apuntes](https://uni.instructure.com/courses/1/files/2).\n\n1. Uno\n2. Dos\n   - Dos-a')
  })

  it('tablas con cabecera', () => {
    const md = htmlToMarkdown('<table><tr><th>Fecha</th><th>Tema</th></tr><tr><td>3/11</td><td>Derivadas | reglas</td></tr></table>')
    expect(md).toBe('| Fecha | Tema |\n| --- | --- |\n| 3/11 | Derivadas \\| reglas |')
  })

  it('código, citas y líneas', () => {
    expect(htmlToMarkdown('<pre><code class="language-python">print(1)\n</code></pre>')).toBe('```python\nprint(1)\n```')
    expect(htmlToMarkdown('<blockquote><p>Cita</p></blockquote><hr><p>x<sup>2</sup> y H<sub>2</sub>O, 1<sup>st</sup></p>')).toBe('> Cita\n\n---\n\nx^2 y H_2O, 1st')
  })

  it('ecuaciones de Canvas (imagen con LaTeX) y MathML', () => {
    expect(htmlToMarkdown('<p><img class="equation_image" alt="LaTeX: \\frac{a}{b}" src="/equation_images/x"></p>')).toBe('$\\frac{a}{b}$')
    expect(htmlToMarkdown('<img class="equation_image" src="/equation_images/%255Csqrt%257Bx%257D?scale=1">')).toBe('$\\sqrt{x}$')
    expect(htmlToMarkdown('<p>Área: <math><mi>π</mi><msup><mi>r</mi><mn>2</mn></msup></math></p>')).toBe('Área: $\\pi r^{2}$')
    expect(latexFromEquationSrc('https://x/equation_images/%255Csin%2528x%2529')).toBe('\\sin(x)')
    expect(latexFromEquationSrc('https://x/images/a.png')).toBeNull()
  })

  it('oculta lo invisible y los adornos', () => {
    const md = htmlToMarkdown('<p>Visible<span class="screenreader-only"> (lector)</span></p><div style="display: none">oculto</div><p hidden>no</p><img src="data:image/png;base64,xx" alt="icono"><button>Enviar</button>')
    expect(md).toBe('Visible\n\nicono')
  })

  it('texto plano y detección de HTML', () => {
    expect(htmlToPlainText('<h1>Hola</h1><p>Ver <a href="https://x.edu/a">esto</a></p>')).toBe('Hola\n\nVer esto (https://x.edu/a)')
    expect(looksLikeHTML('a < b y c > d')).toBe(false)
    expect(looksLikeHTML('<p>x</p>')).toBe(true)
    expect(htmlToMarkdown('solo texto &amp; más')).toBe('solo texto & más')
  })

  it('enlaces peligrosos se quedan en texto', () => {
    expect(htmlToMarkdown('<a href="javascript:alert(1)">pulsa</a>')).toBe('pulsa')
  })
})

describe('MathML → LaTeX', () => {
  it('fracciones, raíces, índices, paréntesis, funciones y matrices', () => {
    const m = (s: string) => mathMLToLatex(parseHTML(`<math>${s}</math>`).children[0])
    expect(m('<mfrac><mn>1</mn><mi>x</mi></mfrac>')).toBe('\\frac{1}{x}')
    expect(m('<mroot><mi>x</mi><mn>3</mn></mroot>')).toBe('\\sqrt[3]{x}')
    expect(m('<msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup>')).toBe('x_{i}^{2}')
    expect(m('<mi>sin</mi><mi>x</mi>')).toBe('\\sin x')
    expect(m('<mfenced><mi>a</mi><mi>b</mi></mfenced>')).toBe('\\left( a, b \\right)')
    expect(m('<mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>0</mn></mtd></mtr><mtr><mtd><mn>0</mn></mtd><mtd><mn>1</mn></mtd></mtr></mtable>')).toBe('\\begin{matrix} 1 & 0 \\\\ 0 & 1 \\end{matrix}')
    expect(m('<mover><mi>v</mi><mo>→</mo></mover>')).toBe('\\vec{v}')
  })

  it('usa la anotación TeX si la hay', () => {
    const root = parseHTML('<math><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2</annotation></semantics></math>')
    expect(mathMLToLatex(root.children[0])).toBe('x^2')
  })
})
