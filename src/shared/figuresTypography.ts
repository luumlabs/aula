// Contexto tipográfico heredado de Aula: sólo stacks locales y zoom numérico, nunca CSS ni recursos.
export const FIGURE_CSS_ZOOM_LIMITS = { min: 1 / 8, max: 8 } as const
export interface FigureTypography {
  bodyFont: 'sans' | 'serif' | 'mono' | 'rounded'
  bodyItalic: boolean
  cssZoom: number
}
