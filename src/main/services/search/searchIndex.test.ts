import { describe, expect, it } from 'vitest'
import type { SourceChunk } from '@shared/ingest'
import { isIngestError } from '../ingest/errors'
import { SearchIndex, type SearchHit } from './searchIndex'
import { codePoints, fold, fromCodePoints, stemWord, STOPWORDS, terms, tokenize } from './text'

const t = terms

describe('Tokenizador', () => {
  it('mayúsculas, tildes y palabras vacías', () => {
    expect(t('Función Trigonométrica ÁNGULO')).toEqual(['funcion', 'trigonometric', 'angul'])
    expect(t('el seno de la hipotenusa')).toEqual(['seno', 'hipotenus'])
    expect(t('The square of the hypotenuse is equal to the sum')).toEqual(['squar', 'hypotenus', 'equal', 'sum'])
    expect(t('Pitágoras')).toEqual(t('PITAGORAS'))
    expect(t('año')).toEqual(t('ano'))
    expect(t('ñandú')).toEqual(t('nandu'))
    expect(t('Straße')).toEqual(['strass'])
  })

  it('los nombres de funciones matemáticas no son palabras vacías', () => {
    expect(t('sin x')).toEqual(['sin', 'x'])
    expect(t('tan θ')).toEqual(['tan', 'theta'])
    expect(t('cos 2x')).toEqual(['cos', '2x'])
    expect(t('e^x + i')).toEqual(['e^x', 'i'])
    expect(STOPWORDS.has('de')).toBe(true)
    for (const w of ['sin', 'tan', 'e', 'i']) expect(STOPWORDS.has(w), w).toBe(false)
  })

  it('potencias y subíndices', () => {
    for (const s of ['x^2', 'x²', 'x^{2}', 'x**2', 'x^(2)', 'X^2']) expect(t(s), s).toEqual(['x^2'])
    expect(t('e^x')).toEqual(['e^x'])
    expect(t('x^-1')).toEqual(['x^-1'])
    expect(t('x^{n+1}')).toEqual(['x^n+1'])
    expect(t('a² + b² = c²')).toEqual(['a^2', 'b^2', 'c^2'])
    expect(t('sin^2θ')).toEqual(['sin^2', 'sin', 'theta'])
    expect(t('x^2 + 3x - 2')).toEqual(['x^2', '3x', '2'])
    expect(t('x_1')).toEqual(['x_1'])
    expect(t('x₁')).toEqual(['x_1'])
    expect(t('a_n')).toEqual(['a_n'])
    expect(t('x_{12}')).toEqual(['x_12'])
    expect(t('log_2 x')).toEqual(['log_2', 'log', 'x'])
    expect(t('snake_case_name')).toEqual(['snak', 'case', 'name'])
  })

  it('números', () => {
    expect(t('3.14')).toEqual(['3.14'])
    expect(t('3,14')).toEqual(['3.14'])
    expect(t('1,000')).toEqual(['1.000'])
    expect(t('1/2 y 3/4')).toEqual(['1/2', '3/4'])
    expect(t('-3 y +5')).toEqual(['3', '5'])
    expect(t('50%')).toEqual(['50'])
    expect(t('12/05/2026')).toEqual(['12/05/2026'])
    expect(t('MATH140 y b2b')).toEqual(['math140', 'b2b'])
    expect(t('2x')).toEqual(['2x'])
    expect(t('fin. 3.5')).toEqual(['fin', '3.5'])
    expect(t('٣٤')).toEqual(['34'])
  })

  it('letras griegas y símbolos', () => {
    expect(t('π θ Θ α β γ λ μ µ ω')).toEqual(['pi', 'theta', 'theta', 'alpha', 'beta', 'gamma', 'lambda', 'mu', 'mu', 'omega'])
    expect(t('sinθ')).toEqual(['sin', 'theta'])
    expect(t('2π')).toEqual(['2', 'pi'])
    expect(t('πr²')).toEqual(['pi', 'r^2'])
    expect(t('√x ∑ ∫ ∞ ∂')).toEqual(['sqrt', 'x', 'sum', 'integral', 'infinity', 'partial'])
    expect(t('θεώρημα')).toHaveLength(1)
    expect(t('≤ ≥ ≠ ± → ()')).toEqual([])
  })

  it('apóstrofos, puntuación, CJK y vacíos', () => {
    expect(t("don't it's l'été j'ai")).toEqual(['don', 'ete', 'ai'])
    expect(t('hola, mundo! ¿qué tal? (sí) «ok» — fin')).toEqual(['hola', 'mund', 'tal', 'ok', 'fin'])
    expect(t('semi-circular')).toEqual(['semi', 'circular'])
    expect(t('日本語')).toEqual(['日', '本', '語'])
    for (const s of ['', '   \n\t ', '... --- !!!', 'a'.repeat(200)]) expect(t(s)).toEqual([])
  })

  it('los rangos apuntan al texto original', () => {
    const text = 'El teorema de Pitágoras: a² + b² = c².'
    const cps = codePoints(text)
    for (const tok of tokenize(text)) {
      const original = fromCodePoints(cps, tok.lo, tok.hi)
      expect(original.length).toBeGreaterThan(0)
      expect(['teorem', 'pitagor', 'a^2', 'b^2', 'c^2']).toContain(tok.term)
      expect(t(original)).toEqual([tok.term])
    }
  })

  it('pliegue sin raíz, rapidez y entradas hostiles', () => {
    expect(fold('Función')).toBe('funcion')
    expect(fold('¿Qué?')).toBe('que')
    expect(fold('Æsir Œuvre')).toBe('aesiroeuvre')
    const text = 'La función derivada de x² + 3x − 2 es 2x + 3, y el área bajo la curva sen(θ) vale 3,14 aproximadamente. '.repeat(15_000)
    const t0 = performance.now()
    expect(t(text).length).toBeGreaterThan(150_000)
    expect(performance.now() - t0).toBeLessThan(10_000)
    const pool = Array.from('aA1_^{}()*/.,-+\'’ θπ²₁√∑日é́‍👩 \n')
    let seed = 1
    const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    for (let k = 0; k < 2000; k++) {
      let s = ''
      for (let i = 0; i < rnd(61); i++) s += pool[rnd(pool.length)]
      const n = codePoints(s).length
      for (const tok of tokenize(s)) expect(tok.lo >= 0 && tok.hi <= n && tok.lo < tok.hi, JSON.stringify(s)).toBe(true)
    }
  })
})

describe('Raíces', () => {
  const sameStem = (words: string[]): void => expect(new Set(words.map(stemWord)).size, `${words} → ${words.map(stemWord)}`).toBe(1)

  it('las flexiones comparten raíz', () => {
    for (const ws of [['funcion', 'funciones'], ['triangle', 'triangles'], ['derivada', 'derivadas', 'derivado', 'derivados'], ['study', 'studies'], ['serie', 'series'], ['solve', 'solves', 'solved', 'solving'],
      ['class', 'classes'], ['theory', 'theories'], ['probability', 'probabilities'], ['angle', 'angles'], ['circle', 'circles'], ['gas', 'gases'], ['valor', 'valores'], ['running', 'run'], ['seno', 'senos'],
      ['ecuacion', 'ecuaciones'], ['limite', 'limites'], ['parabola', 'parabolas'], ['quick', 'quickly'], ['claro', 'claramente']]) sameStem(ws)
  })

  it('plurales irregulares de matemáticas', () => {
    for (const ws of [['vertex', 'vertices'], ['matrix', 'matrices', 'matriz'], ['index', 'indices'], ['axis', 'axes'], ['analysis', 'analyses'], ['focus', 'foci'], ['radius', 'radii'], ['hypothesis', 'hypotheses'], ['formula', 'formulae'], ['raiz', 'raices']]) sameStem(ws)
  })

  it('palabras distintas siguen distintas; lo corto no se toca', () => {
    for (const [a, b] of [['mesa', 'mes'], ['sine', 'sin'], ['seno', 'senior'], ['derivada', 'integral'], ['thing', 'th']]) expect(stemWord(a)).not.toBe(stemWord(b))
    for (const w of ['x', 'sin', 'cos', 'ln', 'pi', 'x^2', 'math140', '3.14', 'a_n', '日本', 'θεωρημα']) expect(stemWord(w), w).toBe(w)
    expect(stemWord('ases').length).toBeGreaterThanOrEqual(3)
    expect(stemWord('')).toBe('')
  })
})

const chunk = (id: string, text: string, source = 's1', ordinal = 0, heading?: string, page: number | undefined = 1): SourceChunk => {
  const c: SourceChunk = { id, sourceID: source, ordinal, text }
  if (page !== undefined) c.page = page
  if (heading !== undefined) c.heading = heading
  return c
}
const corpus: SourceChunk[] = [
  chunk('pit', 'El teorema de Pitágoras relaciona los catetos y la hipotenusa de un triángulo rectángulo: a² + b² = c².', 's1', 0),
  chunk('der', 'La derivada de una función mide su razón de cambio instantánea. La derivada del seno es el coseno.', 's1', 1),
  chunk('tri', 'Las funciones trigonométricas seno, coseno y tangente se definen sobre la circunferencia unitaria.', 's1', 2),
  chunk('eng', 'The Pythagorean theorem states that the square of the hypotenuse equals the sum of the squares of the legs.', 's2', 0),
  chunk('int', 'La integral definida calcula el área bajo la curva entre dos límites.', 's1', 3),
  chunk('par', 'Una parábola es el conjunto de puntos equidistantes de un foco y una directriz. Su ecuación es y = x².', 's2', 1)
]
const ids = (hits: SearchHit[]): string[] => hits.map((h) => h.chunk.id)

describe('Índice BM25: relevancia', () => {
  const index = new SearchIndex(corpus)

  it('relevancia básica, tildes y mayúsculas', () => {
    expect(index.count).toBe(6)
    expect(ids(index.search('teorema de Pitágoras'))[0]).toBe('pit')
    expect(ids(index.search('hipotenusa'))).toEqual(['pit'])
    expect(ids(index.search('hypotenuse theorem'))[0]).toBe('eng')
    expect(ids(index.search('área bajo la curva'))[0]).toBe('int')
    expect(ids(index.search('parábola directriz foco'))[0]).toBe('par')
    expect(ids(index.search('pitagoras'))).toEqual(ids(index.search('PITÁGORAS')))
    expect(ids(index.search('TRIÁNGULO'))[0]).toBe('pit')
    expect(['der', 'tri']).toContain(ids(index.search('funcion'))[0])
    expect(ids(index.search('limites'))[0]).toBe('int')
  })

  it('raíces, consultas bilingües y fórmulas', () => {
    expect(ids(index.search('funciones derivada')).slice(0, 2)).toContain('der')
    expect(ids(index.search('squares'))[0]).toBe('eng')
    expect(ids(index.search('derivadas'))[0]).toBe('der')
    expect(['der', 'tri']).toContain(ids(index.search('senos'))[0])
    expect(ids(index.search('a^2 + b^2'))[0]).toBe('pit')
    expect(ids(index.search('a² b²'))[0]).toBe('pit')
    expect(ids(index.search('x²'))[0]).toBe('par')
    expect(ids(index.search('y = x^2'))[0]).toBe('par')
    expect(ids(index.search('c^{2}'))[0]).toBe('pit')
  })

  it('decimales, letras griegas, TF e IDF, longitud y títulos', () => {
    const nums = new SearchIndex([chunk('a', 'El valor de pi es aproximadamente 3,14 en este libro.'), chunk('b', 'Otra cifra: 2,71 es el número e.')])
    expect(ids(nums.search('3.14'))).toEqual(['a'])
    expect(ids(nums.search('3,14'))).toEqual(['a'])
    expect(ids(nums.search('2.71'))).toEqual(['b'])
    const greek = new SearchIndex([chunk('a', 'El área del círculo es πr² donde r es el radio.'), chunk('b', 'El ángulo θ se mide en radianes desde el eje x.')])
    expect(ids(greek.search('pi'))[0]).toBe('a')
    expect(ids(greek.search('π'))[0]).toBe('a')
    expect(ids(greek.search('theta'))[0]).toBe('b')
    expect(ids(greek.search('θ'))[0]).toBe('b')
    const tfidf = new SearchIndex([chunk('uno', 'teorema teorema teorema de la geometría plana y poco más aquí', 's1', 0), chunk('dos', 'teorema de la geometría plana y poco más aquí en este caso', 's1', 1),
      chunk('tres', 'el teorema nada que ver con el resto del contenido sobre otros asuntos', 's1', 2), chunk('cuatro', 'hipotenusa rara aparece solo en este fragmento sobre triángulos', 's1', 3)])
    expect(ids(tfidf.search('teorema'))[0]).toBe('uno')
    const idf = tfidf.search('teorema hipotenusa')
    expect(idf[0].chunk.id).toBe('cuatro')
    expect(idf).toHaveLength(4)
    const long = 'relleno sin interés para la consulta '.repeat(60)
    expect(ids(new SearchIndex([chunk('largo', 'seno ' + long, 's1', 0), chunk('corto', 'seno y coseno', 's1', 1)]).search('seno'))).toEqual(['corto', 'largo'])
    const headed = new SearchIndex([chunk('cuerpo', 'En este apartado se menciona el círculo unidad una vez entre muchas otras cosas distintas.', 's1', 0, 'Repaso general'),
      chunk('titulo', 'Aquí se explican muchas otras cosas distintas sin nombrar el tema directamente en el cuerpo.', 's1', 1, 'Círculo unidad')])
    const hits = headed.search('círculo unidad')
    expect(hits).toHaveLength(2)
    expect(hits[0].chunk.id).toBe('titulo')
  })
})

describe('Índice BM25: frases, prefijos, filtros', () => {
  const index = new SearchIndex(corpus)

  it('frases', () => {
    expect(ids(index.search('"razón de cambio"'))).toEqual(['der'])
    expect(ids(index.search('"razon de cambio"'))).toEqual(['der'])
    expect(ids(index.search('"cambio razón"'))).toEqual([])
    expect(ids(index.search('"circunferencia unitaria" seno'))).toEqual(['tri'])
    expect(ids(index.search('“teorema de Pitágoras”'))).toEqual(['pit'])
    expect(ids(index.search('«cuadrado de la hipotenusa»'))).toEqual([])
    expect(ids(index.search('"sum of the squares"'))).toEqual(['eng'])
    expect(ids(index.search('"seno y coseno"'))).toEqual([])
    expect(ids(index.search('"seno coseno"'))).toEqual(['tri'])
    expect(ids(index.search('"seno es el coseno"'))).toEqual(['der'])
    expect(ids(index.search('"el coseno"'))).toEqual(['der'])
    expect(ids(index.search('"razón de cambio'))).toEqual(['der'])
    expect(['der', 'tri']).toContain(ids(index.search('"" seno'))[0])
    expect(ids(index.search('"'))).toEqual([])
  })

  it('prefijos explícitos e implícitos', () => {
    expect(ids(index.search('deriv*'))).toEqual(['der'])
    expect(ids(index.search('trigonom*'))).toEqual(['tri'])
    expect(ids(index.search('hipot*'))).toEqual(['pit'])
    expect(ids(index.search('zzz*'))).toEqual([])
    expect(new Set(ids(index.search('tri*')))).toEqual(new Set(['pit', 'tri']))
    expect(ids(index.search('trigonom'))).toEqual(['tri'])
    expect(ids(index.search('hipoten'))).toEqual(['pit'])
    expect(ids(index.search('xyzq'))).toEqual([])
  })

  it('filtro por fuente y límites', () => {
    expect(ids(index.search('teorema theorem', { sourceIDs: ['s2'] }))).toEqual(['eng'])
    expect(ids(index.search('teorema theorem', { sourceIDs: ['s1'] }))).toEqual(['pit'])
    expect(index.search('teorema theorem', { sourceIDs: ['s1', 's2'] })).toHaveLength(2)
    expect(index.search('teorema theorem', { sourceIDs: ['otra'] })).toEqual([])
    expect(index.search('teorema theorem', { sourceIDs: [] })).toEqual([])
    expect(index.search('teorema theorem')).toHaveLength(2)
    expect(index.search('coseno función seno derivada triángulo', { limit: 2 })).toHaveLength(2)
    expect(index.search('seno', { limit: 0 })).toHaveLength(0)
    expect(index.search('seno', { limit: -3 })).toHaveLength(0)
    expect(index.search('seno', { limit: 1000 })).toHaveLength(2)
  })

  it('consultas vacías, orden determinista y puntuaciones', () => {
    for (const q of ['', '   ', 'de la el', '?!?', '()', '*', '""']) expect(ids(index.search(q)), JSON.stringify(q)).toEqual([])
    expect(new SearchIndex([]).search('seno')).toEqual([])
    expect(new SearchIndex([]).count).toBe(0)
    const same = 'texto idéntico sobre el seno y el coseno'
    const chunks = [chunk('c', same, 'b', 1), chunk('a', same, 'a', 5), chunk('b', same, 'a', 2), chunk('d', same, 'b', 0)]
    for (const order of [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1]]) expect(ids(new SearchIndex(order.map((i) => chunks[i])).search('seno'))).toEqual(['b', 'a', 'd', 'c'])
    const r1 = new SearchIndex(corpus).search('seno coseno función'), r2 = new SearchIndex([...corpus].reverse()).search('seno coseno función')
    expect(ids(r1)).toEqual(ids(r2))
    expect(r1.map((h) => h.score)).toEqual(r2.map((h) => h.score))
    const hits = index.search('seno coseno derivada teorema triángulo curva')
    expect(hits.length).toBeGreaterThan(3)
    expect(hits.map((h) => h.score)).toEqual([...hits.map((h) => h.score)].sort((a, b) => b - a))
    expect(hits.every((h) => h.score > 0)).toBe(true)
  })
})

describe('Índice BM25: fragmentos resaltados', () => {
  it('resalta, funde y acorta', () => {
    const filler = 'Texto de relleno sin relación alguna con la búsqueda. '.repeat(30)
    const hit = new SearchIndex([chunk('a', filler + 'La función seno es periódica con periodo 2π y su derivada es el coseno. ' + filler)]).search('función seno')[0]
    expect(hit.snippet).toContain('**función seno**')
    expect(Array.from(hit.snippet).length).toBeLessThanOrEqual(260)
    expect(Array.from(hit.snippet).length).toBeGreaterThan(100)
    expect(hit.snippet.startsWith('…') && hit.snippet.endsWith('…')).toBe(true)
    expect(hit.snippet).not.toContain('\n')
  })

  it('formas flexionadas, fragmentos cortos y la ventana con más términos', () => {
    expect(new SearchIndex([chunk('a', 'Las funciones trigonométricas son periódicas y sus derivadas también.')]).search('función derivada')[0].snippet).toBe('Las **funciones** trigonométricas son periódicas y sus **derivadas** también.')
    expect(new SearchIndex([chunk('a', 'El seno de 30° vale 1/2.')]).search('seno')[0].snippet).toBe('El **seno** de 30° vale 1/2.')
    const far = 'relleno que no dice nada de nada. '.repeat(25)
    const hit = new SearchIndex([chunk('a', 'Al principio solo aparece el seno. ' + far + 'Más adelante coinciden el seno y el coseno y la tangente juntos en una frase. ' + far)]).search('seno coseno tangente')[0]
    expect(hit.snippet).toContain('**coseno**')
    expect(hit.snippet).toContain('**tangente**')
  })

  it('fórmulas, asteriscos escapados y frases', () => {
    const hit = new SearchIndex([chunk('a', 'Resultado: 2*3 = 6 y a² + b² = c² en el teorema.')]).search('b^2')[0]
    expect(hit.snippet).toContain('**b²**')
    expect(hit.snippet).toContain('2∗3')
    const phrase = new SearchIndex(corpus).search('"razon de cambio"')[0]
    expect(phrase.snippet).toContain('**razón**')
    expect(phrase.snippet).toContain('**cambio**')
  })
})

describe('Índice BM25: altas, bajas y persistencia', () => {
  it('altas, bajas y sustituciones', () => {
    const index = new SearchIndex(corpus.slice(0, 3))
    expect(index.count).toBe(3)
    expect(index.search('Pythagorean')).toEqual([])
    index.add([corpus[3], corpus[4]])
    expect(index.count).toBe(5)
    expect(ids(index.search('Pythagorean'))).toEqual(['eng'])
    index.add([chunk('pit', 'Texto completamente nuevo sobre logaritmos y exponenciales.', 's1', 0)])
    expect(index.count).toBe(5)
    expect(ids(index.search('logaritmos'))).toEqual(['pit'])
    expect(index.search('hipotenusa')).toEqual([])
    index.remove('s2')
    expect(index.count).toBe(4)
    index.remove('no-existe')
    expect(index.count).toBe(4)
    index.remove('s1')
    expect(index.count).toBe(0)
    index.add(corpus)
    expect(ids(index.search('teorema Pitágoras'))[0]).toBe('pit')
    const dup = new SearchIndex([chunk('x', 'primera versión con manzanas'), chunk('x', 'segunda versión con naranjas')])
    expect(dup.count).toBe(1)
    expect(ids(dup.search('naranjas'))).toEqual(['x'])
    expect(dup.search('manzanas')).toEqual([])
  })

  it('muchas altas y bajas, y compactación', () => {
    const index = new SearchIndex([])
    for (let round = 0; round < 12; round++) {
      index.add(Array.from({ length: 60 }, (_, i) => chunk(`r${round}-${i}`, `ronda ${round} fragmento ${i} sobre derivadas e integrales número${i % 7}`, `src${round}`, i)))
      if (round % 2 === 1) index.remove(`src${round - 1}`)
    }
    expect(index.count).toBe(360)
    expect(index.search('ronda 4', { sourceIDs: ['src4'] })).toEqual([])
    expect(index.search('derivadas', { limit: 1000 })).toHaveLength(360)
    expect(ids(index.search('fragmento 59 ronda', { limit: 1000, sourceIDs: ['src11'] }))).toContain('r11-59')
    const big = new SearchIndex([...Array.from({ length: 900 }, (_, i) => chunk(`a${i}`, `alfa bravo charlie ${i}`, 'A', i)), ...Array.from({ length: 100 }, (_, i) => chunk(`b${i}`, `delta eco foxtrot ${i}`, 'B', i))])
    big.remove('A')
    expect(big.count).toBe(100)
    expect(big.search('delta', { limit: 200 })).toHaveLength(100)
    expect(big.search('alfa')).toHaveLength(0)
    big.add([chunk('c0', 'gamma hotel india', 'C')])
    expect(ids(big.search('hotel'))).toEqual(['c0'])
    expect(big.count).toBe(101)
  })

  it('ida y vuelta, compresión, versiones anteriores y JSON plano', () => {
    const index = new SearchIndex(corpus)
    const loaded = SearchIndex.load(index.data())
    expect(loaded.count).toBe(index.count)
    for (const q of ['teorema de Pitágoras', 'hypotenuse', 'a² + b²', '"razón de cambio"', 'trigonom*', 'función seno']) {
      const a = index.search(q), b = loaded.search(q)
      expect(ids(a), q).toEqual(ids(b))
      expect(a.map((h) => h.score)).toEqual(b.map((h) => h.score))
      expect(a.map((h) => h.snippet)).toEqual(b.map((h) => h.snippet))
    }
    const many = Array.from({ length: 200 }, (_, i) => chunk(`c${i}`, 'texto repetido de relleno '.repeat(40) + i, 's1', i))
    const data = new SearchIndex(many).data()
    expect(Buffer.from(data.subarray(0, 8)).toString('latin1')).toBe('AULA_IDX')
    expect(data.length).toBeLessThan(Buffer.byteLength(JSON.stringify(many)) / 5)
    expect(SearchIndex.load(data).count).toBe(200)
    const old = new Uint8Array([...Buffer.from('MIMIRIDX'), ...index.data().subarray(8)])
    expect(SearchIndex.load(old).count).toBe(corpus.length)
    const uncompressed = index.data({ compress: false })
    expect(uncompressed[9]).toBe(0)
    expect(SearchIndex.load(uncompressed).count).toBe(6)
    expect(SearchIndex.load(new Uint8Array(Buffer.from(JSON.stringify(corpus)))).count).toBe(6)
    expect(SearchIndex.load(new Uint8Array(Buffer.from('{"chunks":[]}'))).count).toBe(0)
    expect(SearchIndex.load(new SearchIndex([]).data()).count).toBe(0)
  })

  it('datos dañados lanzan errores claros', () => {
    const good = new SearchIndex(corpus).data()
    const bad = (d: Uint8Array): unknown => { try { SearchIndex.load(d); return null } catch (e) { return e } }
    for (const d of [new Uint8Array(), new Uint8Array(Buffer.from('no es un índice')), good.subarray(0, 5), good.subarray(0, Math.floor(good.length / 2))]) expect(isIngestError(bad(d))).toBe(true)
    const wrongVersion = new Uint8Array(good)
    wrongVersion[8] = 99
    expect(String((bad(wrongVersion) as Error).message)).toContain('versión')
    const lzfse = new Uint8Array(good)
    lzfse[9] = 1
    expect(isIngestError(bad(lzfse))).toBe(true)
    const garbled = new Uint8Array(good)
    for (let i = 20; i < garbled.length; i += 7) garbled[i] ^= 0xff
    expect(bad(garbled)).not.toBeNull()
  })

  it('construir y buscar es rápido', () => {
    const words = ['seno', 'coseno', 'tangente', 'derivada', 'integral', 'límite', 'función', 'ángulo', 'círculo', 'triángulo', 'ecuación', 'parábola', 'elipse', 'hipérbola', 'matriz', 'vector', 'gráfica', 'dominio', 'rango', 'raíz']
    let seed = 5
    const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    const chunks = Array.from({ length: 1500 }, (_, i) => ({ id: `c${i}`, sourceID: `s${i % 20}`, ordinal: i, page: Math.floor(i / 3), heading: `Tema ${i % 50}`,
      text: `Fragmento ${i}: ` + Array.from({ length: 120 }, () => words[rnd(words.length)] + (rnd(2) ? 's' : '')).join(' ') + ` identificador${i}` }))
    let t0 = performance.now()
    const index = new SearchIndex(chunks)
    expect(performance.now() - t0).toBeLessThan(8000)
    t0 = performance.now()
    for (let k = 0; k < 50; k++) expect(index.search('seno coseno ecuación').length).toBeGreaterThan(0)
    expect((performance.now() - t0) / 50).toBeLessThan(150)
    expect(index.search('identificador1234')[0].chunk.id).toBe('c1234')
    expect(SearchIndex.load(index.data()).count).toBe(1500)
  })
})
