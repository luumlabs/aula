// El recorrido guiado de las figuras etiquetadas (`labeled.steps`): se lee tolerante y, sin pasos, el JSON sale igual que antes.
import { describe, expect, it } from 'vitest'
import { decodeBlock, encodeBlock } from './blocks'
import { decodeLabeledStep } from './visual'

const OLD = '{"type":"labeled","asset":"h.png","alt":"corazón","parts":[{"id":"ao","name":"Aorta","x":0.5,"y":0.2,"r":0.05}]}'

describe('labeled.steps', () => {
  it('un curso de antes se lee sin pasos y se vuelve a escribir sin la clave `steps`', () => {
    const b = decodeBlock(JSON.parse(OLD))
    expect(b?.type).toBe('labeled')
    if (b?.type !== 'labeled') return
    expect(b.steps).toBeUndefined()
    expect(Object.keys(encodeBlock(b))).not.toContain('steps')
  })

  it('ida y vuelta con título, texto y partes', () => {
    const raw = JSON.parse(OLD)
    raw.steps = [{ title: 'Sale la sangre', md: 'Por la **aorta**.', parts: ['ao'] }, 'Y vuelve por las venas.']
    const b = decodeBlock(raw)
    if (b?.type !== 'labeled') throw new Error('no es labeled')
    expect(b.steps).toEqual([{ title: 'Sale la sangre', md: 'Por la **aorta**.', parts: ['ao'] }, { md: 'Y vuelve por las venas.', parts: [] }])
    const again = decodeBlock(JSON.parse(JSON.stringify(encodeBlock(b))))
    expect(again).toEqual(b)
    expect(encodeBlock(b).steps).toEqual([{ title: 'Sale la sangre', md: 'Por la **aorta**.', parts: ['ao'] }, { md: 'Y vuelve por las venas.' }])
  })

  it('acepta `part` suelto, `nodes` y `text`; lo que no es un paso se salta', () => {
    expect(decodeLabeledStep({ part: 'ao', text: 'La aorta' })).toEqual({ md: 'La aorta', parts: ['ao'] })
    expect(decodeLabeledStep({ nodes: ['a', 'b'], md: 'x' })).toEqual({ md: 'x', parts: ['a', 'b'] })
    expect(decodeLabeledStep({ parts: 'a', part: 'b', md: 'x' })).toEqual({ md: 'x', parts: ['b', 'a'] })
    expect(decodeLabeledStep(42)).toBeUndefined()
    expect(decodeLabeledStep('   ')).toBeUndefined()
  })

  it('como mucho 40 pasos', () => {
    const raw = JSON.parse(OLD)
    raw.steps = Array.from({ length: 60 }, (_, i) => `Paso ${i}`)
    const b = decodeBlock(raw)
    expect(b?.type === 'labeled' && b.steps?.length).toBe(40)
  })
})
