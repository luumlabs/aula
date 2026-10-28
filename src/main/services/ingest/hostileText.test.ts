// Texto, HTML y RTF hostiles (port de HostileTextTests.swift): tamaños extremos, estructuras patológicas y anidamientos
// profundos. Todo debe terminar rápido (sin comportamientos cuadráticos) y sin desbordar la pila.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SourceChunk, SourceDocument } from '@shared/ingest'
import { SearchIndex } from '../search/searchIndex'
import { tokenize } from '../search/text'
import { chunkDocument, sentences } from './chunker'
import { extractHTML } from './extract/htmlExtractor'
import { rtfText } from './extract/plainText'
import { documentFromText, readDocument } from './pipeline'
import { tempDir, type TempDir } from './testing/files'
import { charCount } from './text/unicode'

let tmp: TempDir
beforeEach(() => { tmp = tempDir() })
afterEach(() => tmp.cleanup())

const one = (text: string): Pick<SourceDocument, 'pages'> => ({ pages: [{ number: 1, text, usedOCR: false, hasFigures: false }] })
const noSpace = (s: string): string => s.replace(/\s+/g, '')
const elapsed = (t0: number): number => (performance.now() - t0) / 1000

describe('Troceado de textos patológicos', () => {
  it('un bloque enorme sin fin de frase ni espacios se trocea rápido', () => {
    const csv = 'id,nombre,nota,fecha,comentario_sin_espacios_ni_puntos\n'.repeat(12_000)
    const json = '{"a":1,"b":[1,2,3],"c":"xyz"}'.repeat(20_000)
    for (const text of [csv, json]) {
      const t0 = performance.now()
      const chunks = chunkDocument(one(text), 's', { overlap: 0 })
      expect(elapsed(t0)).toBeLessThan(6)
      expect(chunks.every((c) => c.text.length > 0 && charCount(c.text) <= 2200)).toBe(true)
      expect(noSpace(chunks.map((c) => c.text).join(''))).toBe(noSpace(text))
    }
  })

  it('una «palabra» enorme antes de un punto (base64)', () => {
    const blob = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo'.repeat(45_000)
    const text = 'Inicio del archivo. ' + blob + '. Fin del bloque. Otra frase.'
    const t0 = performance.now()
    const chunks = chunkDocument(one(text), 'b64', { overlap: 0 })
    expect(elapsed(t0)).toBeLessThan(10)
    expect(noSpace(chunks.map((c) => c.text).join(''))).toBe(noSpace(text))
    expect(sentences('Lo dijo el Dr. Pérez. Luego aprox. 5 personas. Fin.')).toEqual(['Lo dijo el Dr. Pérez. ', 'Luego aprox. 5 personas. ', 'Fin.'])
  })

  it('un CSV se corta entre líneas', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `fila${i + 1},valor${i + 1},otro${i + 1}`)
    const chunks = chunkDocument(one(lines.join('\n')), 'csv', { overlap: 0 })
    expect(chunks.length).toBeGreaterThan(10)
    const all = new Set(lines)
    for (const c of chunks) for (const l of c.text.split('\n')) expect(all.has(l), l).toBe(true)
  })

  it('un texto pegado de varios megas', () => {
    const t0 = performance.now()
    const chunks = chunkDocument(documentFromText('palabra '.repeat(500_000), 'Enorme'), 'enorme')
    expect(elapsed(t0)).toBeLessThan(10)
    expect(chunks.length).toBeGreaterThan(1500)
  })

  it('muchas líneas que parecen títulos', () => {
    const text = Array.from({ length: 30_000 }, (_, k) => { const i = k + 1; return i % 3 === 0 ? `TEMA ${i} EN MAYÚSCULAS` : i % 3 === 1 ? `${(i % 90) + 1}.${(i % 9) + 1} Apartado numerado` : '' }).join('\n')
    const t0 = performance.now()
    const chunks = chunkDocument(one(text), 't')
    expect(elapsed(t0)).toBeLessThan(10)
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.every((c) => c.heading !== undefined)).toBe(true)
  })
})

describe('Mezcla de idiomas, escrituras y fórmulas', () => {
  const mixed = `# Trigonometría · Trigonometry · Τριγωνομετρία

La identidad sin²(x) + cos²(x) = 1 vale para todo x ∈ ℝ y la derivada de x² es 2x. In English: the derivative of x^2 is 2x, and ∫₀¹ x dx = 1/2.
Пифагор доказал теорему; 毕达哥拉斯定理说明 a²+b²=c²；فيثاغورس عالم رياضيات. 🎉👩🏽‍🔬 🇪🇸 école café naïve.
Ελληνικά: ο Πυθαγόρας. Hebrew: משפט פיתגורס. Fórmula química: H₂O y CO₂; límite lím_{x→0} sen(x)/x = 1.`

  it('se trocea y se puede buscar', async () => {
    const doc = await readDocument(tmp.write('mezcla.md', mixed))
    expect(doc.title).toBe('Trigonometría · Trigonometry · Τριγωνομετρία')
    const chunks = chunkDocument(doc, 'mix', { target: 120, maxChars: 200, overlap: 20 })
    expect(chunks.every((c) => c.text.length > 0 && charCount(c.text) <= 200)).toBe(true)
    const index = new SearchIndex(chunks)
    for (const q of ['derivative', 'derivada', 'sin^2', 'cos', 'пифагор', 'Пифагор', '定理', 'فيثاغورس', 'πυθαγορασ', 'Πυθαγόρας', 'ecole', 'École', 'cafe', 'naive', 'H_2', '"the derivative of"', 'trigonometr*']) {
      expect(index.search(q).length, q).toBeGreaterThan(0)
    }
    for (const hit of index.search('teorema pitagoras sin cos derivative', { limit: 20 })) expect(hit.snippet.split('**').length % 2, hit.snippet).toBe(1)
  })

  it('fin de frase en otras escrituras', () => {
    expect(sentences('勾股定理很重要。它说明直角三角形的边长关系！对吗？是的。')).toEqual(['勾股定理很重要。', '它说明直角三角形的边长关系！', '对吗？', '是的。'])
    expect(sentences('「三平方の定理」は大切です。次に進みます。')).toEqual(['「三平方の定理」は大切です。', '次に進みます。'])
    expect(sentences('هذه جملة أولى. وهذه جملة ثانية؟ نعم.')).toEqual(['هذه جملة أولى. ', 'وهذه جملة ثانية؟ ', 'نعم.'])
    expect(sentences('यह पहला वाक्य है। यह दूसरा है।')).toEqual(['यह पहला वाक्य है। ', 'यह दूसरा है।'])
    expect(sentences('Mezcla: x² + y² = 1. 数学很美。Fin.')).toEqual(['Mezcla: x² + y² = 1. ', '数学很美。', 'Fin.'])
    const chunks = chunkDocument(one('这是一个关于三角函数的很长的句子，用来测试分块。'.repeat(400)), 'zh', { overlap: 0 })
    expect(chunks.length).toBeGreaterThan(3)
    expect(chunks.every((c) => c.text.endsWith('。'))).toBe(true)
  })

  it('el tokenizador y el índice con cadenas hostiles', () => {
    const nasty = ['́'.repeat(5000), '👩🏽‍🔬'.repeat(2000), 'x^'.repeat(5000), '_'.repeat(5000), '^{'.repeat(3000), '1.'.repeat(5000) + '1', '1/'.repeat(5000) + '1',
      'a'.repeat(200_000), '\u0000\u0001￿�‮texto‬', 'x^{' + 'a'.repeat(100)]
    const t0 = performance.now()
    for (const s of nasty) {
      tokenize(s)
      new SearchIndex([{ id: '1', sourceID: 's', ordinal: 0, text: s }]).search(s.slice(0, 300) + ' ' + s.slice(-50))
    }
    expect(elapsed(t0)).toBeLessThan(10)
  })

  it('consultas hostiles', () => {
    const chunks: SourceChunk[] = Array.from({ length: 300 }, (_, i) => ({ id: `c${i}`, sourceID: `s${i % 3}`, ordinal: i, text: `Fragmento ${i} sobre derivadas, integrales y límites; también sin(x) y x^2.` }))
    const index = new SearchIndex(chunks)
    const queries = ['', ' ', '"', '""', '"""', '*', '**', '***', 'a*', '"*"', '"de la"', 'derivada '.repeat(5000), '"'.repeat(1001), '"derivadas, integrales" "sin cerrar', 'x'.repeat(100_000) + '*',
      'derivadas -integrales', 'sin(x', 'x^', '^2', '_', '«integrales y»', '“límites”']
    const t0 = performance.now()
    for (const q of queries) {
      const hits = index.search(q, { limit: 5 })
      expect(hits.length).toBeLessThanOrEqual(5)
      expect(hits.map((h) => h.score)).toEqual([...hits.map((h) => h.score)].sort((a, b) => b - a))
    }
    expect(index.search('deriv*').length).toBeGreaterThan(0)
    expect(index.search('f*').length).toBeGreaterThan(0)
    expect(elapsed(t0)).toBeLessThan(10)
  })
})

describe('HTML hostil', () => {
  it('HTML muy anidado por el canal completo', async () => {
    const patterns: Array<[string, string]> = [['<div>', '</div>'], ['<h1>', '</h1>'], ['<blockquote>', '</blockquote>'], ['<ul><li>', '</li></ul>'], ['<table><tr><td>', '</td></tr></table>'], ['<sup>', '</sup>'], ['<p><span><b>', '</b></span></p>']]
    for (const [i, [open, close]] of patterns.entries()) {
      const html = '<html><body><p>Inicio del documento.</p>' + open.repeat(3000) + 'centro' + close.repeat(3000) + '<p>Final del documento.</p></body></html>'
      const doc = await readDocument(tmp.write(`profundo${i}.html`, html))
      expect(doc.pages[0].text, open).toContain('Inicio del documento.')
    }
    await readDocument(tmp.write('mathml.html', '<html><body><p>Fórmula:</p><math>' + '<mrow><mfrac><mi>a</mi>'.repeat(2000) + '</mfrac></mrow>'.repeat(2000) + '</math></body></html>'))
  })

  it('números de lista extremos', async () => {
    const html = '<html><body><ol start="-9223372036854775808"><li>primero</li><li>segundo</li></ol><ol><li value="9223372036854775807">máximo</li><li>siguiente</li></ol><ol start="9223372036854775807"><li>tope</li></ol></body></html>'
    const content = extractHTML(html)
    for (const item of ['primero', 'segundo', 'máximo', 'siguiente', 'tope']) expect(content.text).toContain(item)
    expect(content.text).toContain('999999999. máximo')
    expect(content.text).toContain('1000000000. siguiente')
    expect((await readDocument(tmp.write('listas.html', html))).pages[0].text).toContain('siguiente')
  })

  it('estructuras lentas: relleno anidado, cierres sin pareja, candidatos anidados y páginas enormes', () => {
    let t0 = performance.now()
    const share = '<html><body>' + '<div class="share">'.repeat(200) + '<span></span>'.repeat(150_000) + '<p>' + 'Texto real del artículo. '.repeat(100) + '</p>' + '</div>'.repeat(200) + '</body></html>'
    expect(extractHTML(share, { isolateMainContent: false }).text).toContain('Texto real del artículo.')
    expect(elapsed(t0)).toBeLessThan(8)
    t0 = performance.now()
    expect(extractHTML('<div><section><article>'.repeat(70) + '</nada></x></y>'.repeat(150_000) + 'texto').text).toContain('texto')
    expect(elapsed(t0)).toBeLessThan(8)
    const paragraph = '<p>' + 'Texto del artículo con bastantes palabras. '.repeat(20) + '</p>'
    const nested = '<html><body>' + '<div class="content main-content article-body"><main><article>'.repeat(70) + paragraph.repeat(3000) + '</article></main></div>'.repeat(70) + '</body></html>'
    t0 = performance.now()
    expect(extractHTML(nested).text.length).toBeGreaterThan(1_000_000)
    expect(elapsed(t0)).toBeLessThan(10)
    t0 = performance.now()
    expect(extractHTML('Texto sin ninguna etiqueta y con entidades &amp; &eacute; &#241; &bogus; '.repeat(40_000)).text).toContain('é ñ &bogus;')
    expect(extractHTML('<i></i><br><img src=x>'.repeat(60_000) + '<p>fin</p>').text).toContain('fin')
    expect(elapsed(t0)).toBeLessThan(10)
  })
})

describe('RTF hostil', () => {
  it('grupos sin fin', async () => {
    const t0 = performance.now()
    const r = rtfText(new Uint8Array(Buffer.from('{\\rtf1\\ansi ' + '{'.repeat(2_000_000) + 'texto profundo' + '}'.repeat(10) + ' fin')))
    expect(elapsed(t0)).toBeLessThan(10)
    expect(r.text).toContain('texto profundo')
    const small = '{\\rtf1\\ansi ' + '{\\b '.repeat(50_000) + 'negrita profunda' + '}'.repeat(50_000) + '\\par fin}'
    expect((await readDocument(tmp.write('grupos.rtf', small))).pages[0].text).toContain('negrita profunda')
  })

  it('palabras de control y parámetros enormes; pares sustitutos', () => {
    const rtf = '{\\rtf1 \\' + 'a'.repeat(300_000) + '999999999999999999999 texto \\u-99999999999? \\uc999999999 \\u233?12345678 fin \\\'zz \\\'4'
    const r = rtfText(new Uint8Array(Buffer.from(rtf)))
    for (const want of ['texto', 'é', 'fin']) expect(r.text).toContain(want)
    expect(rtfText(new Uint8Array(Buffer.from('{\\rtf1 \\u-10179?\\u-8704? cara}'))).text).toBe('😀 cara')
  })
})

describe('Archivos de texto hostiles', () => {
  it('basura binaria con extensión de texto', async () => {
    let state = 42n
    const bytes = new Uint8Array(300_000)
    for (let i = 0; i < bytes.length; i++) {
      state ^= (state << 13n) & 0xffffffffffffffffn; state ^= state >> 7n; state ^= (state << 17n) & 0xffffffffffffffffn
      bytes[i] = Number(state & 0xffn)
    }
    const doc = await readDocument(tmp.write('basura.txt', bytes))
    expect(doc.kind).toBe('text')
    expect(doc.pages.length).toBeGreaterThan(0)
    expect((await readDocument(tmp.write('basura.md', bytes))).kind).toBe('markdown')
  })

  it('UTF-16 raro y saltos de línea mezclados', async () => {
    const data = new Uint8Array([0xff, 0xfe, ...Buffer.from('Línea uno\r\nLínea dos\rLínea tres\n', 'utf16le'), 0x41])
    expect((await readDocument(tmp.write('utf16.txt', data))).pages[0].text).toContain('Línea dos')
  })
})
