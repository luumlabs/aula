import { FIGURE_CSS_ZOOM_LIMITS, type FigureTypography } from '@shared/figuresTypography'
import { FONT_STACK } from '@renderer/blocks/visual/lib/slides'

// Las diapositivas pueden aportar serif/rounded y cursiva por herencia al lienzo.
export const FIGURE_FONTS = { sans: FONT_STACK.sans, serif: FONT_STACK.serif, rounded: FONT_STACK.rounded, mono: 'var(--font-mono)' } as const
const normalized = (value: string): string => value.toLowerCase().replace(/["']/g, '').replace(/\s*,\s*/g, ',').trim()

/** CSS zoom no se hereda: su efecto se acumula en los ancestros. Los transforms no participan. */
export function figureCssZoom(element: HTMLElement): number {
  let zoom = 1, depth = 0
  for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (++depth > 128) throw new Error('Figure zoom ancestry exceeds limits')
    const css = getComputedStyle(ancestor).zoom, value = css === 'normal' ? 1 : Number(css)
    if (!Number.isFinite(value) || value <= 0) throw new Error('Unsupported figure CSS zoom')
    zoom *= value
    if (!Number.isFinite(zoom) || zoom <= 0) throw new Error('Unsupported figure CSS zoom')
  }
  if (zoom < FIGURE_CSS_ZOOM_LIMITS.min || zoom > FIGURE_CSS_ZOOM_LIMITS.max) throw new Error('Figure CSS zoom exceeds limits')
  return zoom
}

export function figureTypography(element: HTMLElement): FigureTypography {
  const style = getComputedStyle(element), actual = normalized(style.fontFamily), cssZoom = figureCssZoom(element)
  const probe = element.ownerDocument.createElement('span')
  probe.style.display = 'none'; element.appendChild(probe)
  try {
    for (const key of Object.keys(FIGURE_FONTS) as Array<FigureTypography['bodyFont']>) {
      probe.style.fontFamily = FIGURE_FONTS[key]
      if (normalized(getComputedStyle(probe).fontFamily) === actual) {
        if (style.fontStyle !== 'normal' && style.fontStyle !== 'italic') throw new Error('Unsupported figure font style')
        return { bodyFont: key, bodyItalic: style.fontStyle === 'italic', cssZoom }
      }
    }
    throw new Error('Unsupported figure font family')
  } finally { probe.remove() }
}
