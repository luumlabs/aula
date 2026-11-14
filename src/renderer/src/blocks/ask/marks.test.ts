import { describe, expect, it } from 'vitest'
import es from '@renderer/i18n/locales/es/visual.json'
import en from '@renderer/i18n/locales/en/visual.json'
import {
  clampInto, cleanText, composeMarkMessage, isLoop, isPageKey, loopAround, MARK_LIMITS, marksCenter, marksOf, nearestTarget, noteTarget, ringLabelTop,
  strokePath, summarizeMarks, whereOf, type Box, type Mark, type MarkTarget, type Pt, type Stroke
} from './marks'

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height })
const item = (id: string, b: Box, name = id.toUpperCase()): MarkTarget => ({ id, name, kind: 'item', shapes: [{ box: b }] })

/** Un lazo a mano alrededor de una caja (con un pelo de más al cerrar). */
const ring = (b: Box, pad = 10): Pt[] => loopAround(b, pad)
/** Una raya recta de un punto a otro, con un punto cada 3 px. */
function line(a: Pt, b: Pt): Pt[] {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3))
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }))
}
const pen = (points: Pt[]): Stroke => ({ kind: 'pen', points })
const marker = (points: Pt[]): Stroke => ({ kind: 'marker', points })

describe('strokePath (de Sketchy)', () => {
  it('un toque es un punto; dos puntos, una recta; tres o más, curvas por los puntos medios', () => {
    expect(strokePath([])).toBe('')
    expect(strokePath([{ x: 3, y: 4 }])).toBe('M 3 4 l 0.01 0')
    expect(strokePath([{ x: 0, y: 0 }, { x: 10, y: 5 }])).toBe('M 0 0 L 10 5')
    expect(strokePath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }])).toBe('M 0 0 Q 10 0 15 5 L 20 10')
  })
})

describe('qué se marcó', () => {
  const a = item('a', box(20, 40, 60, 30))
  const b = item('b', box(100, 40, 60, 30))
  const c = item('c', box(180, 40, 60, 30))
  const targets = [a, b, c]

  it('un lazo alrededor de un nodo y una nota al lado: el nodo y la nota junto a él (el caso de Sketchy)', () => {
    const marks: Mark[] = [pen(ring(b.shapes[0].box, 6)), { kind: 'note', x: 132, y: 92, text: '¿por qué aquí?' }]
    const s = summarizeMarks(targets, marks)
    expect(s.marked.map((t) => t.id)).toEqual(['b'])
    expect(s.notes).toEqual([{ text: '¿por qué aquí?', near: b, at: { x: 132, y: 92 } }])
    expect(s.loose).toEqual([])
  })

  it('un lazo alrededor de la caja del medio de tres pegadas marca solo la del medio (no las vecinas que roza)', () => {
    const tight = [item('a', box(0, 0, 60, 30)), item('b', box(62, 0, 60, 30)), item('c', box(124, 0, 60, 30))]
    expect(isLoop(ring(tight[1].shapes[0].box, 4))).toBe(true)
    expect(marksOf(pen(ring(tight[1].shapes[0].box, 4)), tight).map((t) => t.id)).toEqual(['b'])
  })

  it('un trazo de marcador que cruza A, B y C las marca las tres, en el orden en que pasa', () => {
    expect(marksOf(marker(line({ x: 250, y: 55 }, { x: 10, y: 55 })), targets).map((t) => t.id)).toEqual(['c', 'b', 'a'])
  })

  it('subrayar a 6 px por debajo de una caja la marca', () => {
    expect(marksOf(pen(line({ x: 105, y: 76 }, { x: 155, y: 76 })), targets).map((t) => t.id)).toEqual(['b'])
  })

  it('una línea (una flecha) se marca si el trazo pasa a menos de 6 px; más lejos, no', () => {
    const arrow: MarkTarget = { id: 'e', name: 'A → B', kind: 'item', shapes: [{ box: box(80, 100, 100, 0), poly: line({ x: 80, y: 100 }, { x: 180, y: 100 }), closed: false }] }
    expect(marksOf(pen(line({ x: 130, y: 90 }, { x: 130, y: 95 })), [arrow]).map((t) => t.id)).toEqual(['e'])
    expect(marksOf(pen(line({ x: 130, y: 80 }, { x: 130, y: 90 })), [arrow])).toEqual([])
    // un lazo alrededor de su mitad también la marca
    expect(marksOf(pen(ring(box(120, 95, 20, 10), 4)), [arrow]).map((t) => t.id)).toEqual(['e'])
  })

  it('zonas: un lazo alrededor de un marcador dentro de una región da el marcador; uno que la cubre entera, la región', () => {
    const region: MarkTarget = {
      id: 'r', name: 'Castilla', kind: 'area',
      shapes: [{ box: box(0, 0, 200, 160), poly: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 160 }, { x: 0, y: 160 }], closed: true }]
    }
    const city = item('m', box(90, 70, 18, 18), 'Toledo')
    expect(marksOf(pen(ring(city.shapes[0].box, 4)), [region, city]).map((t) => t.id)).toEqual(['m'])
    expect(marksOf(pen(ring(region.shapes[0].box, 12)), [region, city]).map((t) => t.id)).toEqual(['m', 'r'])
    // un lazo pequeño dentro de la región, lejos de todo: la región que lo contiene
    expect(marksOf(pen(ring(box(20, 120, 10, 10), 4)), [region, city]).map((t) => t.id)).toEqual(['r'])
    // un subrayado que cruza la región y el marcador: lo concreto gana
    expect(marksOf(pen(line({ x: 10, y: 79 }, { x: 190, y: 79 })), [region, city]).map((t) => t.id)).toEqual(['m'])
  })

  it('un lazo hecho con el teclado lleva sus partes: no se adivinan por la forma', () => {
    expect(marksOf({ kind: 'pen', points: ring(box(0, 0, 400, 400)), ids: ['c'] }, targets).map((t) => t.id)).toEqual(['c'])
  })

  it('una nota lejos de todo (más de noteReach) no tiene parte al lado; dentro de una zona, gana lo concreto cercano', () => {
    expect(nearestTarget({ x: 600, y: 600 }, targets, 160)).toBeUndefined()
    const area: MarkTarget = { id: 'z', name: 'Zona', kind: 'area', shapes: [{ box: box(0, 0, 300, 300) }] }
    expect(nearestTarget({ x: 50, y: 80 }, [area, a])?.id).toBe('a')
    expect(nearestTarget({ x: 250, y: 280 }, [area, a])?.id).toBe('z')
  })

  it('un trazo que no toca nada queda como marca suelta (con su centro)', () => {
    const s = summarizeMarks(targets, [pen(line({ x: 300, y: 200 }, { x: 340, y: 200 }))])
    expect(s.marked).toEqual([])
    expect(s.loose).toEqual([{ x: 320, y: 200 }])
  })

  it('topes: 12 nombres y 5 notas como mucho; cada nota, de una línea y como mucho 200 caracteres', () => {
    const many = Array.from({ length: 20 }, (_, i) => item(`p${i}`, box(i * 30, 0, 20, 20)))
    const s = summarizeMarks(many, [
      marker(line({ x: 0, y: 10 }, { x: 600, y: 10 })),
      ...Array.from({ length: 8 }, (_, i): Mark => ({ kind: 'note', x: 5, y: 40 + i, text: `nota ${i}\n` + 'x'.repeat(400) }))
    ])
    expect(s.marked).toHaveLength(MARK_LIMITS.names)
    expect(s.notes).toHaveLength(MARK_LIMITS.notes)
    expect(s.notes[0].text.length).toBeLessThanOrEqual(MARK_LIMITS.noteChars)
    expect(s.notes[0].text).not.toContain('\n')
    expect(s.notes[0].text.endsWith('…')).toBe(true)
  })
})

describe('lo que se marcó se decide al marcar (un dibujo que se mueve)', () => {
  const ball = item('ball', box(100, 100, 20, 20), 'Pelota')
  const moved = item('ball', box(400, 100, 20, 20), 'Pelota')
  const loop = ring(ball.shapes[0].box, 6)

  it('un trazo con sus partes ya sabidas las cuenta aunque se hayan movido; con `ids: []`, sigue sin tocar nada', () => {
    expect(marksOf({ kind: 'pen', points: loop, ids: ['ball'] }, [moved]).map((t) => t.id)).toEqual(['ball'])
    // la pelota llega al sitio del trazo después: no cambia lo que el estudiante vio al marcar
    const s = summarizeMarks([ball], [{ kind: 'pen', points: line({ x: 300, y: 300 }, { x: 340, y: 300 }), ids: [] }, { kind: 'pen', points: loop, ids: [] }])
    expect(s.marked).toEqual([])
    expect(s.loose).toHaveLength(2)
  })

  it('si la parte ya no está (otra capa), se vuelve a mirar por la forma', () => {
    expect(marksOf({ kind: 'pen', points: loop, ids: ['gone'] }, [ball]).map((t) => t.id)).toEqual(['ball'])
  })

  it('una nota recuerda la parte junto a la que se escribió', () => {
    expect(noteTarget({ kind: 'note', x: 410, y: 110, text: 'aquí', ids: ['ball'] }, [moved])?.id).toBe('ball')
    expect(noteTarget({ kind: 'note', x: 110, y: 110, text: 'aquí', ids: [] }, [ball])).toBeUndefined()
    expect(noteTarget({ kind: 'note', x: 110, y: 110, text: 'aquí' }, [ball])?.id).toBe('ball')
  })
})

describe('una ruta de un mapa es su línea, no su caja', () => {
  // la ruta en diagonal (100,300)→(600,150) y un país cerrado dentro de su caja pero lejos de la línea
  const route: MarkTarget = { id: 'route:0', name: 'Ruta de Aníbal', kind: 'item', shapes: [{ box: box(100, 150, 500, 150), poly: line({ x: 100, y: 300 }, { x: 600, y: 150 }), closed: false }] }
  const square = [{ x: 420, y: 230 }, { x: 520, y: 230 }, { x: 520, y: 290 }, { x: 420, y: 290 }]
  const france: MarkTarget = { id: 'country:FR', name: 'Francia', kind: 'area', shapes: [{ box: box(420, 230, 100, 60), poly: square, closed: true }] }

  it('subrayar, resaltar o rodear el país da el país', () => {
    expect(summarizeMarks([route, france], [pen(line({ x: 430, y: 270 }, { x: 510, y: 270 }))]).marked.map((t) => t.name)).toEqual(['Francia'])
    expect(summarizeMarks([route, france], [marker(line({ x: 430, y: 260 }, { x: 510, y: 260 }))]).marked.map((t) => t.name)).toEqual(['Francia'])
    expect(summarizeMarks([route, france], [pen(ring(box(425, 235, 90, 50), 6))]).marked.map((t) => t.name)).toEqual(['Francia'])
  })

  it('un trazo sobre la línea sí es la ruta', () => {
    expect(marksOf(pen(line({ x: 340, y: 222 }, { x: 360, y: 222 })), [route, france]).map((t) => t.id)).toEqual(['route:0'])
  })
})

describe('marcando, las teclas de la página no le llegan', () => {
  it('Intro, espacio, flechas y letras sueltas, sí; con ⌘/Ctrl/Alt, Esc o Tab, no', () => {
    for (const key of ['Enter', ' ', 'ArrowRight', 'ArrowLeft', 'a', 'n', '1', 'ñ']) expect(isPageKey({ key }), key).toBe(true)
    expect(isPageKey({ key: 'k', metaKey: true })).toBe(false)
    expect(isPageKey({ key: 'z', ctrlKey: true })).toBe(false)
    expect(isPageKey({ key: 'Escape' })).toBe(false)
    expect(isPageKey({ key: 'Tab' })).toBe(false)
  })
})

describe('lo que se pinta junto a las marcas no se sale del lienzo', () => {
  it('el campo de una nota cerca del borde de abajo o de arriba se queda dentro', () => {
    expect(clampInto(400 - 16, 32, 400)).toBe(364)
    expect(clampInto(2 - 16, 32, 400)).toBe(4)
    expect(clampInto(200 - 16, 32, 400)).toBe(184)
  })

  it('el nombre de la parte elegida: encima; pegada arriba, debajo; si llena el lienzo, dentro', () => {
    expect(ringLabelTop(100, 40, 400)).toBe(77)
    expect(ringLabelTop(11, 40, 400)).toBe(54)
    expect(ringLabelTop(-5, 400, 400)).toBe(3)
  })
})

describe('isLoop', () => {
  it('un círculo es un lazo; una raya, una «C» abierta o un garabato corto, no', () => {
    expect(isLoop(ring(box(0, 0, 80, 40)))).toBe(true)
    expect(isLoop(line({ x: 0, y: 0 }, { x: 200, y: 0 }))).toBe(false)
    const c = Array.from({ length: 40 }, (_, i) => ({ x: 50 + 40 * Math.cos(0.6 + (i / 39) * Math.PI * 1.3), y: 50 + 40 * Math.sin(0.6 + (i / 39) * Math.PI * 1.3) }))
    expect(isLoop(c)).toBe(false)
    expect(isLoop([{ x: 0, y: 0 }, { x: 3, y: 2 }, { x: 1, y: 4 }, { x: 0, y: 1 }, { x: 2, y: 1 }, { x: 0, y: 0 }])).toBe(false)
  })
})

describe('dónde', () => {
  it('reparte el recuadro en tercios', () => {
    const f = box(0, 0, 300, 300)
    expect(whereOf({ x: 10, y: 10 }, f)).toBe('topLeft')
    expect(whereOf({ x: 150, y: 150 }, f)).toBe('center')
    expect(whereOf({ x: 290, y: 150 }, f)).toBe('right')
    expect(whereOf({ x: 150, y: 290 }, f)).toBe('bottom')
    expect(marksCenter([])).toBeUndefined()
    expect(marksCenter([{ kind: 'note', x: 0.2, y: 0.4, text: 'a' }, { kind: 'note', x: 0.4, y: 0.6, text: 'b' }])).toEqual({ x: expect.closeTo(0.3), y: expect.closeTo(0.5) })
  })
})

/** Un `t` de i18next de juguete con las cadenas de verdad (interpolación {{x}}). */
function translator(dict: Record<string, unknown>) {
  return (key: string, vars: Record<string, string | number> = {}): string => {
    let v: unknown = dict
    for (const k of key.split('.')) v = (v as Record<string, unknown> | undefined)?.[k]
    if (typeof v !== 'string') throw new Error(`falta la clave ${key}`)
    return v.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ''))
  }
}

describe('el mensaje al tutor', () => {
  const heart = [item('vi', box(200, 120, 40, 40), 'Ventrículo izquierdo'), item('ao', box(160, 20, 30, 30), 'Aorta')]
  const marks: Mark[] = [pen(ring(heart[0].shapes[0].box, 5)), pen(ring(heart[1].shapes[0].box, 5)), { kind: 'note', x: 250, y: 140, text: '¿por qué es más gruesa?' }]
  const summary = summarizeMarks(heart, marks)
  const frame = box(0, 0, 300, 200)

  it('en español: la pregunta, las partes (con «»), la nota junto a su parte, dónde están y el pie', () => {
    const msg = composeMarkMessage({
      question: '¿Por qué la pared es tan gruesa?', block: { kind: 'labeled', title: 'El corazón', caption: 'Corte frontal' }, summary,
      where: 'topRight', whereOfPoint: (p) => whereOf(p, frame), t: translator(es), lang: 'es'
    })
    expect(msg).toBe(
      '¿Por qué la pared es tan gruesa?\n\n' +
      'He marcado en la figura «El corazón»: «Ventrículo izquierdo» y «Aorta». Nota junto a «Ventrículo izquierdo»: «¿por qué es más gruesa?». ' +
      'Las marcas están sobre todo arriba a la derecha.\nPie de la figura: Corte frontal'
    )
  })

  it('en inglés, sin pregunta: la pregunta por defecto', () => {
    const msg = composeMarkMessage({ question: '  ', block: { kind: 'diagram', title: 'Krebs cycle' }, summary, t: translator(en), lang: 'en' })
    expect(msg.split('\n')[0]).toBe('Look at what I marked and explain it to me.')
    expect(msg).toContain('I marked on the diagram “Krebs cycle”: “Ventrículo izquierdo” and “Aorta”.')
  })

  it('marcas que no tocan ninguna parte: dónde están', () => {
    const loose = summarizeMarks(heart, [pen(line({ x: 10, y: 180 }, { x: 40, y: 185 }))])
    const msg = composeMarkMessage({ question: '¿Y esto?', block: { kind: 'map' }, summary: loose, whereOfPoint: (p) => whereOf(p, frame), t: translator(es), lang: 'es' })
    expect(msg).toBe('¿Y esto?\n\nHe marcado una zona abajo a la izquierda en el mapa, sin ninguna parte con nombre debajo.')
  })

  it('sin marcas: la pregunta sobre la figura', () => {
    const msg = composeMarkMessage({ question: '¿Qué es?', block: { kind: 'structure', title: 'Benceno' }, summary: { marked: [], notes: [], loose: [] }, t: translator(es), lang: 'es' })
    expect(msg).toBe('¿Qué es?\n\nTe pregunto por la estructura «Benceno».')
  })

  it('los nombres de la figura van limpios (una línea, con tope)', () => {
    expect(cleanText('  Aurícula\n\nderecha\u0007 ', 80)).toBe('Aurícula derecha')
    expect(cleanText('x'.repeat(100), 80)).toHaveLength(80)
  })
})
