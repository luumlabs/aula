// La guía y block_reference enseñan las formas ya hechas y los ejemplos que dan se leen y validan sin errores.
import { describe, expect, it } from 'vitest'
import { parseJSON, type JSONValue } from '@engine/base/json'
import { ContentValidator } from '@engine/content/validator'
import { normalizeBlock } from '@engine/content/normalizer'
import { DIAGRAM_FORMS, decodeBlock } from '@shared/schema'
import { BLOCK_REFERENCE, authoringGuide, blockReferenceKey } from './guide'

describe('guía de las formas ya hechas', () => {
  it('la guía nombra cada forma, el modo analogía y el tono de las filas', () => {
    const g = authoringGuide('guided')
    for (const f of DIAGRAM_FORMS) expect(g).toContain(f)
    expect(g).toContain('"mode":"analogy"')
    expect(g).toContain('"tone":"key|same"')
    expect(g).toContain('red pen')
  })
  it('block_reference de una forma lleva a la referencia del diagrama', () => {
    for (const t of ['venn', 'pyramid', 'funnel', 'mindmap', 'mapamental', 'shapes', 'diagram']) expect(blockReferenceKey(t)).toBe('process')
    for (const f of DIAGRAM_FORMS) expect(BLOCK_REFERENCE.process).toContain(`"form":"${f}"`)
  })
  it('cada ejemplo de forma de la referencia se lee y valida sin errores ni avisos', () => {
    const examples = BLOCK_REFERENCE.process.split('\n').filter((l) => l.startsWith('{"type":"diagram","form"'))
    expect(examples).toHaveLength(DIAGRAM_FORMS.length)
    const v = new ContentValidator()
    for (const line of examples) {
      const b = decodeBlock(normalizeBlock(parseJSON(line) as JSONValue))
      expect(b?.type).toBe('diagram')
      const issues = v.checkBlock(b!, 'ejemplo').filter((i) => i.severity !== 'info')
      expect(issues, line.slice(0, 60)).toEqual([])
    }
  })
})
