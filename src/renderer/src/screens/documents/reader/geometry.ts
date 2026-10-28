// Geometría de las marcas en un PDF: los rectángulos de una selección (en píxeles de la página) se juntan por línea y se pasan
// a coordenadas de la página del PDF (puntos, origen abajo a la izquierda), que es como se guardan (igual que la app Swift).
// Puro: sin DOM ni pdf.js (el visor da la conversión).

export interface Box { x: number; y: number; w: number; h: number }

/** Junta los trozos de una selección que están en la misma línea (pdf.js da un rectángulo por trozo de texto). */
export function mergeLineBoxes(boxes: Box[]): Box[] {
  const valid = boxes.filter((b) => b.w > 0.5 && b.h > 0.5 && Number.isFinite(b.x + b.y + b.w + b.h))
  if (!valid.length) return []
  // fuera los rectángulos absurdamente altos (saltos de línea, el final del contenido)
  const hs = valid.map((b) => b.h).sort((a, b) => a - b)
  const median = hs[Math.floor(hs.length / 2)]
  const sane = valid.filter((b) => b.h <= median * 2.6)
  const sorted = [...sane].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x)
  const lines: Box[] = []
  for (const b of sorted) {
    const last = lines[lines.length - 1]
    const cy = b.y + b.h / 2
    if (last && Math.abs(last.y + last.h / 2 - cy) < Math.min(last.h, b.h) * 0.55 && b.x <= last.x + last.w + Math.max(last.h, b.h) * 1.6) {
      const x1 = Math.min(last.x, b.x), y1 = Math.min(last.y, b.y)
      const x2 = Math.max(last.x + last.w, b.x + b.w), y2 = Math.max(last.y + last.h, b.y + b.h)
      lines[lines.length - 1] = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
    } else lines.push({ ...b })
  }
  return lines
}

/** Conversión entre los píxeles del visor y los puntos del PDF (la de `PageViewport` de pdf.js). */
export interface ViewportLike {
  convertToPdfPoint(x: number, y: number): number[]
  convertToViewportRectangle(rect: number[]): number[]
}

/** Un rectángulo del visor → [x, y, ancho, alto] en el PDF (origen abajo a la izquierda). */
export function boxToPdfRect(b: Box, vp: ViewportLike): number[] {
  const [ax, ay] = vp.convertToPdfPoint(b.x, b.y)
  const [bx, by] = vp.convertToPdfPoint(b.x + b.w, b.y + b.h)
  const x = Math.min(ax, bx), y = Math.min(ay, by)
  return [round(x), round(y), round(Math.abs(bx - ax)), round(Math.abs(by - ay))]
}

/** [x, y, ancho, alto] del PDF → rectángulo en píxeles del visor. */
export function pdfRectToBox(r: number[], vp: ViewportLike): Box {
  const [x1, y1, x2, y2] = vp.convertToViewportRectangle([r[0], r[1], r[0] + r[2], r[1] + r[3]])
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
}

const round = (v: number): number => Math.round(v * 100) / 100

/** Viewport sin rotación de una página de `height` puntos de alto a `scale` (para pruebas). */
export function simpleViewport(height: number, scale: number): ViewportLike {
  return {
    convertToPdfPoint: (x, y) => [x / scale, height - y / scale],
    convertToViewportRectangle: ([a, b, c, d]) => [a * scale, (height - b) * scale, c * scale, (height - d) * scale]
  }
}

/** Rectángulo de una nota suelta en la página (arriba a la derecha, como en Swift). */
export function pageNoteRect(pageWidth: number, pageHeight: number): number[] {
  return [pageWidth - 44, pageHeight - 44, 20, 20]
}
