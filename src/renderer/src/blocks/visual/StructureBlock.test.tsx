import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import '@renderer/i18n'
import { decodeBlock, type BlockOf } from '@shared/schema/blocks'
import { estimateMeasure } from '@engine/chem/structure-depict'
import { makeBlockContext } from '../types'
import StructureBlock, { GroupChips, StructureDrawing } from './StructureBlock'
import { formulaCe, shownGroups, stepAtoms, structureView, type ShownGroup } from './lib/structureView'

const block = (o: object): BlockOf<'structure'> => decodeBlock({ type: 'structure', ...o }) as BlockOf<'structure'>

/** El dibujo de una SMILES como lo pinta el bloque (sin medidas de ventana). */
function drawing(smiles: string, opts: { animate?: boolean; active?: number[]; groups?: object[]; autoGroups?: boolean } = {}): string {
  const b = block({ smiles, groups: opts.groups ?? [], autoGroups: opts.autoGroups ?? false })
  const view = structureView(b, 'skeletal', estimateMeasure)
  if (!view.ok) throw new Error('no se dibujó')
  const groups = shownGroups(b, view.mol, false)
  return renderToStaticMarkup(
    <StructureDrawing
      d={view.depiction}
      mol={view.mol}
      width={400}
      height={300}
      dark={false}
      groups={groups}
      groupColor={() => 'var(--viz-blue)'}
      groupLabel={(g) => g.label ?? g.kind ?? ''}
      active={opts.active ?? null}
      activeSet={opts.active ? new Set(opts.active) : null}
      hover={null}
      setHover={() => undefined}
      animate={opts.animate ?? false}
      run
      seed="t"
      atomAsk={(i) => `átomo ${i + 1}`}
    />
  )
}
const inkPaths = (html: string): string[] => [...html.matchAll(/<path[^>]*stroke="var\(--text\)"[^>]*stroke-width="1.6"[^>]*>/g)].map((m) => m[0])

describe('bloque structure en pantalla', () => {
  it('la aspirina: un trazo por cada segmento de enlace', () => {
    const view = structureView(block({ smiles: 'CC(=O)OC1=CC=CC=C1C(=O)O' }), 'skeletal', estimateMeasure)
    if (!view.ok) throw new Error('no se dibujó')
    const segments = view.depiction.bonds.reduce((s, b) => s + b.segments.length, 0)
    expect(inkPaths(drawing('CC(=O)OC1=CC=CC=C1C(=O)O'))).toHaveLength(segments)
  })
  it('el benceno lleva su círculo', () => {
    const html = drawing('c1ccccc1')
    expect([...html.matchAll(/<path[^>]*stroke-width="1.4"[^>]*>/g)]).toHaveLength(1)
  })
  it('cada átomo y cada grupo llevan su marca para preguntar al tutor', () => {
    const html = drawing('CCO', { groups: [{ atoms: [3], label: 'hidroxilo' }] })
    expect(html).toContain('data-ask-part="atom-3"')
    expect(html).toContain('data-ask-label="átomo 3"')
    expect(html).toContain('data-ask-part="group-g0"')
    expect(html).toContain('data-ask-label="hidroxilo"')
  })
  it('sin movimiento (impresión, movimiento reducido) no hay trazado animado', () => {
    expect(drawing('CC(=O)O', { animate: false })).not.toMatch(/stroke-dasharray|pathLength|stroke-dashoffset/)
    expect(drawing('CC(=O)O', { animate: true })).toMatch(/stroke-dasharray|stroke-dashoffset/)
  })
  it('el grupo activo se rodea a mano en ladrillo y el resto se apaga', () => {
    const html = drawing('CC(=O)OCC', { active: [1, 2, 3] })
    expect(html).toContain('var(--pigment-brick')
    expect(html).toMatch(/opacity="0.3"/)
    expect(drawing('CC(=O)OCC')).not.toContain('var(--pigment-brick')
  })
  it('una SMILES mala enseña la ficha con el motivo y la fórmula', () => {
    const html = renderToStaticMarkup(<StructureBlock block={block({ smiles: 'C1CC', formula: 'C3H6', title: 'Ciclopropano' })} ctx={makeBlockContext(null, 'es')} />)
    expect(html).toContain('data-structure-broken')
    expect(html).toContain('C1CC')
    expect(html).toMatch(/ring 1|anillo 1/i)
  })
  it('los botones de grupo dicen si están pulsados (y no son partes que marcar: están fuera del dibujo)', () => {
    const groups: ShownGroup[] = [{ key: 'a', label: 'Éster', atoms: [1] }, { key: 'b', label: 'Ácido', atoms: [2] }]
    const html = renderToStaticMarkup(<GroupChips groups={groups} groupColor={() => 'red'} groupLabel={(g) => g.label ?? ''} active="b" onPick={() => undefined} printing={false} />)
    expect([...html.matchAll(/aria-pressed="(true|false)"/g)].map((m) => m[1])).toEqual(['false', 'true'])
    expect(html).not.toContain('data-ask-part')
  })
  it('el lienzo donde se marca es el dibujo, no el bloque entero', () => {
    const html = renderToStaticMarkup(<StructureBlock block={block({ smiles: 'CC(=O)OCC', autoGroups: true })} ctx={makeBlockContext(null, 'es')} />)
    expect(html.match(/data-ask-canvas/g)).toHaveLength(1)
    // la cabecera y los botones de grupo quedan fuera del lienzo
    const canvasAt = html.indexOf('data-ask-canvas')
    expect(html.search(/Fórmula estructural|Structural formula/)).toBeGreaterThan(-1)
    expect(html.search(/Fórmula estructural|Structural formula/)).toBeLessThan(canvasAt)
    expect(html.lastIndexOf('aria-pressed')).toBeGreaterThan(canvasAt)
    expect(html.slice(canvasAt).match(/data-ask-part="group-/g) ?? []).toHaveLength(0)
  })
})

describe('en el enunciado de un ejercicio sin resolver', () => {
  const ethanol = block({ smiles: 'CCO', title: 'Etanol', autoGroups: true, groups: [{ atoms: [3], label: 'hidroxilo', md: 'El grupo del alcohol' }], steps: [{ md: 'El OH' }, { md: 'El C' }] })
  const render = (b: BlockOf<'structure'>, inPrompt: boolean): string =>
    renderToStaticMarkup(<StructureBlock block={b} ctx={makeBlockContext(null, 'es', inPrompt ? { inPrompt: true, exerciseId: 'e1' } : {})} />)
  it('no dice el nombre, la fórmula, la masa molar, los grupos ni el recorrido; resuelto, todo vuelve', () => {
    const open = render(ethanol, false)
    expect(open).toContain('Etanol')
    expect(open).toContain('g/mol')
    expect(open).toContain('katex')
    expect(open).toContain('hidroxilo')
    expect(open).toMatch(/Recorrer|Walk through/)
    const prompt = render(ethanol, true)
    expect(prompt).not.toContain('Etanol')
    expect(prompt).not.toContain('g/mol')
    expect(prompt).not.toContain('katex')
    expect(prompt).not.toContain('hidroxilo')
    expect(prompt).not.toContain('Alcohol')
    expect(prompt).not.toContain('aria-pressed')
    expect(prompt).not.toMatch(/Recorrer|Walk through/)
    // la molécula sí se dibuja y se recorre
    expect(prompt).toContain('data-ask-canvas')
    expect(prompt).toMatch(/Fórmula estructural|Structural formula/)
  })
  it('la fórmula del aria-label tampoco', () => {
    expect(render(block({ smiles: 'CCO', alt: 'Una molécula' }), true)).not.toContain('C2H6O')
    expect(render(block({ smiles: 'CCO', alt: 'Una molécula' }), false)).toContain('C2H6O')
  })
  it('una SMILES que no se lee no enseña la fórmula escrita ni el título', () => {
    const bad = block({ smiles: 'C1CC', formula: 'C3H6', title: 'Ciclopropano' })
    expect(render(bad, false)).toMatch(/Su fórmula molecular|Its molecular formula/)
    const prompt = render(bad, true)
    expect(prompt).toContain('data-structure-broken')
    expect(prompt).not.toMatch(/Su fórmula molecular|Its molecular formula/)
    expect(prompt).not.toContain('Ciclopropano')
  })
  it('los grupos escritos se ven en el dibujo, pero sin su nombre para marcar', () => {
    const b = block({ smiles: 'CCO', groups: [{ atoms: [3], label: 'hidroxilo' }] })
    const view = structureView(b, 'skeletal', estimateMeasure)
    if (!view.ok) throw new Error('no se dibujó')
    const html = renderToStaticMarkup(
      <StructureDrawing d={view.depiction} mol={view.mol} width={400} height={300} dark={false} groups={shownGroups(b, view.mol, false)} groupColor={() => 'red'}
        groupLabel={(g) => g.label ?? ''} askGroups={false} active={null} activeSet={null} hover={null} setHover={() => undefined} animate={false} run seed="t" atomAsk={(i) => `átomo ${i + 1}`} />
    )
    expect(html).not.toContain('group-g0')
    expect(html).not.toContain('hidroxilo')
    expect(html).toContain('fill="red"')
  })
})

describe('piezas del bloque', () => {
  it('autoGroups junta los grupos del mismo tipo (los 5 alcoholes de la glucosa en un botón)', () => {
    const b = block({ smiles: 'OC[C@@H](O)[C@@H](O)[C@H](O)[C@@H](O)C=O', autoGroups: true })
    const view = structureView(b, 'skeletal', estimateMeasure)
    if (!view.ok) throw new Error('no se dibujó')
    const groups = shownGroups(b, view.mol, false)
    expect(groups.map((g) => g.kind)).toEqual(['aldehyde', 'alcohol'])
    expect(groups[1].atoms).toHaveLength(5)
  })
  it('un paso apunta a su grupo por el nombre o a sus átomos', () => {
    const groups: ShownGroup[] = [{ key: 'g0', label: 'Éster', atoms: [1, 2, 3] }]
    expect(stepAtoms({ group: 'éster' }, groups, 6)).toEqual([1, 2, 3])
    expect(stepAtoms({ atoms: [1, 9] }, groups, 6)).toEqual([0])
  })
  it('la desarrollada solo hasta 15 átomos; las reacciones no la tienen', () => {
    const big = structureView(block({ smiles: 'C'.repeat(16) }), 'expanded', estimateMeasure)
    expect(big.ok && big.style).toBe('condensed')
    const rx = structureView(block({ smiles: 'CCO>>CC=O' }), 'skeletal', estimateMeasure)
    expect(rx.ok && rx.styles).toEqual(['skeletal', 'condensed'])
  })
  it('la desarrollada de las moléculas de clase: los H no se pisan en pantalla', () => {
    for (const smiles of ['CC(C)C', 'CC(C)=O', 'CC(C)(C)C', 'CC(C)(C)O', 'CC1CCCCC1', 'OC1CCCCC1', 'OC[C@H]1O[C@@H](O)[C@H](O)[C@@H](O)[C@@H]1O']) {
      const view = structureView(block({ smiles }), 'expanded', estimateMeasure)
      if (!view.ok) throw new Error(smiles)
      expect(view.style, smiles).toBe('expanded')
      const pts = view.depiction.atoms
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y), `${smiles}: ${i + 1}~${j + 1}`).toBeGreaterThan(0.7 * 46)
      }
    }
  })
  it('si la desarrollada sale encimada no se ofrece (se ve la semidesarrollada)', () => {
    const view = structureView(block({ smiles: 'CCC1(C)CCCCC1' }), 'expanded', estimateMeasure)
    expect(view.ok && view.styles).toEqual(['skeletal', 'condensed'])
    expect(view.ok && view.style).toBe('condensed')
  })
  it('la fórmula bajo el dibujo: una por sustancia; nada con un «*» suelto', () => {
    const ce = (smiles: string): string | undefined => {
      const view = structureView(block({ smiles }), 'skeletal', estimateMeasure)
      return view.ok ? formulaCe(view.parsed, false)?.ce : 'error'
    }
    expect(ce('CCCC.CC(C)C')).toBe('C4H10, C4H10')
    expect(ce('[Na+].[Cl-]')).toBe('NaCl')
    expect(ce('*')).toBeUndefined()
  })
})
