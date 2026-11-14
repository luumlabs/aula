// Formas ya hechas de los diagramas y matices de «comparar»: lectura tolerante, guardado y compatibilidad con lo de antes.
import { describe, expect, it } from 'vitest'
import { parseJSON, stringifyJSON } from '@engine/base/json'
import { decodeBlock, encodeBlock, type Block, type BlockOf } from './blocks'
import { parseCompareTone, parseDiagramForm } from './diagramForms'

const decode = (json: string): Block => {
  const b = decodeBlock(parseJSON(json))
  if (!b) throw new Error(`no se leyó ${json}`)
  return b
}
const roundTrip = (b: Block): Block | undefined => decodeBlock(parseJSON(stringifyJSON(encodeBlock(b))))
const diagram = (json: string): BlockOf<'diagram'> => {
  const b = decode(json)
  if (b.type !== 'diagram') throw new Error(`no es un diagrama: ${b.type}`)
  return b
}
const compare = (json: string): BlockOf<'compare'> => {
  const b = decode(json)
  if (b.type !== 'compare') throw new Error(`no es una comparación: ${b.type}`)
  return b
}
const N = '"nodes":[{"id":"a","label":"A"},{"id":"b","label":"B"}]'

describe('formas de diagrama', () => {
  it('una forma en `kind` pasa a `form` y el tipo de base queda en `kind`', () => {
    const p = diagram(`{"type":"diagram","kind":"pyramid",${N}}`)
    expect(p.kind).toBe('layers')
    expect(p.form).toBe('pyramid')
    expect(diagram(`{"type":"diagram","kind":"Embudo",${N}}`)).toMatchObject({ kind: 'layers', form: 'funnel' })
    expect(diagram(`{"type":"diagram","kind":"venn",${N}}`)).toMatchObject({ kind: 'concept', form: 'venn' })
  })
  it('el tipo de bloque también nombra la forma («mindmap», «pirámide», «venn»)', () => {
    expect(diagram(`{"type":"mindmap",${N}}`)).toMatchObject({ kind: 'tree', form: 'mindmap' })
    expect(diagram(`{"type":"mapa_mental",${N}}`)).toMatchObject({ kind: 'tree', form: 'mindmap' })
    expect(diagram(`{"type":"pirámide",${N}}`)).toMatchObject({ kind: 'layers', form: 'pyramid' })
    expect(diagram(`{"type":"Venn",${N}}`)).toMatchObject({ kind: 'concept', form: 'venn' })
  })
  it('la forma gana a un `kind` que no casa; una forma desconocida se ignora', () => {
    expect(diagram(`{"type":"diagram","kind":"cycle","form":"funnel",${N}}`)).toMatchObject({ kind: 'layers', form: 'funnel' })
    const d = diagram(`{"type":"diagram","kind":"cycle","form":"hexagon",${N}}`)
    expect(d.kind).toBe('cycle')
    expect(d.form).toBeUndefined()
  })
  it('form y build sobreviven al guardado; build solo se escribe si es verdad', () => {
    const d = diagram(`{"type":"diagram","form":"venn","build":true,${N}}`)
    expect(d.build).toBe(true)
    expect(roundTrip(d)).toEqual(d)
    const enc = encodeBlock(d)
    expect(enc.form).toBe('venn')
    expect(enc.kind).toBe('concept')
    expect(enc.build).toBe(true)
    const off = diagram(`{"type":"diagram","form":"pyramid","build":false,${N}}`)
    expect('build' in off).toBe(false)
    expect('build' in encodeBlock(off)).toBe(false)
  })
  it('un diagrama de antes no cambia (ni gana claves)', () => {
    const json = '{"id":"d1","type":"diagram","kind":"cycle","title":"T","direction":"tb","nodes":[{"id":"a","label":"A","shape":"box"},{"id":"b","label":"B","shape":"round"}],"edges":[{"from":"a","to":"b","dashed":false,"arrow":true}]}'
    const d = diagram(json)
    expect(d.form).toBeUndefined()
    expect(encodeBlock(d)).toEqual(parseJSON(json))
    // «mindmap» como `kind` de antes se leía como flujo: ahora es la forma
    expect(diagram(`{"type":"diagram","kind":"tree",${N}}`).form).toBeUndefined()
  })
  it('alias con acentos, guiones y mayúsculas', () => {
    expect(parseDiagramForm('Pirámide')).toBe('pyramid')
    expect(parseDiagramForm('mind-map')).toBe('mindmap')
    expect(parseDiagramForm('Diagrama de Venn')).toBe('venn')
    expect(parseDiagramForm('flow')).toBeUndefined()
    expect(parseDiagramForm('__proto__')).toBeUndefined()
  })
})

describe('comparar: filas clave/iguales y analogía', () => {
  it('lee el tono de cada fila (con alias) y lo guarda', () => {
    const c = compare('{"type":"compare","leftTitle":"Mitosis","rightTitle":"Meiosis","rows":[{"label":"Divisiones","left":"1","right":"2","tone":"accent"},{"left":"ADN","right":"ADN","tone":"muted"},{"left":"x","right":"y","tone":"rainbow"}]}')
    expect(c.rows.map((r) => r.tone)).toEqual(['key', 'same', undefined])
    expect(roundTrip(c)).toEqual(c)
    expect(parseCompareTone('Clave')).toBe('key')
  })
  it('modo analogía: por `mode` o por el tipo de bloque («analogy», «metáfora»)', () => {
    const a = compare('{"type":"analogy","leftTitle":"Célula","rightTitle":"Fábrica","rows":[{"left":"Núcleo","right":"Oficina"}]}')
    expect(a.mode).toBe('analogy')
    expect(compare('{"type":"compare","mode":"metaphor","leftTitle":"A","rightTitle":"B","rows":[]}').mode).toBe('analogy')
    expect(roundTrip(a)).toEqual(a)
    expect(encodeBlock(a).mode).toBe('analogy')
  })
  it('una comparación de antes no gana claves', () => {
    const json = '{"id":"c1","type":"compare","leftTitle":"A","rightTitle":"B","rows":[{"left":"1","right":"2"}]}'
    expect(encodeBlock(compare(json))).toEqual(parseJSON(json))
  })
})
