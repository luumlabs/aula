// Chromium elige las caras usadas al hacer layout. Consultar/cargar el stack completo activaría fallbacks no utilizados.
interface DrawingFontFace { family: string; status: 'unloaded' | 'loading' | 'loaded' | 'error' }
const normalizedFamily = (family: string): string => family.trim().replace(/^(['"])(.*)\1$/, '$2').toLowerCase()

export function drawingFontFamilies(stack: string): string[] {
  return stack.split(',').map(normalizedFamily).filter(Boolean)
}

export function assertDrawingFontState(status: 'loading' | 'loaded', faces: Iterable<DrawingFontFace>, families: ReadonlySet<string>): void {
  if (status !== 'loaded') throw new Error('Drawing fonts are not ready')
  for (const face of faces) {
    if (face.status === 'error' && families.has(normalizedFamily(face.family))) throw new Error('Drawing font failed')
  }
}

/** Sólo runs pintados, sin mezclar texto KaTeX, MathML y prosa en una comprobación de la fuente del padre. */
export function drawingTextFontFamilies(element: HTMLElement): Set<string> {
  const families = new Set<string>()
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    if (!parent || !node.textContent?.trim() || parent.closest('.katex-mathml')) continue
    const css = getComputedStyle(parent)
    if (css.display === 'none' || css.visibility === 'hidden') continue
    for (const family of drawingFontFamilies(css.fontFamily)) families.add(family)
  }
  return families
}

export function assertDrawingFontsReady(element: HTMLElement): void {
  // Obliga a solicitar las caras necesarias antes de leer FontFaceSet; no inicia cargas de fallbacks.
  element.getBoundingClientRect()
  const fonts = element.ownerDocument.fonts
  if (!fonts) throw new Error('Drawing fonts are unavailable')
  assertDrawingFontState(fonts.status, fonts, drawingTextFontFamilies(element))
}
