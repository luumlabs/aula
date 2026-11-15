// Cajas reales en CSS: no dependen del viewport ni de su recorte provisional.
import type { DrawingRenderBounds } from '@shared/figuresDrawing'

export function unionDrawingBounds(boxes: ReadonlyArray<DrawingRenderBounds>, padding = 2): DrawingRenderBounds {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const box of boxes) {
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width < 0 || box.height < 0) throw new Error('Invalid drawing bounds')
    left = Math.min(left, box.x); top = Math.min(top, box.y)
    right = Math.max(right, box.x + box.width); bottom = Math.max(bottom, box.y + box.height)
  }
  const x = Math.floor(left - padding), y = Math.floor(top - padding)
  const width = Math.ceil(right + padding) - x, height = Math.ceil(bottom + padding) - y
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || Math.max(width, height, Math.abs(x), Math.abs(y)) > 1_000_000) throw new Error('Drawing bounds exceed limits')
  return { x, y, width, height }
}

export function drawingExportBounds(scene: HTMLElement, nominal: { width: number; height: number }, scale = 1): DrawingRenderBounds {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid drawing scale')
  const origin = scene.getBoundingClientRect()
  const boxes: DrawingRenderBounds[] = [{ x: 0, y: 0, ...nominal }]
  const addRect = (rect: DOMRect): void => {
    if (rect.width > 0 && rect.height > 0) boxes.push({ x: (rect.x - origin.x) / scale, y: (rect.y - origin.y) / scale, width: rect.width / scale, height: rect.height / scale })
  }
  const nodes = scene.querySelectorAll('*')
  if (nodes.length > 10_000) throw new Error('Drawing DOM exceeds limits')
  for (const path of scene.querySelectorAll<SVGGraphicsElement>('[data-drawing-geometry]')) {
    const css = getComputedStyle(path)
    if (css.stroke === 'none' && css.fill === 'none') continue
    const box = path.getBBox(), matrix = path.getScreenCTM()
    if (!matrix) throw new Error('Drawing transform is unavailable')
    const points = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix))
    const stroke = css.stroke === 'none' ? 0 : parseFloat(css.strokeWidth) * Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d)) / 2
    const x = Math.min(...points.map((point) => point.x)) - stroke - origin.x, y = Math.min(...points.map((point) => point.y)) - stroke - origin.y
    boxes.push({ x: x / scale, y: y / scale, width: (Math.max(...points.map((point) => point.x)) + stroke - origin.x - x) / scale, height: (Math.max(...points.map((point) => point.y)) + stroke - origin.y - y) / scale })
  }
  for (const label of scene.querySelectorAll<HTMLElement>('[data-drawing-label]')) {
    addRect(label.getBoundingClientRect())
    const visibleRect = (element: Element, rect: DOMRect): DOMRect | undefined => {
      let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom
      for (let ancestor: Element | null = element; ancestor && ancestor !== label; ancestor = ancestor.parentElement) {
        const css = getComputedStyle(ancestor)
        if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || ancestor.classList.contains('katex-mathml')) return undefined
        // KaTeX dibuja raíces con SVG de 400em y recorta la cola; esa superficie no es tinta visible.
        if (ancestor === element) continue
        const bounds = ancestor.getBoundingClientRect()
        if (['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right) }
        if (['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom) }
      }
      return right > left && bottom > top ? new DOMRect(left, top, right - left, bottom - top) : undefined
    }
    for (const child of label.querySelectorAll<Element>('*')) {
      const rect = visibleRect(child, child.getBoundingClientRect())
      if (rect) addRect(rect)
    }
    const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || !node.parentElement) continue
      range.selectNodeContents(node)
      for (const raw of range.getClientRects()) {
        const rect = visibleRect(node.parentElement, raw)
        if (rect) addRect(rect)
      }
    }
    range.detach()
  }
  return unionDrawingBounds(boxes)
}
