import { afterEach, describe, expect, it, vi } from 'vitest'
import { FIGURE_FONTS, figureTypography } from './figureTypography'

const computed = { sans: 'system-ui, "Inter Variable", sans-serif', serif: 'ui-serif, "Newsreader Variable", serif', mono: 'ui-monospace, "JetBrains Mono", monospace', rounded: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif' }
function fixture(fontFamily: string, fontStyle = 'normal') {
  const probe = { style: { display: '', fontFamily: '' }, remove: vi.fn() }
  const element = { ownerDocument: { createElement: () => probe }, appendChild: vi.fn() } as unknown as HTMLElement
  vi.stubGlobal('getComputedStyle', (target: unknown) => {
    if (target === element) return { fontFamily, fontStyle }
    const key = (Object.keys(FIGURE_FONTS) as Array<keyof typeof FIGURE_FONTS>).find((key) => FIGURE_FONTS[key] === probe.style.fontFamily)
    return { fontFamily: key ? computed[key] : '' }
  })
  return { element, probe }
}
afterEach(() => { vi.unstubAllGlobals() })

describe('tipografía heredada y cerrada de figuras', () => {
  it('reconoce la fuente sans normal por defecto', () => {
    const { element } = fixture(computed.sans)
    expect(figureTypography(element)).toEqual({ bodyFont: 'sans', bodyItalic: false })
  })
  it.each(['sans', 'serif', 'mono', 'rounded'] as const)('congela %s y cursiva sin transportar el stack CSS', (family) => {
    const { element, probe } = fixture(computed[family], 'italic')
    expect(figureTypography(element)).toEqual({ bodyFont: family, bodyItalic: true })
    expect(probe.remove).toHaveBeenCalledOnce()
  })
  it('normaliza comillas y separadores, manteniendo las familias', () => {
    const { element } = fixture("ui-serif , 'Newsreader Variable' , serif")
    expect(figureTypography(element)).toEqual({ bodyFont: 'serif', bodyItalic: false })
  })
  it.each([['Private Font, serif', 'normal'], [computed.sans, 'oblique 20deg']])('rechaza fuentes y estilos no representables y elimina el probe', (font, style) => {
    const { element, probe } = fixture(font, style)
    expect(() => figureTypography(element)).toThrow(/Unsupported figure font/)
    expect(probe.remove).toHaveBeenCalledOnce()
  })
})
