// Dónde abrir un menú o una lista desplegable: debajo de su botón si cabe; si no, encima (donde haya más sitio), sin salirse
// nunca de la ventana (altura máxima = el sitio que queda, con desplazamiento dentro). Puro, para probarlo sin DOM.
// La altura que se pasa es una estimación que solo decide el lado: nunca recorta el menú (A4-P1-3: un menú de opciones de
// dos líneas se quedaba en 120 px con 650 libres debajo). Para un tope propio (las listas de Select), `maxHeight`.

export interface AnchorBox {
  top: number
  bottom: number
  left: number
  right: number
}

export interface PopoverPlacement {
  /** Distancia desde arriba (abre hacia abajo) o desde abajo (abre hacia arriba) de la ventana. */
  top?: number
  bottom?: number
  left: number
  maxHeight: number
  /** Abre hacia arriba (la animación de entrada sube en vez de bajar). */
  above: boolean
}

export function placePopover(
  anchor: AnchorBox,
  viewport: { width: number; height: number },
  size: { width: number; height: number },
  opts: { align?: 'start' | 'end'; gap?: number; margin?: number; maxHeight?: number } = {}
): PopoverPlacement {
  const gap = opts.gap ?? 6
  const margin = opts.margin ?? 8
  const below = Math.max(0, viewport.height - anchor.bottom - gap - margin)
  const aboveSpace = Math.max(0, anchor.top - gap - margin)
  const above = size.height > below && aboveSpace > below
  const maxHeight = Math.max(0, Math.min(opts.maxHeight ?? Infinity, above ? aboveSpace : below))
  const width = Math.min(size.width, viewport.width - 2 * margin)
  const wanted = opts.align === 'end' ? anchor.right - width : anchor.left
  const left = Math.round(Math.min(Math.max(margin, wanted), viewport.width - margin - width))
  return above
    ? { bottom: Math.round(viewport.height - anchor.top + gap), left, maxHeight: Math.floor(maxHeight), above }
    : { top: Math.round(anchor.bottom + gap), left, maxHeight: Math.floor(maxHeight), above }
}

/** Dónde va una pista (tooltip) ya medida: en su lado si cabe, si no en el contrario, y siempre dentro de la ventana. */
export function placeTooltip(
  anchor: AnchorBox,
  viewport: { width: number; height: number },
  size: { width: number; height: number },
  side: 'top' | 'bottom' | 'left' | 'right',
  opts: { gap?: number; margin?: number } = {}
): { left: number; top: number; side: 'top' | 'bottom' | 'left' | 'right' } {
  const gap = opts.gap ?? 8
  const m = opts.margin ?? 8
  const fits = {
    top: anchor.top - gap - size.height >= m,
    bottom: anchor.bottom + gap + size.height <= viewport.height - m,
    left: anchor.left - gap - size.width >= m,
    right: anchor.right + gap + size.width <= viewport.width - m
  }
  const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const
  const s = fits[side] || !fits[opposite[side]] ? side : opposite[side]
  const cx = (anchor.left + anchor.right) / 2
  const cy = (anchor.top + anchor.bottom) / 2
  let left = s === 'top' || s === 'bottom' ? cx - size.width / 2 : s === 'right' ? anchor.right + gap : anchor.left - gap - size.width
  let top = s === 'left' || s === 'right' ? cy - size.height / 2 : s === 'bottom' ? anchor.bottom + gap : anchor.top - gap - size.height
  left = Math.min(Math.max(m, left), Math.max(m, viewport.width - m - size.width))
  top = Math.min(Math.max(m, top), Math.max(m, viewport.height - m - size.height))
  return { left: Math.round(left), top: Math.round(top), side: s }
}
