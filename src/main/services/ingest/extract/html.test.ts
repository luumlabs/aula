import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readDocument } from '../pipeline'
import { tempDir, type TempDir } from '../testing/files'
import { extractHTML } from './htmlExtractor'

let tmp: TempDir
beforeEach(() => { tmp = tempDir() })
afterEach(() => tmp.cleanup())

const extract = (html: string, isolate = true) => extractHTML(html, { isolateMainContent: isolate })

const DIRTY = `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="utf-8"><title>  Teorema de Pitágoras | Apuntes  </title>
<meta name="author" content="Prof. Luna"><meta name="description" content="Resumen del teorema">
<style>body { color: red } .x::after { content: "NO DEBERÍA SALIR" }</style>
<script>var secreto = "TAMBIEN NO"; if (a < b && c > d) { document.write('<p>x</p>'); }</script>
</head><body>
<!-- comentario que no debe salir -->
<nav class="menu"><ul><li><a href="/">Inicio</a></li><li><a href="/a">Cursos</a></li><li><a href="/b">Contacto</a></li></ul></nav>
<div class="cookie-banner">Usamos cookies. <button>Aceptar</button></div>
<header class="site-header"><h2>Mi sitio</h2></header>
<main>
  <article>
    <h1>Teorema de Pitágoras</h1>
    <p>En un triángulo rectángulo, el cuadrado de la <b>hipotenusa</b> es igual a la suma de los cuadrados de los catetos: a<sup>2</sup> + b<sup>2</sup> = c<sup>2</sup>.</p>
    <h2>Demostración</h2>
    <p>Considera un cuadrado de lado <i>a + b</i>. Dentro caben cuatro triángulos iguales y un cuadrado de lado c.</p>
    <ul><li>Primero: el área total.</li><li>Segundo: restar los triángulos.<ul><li>Cada uno vale ab/2.</li></ul></li></ul>
    <div class="share-buttons">Compartir en redes</div>
  </article>
</main>
<aside class="sidebar">Anuncios y enlaces relacionados</aside>
<footer><p>© 2026 Mi sitio. Todos los derechos reservados.</p></footer>
<script src="analytics.js"></script>
</body></html>`

describe('HTML: contenido principal', () => {
  it('de una página sucia solo queda el artículo', () => {
    const c = extract(DIRTY)
    expect(c.title).toBe('Teorema de Pitágoras | Apuntes')
    expect(c.metadata).toMatchObject({ author: 'Prof. Luna', description: 'Resumen del teorema', language: 'es' })
    for (const noise of ['NO DEBERÍA', 'TAMBIEN NO', 'comentario', 'Inicio', 'Cursos', 'cookies', 'Aceptar', 'Mi sitio', 'Compartir', 'Anuncios', 'derechos reservados', 'document.write']) expect(c.text, noise).not.toContain(noise)
    for (const want of ['# Teorema de Pitágoras', '## Demostración', 'hipotenusa', 'a^2 + b^2 = c^2', '- Primero: el área total.', '  - Cada uno vale ab/2.']) expect(c.text).toContain(want)
    expect(c.firstHeading).toBe('Teorema de Pitágoras')
  })

  it('sin contenedor principal también quita lo accesorio', () => {
    const c = extract('<html><head><title>T</title></head><body>\n<nav><a href="/">Inicio</a> <a href="/x">Cursos</a></nav>\n<div id="header"><div class="navbar">Barra</div></div>\n<h1>Mi apunte</h1><p>Texto importante del apunte con suficiente contenido para contar.</p>\n<div class="newsletter">Suscríbete a nuestro boletín</div>\n<footer>Pie de página</footer>\n</body></html>')
    expect(c.text).toContain('Mi apunte')
    expect(c.text).toContain('Texto importante')
    for (const noise of ['Inicio', 'Barra', 'Suscríbete', 'Pie de página']) expect(c.text).not.toContain(noise)
  })

  it('contenedores tipo Wikipedia y varios artículos', () => {
    const filler = 'Frase de relleno del artículo principal. '.repeat(20)
    const c = extract(`<html><body><div id="siteSub">Menú lateral enorme que no es contenido</div><div id="mw-content-text"><p>${filler}</p></div><div id="footer">pie</div></body></html>`)
    expect(c.text).toContain('Frase de relleno')
    expect(c.text).not.toContain('Menú lateral')
    const many = extract('<body><article><h2>Uno</h2><p>Primer artículo del listado con texto.</p></article><article><h2>Dos</h2><p>Segundo artículo del listado con texto.</p></article></body>')
    expect(many.text).toContain('Primer artículo')
    expect(many.text).toContain('Segundo artículo')
  })
})

describe('HTML: análisis tolerante', () => {
  it('HTML roto', () => {
    const c = extract('<HTML><BODY><P>Uno<P>Dos<br>línea<UL><LI>a<LI>b<LI>c</UL><TABLE><TR><TD>x<TD>y<TR><TD>z<TD>w</TABLE><b>negrita sin cerrar<p>siguiente</BODY>', false)
    for (const want of ['Uno\n\nDos\nlínea', '- a\n- b\n- c', 'x | y\nz | w', 'negrita sin cerrar', 'siguiente']) expect(c.text).toContain(want)
  })

  it('atributos sin comillas y entidades', () => {
    const c = extract('<div class=a id=b data-x=\'1"2\'><p title=hola>Texto <a href=http://x.com/a?b=1&c=2>enlace</a></p><img src=a.png alt=Figura&nbsp;uno></div><br/><br />fin', false)
    expect(c.text).toContain('Texto enlace')
    expect(c.text).toContain('fin')
    expect(extract('<p>Mar&iacute;a &amp; Jos&eacute; &lt;3 &pi;r&sup2; &#8805; 0 &mdash; &laquo;hola&raquo;</p>', false).text).toBe('María & José <3 πr² ≥ 0 — «hola»')
  })

  it('listas, definiciones y tablas', () => {
    expect(extract('<ol><li>Primero</li><li>Segundo<ol><li>Sub uno</li><li>Sub dos</li></ol></li><li>Tercero</li></ol><ol start="5"><li>cinco</li><li>seis</li></ol>', false).text).toBe('1. Primero\n2. Segundo\n  1. Sub uno\n  2. Sub dos\n3. Tercero\n\n5. cinco\n6. seis')
    expect(extract('<dl><dt>Seno</dt><dd>Cateto opuesto sobre hipotenusa</dd><dt>Coseno</dt><dd>Cateto adyacente sobre hipotenusa</dd></dl>', false).text).toContain('Seno\n  Cateto opuesto sobre hipotenusa\nCoseno\n  Cateto adyacente')
    expect(extract('<table><caption>Valores</caption><thead><tr><th>x</th><th>sen x</th><th>cos x</th></tr></thead><tbody><tr><td>0</td><td>0</td><td>1</td></tr><tr><td colspan="2">π/6</td><td>√3/2</td></tr><tr><td></td><td></td></tr></tbody></table>', false).text).toBe('Valores\n\nx | sen x | cos x\n0 | 0 | 1\nπ/6 |  | √3/2')
    expect(extract('<table><tr><td>|x|</td><td>valor absoluto</td></tr></table>', false).text).toBe('¦x¦ | valor absoluto')
    const layout = extract('<table><tr><td><h2>Columna A</h2><p>Texto de la columna A que es largo.</p></td><td><ul><li>uno</li><li>dos</li></ul></td></tr></table>', false).text
    expect(layout).toContain('## Columna A')
    expect(layout).toContain('- uno')
    expect(layout).not.toContain(' | ')
  })

  it('preformateado, citas y títulos', () => {
    const pre = extract('<p>Código:</p><pre>def f(x):\n    return x**2\n\n# fin   </pre><p>después</p>', false).text
    expect(pre).toContain('def f(x):\n    return x**2\n\n# fin')
    expect(pre).toContain('después')
    expect(extract('<h1>A</h1><h3>C</h3><blockquote><p>Cita uno</p><p>Cita dos</p></blockquote><h6>F</h6>', false).text).toBe('# A\n\n### C\n\n> Cita uno\n\n> Cita dos\n\n###### F')
  })

  it('superíndices, subíndices e imágenes', () => {
    expect(extract('<p>x<sup>2</sup> + y<sub>1</sub> = z<sup>n+1</sup> y H<sub>2</sub>O y 10<sup>-3</sup></p>', false).text).toBe('x^2 + y_1 = z^(n+1) y H_2O y 10^-3')
    const big = extract('<p>Mira:</p><img src="grafica.png" alt="Gráfica de la función seno entre 0 y 2π" width="400" height="300">', false)
    expect(big.hasFigures).toBe(true)
    expect(big.text).toContain('[Figura: Gráfica de la función seno entre 0 y 2π]')
    const icon = extract('<p>Hola</p><img src="icon-home.png" alt="Inicio" width="16" height="16"><img class="avatar" src="a.png" alt="Foto de perfil">', false)
    expect(icon.hasFigures).toBe(false)
    expect(icon.text).not.toContain('Inicio')
    expect(icon.text).not.toContain('perfil')
    expect(extract('<img src="e.svg" alt="{\\displaystyle x^{2}+y^{2}=r^{2}}" width="120" height="30">', false).text).toBe('$x^{2}+y^{2}=r^{2}$')
  })

  it('MathML, KaTeX y MathJax', () => {
    expect(extract('<p>Fórmula: <math><semantics><mrow><msup><mi>x</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">{\\displaystyle x^{2}}</annotation></semantics></math></p>', false).text).toBe('Fórmula: $x^{2}$')
    expect(extract('<math><mfrac><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mn>2</mn></mfrac><mo>=</mo><msqrt><mi>c</mi></msqrt><mo>+</mo><msub><mi>x</mi><mn>1</mn></msub></math>', false).text).toBe('(a+b)/2=√c+x_1')
    expect(extract('<span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="base">E=mc2</span></span></span>', false).text).toBe('$E=mc^2$')
    const jax = extract('<p>Inline <script type="math/tex">a^2+b^2</script> y display:</p><script type="math/tex; mode=display">\\int_0^1 x\\,dx</script>', false).text
    expect(jax).toContain('$a^2+b^2$')
    expect(jax).toContain('$$\\int_0^1 x\\,dx$$')
  })

  it('contenido oculto, formularios, enlaces y espacios', () => {
    expect(extract('<p>Visible</p><p hidden>Oculto 1</p><p style="display: none">Oculto 2</p><p style="visibility:hidden">Oculto 3</p><p aria-hidden="true">Oculto 4</p><div class="sr-only">Saltar al contenido</div><noscript>Activa JS</noscript>', false).text).toBe('Visible')
    expect(extract('<form action="/x"><label>Buscar</label><input type="text" value="abc"><select><option>Uno</option></select><button>Ir</button><textarea>escrito</textarea></form><p>Contenido real</p>', false).text).toBe('Contenido real')
    const asp = extract('<body><form id="aspnetForm"><div><h1>Título</h1><p>Contenido dentro de un form gigante que envuelve toda la página.</p></div></form></body>')
    expect(asp.text).toContain('Título')
    expect(asp.text).toContain('Contenido dentro')
    expect(extract('<p>Lee <a href="https://example.com/largo/camino">este artículo</a> y <a href="#x">aquel</a>.</p>', false).text).toBe('Lee este artículo y aquel.')
    expect(extract('<p>  mucho    espacio \n\n  y\tsaltos  </p><p>&nbsp;&nbsp;nbsp   </p>', false).text).toBe('mucho espacio y saltos\n\nnbsp')
    expect(extract('<p>Usa <code>sin(x)</code> con <q>comillas</q> y <kbd>Ctrl</kbd>.</p>', false).text).toBe('Usa sin(x) con “comillas” y Ctrl.')
  })

  it('títulos de reserva', () => {
    expect(extract('<html><body><h1>Solo H1</h1><p>texto</p></body></html>').title).toBe('Solo H1')
    expect(extract('<head><meta property="og:title" content="Título OG"></head><body><p>x</p></body>').title).toBe('Título OG')
    expect(extract('<p>sin título</p>', false).title).toBeNull()
  })

  it('anidamiento profundo y basura no rompen nada', () => {
    expect(extract('<div>'.repeat(20_000) + 'profundo' + '</div>'.repeat(20_000)).text).toContain('profundo')
    expect(extract('<span><b><i>'.repeat(5000) + 'interior').text).toContain('interior')
    const alphabet = Array.from('<>/=" \'!-?[]&;#abcdefghijklmnopqrstuvwxyz0123456789\n\t')
    let seed = 99
    const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    for (let k = 0; k < 200; k++) {
      let s = ''
      for (let i = 0; i < 1 + rnd(400); i++) s += alphabet[rnd(alphabet.length)]
      extract(s)
      extract(s, false)
    }
    for (const s of ['<', '<!--', '<![CDATA[', '<script>sin cerrar', '<a href="sin cerrar', '&', '&'.repeat(10_000)]) extract(s)
  })

  it('vacío, solo texto y página grande', () => {
    expect(extract('').text).toBe('')
    expect(extract('   ').text).toBe('')
    expect(extract('solo texto sin etiquetas').text).toBe('solo texto sin etiquetas')
    expect(extract('<script>x</script><style>y</style>').text).toBe('')
    const item = '<div class="item"><h3>Título del elemento</h3><p>Un párrafo con <a href="/x">enlace</a>, <b>negrita</b> y texto &amp; entidades &eacute;.</p><ul><li>uno</li><li>dos</li></ul></div>'
    const html = '<html><body><article>' + item.repeat(4000) + '</article></body></html>'
    const t0 = performance.now()
    const c = extract(html)
    expect(performance.now() - t0).toBeLessThan(6000)
    expect(c.text.length).toBeGreaterThan(200_000)
  })
})

describe('HTML: archivos locales', () => {
  it('lee un archivo HTML', async () => {
    const doc = await readDocument(tmp.write('pagina.html', DIRTY))
    expect(doc.kind).toBe('html')
    expect(doc.title).toBe('Teorema de Pitágoras | Apuntes')
    expect(doc.pages).toHaveLength(1)
    expect(doc.pages[0].text).toContain('hipotenusa')
    expect(doc.pages[0].heading).toBe('Teorema de Pitágoras')
    expect(doc.metadata.author).toBe('Prof. Luna')
  })

  it('HTML en Latin-1 y HTML sin texto', async () => {
    const html = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"><title>Canción</title></head><body><p>El niño comó árboles.</p></body></html>'
    const doc = await readDocument(tmp.write('viejo.html', new Uint8Array(Buffer.from(html, 'latin1'))))
    expect(doc.title).toBe('Canción')
    expect(doc.pages[0].text).toContain('El niño comó árboles.')
    expect((await readDocument(tmp.write('vacia.html', '<html><body><script>1</script></body></html>'))).warnings.some((w) => w.includes('No se encontró texto'))).toBe(true)
  })
})
