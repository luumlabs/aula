import type { FigureTypography } from '@shared/figuresTypography'
import { FONT_STACK } from '@renderer/blocks/visual/lib/slides'

// Las diapositivas pueden aportar serif/rounded y cursiva por herencia al lienzo.
export const FIGURE_FONTS = { sans: FONT_STACK.sans, serif: FONT_STACK.serif, rounded: FONT_STACK.rounded, mono: 'var(--font-mono)' } as const
const normalized = (value: string): string => value.toLowerCase().replace(/["']/g, '').replace(/\s*,\s*/g, ',').trim()

export function figureTypography(element: HTMLElement): FigureTypography {
  const style = getComputedStyle(element), actual = normalized(style.fontFamily)
  const probe = element.ownerDocument.createElement('span')
  probe.style.display = 'none'; element.appendChild(probe)
  try {
    for (const key of Object.keys(FIGURE_FONTS) as Array<FigureTypography['bodyFont']>) {
      probe.style.fontFamily = FIGURE_FONTS[key]
      if (normalized(getComputedStyle(probe).fontFamily) === actual) {
        if (style.fontStyle !== 'normal' && style.fontStyle !== 'italic') throw new Error('Unsupported figure font style')
        return { bodyFont: key, bodyItalic: style.fontStyle === 'italic' }
      }
    }
    throw new Error('Unsupported figure font family')
  } finally { probe.remove() }
}
