// Colocación de etiquetas sobre una figura (port de PlotPainter.placeLabel): cada etiqueta prueba varios sitios y se queda
// con el primero libre (sin pisar otra ni salirse) por el que pase menos tinta de curva.

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Punto de anclaje: qué parte de la etiqueta cae en el punto (0 = izquierda/arriba, 1 = derecha/abajo). */
export interface Candidate {
  x: number
  y: number
  ax: number
  ay: number
}

export const intersects = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const contains = (outer: Box, b: Box): boolean => b.x >= outer.x && b.y >= outer.y && b.x + b.w <= outer.x + outer.w && b.y + b.h <= outer.y + outer.h

export const boxAt = (c: Candidate, w: number, h: number): Box => ({ x: c.x - w * c.ax, y: c.y - h * c.ay, w, h })

/** Elige el sitio y lo apunta en `placed`. null si no hay candidatos. */
export function placeLabel(candidates: Candidate[], w: number, h: number, placed: Box[], bounds: Box, ink: Array<{ x: number; y: number }>): Candidate | null {
  if (!candidates.length) return null
  const pad = (b: Box): Box => ({ x: b.x - 2, y: b.y - 1, w: b.w + 4, h: b.h + 2 })
  const free = candidates.filter((c) => {
    const b = pad(boxAt(c, w, h))
    return contains(bounds, b) && !placed.some((p) => intersects(p, b))
  })
  const crossings = (c: Candidate): number => {
    const b = boxAt(c, w, h)
    let n = 0
    for (const p of ink) if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) n++
    return n
  }
  let chosen = candidates[0]
  if (free.length) {
    chosen = free[0]
    let best = crossings(chosen)
    for (const c of free.slice(1)) {
      const k = crossings(c)
      if (k < best) {
        best = k
        chosen = c
      }
    }
  }
  placed.push(pad(boxAt(chosen, w, h)))
  return chosen
}

/** Tamaño aproximado de una etiqueta (texto o LaTeX corto) en px. */
export function labelSize(text: string, fontSize = 12.5): { w: number; h: number } {
  const plain = text
    .replace(/\$/g, '')
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2')
    .replace(/\\[a-zA-Z]+/g, 'x')
    .replace(/[{}^_\\]/g, '')
  const chars = Array.from(plain).length
  return { w: Math.max(10, chars * fontSize * 0.56 + 6), h: fontSize * 1.5 }
}
