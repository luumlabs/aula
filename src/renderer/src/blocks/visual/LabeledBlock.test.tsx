import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import '@renderer/i18n'
import type { FigurePart } from '@shared/schema/visual'
import { GutterLabels } from './LabeledBlock'
import { PrintedTour, TourLayer, TourPanel } from './shared/FigureTour'
import { makeTransform } from './lib/viewTransform'

const parts: FigurePart[] = [
  { id: 'a', name: 'Aorta', aliases: [], x: 0.3, y: 0.2, r: 0.05 },
  { id: 'v', name: 'Ventrículo', aliases: [], x: 0.7, y: 0.7, rect: [0.6, 0.6, 0.2, 0.2] }
]
const tf = makeTransform({ width: 400, height: 300 }, { width: 400, height: 300 })
const noop = (): void => undefined
const paths = (html: string): string[] => [...html.matchAll(/<path[^>]*>/g)].map((m) => m[0])

describe('líneas de los nombres en el margen', () => {
  it('sobre una foto cada línea lleva un halo de papel debajo (dos trazos); sobre un dibujo, uno', () => {
    const photo = renderToStaticMarkup(<GutterLabels parts={parts} tf={tf} gutter={140} width={680} hovered={null} selected={null} photo tint={() => 'red'} onSelect={noop} onHover={noop} animate={false} play />)
    expect(paths(photo)).toHaveLength(4)
    expect(paths(photo).filter((p) => p.includes('stroke="var(--surface)"'))).toHaveLength(2)
    const drawing = renderToStaticMarkup(<GutterLabels parts={parts} tf={tf} gutter={140} width={680} hovered={null} selected={null} tint={() => 'red'} onSelect={noop} onHover={noop} animate={false} play />)
    expect(paths(drawing)).toHaveLength(2)
  })

  it('en el recorrido, lo que no cuenta el paso se apaga', () => {
    const html = renderToStaticMarkup(<GutterLabels parts={parts} tf={tf} gutter={140} width={680} hovered={null} selected={null} focus={new Set(['a'])} tint={() => 'red'} onSelect={noop} onHover={noop} animate={false} play />)
    expect(html.match(/opacity:0\.3/g)).toHaveLength(1)
  })
})

describe('el recorrido guiado', () => {
  it('un velo con un hueco por parte y un lazo de ladrillo alrededor de cada una', () => {
    const html = renderToStaticMarkup(<TourLayer focus={parts} fitted={{ width: 400, height: 300 }} step={0} seed="fig" reduced />)
    expect(html.match(/<mask /g)).toHaveLength(3) // el velo y una máscara por trazo de cada lazo
    expect(html.match(/fill="#000"/g)).toHaveLength(2)
    expect(html.match(/var\(--pigment-brick\)/g)).toHaveLength(2)
    expect(html).not.toMatch(/gradient/i)
  })

  it('sin empezar: «Recorrer la figura» con el número de pasos; dentro: un punto por paso y el texto del paso (en inglés en las pruebas)', () => {
    const steps = [{ md: 'Primero', parts: ['a'] }, { title: 'Después', md: 'El ventrículo', parts: ['v'] }]
    const idle = renderToStaticMarkup(<TourPanel steps={steps} step={null} playing={false} parts={parts} reduced onGo={noop} onToggle={noop} onAll={noop} />)
    expect(idle).toContain('Tour the figure')
    expect(idle).toContain('2 steps')
    const on = renderToStaticMarkup(<TourPanel steps={steps} step={1} playing={false} parts={parts} reduced onGo={noop} onToggle={noop} onAll={noop} />)
    expect(on.match(/aria-label="Step \d: /g)).toHaveLength(2)
    expect(on).toContain('aria-label="Step 1: Aorta"')
    expect(on).toContain('aria-current="step"')
    expect(on).toContain('El ventrículo')
  })

  it('en papel, una lista numerada con las partes de cada paso como título si no tiene', () => {
    const html = renderToStaticMarkup(<PrintedTour steps={[{ md: 'Sale por aquí', parts: ['a'] }, { title: 'Vuelve', md: 'Por el ventrículo', parts: [] }]} parts={parts} />)
    expect(html.match(/<li /g)).toHaveLength(2)
    expect(html).toContain('Aorta')
    expect(html).toContain('Vuelve')
  })
})
