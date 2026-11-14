import { beforeAll, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import i18n from '@renderer/i18n'
import { decodeBlock, type BlockOf } from '@shared/schema/blocks'
import { makeBlockContext } from '../../types'
import { CompareBlockView } from '../../TableBlocks'
import { layoutMindmap, layoutPyramid, layoutVenn } from '../lib/diagramForms'
import { estimateMeasure, stepHighlight } from '../lib/diagramLayout'
import { MindmapView, PyramidView, VennView, type FormViewProps } from './FormViews'

const diagram = (raw: Record<string, unknown>): BlockOf<'diagram'> => decodeBlock({ type: 'diagram', ...raw }) as BlockOf<'diagram'>
const props = (b: BlockOf<'diagram'>, step: number | null): FormViewProps => ({ b, blockId: 'blk', hl: stepHighlight(b, step), revealed: undefined, step, animate: false, run: true, printing: false })
const count = (html: string, re: RegExp): number => (html.match(re) ?? []).length

beforeAll(async () => { await i18n.changeLanguage('es') })

describe('formas: partes para preguntar al tutor y rodeos de los pasos', () => {
  const pyr = diagram({ form: 'pyramid', nodes: [{ id: 'a', label: 'Cima' }, { id: 'b', label: 'Medio' }, { id: 'c', label: 'Base' }], steps: [{ md: '1', nodes: ['a'] }, { md: '2', nodes: ['b', 'c'] }] })
  it('cada nivel de la pirámide se puede señalar; el paso rodea a pluma (ladrillo) solo lo suyo', () => {
    const l = layoutPyramid(pyr, estimateMeasure, false, true)
    const all = renderToStaticMarkup(<PyramidView layout={l} {...props(pyr, null)} />)
    for (const id of ['a', 'b', 'c']) expect(all).toContain(`data-ask-part="${id}"`)
    expect(all).toContain('data-ask-label="Cima"')
    expect(count(all, /var\(--pigment-brick\)/g)).toBe(0)
    const two = renderToStaticMarkup(<PyramidView layout={l} {...props(pyr, 1)} />)
    expect(count(two, /color:var\(--pigment-brick\)/g)).toBe(2)
  })
  it('Venn: conjuntos, elementos y regiones con su nombre', () => {
    const v = diagram({ form: 'venn', nodes: [{ id: 'm', label: 'Mitosis', shape: 'circle' }, { id: 'e', label: 'Meiosis', shape: 'circle' }, { id: 'x', label: 'ADN' }], edges: [{ from: 'x', to: 'm' }, { from: 'x', to: 'e' }] })
    const html = renderToStaticMarkup(<VennView layout={layoutVenn(v, estimateMeasure)!} hover={null} onHover={() => undefined} {...props(v, null)} />)
    expect(html).toContain('data-ask-part="m"')
    expect(html).toContain('data-ask-part="x"')
    expect(html).toContain('data-ask-part="region:m&amp;e"')
    expect(html).toContain('data-ask-label="Mitosis y Meiosis"')
    expect(html).not.toMatch(/gradient/)
  })
  it('mapa mental: cada rama se puede señalar', () => {
    const m = diagram({ form: 'mindmap', nodes: [{ id: 'r', label: 'Tema' }, { id: 'a', label: 'Rama' }, { id: 'b', label: 'Hoja' }], edges: [{ from: 'r', to: 'a' }, { from: 'a', to: 'b' }] })
    const html = renderToStaticMarkup(<MindmapView layout={layoutMindmap(m, estimateMeasure)!} {...props(m, null)} />)
    for (const id of ['r', 'a', 'b']) expect(html).toContain(`data-ask-part="${id}"`)
    expect(html).not.toMatch(/gradient/)
  })
})

describe('comparar', () => {
  const ctx = makeBlockContext('demo', 'es')
  const cmp = (raw: Record<string, unknown>): BlockOf<'compare'> => decodeBlock({ type: 'compare', leftTitle: 'Mitosis', rightTitle: 'Meiosis', ...raw }) as BlockOf<'compare'>
  it('la fila «igual» con el mismo texto se escribe una vez; la clave lleva su marca', () => {
    const html = renderToStaticMarkup(<CompareBlockView block={cmp({ rows: [{ label: 'Hijas', left: '2', right: '4', tone: 'key' }, { label: 'ADN', left: 'Se copia', right: 'se copia', tone: 'same' }] })} ctx={ctx} />)
    expect(html).toContain('Diferencia clave')
    expect(html).toContain('Igual en ambos')
    expect(html).not.toContain('se copia')
    expect(html).toContain('data-ask-part="row-0-a"')
    expect(html).toContain('data-ask-label="Mitosis: 2"')
  })
  it('analogía: sin A/B y con «es como» entre cada pareja', () => {
    const html = renderToStaticMarkup(<CompareBlockView block={cmp({ mode: 'analogy', rows: [{ left: 'Núcleo', right: 'Oficina' }, { left: 'Mitocondria', right: 'Central eléctrica' }] })} ctx={ctx} />)
    expect(html).toContain('Analogía')
    expect(count(html, /es como/g)).toBe(2)
    expect(html).not.toMatch(/>A<\/span>/)
  })
})
