// Pruebas de los bloques de lección y los visuales (port de ModelCodingTests, VisualBlocksTests, TolerantVisualNumberListTests y
// HostileDecodingTests de la app Swift anterior: Tests/StudyModelTests).
import { describe, expect, it } from 'vitest'
import { parseJSON, stringifyJSON, type JSONObject } from '@engine/base/json'
import { BLOCK_TYPES, blockTypeName, decodeBlock, decodeBlocks, encodeBlock, TOO_DEEP_TYPE, type Block, type BlockOf } from './blocks'
import { canonicalDeckTheme, cardTargetPart, decodeDeck, decodeFlashcard, encodeDeck } from './cards'
import { decodeAnswer, effectiveLabelMode, encodeAnswer } from './exercises'
import { SimulationPresets } from './simulationPresets'
import { decodeFigurePart, decodeMap, effectiveAspect, encodeMap, FigureGeometry, HistoricalDate, mapCoordinates, type FigurePart } from './visual'

const rt = (v: unknown): unknown => parseJSON(stringifyJSON(v))
const decode = (json: string): Block => {
  const b = decodeBlock(parseJSON(json))
  if (!b) throw new Error(`no se leyó ${json}`)
  return b
}
const roundTrip = (b: Block): Block | undefined => decodeBlock(rt(encodeBlock(b)))
function as<T extends Block['type']>(b: Block, type: T): BlockOf<T> {
  if (b.type !== type) throw new Error(`se esperaba ${type} y es ${b.type}`)
  return b as BlockOf<T>
}

describe('bloques: lectura y escritura', () => {
  it('todos los tipos sobreviven a un ciclo de guardado', () => {
    const json = [
      '{"type":"text","md":"Hola $x$"}',
      '{"type":"math","tex":"\\\\frac{a}{b}","label":"Cociente"}',
      '{"type":"callout","kind":"definition","title":"Seno","md":"texto"}',
      '{"type":"example","title":"Ej","problem":"p","steps":[{"md":"uno"},{"md":"dos","note":"nota"}],"answer":"r"}',
      '{"type":"plot","curves":[{"expr":"sin(x)"}],"points":[{"x":"pi/2","y":"1","label":"máx"}]}',
      '{"type":"explore","plot":{"curves":[{"expr":"a*sin(x)"}]},"params":[{"name":"a","min":-3,"max":3,"value":1}],"prompts":["¿Qué pasa si a<0?"]}',
      '{"type":"table","headers":["a","b"],"rows":[["1","2"]]}',
      '{"type":"chart","kind":"bar","series":[{"name":"s","points":[{"label":"A","y":3}]}]}',
      '{"type":"numberline","min":-5,"max":5,"intervals":[{"from":"-2","fromOpen":true}]}',
      '{"type":"diagram","nodes":[{"id":"a","label":"A"},{"id":"b","label":"B"}],"edges":[{"from":"a","to":"b"}]}',
      '{"type":"drawing","items":[{"kind":"circle"}]}',
      '{"type":"timeline","events":[{"when":"1789","title":"Revolución"}]}',
      '{"type":"image","asset":"abc.png","alt":"x"}',
      '{"type":"steps","steps":[{"md":"uno"}]}',
      '{"type":"compare","leftTitle":"A","rightTitle":"B","rows":[{"left":"1","right":"2"}]}',
      '{"type":"formulas","items":[{"name":"n","tex":"x","vars":[{"symbol":"x","meaning":"m"}]}]}',
      '{"type":"predict","question":"q","options":[{"md":"a","correct":true}]}',
      '{"type":"spot","intro":"i","lines":["a","b"],"wrongIndex":1,"explanation":"e"}',
      '{"type":"tryit","exerciseIDs":["e1"]}',
      '{"type":"recap","points":["a"]}',
      '{"type":"code","language":"swift","code":"let x = 1"}',
      '{"type":"quote","md":"cita","source":{"source":"s1","page":3}}',
      '{"type":"labeled","asset":"h.png","alt":"corazón","parts":[{"id":"ao","name":"Aorta","x":0.5,"y":0.2,"r":0.05}]}',
      '{"type":"model3d","formula":"H2O","lonePairs":true,"alt":"agua"}',
      '{"type":"simulation","params":[{"name":"k","min":1,"max":5,"value":2}],"plot":{"curves":[{"expr":"k*x"}]}}',
      '{"type":"map","markers":[{"lat":40.4,"lon":-3.7,"title":"Madrid"}]}'
    ]
    const blocks = json.map(decode)
    for (const b of blocks) expect(roundTrip(b), b.type).toEqual(b)
    expect(new Set(blocks.map(blockTypeName))).toEqual(new Set(BLOCK_TYPES))
    // el id se conserva y siempre se escribe
    for (const b of blocks) expect(encodeBlock(b).id).toBe(b.id)
  })

  it('lee con tolerancia lo que escribe la IA', () => {
    // sinónimos de tipo, campos ausentes, números donde van cadenas, texto suelto
    const b = decodeBlocks(parseJSON(`[{"type":"paragraph","text":"Un párrafo"},
      {"type":"equation","latex":"x^2"},
      {"type":"note","md":"cuidado"},
      {"type":"warning","title":"Ojo","md":"x"},
      {"type":"worked_example","problem":"p","steps":["a","b",{"md":"c"}]},
      {"type":"graph","curves":[{"expr":"x^2"}],"points":[{"x":1,"y":2}],"xMin":-3,"xMax":3},
      {"type":"table","headers":["a"],"rows":[[1,2.5,true,"x"]]},
      {"type":"something_new","foo":1},
      {"type":"summary","points":["uno","dos"]}]`), 0)
    expect(b).toHaveLength(9)
    expect(as(b[0], 'text').md).toBe('Un párrafo')
    expect(as(b[1], 'math').tex).toBe('x^2')
    expect(as(b[2], 'callout').kind).toBe('note')
    expect(as(b[3], 'callout')).toMatchObject({ kind: 'warning', title: 'Ojo' })
    expect(as(b[4], 'example').steps.map((s) => s.md)).toEqual(['a', 'b', 'c'])
    const p = as(b[5], 'plot')
    expect(p.points[0].x).toBe('1')
    expect(p.xMin).toBe(-3)
    expect(as(b[6], 'table').rows).toEqual([['1', '2.5', 'true', 'x']])
    const u = as(b[7], 'unknown')
    expect(u.rawType).toBe('somethingnew')
    expect(u.raw?.foo).toBe(1)
    expect(as(b[8], 'recap').points).toHaveLength(2)
    // los desconocidos sobreviven a un ciclo de guardado (con su tipo y sus campos)
    const again = decodeBlocks(rt(b.map(encodeBlock)), 0)
    expect(as(again[7], 'unknown').raw?.foo).toBe(1)
    expect(encodeBlock(again[7])).toMatchObject({ type: 'somethingnew', foo: 1 })
  })

  it('un tipo futuro se conserva tal cual', () => {
    const b = decode('{"id":"h1","type":"hologram","x":1,"nested":{"deep":[1,2,{"k":"v"}]}}')
    expect(blockTypeName(b)).toBe('hologram')
    expect(encodeBlock(b)).toEqual({ id: 'h1', type: 'hologram', x: 1, nested: { deep: [1, 2, { k: 'v' }] } })
  })

  it('los bloques de antes no ganan claves nuevas', () => {
    const old = [
      '{"id":"d","type":"diagram","kind":"cycle","nodes":[{"id":"a","label":"A"},{"id":"b","label":"B"}],"edges":[]}',
      '{"id":"t","type":"timeline","title":"T","events":[{"when":"1789","title":"Bastilla"}]}',
      '{"id":"i","type":"image","asset":"x.png","alt":"a","caption":"c","hotspots":[]}'
    ]
    for (const json of old) {
      const b = decode(json)
      const enc = stringifyJSON(encodeBlock(b), { pretty: false })
      for (const k of ['"steps"', '"periods"', '"layout"', '"credit"']) expect(enc.includes(k), `${k} no debe aparecer en ${enc}`).toBe(false)
      expect(roundTrip(b)).toEqual(b)
    }
    // «process» sigue siendo una lista de pasos, «figure» un dibujo
    expect(decode('{"type":"process","steps":["a","b"]}').type).toBe('steps')
    expect(decode('{"type":"figure","width":100,"height":100,"items":[]}').type).toBe('drawing')
  })

  it('los ids de bloque repetidos se renombran al leer una habilidad', async () => {
    const { decodeSkill } = await import('./pack')
    const s = decodeSkill(parseJSON('{"id":"s","lesson":[{"id":"b","type":"text","md":"1"},{"id":"b","type":"text","md":"2"},{"id":"b","type":"text","md":"3"}]}'))
    expect(new Set(s.lesson.map((b) => b.id)).size).toBe(3)
  })

  it('el «Pruébalo» quita ids repetidos', () => {
    const t = as(decode('{"type":"tryit","exerciseIDs":["e1","e1","e2"],"inline":[{"id":"e1","prompt":"p"},{"id":"e3","prompt":"q"},{"id":"e3","prompt":"r"}]}'), 'tryit')
    expect(t.exerciseIDs).toEqual(['e1', 'e2'])
    expect(new Set([...t.exerciseIDs, ...t.inline.map((e) => e.id)]).size).toBe(5)
  })
})

describe('bloques hostiles', () => {
  it('los «Pruébalo» anidados sin fin se cortan en un bloque «demasiado anidado»', () => {
    let block = '{"type":"text","md":"x"}'
    for (let i = 0; i < 125; i++) block = `{"type":"tryit","inline":[{"id":"e","prompt":[${block}],"answer":{"kind":"short","accepted":["x"]}}]}`
    let cur: Block | undefined = decode(block)
    while (cur && cur.type === 'tryit') cur = cur.inline[0]?.prompt[0]
    expect(cur?.type).toBe('unknown')
    expect(cur?.type === 'unknown' && cur.rawType).toBe(TOO_DEEP_TYPE)
  })

  it('un bloque desconocido guarda una copia acotada de su JSON', () => {
    const b = decode('{"type":"zzz","raw":' + '['.repeat(505) + ']'.repeat(505) + ',"extra":7}')
    expect(as(b, 'unknown').raw?.extra).toBe(7)
    expect(() => stringifyJSON(encodeBlock(b))).not.toThrow()
  })
})

describe('bloques visuales', () => {
  it('«labeled» lee sinónimos y sobrevive a un ciclo de guardado', () => {
    const b = decode(`{"type":"anatomy","title":"Corazón","asset":"h.png","alt":"corazón","credit":"X · CC BY-SA 4.0",
      "layers":[{"id":"v","name":"Válvulas"}],
      "parts":[{"label":"Aurícula derecha","x":"0.24","y":0.52,"r":0.09,"layer":"v","md":"Recibe sangre"},{"id":"a","name":"Aorta","x":0.5,"y":0.17,"rect":[0.4,0.1,0.2,0.1]},{"id":"a","name":"Otra","x":0.1,"y":0.1,"polygon":[[0,0],[0.2,0],[0.1,"0.2"]]}]}`)
    const l = as(b, 'labeled')
    expect(l.parts).toHaveLength(3)
    expect(l.parts[0].name).toBe('Aurícula derecha')
    expect(l.parts[0].x).toBeCloseTo(0.24, 9)
    expect(l.parts[0].detail).toBe('Recibe sangre')
    expect(l.parts[1].rect).toEqual([0.4, 0.1, 0.2, 0.1])
    expect(l.parts[2].id).toBe('a-2') // ids repetidos se renombran
    expect(l.parts[2].polygon).toHaveLength(3)
    expect(l.practice).toBe(true)
    expect(l.labels).toBe('auto')
    expect(roundTrip(b)).toEqual(b)
  })

  it('modelo 3D, simulación y mapa sobreviven a un ciclo de guardado', () => {
    for (const json of [
      '{"type":"molecule","formula":"H2O","lonePairs":true,"solid":{"shape":"Cube","a":"2"},"atoms":[{"el":"O","x":0,"y":0,"z":0},{"symbol":"H","x":"0.96","y":0,"z":0}],"bonds":[[0,1]]}',
      '{"type":"simulation","preset":"tiro parabólico"}',
      '{"type":"map","center":[40.4,-3.7],"span":10,"markers":[{"lat":40.4,"lng":-3.7,"name":"Madrid"}],"regions":[{"name":"R","polygon":[[1,2],[3,4],[5,6]]}],"routes":[{"points":[[1,2],[3,4]],"name":"ruta"}]}'
    ]) {
      const b = decode(json)
      expect(b.type, json).not.toBe('unknown')
      expect(roundTrip(b), json).toEqual(b)
    }
    const m = as(decode('{"type":"3d","molecule":"CH4","solid":{"shape":"cube"},"solids":[{"shape":"sphere","radius":1}]}'), 'model3d')
    expect(m.formula).toBe('CH4')
    expect(m.solids.map((s) => s.shape)).toEqual(['cube', 'sphere'])
    expect(m.solids[1].r).toBe(1)
    const map = as(decode('{"type":"mapa","center":{"lat":10,"lon":20},"markers":[]}'), 'map')
    expect([map.lat, map.lon]).toEqual([10, 20])
  })

  it('los modelos de simulación se expanden y se pueden ajustar', () => {
    for (const name of SimulationPresets.names) {
      const p = SimulationPresets.make(name)
      expect(p, name).toBeDefined()
      expect(p!.params.length === 0 && p!.time === undefined, name).toBe(false)
      expect(p!.plot.curves.length === 0 && p!.objects.length === 0, name).toBe(false)
    }
    const s = as(decode('{"type":"simulation","preset":"Projectile Motion","title":"Mi tiro","params":[{"name":"v0","label":"Launch speed","min":1,"max":10,"step":1,"value":5}]}'), 'simulation')
    expect(s.preset).toBe('projectile')
    expect(s.title).toBe('Mi tiro')
    expect(s.params.find((p) => p.name === 'v0')?.label).toBe('Launch speed') // se sustituye el del mismo nombre
    expect(s.params.some((p) => p.name === 'theta')).toBe(true) // los demás del modelo siguen
    expect(s.time).toBeDefined()
    expect(s.derived.length).toBeGreaterThan(0)
  })

  it('las respuestas de rotular de antes y las presentaciones siguen funcionando', () => {
    const a = decodeAnswer(parseJSON('{"kind":"label","asset":"c.png","spots":[{"x":0.5,"y":0.5,"accepted":["núcleo"]}],"wordBank":["núcleo","pared"]}'))
    if (a?.kind !== 'label') throw new Error('label')
    expect(a.mode).toBeUndefined()
    expect(effectiveLabelMode(a)).toBe('bank')
    const locate = decodeAnswer(parseJSON('{"kind":"locate","asset":"c.png","spots":[{"x":0.5,"y":0.5,"r":0.1,"name":"núcleo"}]}'))
    if (locate?.kind !== 'label') throw new Error('locate')
    expect(effectiveLabelMode(locate)).toBe('locate')
    expect(locate.spots[0].accepted).toEqual(['núcleo'])
    expect(locate.spots[0].r).toBe(0.1)
    const drag = decodeAnswer(parseJSON('{"kind":"draglabel","drawing":{"width":100,"height":50,"items":[]},"spots":[]}'))
    if (drag?.kind !== 'label') throw new Error('drag')
    expect(effectiveLabelMode(drag)).toBe('drag')
    expect(effectiveAspect(drag)).toBeCloseTo(2, 9)
    expect(decodeAnswer(rt(encodeAnswer(locate)))).toEqual(locate)

    const deck = decodeDeck(parseJSON('{"title":"D","theme":"pizarra","slides":[{"layout":"comparación","leftTitle":"A","rightTitle":"B","blocks":["x"],"right":["y"]},{"layout":"picture","asset":"i.png"},{"layout":"twoColumn"}]}'))
    expect(deck?.slides.map((s) => s.layout)).toEqual(['comparison', 'image', 'twoColumn'])
    expect(deck?.slides[1].image).toBe('i.png')
    expect(canonicalDeckTheme(deck?.theme)).toBe('chalk')
    expect(decodeDeck(rt(encodeDeck(deck!)))).toEqual(deck)
  })

  it('una tarjeta de figura rellena el reverso con la parte señalada', () => {
    const c = decodeFlashcard(parseJSON('{"front":"¿Qué es?","figure":{"asset":"h.png","parts":[{"id":"ao","name":"Aorta","x":0.5,"y":0.2,"detail":"La arteria mayor"}],"target":"ao"}}'))
    expect(c?.figure && cardTargetPart(c.figure)?.name).toBe('Aorta')
    expect(c?.back).toContain('Aorta')
    expect(c?.back).toContain('La arteria mayor')
  })

  it('geometría de las figuras', () => {
    const part = (p: Partial<FigurePart> & { id: string; x: number; y: number }): FigurePart => ({ name: p.id, aliases: [], ...p })
    const parts = [
      part({ id: 'cell', x: 0.5, y: 0.5, r: 0.45 }), part({ id: 'nuc', x: 0.5, y: 0.5, r: 0.1 }),
      part({ id: 'mito', x: 0.2, y: 0.7, rect: [0.15, 0.65, 0.1, 0.1] }), part({ id: 'tri', x: 0.85, y: 0.2, polygon: [[0.8, 0.1], [0.9, 0.1], [0.85, 0.3]] }),
      part({ id: 'pt', x: 0.05, y: 0.05 })
    ]
    expect(FigureGeometry.hit(0.51, 0.52, parts, 1)).toBe(1) // gana la zona más pequeña
    expect(FigureGeometry.hit(0.7, 0.5, parts, 1)).toBe(0)
    expect(FigureGeometry.hit(0.2, 0.7, parts, 1)).toBe(2)
    expect(FigureGeometry.hit(0.85, 0.15, parts, 1)).toBe(3)
    expect(FigureGeometry.hit(0.08, 0.07, parts, 1)).toBe(4) // un punto sin zona se capta de cerca
    expect(FigureGeometry.hit(0.99, 0.99, parts, 1)).toBeUndefined()
    expect(FigureGeometry.hit(Number.NaN, 0.5, parts, 1)).toBeUndefined()
    // con una figura el doble de ancha que alta, el radio (fracción del ancho) cubre el doble en vertical
    const c = [part({ id: 'c', x: 0.5, y: 0.5, r: 0.1 })]
    expect(FigureGeometry.hit(0.5, 0.68, c, 2)).toBeDefined()
    expect(FigureGeometry.hit(0.5, 0.68, c, 1)).toBeUndefined()
    expect(FigureGeometry.parsePoint(FigureGeometry.format(0.25, 0.75))?.[0]).toBeCloseTo(0.25, 9)
    expect(FigureGeometry.parsePoint('hola')).toBeUndefined()
  })

  it('fechas históricas', () => {
    const p = (s: string): number | undefined => HistoricalDate.parse(s)?.start
    expect(p('1789')).toBe(1789)
    expect([p('44 a. C.'), p('44 BC'), p('500 a.C.')]).toEqual([-44, -44, -500])
    expect(p('c. 1450')).toBe(1450)
    expect([p('siglo XV'), p('s. III a. C.')]).toEqual([1450, -250])
    expect(p('65 Ma')).toBe(-65e6)
    expect(p('0.3 Ma')).toBeCloseTo(-3e5, 0)
    expect(Math.abs((p('1789-07-14') ?? 0) - 1789.53)).toBeLessThanOrEqual(0.01)
    expect(HistoricalDate.parse('1914–1918')).toEqual({ start: 1914, end: 1918 })
    expect(HistoricalDate.parse('1914-1918')?.end).toBe(1918)
    expect(HistoricalDate.parse('500–400 a. C.')).toEqual({ start: -500, end: -400 })
    expect(p('1960s')).toBe(1965)
    expect(p('el día que llovió')).toBeUndefined()
    expect(p('')).toBeUndefined()
    // números absurdos no revientan
    expect(() => HistoricalDate.parse('siglo -9223372036854775808')).not.toThrow()
    expect(HistoricalDate.parse('siglo 9223372036854775807')).toBeUndefined()
  })
})

describe('listas de números tolerantes en los visuales', () => {
  const fig = (json: string): FigurePart => {
    const p = decodeFigurePart(parseJSON(json))
    if (!p) throw new Error(json)
    return p
  }

  it('el rectángulo conserva los números que siguen a una cadena inválida', () => {
    for (const arr of ['["bad",0.1,0.2,0.3,0.4]', '[0.1,"bad",0.2,0.3,0.4]', '["bad","bad",0.1,0.2,0.3,0.4,"bad"]']) {
      expect(fig(`{"rect":${arr}}`).rect, arr).toEqual([0.1, 0.2, 0.3, 0.4])
    }
    expect(fig('{"rect":["bad","0.1","0.2","0.3","0.4"]}').rect).toEqual([0.1, 0.2, 0.3, 0.4])
  })

  it('el polígono conserva los números de cada fila', () => {
    expect(fig('{"polygon":[["bad",0.1,0.2],[0.3,"bad",0.4],["bad","bad","0.5",0.6]]}').polygon).toEqual([[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]])
  })

  it('el mapa usa las coordenadas válidas tras un texto inválido', () => {
    const map = decodeMap(parseJSON('{"center":["bad",40.4,-3.7]}'))
    expect([map?.lat, map?.lon]).toEqual([40.4, -3.7])
    const m2 = decodeMap(parseJSON('{"regions":[{"polygon":[["bad",1,2],[3,"bad",4]]}],"routes":[{"points":[["bad","5",6],[7,"bad","8"]]}]}'))!
    expect(m2.regions[0].points).toEqual([[1, 2], [3, 4]])
    expect(m2.routes[0].points).toEqual([[5, 6], [7, 8]])
    expect(mapCoordinates(m2)).toEqual([[1, 2], [3, 4], [5, 6], [7, 8]])
    expect(decodeMap(rt(encodeMap(m2)))).toEqual(m2)
  })

  it('otros valores ilegibles no se comen los números siguientes', () => {
    const p = fig('{"rect":[null,true,{"nested":[1,2]},[3,4],0.1,0.2,0.3,0.4],"polygon":[null,true,{},"bad",[null,false,{"n":1},[4,5],0.2,"0.3"]]}')
    expect(p.rect).toEqual([0.1, 0.2, 0.3, 0.4])
    expect(p.polygon).toEqual([[0.2, 0.3]])
  })

  it('ausentes, vacíos y contenedores equivocados mantienen su significado', () => {
    for (const text of ['{}', '{"rect":null,"polygon":null}', '{"rect":{},"polygon":{}}']) {
      const p = fig(text)
      expect(p.rect, text).toBeUndefined()
      expect(p.polygon, text).toBeUndefined()
    }
    const empty = fig('{"rect":[],"polygon":[[],["bad"]]}')
    expect(empty.rect).toEqual([])
    expect(empty.polygon).toEqual([[], []])
    const last = fig('{"rect":[0.1,0.2,"bad"],"polygon":[[0.3,0.4,"bad"]]}')
    expect(last.rect).toEqual([0.1, 0.2])
    expect(last.polygon).toEqual([[0.3, 0.4]])
  })

  it('los límites de valores y filas no cambian', () => {
    const values = Array.from({ length: 80 }, (_, i) => String(i)).join(',')
    const rows = Array(4005).fill('[1,2]').join(',')
    const p = fig(`{"rect":[${values}],"polygon":[${rows}]}`)
    expect(p.rect).toEqual(Array.from({ length: 64 }, (_, i) => i))
    expect(p.polygon).toHaveLength(4000)
    expect(fig(`{"polygon":[[${values}]]}`).polygon).toEqual([Array.from({ length: 80 }, (_, i) => i)])
  })
})

// Los bloques sin campos se escriben con lo mínimo que Swift escribiría (las claves no opcionales).
describe('bloques mínimos', () => {
  it('un texto suelto es un bloque de texto con id', () => {
    const b = decodeBlock({ type: 'text', md: 'hola' } as JSONObject)!
    expect(b.id).toMatch(/^[a-z0-9]{6}$/)
    expect(encodeBlock(b)).toEqual({ id: b.id, type: 'text', md: 'hola' })
  })
})
