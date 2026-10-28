// Montaje de la pista real (puro): suena por tramos (los de filmGrid) y cada corte se cose con un fundido cruzado de
// potencia constante de unos 30 ms centrado en el pulso, sin chasquidos. El final es el de la pista: sin fundidos inventados.
import type { Segment } from '../montage/grid.ts'

export function editTrack(channels: Float32Array[], rate: number, segments: Segment[], duration: number, xfade = 0.03): Float32Array[] {
  const n = Math.round(duration * rate)
  const h = Math.max(1, Math.round((xfade * rate) / 2))
  return channels.map((src) => {
    const out = new Float32Array(n)
    segments.forEach((s, i) => {
      const v0 = Math.round(s.video * rate)
      const a = Math.round(s.from * rate)
      const z = Math.round(s.to * rate)
      // cada tramo se extiende medio fundido por cada lado del corte (salvo el principio y el final de la película)
      const pre = i > 0 ? h : 0
      const post = i < segments.length - 1 ? h : 0
      for (let k = -pre; k < z - a + post; k++) {
        const o = v0 + k
        if (o < 0 || o >= n) continue
        const x = src[a + k] ?? 0
        let g = 1
        if (k < pre && i > 0) g = Math.sin(((k + pre) / (2 * pre)) * (Math.PI / 2)) // entra
        if (k >= z - a - post && i < segments.length - 1) g = Math.cos(((k - (z - a - post)) / (2 * post)) * (Math.PI / 2)) // sale
        out[o] += x * g
      }
    })
    return out
  })
}
