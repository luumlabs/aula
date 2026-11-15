import { afterEach, describe, expect, it, vi } from 'vitest'
import { FIGURE_FONTS, figureCssZoom, figureTypography } from './figureTypography'

const computed = { sans: 'system-ui, "Inter Variable", sans-serif', serif: 'ui-serif, "Newsreader Variable", serif', mono: 'ui-monospace, "JetBrains Mono", monospace', rounded: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif' }
function fixture(fontFamily: string, fontStyle = 'normal') {
  const probe = { style: { display: '', fontFamily: '' }, remove: vi.fn() }
  const element = { ownerDocument: { createElement: () => probe }, appendChild: vi.fn() } as unknown as HTMLElement
  vi.stubGlobal('getComputedStyle', (target: unknown) => {
    if (target === element) return { fontFamily, fontStyle, zoom: '1' }
    const key = (Object.keys(FIGURE_FONTS) as Array<keyof typeof FIGURE_FONTS>).find((key) => FIGURE_FONTS[key] === probe.style.fontFamily)
    return { fontFamily: key ? computed[key] : '' }
  })
  return { element, probe }
}
afterEach(() => { vi.unstubAllGlobals() })

describe('tipografía heredada y cerrada de figuras', () => {
  it('reconoce la fuente sans normal por defecto', () => {
    const { element } = fixture(computed.sans)
    expect(figureTypography(element)).toEqual({ bodyFont: 'sans', bodyItalic: false, cssZoom: 1 })
  })
  it.each(['sans', 'serif', 'mono', 'rounded'] as const)('congela %s y cursiva sin transportar el stack CSS', (family) => {
    const { element, probe } = fixture(computed[family], 'italic')
    expect(figureTypography(element)).toEqual({ bodyFont: family, bodyItalic: true, cssZoom: 1 })
    expect(probe.remove).toHaveBeenCalledOnce()
  })
  it('normaliza comillas y separadores, manteniendo las familias', () => {
    const { element } = fixture("ui-serif , 'Newsreader Variable' , serif")
    expect(figureTypography(element)).toEqual({ bodyFont: 'serif', bodyItalic: false, cssZoom: 1 })
  })
  it.each([['Private Font, serif', 'normal'], [computed.sans, 'oblique 20deg']])('rechaza fuentes y estilos no representables y elimina el probe', (font, style) => {
    const { element, probe } = fixture(font, style)
    expect(() => figureTypography(element)).toThrow(/Unsupported figure font/)
    expect(probe.remove).toHaveBeenCalledOnce()
  })
})

function zoomFixture(zooms: string[]): HTMLElement {
  const chain: Array<{ parentElement: unknown }> = zooms.map(() => ({ parentElement: null }))
  chain.forEach((element, i) => { element.parentElement = chain[i + 1] ?? null })
  vi.stubGlobal('getComputedStyle', (element: typeof chain[number]) => ({ zoom: zooms[chain.indexOf(element)], transform: 'matrix(5, 0, 0, 5, 100, 200)' }))
  return chain[0] as unknown as HTMLElement
}

describe('zoom CSS de los ancestros de la figura', () => {
  it('multiplica canvas, contenedores y raíz sin confundir transforms con zoom', () => {
    expect(figureCssZoom(zoomFixture(['0.5', '1.75', '2', 'normal']))).toBe(1.75)
    expect(figureCssZoom(zoomFixture(['1', '1', '1.8']))).toBe(1.8)
  })
  it.each(['0.125', '1', '8'])('admite el zoom cerrado %s', zoom => {
    expect(figureCssZoom(zoomFixture([zoom]))).toBe(Number(zoom))
  })
  it.each(['0', '-1', '', 'inherit', '125%', 'var(--zoom)', 'NaN', 'Infinity', '0.124', '8.001'])('rechaza zoom no numérico o fuera de límites (%s)', zoom => {
    expect(() => figureCssZoom(zoomFixture([zoom]))).toThrow(/zoom/i)
  })
  it('acota el producto y la profundidad de ancestros', () => {
    expect(() => figureCssZoom(zoomFixture(['4', '4']))).toThrow(/limits/)
    expect(() => figureCssZoom(zoomFixture(['0.25', '0.25']))).toThrow(/limits/)
    expect(() => figureCssZoom(zoomFixture(Array.from({ length: 129 }, () => '1')))).toThrow(/ancestry/)
  })
})
