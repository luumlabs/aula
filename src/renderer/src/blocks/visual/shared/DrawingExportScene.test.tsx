import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DrawingRenderSceneV1, PreparedVisibleItem } from '@shared/figuresDrawing'
import { DrawingExportScene } from './DrawingExportScene'

function item(sourceIndex: number): PreparedVisibleItem {
  return { sourceIndex, opacity: sourceIndex ? 0.3 : 1, transform: { dx: 12, dy: -8, deg: 30, px: 40, py: 20 },
    paths: [{ d: `M${sourceIndex} 0L30 0L30 20Z`, fill: { kind: 'hatch', color: '#029791' }, stroke: '#201e1a', width: 2, strokeOpacity: 0.8, fillOpacity: 0.3, dashed: true, offset: { x: 0.7, y: 0.9 } }],
    labels: [{ x: -20, y: 10, text: sourceIndex ? '$\\frac{a_1}{\\sqrt{b}}$' : 'مرحبا', anchor: 'right', size: 18, color: '#201e1a' }],
    rings: [{ x: -30, y: -20, width: 50, height: 40, viewWidth: 52, viewHeight: 40, color: '#b4502f', strokes: [{ d: 'M0 0L50 0L50 40Z', spine: 'M0 0L50 0', dry: 'M5 0L8 0', reach: 6, dryWidth: 0.3 }] }]
  }
}
const scene: DrawingRenderSceneV1 = { version: 1, canvas: { width: 400, height: 300 }, metrics: { pixelWidth: 600, layoutWidth: 600, textK: 1.15, unitsPerPx: 0.76, rootFontPx: 15, bodyFont: 'sans', bodyItalic: false }, appearance: { theme: 'light', language: 'ar', direction: 'rtl', palette: { paper: '#fcfaf5', text: '#201e1a', text2: '#585550', text3: '#6c6862', brick: '#b4502f', accent: '#029791', link: '#9c4527' } }, items: [item(2), item(0)], output: { scale: 2 } }

describe('escena estática completa Drawing', () => {
  it('pinta SVG y posiciones de etiqueta al ancho CSS; fuentes y rodeados conservan sus píxeles preparados', () => {
    const nested = { ...scene, metrics: { ...scene.metrics, layoutWidth: 300 } }
    const html = renderToStaticMarkup(<DrawingExportScene scene={nested} />)
    expect(html).toContain('width:300px;height:225px')
    expect(html).toContain('left:-15px;top:7.5px;font-size:18px')
    expect(html).toContain('left:-30px;top:-20px;width:50px;height:40px')
    expect(html).not.toContain('width:600px;height:450px')
  })
  it('conserva sans normal y la herencia serif/cursiva de una diapositiva', () => {
    expect(renderToStaticMarkup(<DrawingExportScene scene={scene} />)).toContain('font-family:var(--font-sans);font-style:normal')
    const inherited = { ...scene, metrics: { ...scene.metrics, bodyFont: 'serif' as const, bodyItalic: true } }
    const html = renderToStaticMarkup(<DrawingExportScene scene={inherited} />)
    expect(html).toContain('font-family:var(--font-serif);font-style:italic')
    expect(html).toContain('katex-html')
    expect(html).not.toContain('font-family:var(--font-sans)')
  })
  it('conserva capas, stroke, patrón local y máscara seca sin animaciones ni controles', () => {
    const html = renderToStaticMarkup(<DrawingExportScene scene={scene} />)
    expect(html).toContain('patternTransform="rotate(45)"')
    expect(html).toContain('stroke-width="1.1"')
    expect(html).toContain('stroke-dasharray="6 5"')
    expect(html).toContain('stroke-linecap="round"')
    expect(html).toContain('stroke-linejoin="round"')
    expect(html).toContain('stroke="#000" stroke-width="0.3"')
    expect(html).toContain('mask="url(#r-0-0-0)"')
    expect(html).not.toMatch(/data-reveal|data-ask|<button|<input|foreignObject|href=|src=/)
    expect(html).toContain('katex-html')
    expect(html).toContain('مرحبا')
  })
  it('pinta todas las formas, luego todos los textos y finalmente Ink por índice original', () => {
    const html = renderToStaticMarkup(<DrawingExportScene scene={scene} />)
    expect(html.indexOf('id="h-2-0"')).toBeLessThan(html.indexOf('id="h-0-0"'))
    expect(html.indexOf('id="h-0-0"')).toBeLessThan(html.indexOf('data-drawing-label'))
    expect(html.lastIndexOf('data-drawing-label')).toBeLessThan(html.indexOf('id="r-0-0-0"'))
    expect(html.indexOf('id="r-0-0-0"')).toBeLessThan(html.indexOf('id="r-2-0-0"'))
    expect(html).toContain('left:-30px;top:15px;font-size:18px')
    expect(html).toContain('width:600px;height:450px')
  })
  it('es determinista y no modifica la instantánea', () => {
    const before = JSON.stringify(scene)
    expect(renderToStaticMarkup(<DrawingExportScene scene={scene} />)).toBe(renderToStaticMarkup(<DrawingExportScene scene={scene} />))
    expect(JSON.stringify(scene)).toBe(before)
  })
})
