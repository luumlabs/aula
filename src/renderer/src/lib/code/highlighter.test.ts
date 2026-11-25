// El resaltado (el trozo de highlight.js que se carga aparte): las gramáticas registradas son las de CODE_LANGUAGES, el HTML
// sale escapado, lo adivinado solo colorea si es fiable y lo que llega en vivo no adivina.
import { describe, expect, it } from 'vitest'
import { CODE_LANGUAGES } from '@engine/content/codeLanguages'
import { highlight, registeredLanguages } from './highlighter'

describe('resaltado de código', () => {
  it('registra exactamente las gramáticas que promete la guía', () => {
    expect([...registeredLanguages()].sort()).toEqual([...CODE_LANGUAGES].sort())
  })

  it('cada gramática colorea sin romperse (también con sus sublenguajes: HTML con <script>, sesiones de terminal…)', () => {
    const sample = '# comentario\nx = "a" + 1 // otro\n<script>let a = 1</script>\n$ echo $HOME\n>>> print(1)'
    for (const l of CODE_LANGUAGES) {
      const r = highlight(sample, l)
      if (l === 'plaintext') expect(r, l).toBeUndefined()
      else expect(r?.language, l).toBe(l)
    }
  })

  it('colorea con el lenguaje pedido y escapa el HTML del código', () => {
    const r = highlight('const x: number = 1 // uno', 'typescript')
    expect(r?.html).toContain('<span class="hljs-keyword">const</span>')
    expect(r?.html).toContain('hljs-comment')
    const html = highlight('<script>alert("hola")</script>', 'xml')!.html
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;')
    expect(highlight('a < b && "c"', 'python')!.html).toContain('&lt;')
  })

  it('sin lenguaje adivina solo si es fiable; el texto y el pseudocódigo se quedan sin colores', () => {
    expect(highlight('import math\n\ndef area(r):\n    return math.pi * r ** 2', undefined)?.language).toBe('python')
    expect(highlight('SELECT name FROM students WHERE grade > 5;', undefined)?.language).toBe('sql')
    for (const text of ['Si x es mayor que cero, entonces escribe x.\nSi no, escribe cero.', 'mientras i < n hacer\n  suma <- suma + i\n  i <- i + 1\nfin mientras', '[0, 1, 4, 9, 16]', 'The quick brown fox jumps over the lazy dog.']) {
      expect(highlight(text, undefined), text).toBeUndefined()
    }
    expect(highlight('cualquier cosa', 'plaintext')).toBeUndefined()
    expect(highlight('   \n', 'python')).toBeUndefined()
  })

  it('en vivo no adivina (el lenguaje cambiaría a medio escribir) pero colorea si se sabe', () => {
    expect(highlight('def f(x):\n    return x\n', undefined, true)).toBeUndefined()
    expect(highlight('def f(x):\n    return x\n', 'python', true)?.html).toContain('hljs-keyword')
  })

  it('guarda lo resaltado: volver a una tarjeta no lo repite', () => {
    const a = highlight('SELECT * FROM t WHERE id = 1;', 'sql')
    expect(highlight('SELECT * FROM t WHERE id = 1;', 'sql')).toBe(a)
  })
})
