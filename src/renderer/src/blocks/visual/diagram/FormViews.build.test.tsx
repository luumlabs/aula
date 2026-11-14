// Formas que se construyen paso a paso (`build`) y el paso de vista general: lo que aún no ha salido no se ve, no se toca y no
// se nombra («Marcar» no lo encuentra); un paso sin nodos enseña la figura entera sin apagar nada.
import { beforeAll, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import i18n from '@renderer/i18n'
import { revealedAt } from '@engine/content/diagram-forms'
import { decodeBlock, type BlockOf } from '@shared/schema/blocks'
import { Node as DiagramNode } from '../DiagramBlock'
import { layoutMindmap, layoutPyramid, layoutVenn } from '../lib/diagramForms'
import { estimateMeasure, layoutDiagram, stepHighlight } from '../lib/diagramLayout'
import { DIM, MindmapView, PyramidView, VennView, type FormViewProps } from './FormViews'

const diagram = (raw: Record<string, unknown>): BlockOf<'diagram'> => decodeBlock({ type: 'diagram', ...raw }) as BlockOf<'diagram'>
const props = (b: BlockOf<'diagram'>, step: number | null): FormViewProps => ({ b, blockId: 'blk', hl: stepHighlight(b, step), revealed: revealedAt(b, step), step, animate: false, run: true, printing: false })

beforeAll(async () => { await i18n.changeLanguage('es') })

describe('con `build`, lo que aún no ha salido no se puede señalar', () => {
  it('pirámide: solo la cúspide en el primer paso', () => {
    const b = diagram({ form: 'pyramid', build: true, nodes: [{ id: 'a', label: 'Cima' }, { id: 'b', label: 'Medio', detail: 'Lo de en medio' }, { id: 'c', label: 'Base' }], steps: [{ md: '1', nodes: ['a'] }, { md: '2', nodes: ['b', 'c'] }] })
    const l = layoutPyramid(b, estimateMeasure, false, true)
    const html = renderToStaticMarkup(<PyramidView layout={l} {...props(b, 0)} />)
    expect(html).toContain('data-ask-part="a"')
    expect(html).not.toContain('data-ask-part="b"')
    expect(html).not.toContain('data-ask-part="c"')
    expect(html).not.toContain('data-ask-label="Medio"')
    // invisible (Marcar descarta `visibility: hidden`), sin puntero y fuera del árbol de accesibilidad
    expect(html).toMatch(/visibility:hidden;pointer-events:none/)
    expect(html).toContain('aria-hidden="true"')
    // al final, todo se puede señalar
    const all = renderToStaticMarkup(<PyramidView layout={l} {...props(b, 1)} />)
    for (const id of ['a', 'b', 'c']) expect(all).toContain(`data-ask-part="${id}"`)
    expect(all).not.toContain('visibility:hidden')
  })
  it('Venn: el conjunto que no ha salido, ni su región ni sus elementos', () => {
    const b = diagram({
      form: 'venn', build: true,
      nodes: [{ id: 'mi', label: 'Mitosis', shape: 'circle' }, { id: 'me', label: 'Meiosis', shape: 'circle' }, { id: 'x', label: '2 células' }, { id: 'y', label: 'ADN' }, { id: 'z', label: 'Virus' }],
      edges: [{ from: 'x', to: 'mi' }, { from: 'y', to: 'mi' }, { from: 'y', to: 'me' }],
      steps: [{ md: '1', nodes: ['x'] }, { md: '2', nodes: ['y'] }, { md: '3', nodes: ['z'] }]
    })
    const l = layoutVenn(b, estimateMeasure)!
    const html = renderToStaticMarkup(<VennView layout={l} hover={null} onHover={() => undefined} {...props(b, 0)} />)
    expect(html).toContain('data-ask-part="mi"')
    expect(html).toContain('data-ask-part="x"')
    expect(html).toContain('data-ask-part="region:mi"')
    for (const hidden of ['me', 'y', 'z', 'region:mi&amp;me']) expect(html).not.toContain(`data-ask-part="${hidden}"`)
    // el título de Meiosis está, pero invisible (y sin nombre para «Marcar»)
    const title = html.slice(0, html.indexOf('Meiosis'))
    expect(title.slice(title.lastIndexOf('<div')).match(/visibility:hidden/)).not.toBeNull()
    // el rótulo «fuera de los conjuntos» espera a que salga algo de fuera
    const outside = html.slice(0, html.indexOf('Fuera de los conjuntos'))
    expect(outside.slice(outside.lastIndexOf('<div'))).toMatch(/visibility:hidden.*aria-hidden="true"/)
    const done = renderToStaticMarkup(<VennView layout={l} hover={null} onHover={() => undefined} {...props(b, 2)} />)
    for (const id of ['mi', 'me', 'x', 'y', 'z', 'region:mi&amp;me']) expect(done).toContain(`data-ask-part="${id}"`)
  })
  it('Venn: pasar el ratón por un conjunto que no ha salido no lo sombrea', () => {
    const b = diagram({ form: 'venn', build: true, nodes: [{ id: 'a', label: 'A', shape: 'circle' }, { id: 'b', label: 'B', shape: 'circle' }, { id: 'x', label: 'x' }], edges: [{ from: 'x', to: 'a' }], steps: [{ md: '1', nodes: ['x'] }, { md: '2', nodes: ['b'] }] })
    const l = layoutVenn(b, estimateMeasure)!
    const shade = /fill="color-mix\(in oklab, var\(--text\) 9%/
    expect(renderToStaticMarkup(<VennView layout={l} hover="set:b" onHover={() => undefined} {...props(b, 0)} />)).not.toMatch(shade)
    expect(renderToStaticMarkup(<VennView layout={l} hover="a&b" onHover={() => undefined} {...props(b, 0)} />)).not.toMatch(shade)
    expect(renderToStaticMarkup(<VennView layout={l} hover="set:b" onHover={() => undefined} {...props(b, 1)} />)).toMatch(shade)
  })
  it('mapa mental: la rama que no ha salido no se nombra', () => {
    const b = diagram({ form: 'mindmap', build: true, nodes: [{ id: 'r', label: 'Tema' }, { id: 'a', label: 'Rama' }, { id: 'c', label: 'Otra', detail: 'Más' }], edges: [{ from: 'r', to: 'a' }, { from: 'r', to: 'c' }], steps: [{ md: '1', nodes: ['a'] }, { md: '2', nodes: ['c'] }] })
    const html = renderToStaticMarkup(<MindmapView layout={layoutMindmap(b, estimateMeasure)!} {...props(b, 0)} />)
    expect(html).toContain('data-ask-part="r"')
    expect(html).toContain('data-ask-part="a"')
    expect(html).not.toContain('data-ask-part="c"')
    expect(html).not.toContain('data-ask-label="Otra"')
  })
  it('nodo del grafo: oculto, sin `data-ask-*` y sin puntero', () => {
    const b = diagram({ nodes: [{ id: 'a', label: 'Uno' }, { id: 'b', label: 'Dos' }], edges: [{ from: 'a', to: 'b' }] })
    const n = layoutDiagram(b, estimateMeasure).nodes[1]
    const base = { n, on: false, dim: false, hovered: false, layers: false, animate: false, run: true, delay: 0, onHover: () => undefined }
    const hidden = renderToStaticMarkup(<DiagramNode {...base} hidden />)
    expect(hidden).not.toContain('data-ask-part')
    expect(hidden).not.toContain('data-ask-label')
    expect(hidden).toContain('aria-hidden="true"')
    expect(hidden).toMatch(/pointer-events:none;visibility:hidden/)
    const shown = renderToStaticMarkup(<DiagramNode {...base} hidden={false} />)
    expect(shown).toContain('data-ask-part="b"')
    expect(shown).toContain('data-ask-label="Dos"')
    expect(shown).not.toContain('visibility:hidden')
  })
})

describe('un paso sin nodos es la vista general', () => {
  it('no apaga ni rodea nada', () => {
    const b = diagram({ form: 'pyramid', nodes: [{ id: 'a', label: 'Cima' }, { id: 'b', label: 'Base' }], steps: [{ md: 'Visión general' }, { md: '1', nodes: ['a'] }] })
    const l = layoutPyramid(b, estimateMeasure, false, true)
    const overview = renderToStaticMarkup(<PyramidView layout={l} {...props(b, 0)} />)
    expect(overview).not.toContain(`opacity:${DIM}`)
    expect(overview).not.toMatch(/color:var\(--pigment-brick\)/)
    const one = renderToStaticMarkup(<PyramidView layout={l} {...props(b, 1)} />)
    expect(one).toContain(`opacity:${DIM}`)
  })
})
