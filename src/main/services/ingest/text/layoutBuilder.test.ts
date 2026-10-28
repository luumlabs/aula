import { describe, expect, it } from 'vitest'
import { filterHeadersAndFooters } from './headerFooter'
import { bodyHeight, buildLayout, readingOrder, type TextLine } from './layoutBuilder'
import { isMarkerOnly } from './textCleaner'

const charW = 6, lineH = 12
const line = (text: string, x = 72, y = 0, h?: number, w?: number): TextLine => ({ text, rect: { x, y, width: w ?? Array.from(text).length * charW, height: h ?? lineH } })
const maxY = (l: TextLine): number => l.rect.y + l.rect.height

function wrapped(text: string, cols: number, x = 72, y0 = 100, step = 14, justify = false): TextLine[] {
  const lines: string[] = []
  let current = ''
  for (const word of text.split(' ')) {
    if (!current) current = word
    else if (Array.from(current).length + 1 + Array.from(word).length <= cols) current += ' ' + word
    else { lines.push(current); current = word }
  }
  if (current) lines.push(current)
  return lines.map((t, i) => line(t, x, y0 + i * step, undefined, justify && i < lines.length - 1 ? cols * charW : undefined))
}

const prose = 'La trigonometría estudia las relaciones entre los lados y los ángulos de los triángulos. El teorema de Pitágoras establece que en todo triángulo rectángulo el cuadrado de la hipotenusa es igual a la suma de los cuadrados de los catetos.'

describe('LayoutBuilder', () => {
  it('une los párrafos partidos (también justificados)', () => {
    expect(buildLayout(wrapped(prose, 60)).text).toBe(prose)
    expect(buildLayout(wrapped(prose, 60, 72, 100, 14, true)).text).toBe(prose)
  })

  it('separa dos párrafos', () => {
    const lines = wrapped(prose, 60)
    lines.push(...wrapped('Segundo párrafo, separado del primero por un espacio vertical mayor que el interlineado normal del texto.', 60, 72, maxY(lines[lines.length - 1]) + 14))
    const text = buildLayout(lines).text
    expect(text.split('\n\n')).toHaveLength(2)
    expect(text.startsWith('La trigonometría')).toBe(true)
    expect(text.endsWith('normal del texto.')).toBe(true)
  })

  it('no mezcla las fórmulas', () => {
    const formulas = ['sen²θ + cos²θ = 1', 'tan θ = sen θ / cos θ', '1 + tan²θ = sec²θ', 'cot θ = cos θ / sen θ', 'sen 2θ = 2 sen θ cos θ', 'cos 2θ = cos²θ − sen²θ']
    expect(buildLayout(formulas.map((f, i) => line(f, 72, 100 + i * 16))).text).toBe(formulas.join('\n'))
    const lines = wrapped('Recuerda las identidades fundamentales que usaremos en toda la unidad de trigonometría del curso.', 60)
    let y = maxY(lines[lines.length - 1]) + 14
    for (const f of ['sen²θ + cos²θ = 1', '1 + tan²θ = sec²θ']) { lines.push(line(f, 72, y)); y += 16 }
    expect(buildLayout(lines).text.endsWith('sen²θ + cos²θ = 1\n1 + tan²θ = sec²θ')).toBe(true)
  })

  it('índices con puntos guía y viñetas, una línea cada uno', () => {
    const toc = ['Capítulo 1 Funciones ....................................... 5', 'Capítulo 2 Trigonometría ................................... 31', 'Capítulo 3 Límites ......................................... 77']
    expect(buildLayout(toc.map((t, i) => line(t, 72, 100 + i * 14))).text).toBe(toc.join('\n'))
    const items = ['• Funciones trigonométricas de ángulos agudos en un triángulo', '• Identidades y ecuaciones trigonométricas para resolver', '● Triángulos oblicuos: ley de senos y de cosenos para el área']
    const text = buildLayout(items.map((t, i) => line(t, 72, 100 + i * 14))).text
    expect(text.split('\n').map((l) => l.slice(0, 2))).toEqual(['- ', '- ', '- '])
  })

  it('guiones de partición y de palabras compuestas', () => {
    const text = buildLayout([line('el teorema de Pitágoras es un resultado fundamental de la matemá-', 72, 100), line('tica elemental y se enseña en todos los colegios del mundo entero.', 72, 114)]).text
    expect(text).toBe('el teorema de Pitágoras es un resultado fundamental de la matemática elemental y se enseña en todos los colegios del mundo entero.')
    const a = buildLayout([line('las ecuaciones de Navier- con muchas palabras para ocupar toda la línea disponible aquí', 72, 100), line('Stokes describen el movimiento de los fluidos viscosos en la naturaleza real.', 72, 114)]).text
    expect(a).toContain('Navier- con')
    const b = buildLayout([line('las ecuaciones de Navier- con muchas palabras para ocupar toda la línea de arriba-', 72, 100), line('Stokes describen todo el movimiento de los fluidos viscosos en la naturaleza real', 72, 114)]).text
    expect(b).toContain('arriba-Stokes')
  })

  it('un párrafo sangrado empieza un párrafo nuevo', () => {
    const first = wrapped('Primer párrafo con suficiente texto para ocupar varias líneas completas dentro de la columna visible del documento.', 60)
    const second = wrapped('Segundo párrafo sangrado al empezar y sin línea en blanco previa que lo separe del anterior en la página.', 56, 96, maxY(first[first.length - 1]) + 2)
    const all = [...first, ...second.map((l, i) => (i > 0 ? { ...l, rect: { ...l.rect, x: 72 } } : l))]
    expect(buildLayout(all).text.split('\n\n')).toHaveLength(2)
  })

  it('dos columnas: izquierda y luego derecha (también con un título encima)', () => {
    const left = wrapped('Columna izquierda: el primer párrafo de la página que sigue hasta el final de esta columna con bastante texto.', 38, 72)
    const right = wrapped('Columna derecha: continúa la lectura aquí una vez terminada la anterior, también con bastante texto de relleno.', 38, 340)
    const lines: TextLine[] = []
    for (let i = 0; i < Math.max(left.length, right.length); i++) { if (left[i]) lines.push(left[i]); if (right[i]) lines.push(right[i]) }
    const text = buildLayout(lines).text
    expect(text.indexOf('Columna izquierda')).toBeLessThan(text.indexOf('Columna derecha'))
    expect(text).toContain('hasta el final de esta columna con bastante texto.')
    expect(text.endsWith('también con bastante texto de relleno.')).toBe(true)
    expect(text.split('\n\n')).toHaveLength(2)

    const title = line('Un título centrado sobre las dos columnas de texto de la página', 120, 60, 20, 380)
    const l2 = wrapped('Texto de la columna izquierda con varias frases que se reparten en líneas cortas de la columna.', 38, 72)
    const r2 = wrapped('Texto de la columna derecha con otras frases que también se reparten en líneas cortas.', 38, 340)
    const withTitle = [title]
    for (let i = 0; i < Math.max(l2.length, r2.length); i++) { if (l2[i]) withTitle.push(l2[i]); if (r2[i]) withTitle.push(r2[i]) }
    const t2 = buildLayout(withTitle).text
    const pos = ['Un título', 'columna izquierda', 'columna derecha'].map((s) => t2.indexOf(s))
    expect(pos[0]).toBeLessThan(pos[1])
    expect(pos[1]).toBeLessThan(pos[2])
  })

  it('una columna con líneas cortas no se parte', () => {
    expect(buildLayout(Array.from({ length: 10 }, (_, i) => line(i % 2 === 0 ? 'x = 1' : 'y = 2', 72, 100 + i * 14))).text.split('\n')).toHaveLength(10)
  })

  it('filas de tabla y marcadores colgados', () => {
    const header = [line('Vértice', 72, 100), line('Foco', 200, 100), line('Directriz', 320, 100), line('Ecuación', 450, 100)]
    const row = [line('(h, k)', 72, 120), line('(h + a, k)', 200, 120), line('x = h − a', 320, 120), line('(y − k)² = 4a(x − h)', 450, 120)]
    expect(buildLayout([...header, ...row]).text).toBe('Vértice | Foco | Directriz | Ecuación\n(h, k) | (h + a, k) | x = h − a | (y − k)² = 4a(x − h)')
    const rows: Array<[string[], number]> = [[['2.', 'Licencia de uso interno y restricciones'], 100], [['2.1', 'Autoridad para firmar acuerdos'], 120], [['(a)', 'Primer apartado del texto legal'], 140], [['•', 'Un punto con viñeta separada'], 160]]
    const lines = rows.flatMap(([parts, y]) => [line(parts[0], 72, y), line(parts[1], 142, y)])
    expect(buildLayout(lines).text).toBe('2. Licencia de uso interno y restricciones\n2.1 Autoridad para firmar acuerdos\n(a) Primer apartado del texto legal\n- Un punto con viñeta separada')
    for (const s of ['2.', '2.1', '3.4.5.', 'a)', '(iv)', 'A.', '•', '–', '(1)', '12.']) expect(isMarkerOnly(s), s).toBe(true)
    for (const s of ['', 'texto', 'Capítulo', 'x = 1', '2 + 3', '1234567', 'sen θ', 'Fig.']) expect(isMarkerOnly(s), s).toBe(false)
    expect(buildLayout([line('sen', 72, 100), line('θ = 1/2', 72 + 3 * charW + 4, 100)]).text).toBe('sen θ = 1/2')
  })

  it('títulos por tamaño', () => {
    const lines = [line('Capítulo 3: Trigonometría', 72, 60, 24)]
    lines.push(...wrapped('Este capítulo presenta las funciones trigonométricas y sus principales propiedades con ejemplos resueltos.', 60, 72, 100))
    lines.push(line('Funciones básicas', 72, 150, 17))
    lines.push(...wrapped('El seno y el coseno se definen a partir de la circunferencia unitaria y se extienden a todos los reales.', 60, 72, 180))
    const layout = buildLayout(lines)
    expect(layout.text.startsWith('# Capítulo 3: Trigonometría\n\nEste capítulo')).toBe(true)
    expect(layout.text.includes('## Funciones básicas') || layout.text.includes('### Funciones básicas')).toBe(true)
    expect(layout.firstHeading).toBe('Capítulo 3: Trigonometría')
    const body = wrapped(prose, 60)
    expect(buildLayout(body).firstHeading).toBeNull()
    expect(buildLayout(body).text).not.toContain('#')
    const big = line('Título grande', 72, 60, 20)
    expect(buildLayout([big, ...body]).text.startsWith('#')).toBe(true)
    expect(buildLayout([big, ...body], false).text).not.toContain('#')
    expect(buildLayout([big, ...body], true, 2.0).text).not.toContain('#')
    const vertical: TextLine = { text: 'Eje vertical rotado', rect: { x: 20, y: 200, width: 12, height: 150 } }
    expect(buildLayout([...body, vertical]).text).not.toContain('# ')
  })

  it('una línea corta y una palabra larga no son un párrafo partido', () => {
    expect(buildLayout([line('Resumen del tema', 72, 100), line('Trigonométricamente', 72, 114)]).text).toBe('Resumen del tema\nTrigonométricamente')
  })

  it('entradas degeneradas', () => {
    expect(buildLayout([]).text).toBe('')
    const bad: TextLine[] = [
      { text: 'x', rect: { x: NaN, y: 0, width: 10, height: 10 } }, { text: 'y', rect: { x: 0, y: 0, width: 0, height: 10 } },
      { text: '   ', rect: { x: 0, y: 0, width: 10, height: 10 } }, { text: 'ok', rect: { x: 0, y: 0, width: 20, height: 10 } },
      { text: 'inf', rect: { x: 0, y: 0, width: Infinity, height: 10 } }
    ]
    expect(buildLayout(bad).text).toBe('ok')
  })

  it('orden de lectura', () => {
    const a = line('abajo izquierda', 72, 300), b = line('arriba', 72, 100), c = line('medio derecha', 300, 200), d = line('medio izquierda', 72, 200)
    expect(readingOrder([a, b, c, d]).map((l) => l.text)).toEqual(['arriba', 'medio izquierda', 'medio derecha', 'abajo izquierda'])
    expect(readingOrder([])).toHaveLength(0)
  })

  it('una página enorme es rápida', () => {
    const lines: TextLine[] = []
    for (let i = 0; i < 1500; i++) {
      lines.push(line(`Línea de columna izquierda número ${i} con bastante texto de relleno aquí`, 72, 100 + i * 14))
      lines.push(line(`Línea de columna derecha número ${i} con bastante texto de relleno aquí.`, 400, 100 + i * 14))
    }
    const t0 = performance.now()
    const text = buildLayout(lines).text
    expect(performance.now() - t0).toBeLessThan(8000)          // holgado: las pruebas corren en paralelo
    expect(text).toContain('izquierda número 1499')
  })

  it('la altura del cuerpo no cuenta los títulos', () => {
    const lines = [line('Título muy grande', 72, 0, 40), ...Array.from({ length: 10 }, (_, i) => line(`Texto normal de cuerpo número ${i} con palabras`, 72, 50 + i * 14, 11))]
    expect(bodyHeight(lines)).toBe(11)
  })
})

describe('Cabeceras y pies', () => {
  const H = (n: number): number[] => Array(n).fill(792)

  it('quita la cabecera repetida y el número de página', () => {
    const page = (n: number): TextLine[] => [line('Curso de Trigonometría — Apuntes', 72, 30), line(`Contenido propio de la página ${n} con texto suficiente.`, 72, 300), line(`Otro renglón de la página ${n}.`, 72, 320), line(String(n), 300, 750)]
    const out = filterHeadersAndFooters([1, 2, 3, 4, 5, 6].map(page), H(6))
    for (const p of out) {
      expect(p).toHaveLength(2)
      expect(p.some((l) => l.text.includes('Curso de'))).toBe(false)
    }
  })

  it('pies con el número de página cambiando', () => {
    const page = (n: number): TextLine[] => [line(`Tema 3 — Página ${n}`, 72, 760), line(`Texto de la página número ${n} que es distinto cada vez`, 72, 300)]
    expect(filterHeadersAndFooters([1, 2, 3, 4, 5].map(page), H(5)).every((p) => p.length === 1 && p[0].text.startsWith('Texto'))).toBe(true)
  })

  it('conserva las líneas únicas de arriba', () => {
    const tops = ['Introducción', 'Desarrollo', 'Ejemplos', 'Ejercicios', 'Conclusión']
    const pages = tops.map((t, n) => [line(t, 72, 30), line(`Cuerpo ${n + 1}`, 72, 300)])
    expect(filterHeadersAndFooters(pages, H(5)).every((p) => p.length === 2)).toBe(true)
  })

  it('con pocas páginas no supone cabecera, pero sí quita el número', () => {
    const two = [[line('Encabezado', 72, 30), line('a', 72, 300), line('1', 72, 750)], [line('Encabezado', 72, 30), line('b', 72, 300), line('2', 72, 750)]]
    const out = filterHeadersAndFooters(two, [792, 792])
    expect(out[0].map((l) => l.text)).toEqual(['Encabezado', 'a'])
    expect(out[1].map((l) => l.text)).toEqual(['Encabezado', 'b'])
  })

  it('no mira el centro de la página', () => {
    const page = (n: number): TextLine[] => [line('Repetido en medio de la página', 72, 400), line(`Distinto ${n}`, 72, 100)]
    expect(filterHeadersAndFooters([1, 2, 3, 4, 5, 6].map(page), H(6)).every((p) => p.length === 2)).toBe(true)
  })
})
