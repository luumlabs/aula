// Los alias de las formas: solo los nombres que dicen la forma. «hierarchy»/«jerarquía» (un árbol, un organigrama) se leen
// como antes de las formas: flujo, con sus flechas.
import { describe, expect, it } from 'vitest'
import { decodeBlock, encodeBlock, type BlockOf } from './blocks'
import { parseDiagramForm } from './diagramForms'

describe('alias de las formas', () => {
  it('«hierarchy» y «jerarquía» no nombran ninguna forma', () => {
    for (const raw of ['hierarchy', 'Hierarchy', 'jerarquía', 'Jerarquia']) expect(parseDiagramForm(raw), raw).toBeUndefined()
    for (const raw of ['pirámide', 'Pyramid', 'pyramide']) expect(parseDiagramForm(raw), raw).toBe('pyramid')
    expect(parseDiagramForm('pirámide invertida')).toBe('funnel')
  })
  it('un diagrama con `kind: "hierarchy"` se lee y se guarda como flujo (como antes de las formas)', () => {
    const d = decodeBlock({ id: 'd', type: 'diagram', kind: 'hierarchy', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }] }) as BlockOf<'diagram'>
    expect(d.form).toBeUndefined()
    expect(d.kind).toBe('flow')
    const saved = encodeBlock(d) as Record<string, unknown>
    expect(saved.kind).toBe('flow')
    expect('form' in saved).toBe(false)
    expect(saved.edges).toEqual([{ from: 'a', to: 'b', dashed: false, arrow: true }])
  })
})
