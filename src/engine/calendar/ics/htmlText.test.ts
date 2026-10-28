// Port de CanvasKitTests/HTMLTextTests.swift (sin lo que necesita una dirección base o el editor de bloques, que son del
// contenido de Canvas): las descripciones HTML de los calendarios pasan a Markdown ligero o a texto.
import { describe, expect, it } from 'vitest'
import { decodeEntities, htmlToMarkdown, htmlToPlainText, latexFromEquationSrc, looksLikeHTML } from './htmlText'
import { LCG } from './testSupport.testutil'

const md = (html: string) => htmlToMarkdown(html)
const plain = (html: string) => htmlToPlainText(html)

describe('HTML → Markdown', () => {
  it('testParagraphsAndInlineEmphasis', () => {
    expect(md("<p>Hola <strong>mundo</strong> y <em>amigos</em>.</p><p>Segundo</p>")).toBe("Hola **mundo** y *amigos*.\n\nSegundo")
    expect(md("<p><b>negrita</b> <i>cursiva</i> <u>subrayado</u> <s>tachado</s></p>")).toBe("**negrita** *cursiva* subrayado ~~tachado~~")
  })

  it('testBoldMarkersKeepSpacesOutside', () => {
    expect(md("<p>a<b> espacio </b>b</p>")).toBe("a **espacio** b")
    expect(md("<p><b> </b>solo espacio</p>")).toBe("solo espacio")
    expect(md("<p><b></b>vacío</p>")).toBe("vacío")
  })

  it('testNestedBoldAndItalicCombine', () => {
    expect(md("<p><i><b>x</b></i></p>")).toBe("***x***")
    expect(md("<p><b><b>x</b></b></p>")).toBe("**x**")
  })

  it('testLineBreaks', () => {
    expect(md("<p>uno<br>dos<br/>tres</p>")).toBe("uno\ndos\ntres")
    expect(md("<p>uno<br><br>dos</p>")).toBe("uno\n\ndos")
  })

  it('testWhitespaceCollapsing', () => {
    expect(md("<p>  mucho \n\n   espacio\t\tcolapsado  </p>")).toBe("mucho espacio colapsado")
    expect(md("<p>Esto&nbsp;es&nbsp;&nbsp;un&nbsp;test</p>")).toBe("Esto es un test")
  })

  it('testInvisibleCharactersRemoved', () => {
    expect(md("<p>a\u{200B}b\u{FEFF}c\u{00AD}d</p>")).toBe("abcd")
  })

  it('testDivsBecomeSeparateBlocks', () => {
    expect(md("<div>Intro<div>Bloque <b>uno</b></div>cola</div>")).toBe("Intro\n\nBloque **uno**\n\ncola")
  })

  it('testHeadings', () => {
    expect(md("<h1>Título</h1><h2>Sub <em>título</em></h2><h3>Tres</h3><p>Texto</p>")).toBe("# Título\n\n## Sub *título*\n\n### Tres\n\nTexto")
    expect(md("<h2>   </h2><p>x</p>")).toBe("x")
  })

  it('testHorizontalRuleAndBlockquote', () => {
    expect(md("<p>a</p><hr><p>b</p>")).toBe("a\n\n---\n\nb")
    expect(md("<blockquote><p>Cita uno</p><p>Cita dos</p></blockquote>")).toBe("> Cita uno\n>\n> Cita dos")
  })

  it('testUnorderedAndNestedLists', () => {
    expect(md("<ul><li>Uno</li><li>Dos<ul><li>Dos.a</li><li>Dos.b</li></ul></li><li>Tres</li></ul>")).toBe("- Uno\n- Dos\n  - Dos.a\n  - Dos.b\n- Tres")
  })

  it('testOrderedListsAndStartAttribute', () => {
    expect(md("<ol><li>a</li><li>b</li></ol>")).toBe("1. a\n2. b")
    expect(md("<ol start=\"3\"><li>tres</li><li>cuatro</li></ol>")).toBe("3. tres\n4. cuatro")
  })

  it('testListWithImpliedClosingAndLooseHTML', () => {
    expect(md("<ul><li>a<li>b<li>c</ul>")).toBe("- a\n- b\n- c")
  })

  it('testListItemWithParagraphsStaysTight', () => {
    expect(md("<ul><li><p>uno</p></li><li><p>dos</p></li></ul>")).toBe("- uno\n- dos")
  })

  it('testOrderedListNestedInUnordered', () => {
    const out = md("<ul><li>Pasos<ol><li>Primero</li><li>Segundo</li></ol></li></ul>")
    expect(out).toBe("- Pasos\n  1. Primero\n  2. Segundo")
  })

  it('testSimpleTableWithHeader', () => {
    const html = "<table><thead><tr><th>Semana</th><th>Tema</th></tr></thead><tbody><tr><td>1</td><td>Círculo unidad</td></tr><tr><td>2</td><td>Gráficas</td></tr></tbody></table>"
    expect(md(html)).toBe("| Semana | Tema |\n| --- | --- |\n| 1 | Círculo unidad |\n| 2 | Gráficas |")
  })

  it('testTableWithoutHeaderUsesFirstRow', () => {
    expect(md("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>")).toBe("| a | b |\n| --- | --- |\n| c | d |")
  })

  it('testTablePipesAreEscapedAndRowsPadded', () => {
    expect(md("<table><tr><td>x|y</td><td>b</td></tr><tr><td>solo</td></tr></table>")).toBe("| x\\|y | b |\n| --- | --- |\n| solo |  |")
  })

  it('testTableColspan', () => {
    const out = md("<table><tr><th colspan=\"2\">Título</th></tr><tr><td>a</td><td>b</td></tr></table>")
    expect(out).toBe("| Título |  |\n| --- | --- |\n| a | b |")
  })

  it('testSingleCellLayoutTableIsUnwrapped', () => {
    expect(md("<table><tr><td><p>Texto de maquetación</p><p>otro</p></td></tr></table>")).toBe("Texto de maquetación\n\notro")
  })

  it('testTableWithUnclosedCellsAndRows', () => {
    expect(md("<table><tr><td>x<td>y<tr><td>z<td>w</table>")).toBe("| x | y |\n| --- | --- |\n| z | w |")
  })

  it('testTableCaption', () => {
    const out = md("<table><caption>Valores</caption><tr><td>a</td><td>b</td></tr></table>")
    expect(out.startsWith("Valores\n\n| a | b |")).toBe(true)
  })

  it('testLinks', () => {
    expect(md("<p>Ver <a href=\"https://example.com/a?b=1\">el sitio</a>.</p>")).toBe("Ver [el sitio](https://example.com/a?b=1).")
    expect(md("<a href=\"https://x.com\">https://x.com</a>")).toBe("https://x.com")
    expect(md("<a href=\"mailto:a@b.com\">escribir</a>")).toBe("[escribir](mailto:a@b.com)")
  })

  it('testDangerousAndAnchorLinksDropped', () => {
    expect(md("<a href=\"javascript:alert(1)\">malo</a>")).toBe("malo")
    expect(md("<a href=\"JaVaScRiPt:alert(1)\">malo</a>")).toBe("malo")
    expect(md("<a href=\"#top\">ancla</a>")).toBe("ancla")
    expect(md("<a href=\"data:text/html;base64,AAAA\">dato</a>")).toBe("dato")
    expect(md("<a>sin href</a>")).toBe("sin href")
  })

  it('testLinkUrlWithSpacesAndParenthesesIsEscaped', () => {
    expect(md("<a href=\"https://x.com/a b/(c)\">t</a>")).toBe("[t](https://x.com/a%20b/%28c%29)")
  })

  it('testLinkWithoutTextShowsAddress', () => {
    expect(md("<a href=\"https://x.com/doc\"></a>")).toBe("https://x.com/doc")
  })

  it('testImageInsideLink', () => {
    expect(md("<a href=\"https://x.com/a\"><img src=\"https://x.com/i.png\" alt=\"Logo\"></a>")).toBe("[![Logo](https://x.com/i.png)](https://x.com/a)")
  })

  it('testDecorativeImagesAreDropped', () => {
    expect(md("<p>a<img src=\"data:image/png;base64,AAAA\" alt=\"\">b</p>")).toBe("ab")
    expect(md("<p>a<img src=\"/images/svg-icons/svg_icon_download.svg\">b</p>")).toBe("ab")
    expect(md("<p>a<img src=\"/images/emoji/1f600.png\" class=\"emoji\" alt=\"😀\">b</p>")).toBe("a😀b")
  })

  it('testCanvasEquationImageUsesLatexFromAttributes', () => {
    const html = "<p>Resuelve <img class=\"equation_image\" title=\"\\sin(x)=\\frac{1}{2}\" src=\"/equation_images/%255Csin%2528x%2529?scale=1\" alt=\"LaTeX: \\sin(x)=\\frac{1}{2}\" data-equation-content=\"\\sin(x)=\\frac{1}{2}\"> para x.</p>"
    expect(md(html)).toBe("Resuelve $\\sin(x)=\\frac{1}{2}$ para x.")
  })

  it('testCanvasEquationImageFallsBackToAltTitleAndSrc', () => {
    expect(md("<img class=\"equation_image\" alt=\"LaTeX: x^2+1\" src=\"/equation_images/x\">")).toBe("$x^2+1$")
    expect(md("<img class=\"equation_image\" title=\"y=mx+b\" src=\"/equation_images/x\">")).toBe("$y=mx+b$")
    expect(md("<img class=\"equation_image\" src=\"/equation_images/%255Cpi%252F3?scale=1\">")).toBe("$\\pi/3$")
  })

  it('testLatexFromEquationSrcHelper', () => {
    expect(latexFromEquationSrc("https://x.com/equation_images/%255Cfrac%257B1%257D%257B2%257D?scale=1")).toBe("\\frac{1}{2}")
    expect(latexFromEquationSrc("https://x.com/otra/cosa")).toBeNull()
  })

  it('testMathMLFractionPowerAndRoot', () => {
    expect(md("<p>Calcula <math><mfrac><mn>1</mn><mn>2</mn></mfrac><mo>+</mo><msup><mi>x</mi><mn>2</mn></msup><mo>=</mo><msqrt><mi>y</mi></msqrt></math></p>")).toBe("Calcula $\\frac{1}{2}+x^{2}=\\sqrt{y}$")
  })

  it('testMathMLFunctionsAndGreek', () => {
    const out = md("<math><mi>sin</mi><mo>(</mo><mi>θ</mi><mo>)</mo><mo>=</mo><mfrac><mn>1</mn><mn>2</mn></mfrac></math>")
    expect(out.includes("\\sin")).toBe(true)
    expect(out.includes("\\theta")).toBe(true)
    expect(out.includes("\\frac{1}{2}")).toBe(true)
  })

  it('testMathMLAnnotationTexIsPreferred', () => {
    const html = "<math><semantics><mrow><mi>x</mi></mrow><annotation encoding=\"application/x-tex\">\\alpha^2</annotation></semantics></math>"
    expect(md(html)).toBe("$\\alpha^2$")
  })

  it('testMathMLMatrixAndSubscript', () => {
    const out = md("<math><msub><mi>a</mi><mn>1</mn></msub><mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>2</mn></mtd></mtr><mtr><mtd><mn>3</mn></mtd><mtd><mn>4</mn></mtd></mtr></mtable></math>")
    expect(out.includes("a_{1}")).toBe(true)
    expect(out.includes("\\begin{matrix} 1 & 2 \\\\ 3 & 4 \\end{matrix}")).toBe(true)
  })

  it('testSuperscriptAndSubscriptText', () => {
    expect(md("<p>x<sup>2</sup> + y<sub>i</sub> = H<sub>2</sub>O</p>")).toBe("x^2 + y_i = H_2O")
    expect(md("<p>(a+b)<sup>n+1</sup> y 1<sup>st</sup></p>")).toBe("(a+b)^(n+1) y 1st")
  })

  it('testPreservesCodeBlocks', () => {
    const out = md("<pre><code class=\"language-python\">def f(x):\n    return x*2\n\n\nprint(f(2))</code></pre><p>Usa <code>x &lt; 5</code>.</p>")
    expect(out).toBe("```python\ndef f(x):\n    return x*2\n\n\nprint(f(2))\n```\n\nUsa `x < 5`.")
  })

  it('testInlineCodeWithBacktick', () => {
    expect(md("<code>a`b</code>")).toBe("``a`b``")
  })

  it('testNamedNumericAndHexEntities', () => {
    expect(md("<p>&amp; &lt; &gt; &quot; &apos; &eacute;&ntilde;&uuml; &#233; &#xE9; &ndash;&mdash; &hellip; &alpha;&pi;&infin; &le;&ge;&ne; &deg; &plusmn; &times;&divide;</p>")).toBe("& < > \" ' éñü é é –— … απ∞ ≤≥≠ ° ± ×÷")
  })

  it('testUnknownAndInvalidEntitiesAreLeftAlone', () => {
    expect(md("<p>AT&T &notanentity; &#xZZ; & y &amp</p>")).toBe("AT&T &notanentity; &#xZZ; & y &amp")
    expect(decodeEntities("&#0; &#xD800; &#1114112;")).toBe("\u{FFFD} \u{FFFD} \u{FFFD}")
  })

  it('testDecodeEntitiesPublicHelper', () => {
    expect(decodeEntities("Tom &amp; Jerry &copy; 2024 &#x1F600;")).toBe("Tom & Jerry © 2024 😀")
    expect(decodeEntities("sin entidades")).toBe("sin entidades")
  })

  it('testScriptsStylesIframesAndCommentsAreRemoved', () => {
    const html = "<style>p{color:red}</style><script>if (a < b) alert('<p>no</p>')</script><p>visible</p><iframe src=\"https://youtube.com/x\">texto alterno</iframe><!-- comentario <p>oculto</p> --><p>fin</p><noscript>js</noscript>"
    expect(md(html)).toBe("visible\n\nfin")
  })

  it('testConditionalCommentsAndDoctype', () => {
    const html = "<!DOCTYPE html><html><head><title>Título</title><meta charset=\"utf-8\"></head><body><!--[if gte mso 9]><xml><o:p>x</o:p></xml><![endif]--><p>Cuerpo</p></body></html>"
    expect(md(html)).toBe("Cuerpo")
  })

  it('testHiddenElementsAreSkipped', () => {
    expect(md("<p>a<span style=\"display: none\">oculto</span><span hidden>otro</span><span aria-hidden=\"true\">x</span>b</p>")).toBe("ab")
  })

  it('testCDATAIsKeptAsText', () => {
    expect(md("<p>a<![CDATA[ <b>literal</b> ]]>b</p>")).toBe("a <b>literal</b> b")
  })

  it('testCanvasFileLinkWithApiEndpointAndDownloadButton', () => {
    const html = '<p><a class="instructure_file_link instructure_scribd_file auto_open" title="Syllabus.pdf" href="https://school.instructure.com/courses/123/files/456?wrap=1" target="_blank" data-api-endpoint="https://school.instructure.com/api/v1/courses/123/files/456" data-api-returntype="File">Syllabus.pdf</a>\n' +
      '<span class="instructure_file_holder link_holder"><a class="file_download_btn" role="button" download="" href="https://school.instructure.com/courses/123/files/456/download?download_frd=1"><span class="screenreader-only">Download Syllabus.pdf</span><img src="/images/svg-icons/svg_icon_download.svg" alt="Download"></a></span></p>'
    expect(md(html)).toBe('[Syllabus.pdf](https://school.instructure.com/courses/123/files/456?wrap=1)')
  })

  it('testCanvasSpansWithClassesAndStyles', () => {
    const html = "<p><span style=\"font-size: 12pt; color: #2d3b45;\" class=\"highlight\">Texto con <span class=\"x\">span</span> anidado</span></p>"
    expect(md(html)).toBe("Texto con span anidado")
  })

  it('testCanvasTypicalSyllabus', () => {
    const html = ['<h2>Course Syllabus</h2>', '<p><strong>Instructor:</strong> Dr. Pérez<br />Office hours: MW 10:00&ndash;11:30</p>',
      '<table style="border-collapse: collapse; width: 100%;" border="1"><tbody>', '<tr><td style="width: 50%;"><strong>Exam 1</strong></td><td>Oct 8</td></tr>',
      '<tr><td><strong>Exam 2</strong></td><td>Nov 12</td></tr></tbody></table>', '<ul><li>Calculator required</li><li>No phones</li></ul>'].join('\n')
    const out = md(html)
    expect(out.startsWith('## Course Syllabus\n\n**Instructor:** Dr. Pérez\nOffice hours: MW 10:00–11:30\n\n'), out).toBe(true)
    expect(out.includes('| **Exam 1** | Oct 8 |\n| --- | --- |\n| **Exam 2** | Nov 12 |'), out).toBe(true)
    expect(out.endsWith('- Calculator required\n- No phones'), out).toBe(true)
  })

  it('testUnbalancedHTMLDoesNotThrowAndKeepsText', () => {
    expect(md("<p>uno<p>dos<b>sin cerrar")).toBe("uno\n\ndos**sin cerrar**")
    expect(md("</div></p></span>texto")).toBe("texto")
    expect(md("<b><i>mal</b> anidado</i>")).toBe("***mal*** anidado")
  })

  it('testLooseAngleBracketsAreText', () => {
    expect(md("<p>si x < 5 y y > 3 entonces</p>")).toBe("si x < 5 y y > 3 entonces")
    expect(md("<p>1 <2 y 3< 4</p>")).toBe("1 <2 y 3< 4")
  })

  it('testUnterminatedTagAndAttributes', () => {
    expect(md("<p>antes</p><a href=\"x")).toBe("antes")
    expect(md("<p class=a id=\"b\" data-x='c'>ok</p>")).toBe("ok")
    expect(md("<P CLASS=\"X\">MAYÚSCULAS</P>")).toBe("MAYÚSCULAS")
    expect(md("<p>ok</p")).toBe("ok")
  })

  it('testEmptyAndWhitespaceInput', () => {
    expect(md("")).toBe("")
    expect(md("   \n  ")).toBe("")
    expect(md("<p></p><div> </div>")).toBe("")
  })

  it('testPlainTextInputKeepsParagraphs', () => {
    expect(md("Línea 1\nLínea 2\r\n\r\n\r\n\r\nLínea 5 &amp; fin")).toBe("Línea 1\nLínea 2\n\nLínea 5 & fin")
  })

  it('testVeryDeepNestingDoesNotCrash', () => {
    const html = "<div>".repeat(5000) + "profundo" + "</div>".repeat(5000)
    const out = md(html)
    expect(out.includes("profundo")).toBe(true)
  })

  it('testVeryDeepInlineNestingDoesNotCrash', () => {
    const html = "<p>" + "<span>".repeat(5000) + "hondo" + "</span>".repeat(5000) + "</p>"
    expect(md(html).includes("hondo")).toBe(true)
  })

  it('testLargeDocumentIsFastEnough', () => {
    let html = ''
    for (let i = 0; i < 3000; i++) html += `<h3>Sección ${i}</h3><p>Texto <b>importante</b> con <a href="https://x.com/${i}">enlace</a> y más texto &amp; símbolos.</p><ul><li>a</li><li>b</li></ul>`
    const t0 = Date.now()
    const out = md(html)
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(out.includes('### Sección 2999')).toBe(true)
  })

  it('testInputBeyondLimitIsTruncatedNotCrashing', () => {
    const html = "<p>inicio</p>" + "<p>x</p>".repeat(700_000)
    const out = md(html)
    expect(out.startsWith("inicio")).toBe(true)
  })

  it('testPlainTextModeHasNoMarkup', () => {
    const html = "<p>Hola <b>mundo</b> <a href=\"https://x.com/a\">enlace</a></p><ul><li>uno</li></ul><h2>Título</h2>"
    expect(plain(html)).toBe("Hola mundo enlace (https://x.com/a)\n\n- uno\n\nTítulo")
    expect(plain("<a href=\"https://x.com\">https://x.com</a>")).toBe("https://x.com")
  })

  it('testLooksLikeHTML', () => {
    expect(looksLikeHTML("<p>x</p>")).toBe(true)
    expect(looksLikeHTML("texto <br> más")).toBe(true)
    expect(looksLikeHTML("<!DOCTYPE html>")).toBe(true)
    expect(looksLikeHTML("2 < 3 y 5 > 4")).toBe(false)
    expect(looksLikeHTML("sin etiquetas")).toBe(false)
    expect(looksLikeHTML("a <b sin cerrar")).toBe(false)
    expect(looksLikeHTML("")).toBe(false)
  })
})

describe('HTML · entradas hostiles (RobustnessTests)', () => {
  const validHTML = '<h2>Título</h2><p>Hola <b>mundo</b> <a href="https://x.com/a?b=1&amp;c=2">enlace</a> <img class="equation_image" alt="LaTeX: x^2"></p><ul><li>uno<li>dos</ul><table><tr><td>a<td>b</table><pre>code\n  x</pre><math><mfrac><mn>1</mn><mn>2</mn></mfrac></math><!-- c --><script>x</script>'
  const mutate = (text: string, rng: LCG, edits: number): string => {
    const bytes = Array.from(new TextEncoder().encode(text))
    for (let k = 0; k < edits && bytes.length; k++) {
      const i = rng.below(bytes.length)
      switch (rng.below(4)) {
        case 0: bytes[i] = rng.byte(); break
        case 1: bytes.splice(i, 1); break
        case 2: bytes.splice(i, 0, rng.byte()); break
        default: { const j = rng.below(bytes.length); bytes.splice(i, 0, ...bytes.slice(Math.min(i, j), Math.max(i, j)).slice(0, 200)) }
      }
    }
    return new TextDecoder().decode(Uint8Array.from(bytes))
  }

  it('HTML mutado: sin fallos ni caracteres de control, y recortado', () => {
    const rng = new LCG(2024)
    for (let n = 0; n < 600; n++) {
      const text = mutate(validHTML, rng, rng.below(30) + 1)
      for (const o of [md(text), plain(text)]) {
        // eslint-disable-next-line no-control-regex
        expect(/[\u0000-\u0008\u000B-\u001F\u007F]/.test(o)).toBe(false)
        expect(o).toBe(o.trim())
      }
    }
  })

  it('el contenido de script y style bien formados nunca se cuela', () => {
    const rng = new LCG(77)
    const noise = ['<p>a</p>', 'texto', '<b>x</b>', '<!-- c -->', '<div>', '</div>', '<ul><li>1</ul>', '&amp;', '<br>', '<table><tr><td>z</table>']
    for (let n = 0; n < 300; n++) {
      let html = ''
      for (let k = 0; k < 10; k++) {
        html += noise[rng.below(noise.length)]
        if (rng.below(3) === 0) html += '<script>SECRETO_JS("</p>")</script>'
        if (rng.below(3) === 0) html += '<style>.SECRETO_CSS{color:red}</style>'
        if (rng.below(4) === 0) html += '<iframe src="https://x.com">SECRETO_IFRAME</iframe>'
      }
      expect(md(html)).not.toContain('SECRETO')
    }
  })

  it('sopa de etiquetas al azar', () => {
    const rng = new LCG(5)
    const tags = ['p', 'div', 'span', 'b', 'i', 'a', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'h1', 'pre', 'code', 'br', 'img', 'math', 'mfrac', 'sup', 'sub', 'blockquote', 'script', 'style', 'iframe', 'tbody']
    for (let n = 0; n < 300; n++) {
      let html = ''
      for (let k = 0; k < 80; k++) {
        const t = tags[rng.below(tags.length)]
        switch (rng.below(5)) {
          case 0: html += `<${t}>`; break
          case 1: html += `</${t}>`; break
          case 2: html += `<${t} class="x" href="https://a.b/c" alt='y' hidden>`; break
          case 3: html += `texto ${rng.below(100)} &amp; <`; break
          default: html += `<${t}/>`
        }
      }
      md(html)
    }
  })
})
