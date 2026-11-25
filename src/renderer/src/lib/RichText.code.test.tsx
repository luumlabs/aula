// El código dentro de un texto con Markdown: un ``` sale en la misma tarjeta que el bloque `code` (lenguaje, colores, números
// desde 3 líneas, sin botones dentro de un control), el `código en línea` sigue siendo una pastilla, las fórmulas (KaTeX y
// \ce) siguen igual y lo que llega en vivo colorea las líneas terminadas.
import { beforeAll, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import i18n from 'i18next'
import '@renderer/i18n'
import { RichText } from './RichText'
import { loadHighlighter } from './code/useHighlight'
import { CodeBlockView } from '@renderer/blocks/CodeBlock'
import { makeBlockContext } from '@renderer/blocks/types'
import { stripRevealedCodeOutput } from '@shared/documents/paper'
import { decodeBlock, type BlockOf } from '@shared/schema/blocks'
import type { Answer } from '@shared/schema/exercises'

const html = (text: string, props: { inline?: boolean; live?: boolean } = {}): string => renderToStaticMarkup(<RichText text={text} {...props} />)
const cards = (h: string): number => (h.match(/class="aula-code[ "]/g) ?? []).length
const label = (h: string): string | undefined => /class="aula-code-label">([^<]*)</.exec(h)?.[1]

beforeAll(async () => {
  await i18n.changeLanguage('en')
  // con highlight.js ya cargado, la tarjeta colorea en el mismo dibujo (en la app se carga aparte la primera vez)
  await loadHighlighter()
})

describe('código en un texto con Markdown', () => {
  it('un ``` con lenguaje: tarjeta con su nombre, colores, «Copiar» y números desde 3 líneas', () => {
    const h = html('Mira:\n\n```ts\nconst x: number = 1\nlet y = x + 1\nexport { y }\n```')
    expect(cards(h)).toBe(1)
    expect(label(h)).toBe('TypeScript')
    expect(h).toContain('<span class="hljs-keyword">const</span>')
    expect(h).toContain('aria-label="Copy code"')
    expect(h).toContain('data-lines="1\n2\n3"')
    expect(h).toContain('dir="ltr"')
    expect(h).not.toContain('```')
    // dos líneas: sin números
    expect(html('```py\na = 1\nb = 2\n```')).not.toContain('data-lines')
  })

  it('sin lenguaje: «Code» en la cabecera y colores solo si se adivina con seguridad', () => {
    const py = html('```\nimport math\n\ndef area(r):\n    return math.pi * r ** 2\n```')
    expect(label(py)).toBe('Code')
    expect(py).toContain('data-code-language="python"')
    expect(py).toContain('hljs-keyword')
    const prose = html('```\nSi x es mayor que cero, entonces escribe x.\n```')
    expect(label(prose)).toBe('Code')
    expect(prose).not.toContain('hljs-')
  })

  it('un lenguaje que Aula no conoce: su nombre, sin colores inventados; texto, pseudocódigo y salida con su nombre', () => {
    const cobol = html('```cobol\nDISPLAY "HOLA".\n```')
    expect(label(cobol)).toBe('cobol')
    expect(cobol).not.toContain('hljs-')
    expect(label(html('```output\n[0, 1, 4]\n```'))).toBe('Output')
    expect(label(html('```pseudocode\nsi x > 0 entonces\n```'))).toBe('Pseudocode')
    expect(label(html('```txt\nhola\n```'))).toBe('Text')
  })

  it('el código en línea sigue siendo una pastilla del texto (sin tarjeta)', () => {
    const h = html('Usa `const` aquí y `$HOME` allí')
    expect(cards(h)).toBe(0)
    expect(h).toContain('<code>const</code>')
    expect(h).toContain('<code>$HOME</code>')
    expect(h).not.toContain('katex')
  })

  it('las fórmulas siguen igual: $…$, \\ce{} y ```math; los «$» del código no son fórmulas', () => {
    const h = html('Área $\\pi r^2$ y agua $\\ce{H2O}$.\n\n```math\nx^2 + 1\n```\n\n```bash\necho "$HOME" $PATH\n```')
    expect(h).toContain('class="katex"')
    expect(h).toContain('katex-display')
    expect(cards(h)).toBe(1)
    const card = h.slice(h.indexOf('class="aula-code'))
    expect(card).toContain('$HOME')
    expect(card).not.toContain('katex')
  })

  it('escapa el HTML que trae el código', () => {
    const h = html('```html\n<script>alert(1)</script>\n<b onclick="x()">hola</b>\n```')
    expect(h).not.toContain('<script>')
    expect(h).not.toContain('<b onclick')
    expect(h).toContain('&lt;')
    expect(label(h)).toBe('HTML')
  })

  it('en una línea (una opción, un control): la tarjeta sin cabecera ni botones; un trozo suelto de un bloque no monta tarjeta', () => {
    const option = html('```python\nprint(len("hola"))\n```', { inline: true })
    expect(cards(option)).toBe(1)
    expect(option).toContain('aula-code-embedded')
    expect(option).not.toContain('aula-code-head')
    expect(option).not.toContain('<button')
    expect(option).not.toContain('role="group"')
    // el primer trozo de un ``` partido por un hueco de completar
    const piece = html('```python\nx = ', { inline: true })
    expect(cards(piece)).toBe(0)
    expect(piece).toContain('class="aula-code-loose"')
  })

  it('no altera símbolos ni emojis dentro del código (ni en vallas ni en línea)', () => {
    const h = html('Ok ✔\n\n```python\nprint("✅ listo 🚀")\nok = "✔"\n```\n\nY `ok == "✔"`')
    expect(h).toContain('✅ listo 🚀')
    expect(h).toContain('&quot;✔&quot;')
    expect(h).not.toContain('✔\uFE0E&quot;')
  })

  it('en vivo: el bloque sin cerrar colorea sus líneas terminadas, deja la última tal cual y no salta con números', () => {
    const h = html('Mira:\n\n```python\ndef f(x):\n    return x\nprint(f(', { live: true })
    expect(cards(h)).toBe(1)
    expect(h).toContain('aula-code-live')
    expect(h).not.toContain('data-lines')
    expect(h).toContain('<span class="hljs-keyword">def</span>')
    expect(h).toMatch(/<\/span>print\(f\(<\/code>/)
    // ya cerrado, aunque el mensaje siga llegando, se colorea entero
    const closed = html('```python\nprint(1)\n```\n\nY ahora', { live: true })
    expect(closed).not.toContain('aula-code-live')
    expect(closed).toContain('hljs-built_in')
  })
})

describe('el bloque `code` con la misma tarjeta', () => {
  const block = (o: object): BlockOf<'code'> => decodeBlock({ type: 'code', ...o }) as BlockOf<'code'>
  const ctx = makeBlockContext('p', 'en')
  const code = block({ language: 'python', code: 'print(2 + 2)', output: '4', caption: 'Suma' })

  it('lenguaje, colores, salida y pie', () => {
    const h = renderToStaticMarkup(<CodeBlockView block={code} ctx={ctx} />)
    expect(label(h)).toBe('Python')
    expect(h).toContain('hljs-built_in')
    expect(h).toContain('aula-code-output')
    expect(h).toContain('Suma')
  })

  it('en el enunciado sin resolver, oculta la salida solo cuando coincide con la respuesta (y conserva errores/trazas)', () => {
    const ansPrint: Answer = { kind: 'short', accepted: ['4'], keywords: [], typoTolerance: true, aiGrade: false }
    const hidden = stripRevealedCodeOutput([code], ansPrint)[0] as BlockOf<'code'>
    expect(hidden.output).toBeUndefined()
    const hHidden = renderToStaticMarkup(<CodeBlockView block={hidden} ctx={{ ...ctx, inPrompt: true }} />)
    expect(hHidden).not.toContain('aula-code-output')

    const traceback = block({ language: 'python', code: "x = '3' + 4", output: 'TypeError: can only concatenate str (not "int") to str' })
    const ansWhy: Answer = { kind: 'short', accepted: ['cannot concatenate str and int'], keywords: [], typoTolerance: true, aiGrade: false }
    const kept = stripRevealedCodeOutput([traceback], ansWhy)[0] as BlockOf<'code'>
    expect(kept.output).toContain('TypeError')
    const hKept = renderToStaticMarkup(<CodeBlockView block={kept} ctx={{ ...ctx, inPrompt: true }} />)
    expect(hKept).toContain('aula-code-output')
    expect(hKept).toContain('TypeError')
  })

  it('en papel, sin «Copiar»', () => {
    expect(renderToStaticMarkup(<CodeBlockView block={code} ctx={{ ...ctx, mode: 'print' }} />)).not.toContain('<button')
  })
})
