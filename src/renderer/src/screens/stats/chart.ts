// Trazos de las gráficas de la pantalla de estadísticas (SVG, puros).

export interface Pt {
  x: number
  y: number
}

/**
 * Curva monótona (Fritsch–Carlson) que pasa por todos los puntos sin pasarse de los valores entre ellos,
 * como `.interpolationMethod(.monotone)` de Swift Charts. Devuelve el atributo `d` de un `<path>`.
 */
export function monotonePath(points: Pt[]): string {
  const n = points.length
  if (n === 0) return ''
  if (n === 1) return `M${f(points[0].x)},${f(points[0].y)}`
  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1].x - points[i].x)
    slope.push(dx[i] === 0 ? 0 : (points[i + 1].y - points[i].y) / dx[i])
  }
  const m: number[] = [slope[0]]
  for (let i = 1; i < n - 1; i++) m.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2)
  m.push(slope[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / slope[i]
    const b = m[i + 1] / slope[i]
    const h = a * a + b * b
    if (h > 9) {
      const t = 3 / Math.sqrt(h)
      m[i] = t * a * slope[i]
      m[i + 1] = t * b * slope[i]
    }
  }
  let d = `M${f(points[0].x)},${f(points[0].y)}`
  for (let i = 0; i < n - 1; i++) {
    const p = points[i]
    const q = points[i + 1]
    const h = dx[i] / 3
    d += ` C${f(p.x + h)},${f(p.y + m[i] * h)} ${f(q.x - h)},${f(q.y - m[i + 1] * h)} ${f(q.x)},${f(q.y)}`
  }
  return d
}

/** Banda entre dos curvas (arriba de izquierda a derecha y abajo de vuelta). */
export function bandPath(upper: Pt[], lower: Pt[]): string {
  if (!upper.length || upper.length !== lower.length) return ''
  const top = monotonePath(upper)
  const back = monotonePath([...lower].reverse()).replace(/^M/, 'L')
  return `${top} ${back} Z`
}

function f(v: number): string {
  return (Math.round(v * 100) / 100).toString()
}
