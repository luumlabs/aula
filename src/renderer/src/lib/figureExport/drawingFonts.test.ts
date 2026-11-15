import { describe, expect, it } from 'vitest'
import { assertDrawingFontState, drawingFontFamilies } from './drawingFonts'

describe('fuentes realmente solicitadas por el dibujo', () => {
  it('permite el fallback Inter sin cargar cuando la fuente de sistema ya pinta el texto', () => {
    const families = new Set(drawingFontFamilies('-apple-system, system-ui, "SF Pro Text", "Inter Variable", sans-serif'))
    expect(() => assertDrawingFontState('loaded', [{ family: 'Inter Variable', status: 'unloaded' }], families)).not.toThrow()
    expect([...families]).toEqual(['-apple-system', 'system-ui', 'sf pro text', 'inter variable', 'sans-serif'])
  })
  it('no congela una vista mientras sus fuentes siguen cargando', () => {
    expect(() => assertDrawingFontState('loading', [{ family: 'KaTeX_Main', status: 'loading' }], new Set(['katex_main']))).toThrow('not ready')
  })
  it('fonts.ready no convierte un fallo real de KaTeX en éxito parcial', () => {
    expect(() => assertDrawingFontState('loaded', [{ family: '"KaTeX_Main"', status: 'error' }], new Set(['katex_main']))).toThrow('failed')
  })
  it('no necesita la cara fallida de otra parte de la aplicación', () => {
    expect(() => assertDrawingFontState('loaded', [{ family: 'Other Face', status: 'error' }, { family: 'KaTeX_Main', status: 'loaded' }], new Set(['katex_main']))).not.toThrow()
  })
})
