// Oráculo independiente: píxeles de la pantalla viva frente al PNG reabierto, sin reutilizar la escena exportada.
import { expect, type Page, type TestInfo } from 'playwright/test'
import { writeFileSync } from 'node:fs'

export interface LiveDrawingGeometry {
  width: number
  height: number
  /** Escala uniforme de ancestros, observada en DOM; las diapositivas transforman el lienzo entero. */
  scale?: number
  exclusions: Array<{ x: number; y: number; width: number; height: number }>
  labels: Array<{ text: string; x: number; y: number; width: number; height: number }>
}

export async function compareDrawingPixels(page: Page, live: Buffer, saved: Buffer, geometry: LiveDrawingGeometry, info: TestInfo, name: string): Promise<void> {
  const result = await page.evaluate(async ({ before, after, geometry }) => {
    interface Bitmap { src: string; decode(): Promise<void>; naturalWidth: number; naturalHeight: number }
    interface Canvas { width: number; height: number; getContext(kind: '2d'): { drawImage(image: Bitmap, x: number, y: number, w: number, h: number): void; getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } | null }
    const browser = globalThis as unknown as { Image: new () => Bitmap; document: { createElement(tag: 'canvas'): Canvas } }
    async function pixels(base64: string, scale?: number) {
      const image = new browser.Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
      const ratio = scale ?? image.naturalWidth / geometry.width
      const canvas = browser.document.createElement('canvas')
      canvas.width = Math.round(image.naturalWidth / ratio); canvas.height = Math.round(image.naturalHeight / ratio)
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      const background = [0, 1, 2].map(c => {
        const values: number[] = []
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) values.push(data[(y * canvas.width + x) * 4 + c])
        values.sort((a, b) => a - b); return values[Math.floor(values.length / 2)]
      })
      return { data, width: canvas.width, height: canvas.height, background }
    }
    const scale = geometry.scale ?? 1
    if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid live drawing scale')
    const rawSource = await pixels(before, 1), rawExported = await pixels(after, 2 / scale)
    type Raster = typeof rawSource
    // Misma rejilla CSS y filtro binomial 3×3 en ambas imágenes (σ≈0,707 px). Una captura 1× y un
    // render 2× usan antialias distinto; comparar sus tonos de borde sin normalizar penaliza glifos idénticos.
    // No dilata máscaras ni cambia radio, colores o umbrales; conserva los resultados crudos para diagnóstico.
    function normalize(raster: Raster): Raster {
      const horizontal = new Uint8ClampedArray(raster.data.length), data = new Uint8ClampedArray(raster.data.length)
      for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) for (let c = 0; c < 4; c++) {
        const at = (y * raster.width + x) * 4 + c
        horizontal[at] = Math.round((raster.data[(y * raster.width + Math.max(0, x - 1)) * 4 + c] + 2 * raster.data[at] + raster.data[(y * raster.width + Math.min(raster.width - 1, x + 1)) * 4 + c]) / 4)
      }
      for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) for (let c = 0; c < 4; c++) {
        const at = (y * raster.width + x) * 4 + c
        data[at] = Math.round((horizontal[(Math.max(0, y - 1) * raster.width + x) * 4 + c] + 2 * horizontal[at] + horizontal[(Math.min(raster.height - 1, y + 1) * raster.width + x) * 4 + c]) / 4)
      }
      return { ...raster, data }
    }
    const source = normalize(rawSource), exported = normalize(rawExported)
    const rgb = (r: Raster, x: number, y: number): number[] => Array.from(r.data.slice((y * r.width + x) * 4, (y * r.width + x) * 4 + 3))
    const distance = (a: number[], b: number[]): number => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0)
    const ink = (r: Raster, x: number, y: number): boolean => distance(rgb(r, x, y), r.background) > 40
    function green(r: Raster) {
      let xSum = 0, ySum = 0, count = 0
      for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
        const c = rgb(r, x, y)
        if (c[1] > c[0] + 3 && c[1] > c[2] + 3 && ink(r, x, y)) { xSum += x; ySum += y; count++ }
      }
      return { x: xSum / count, y: ySum / count, count }
    }
    const a = green(rawSource), b = green(rawExported)
    if (a.count < 30 || b.count < 30) throw new Error('The independent green reference is missing')
    const dx = b.x - a.x, dy = b.y - a.y
    function recall(box: { x: number; y: number; width: number; height: number }, source: Raster, exported: Raster) {
      let total = 0, matched = 0
      for (let y = Math.max(0, Math.floor(box.y)); y < Math.min(source.height, Math.ceil(box.y + box.height)); y++) {
        for (let x = Math.max(0, Math.floor(box.x)); x < Math.min(source.width, Math.ceil(box.x + box.width)); x++) {
          // Un botón superpuesto pertenece a la interfaz, aunque una captura de pantalla pueda incluirlo sobre role=img.
          if (geometry.exclusions.some(b => x >= b.x - 4 && y >= b.y - 4 && x <= b.x + b.width + 4 && y <= b.y + b.height + 4)) continue
          if (!ink(source, x, y)) continue
          total++; const color = rgb(source, x, y)
          let found = false
          for (let oy = -2; oy <= 2 && !found; oy++) for (let ox = -2; ox <= 2; ox++) {
            const ex = Math.round(x + dx) + ox, ey = Math.round(y + dy) + oy
            if (ex >= 0 && ey >= 0 && ex < exported.width && ey < exported.height && ink(exported, ex, ey) && distance(color, rgb(exported, ex, ey)) < 90) { found = true; break }
          }
          if (found) matched++
        }
      }
      return { total, matched, recall: total ? matched / total : 0 }
    }
    return {
      source: { width: source.width, height: source.height, background: source.background },
      exported: { width: exported.width, height: exported.height, background: exported.background },
      anchor: { source: a, exported: b, areaRatio: b.count / a.count }, offset: { dx, dy },
      normalization: 'symmetric-binomial-3x3-css-pixels',
      raw: {
        all: recall({ x: 0, y: 0, width: rawSource.width, height: rawSource.height }, rawSource, rawExported),
        labels: geometry.labels.map(label => ({ text: label.text, ...recall(label, rawSource, rawExported) }))
      },
      all: recall({ x: 0, y: 0, width: source.width, height: source.height }, source, exported),
      labels: geometry.labels.map(label => ({ text: label.text, ...recall(label, source, exported) }))
    }
  }, { before: live.toString('base64'), after: saved.toString('base64'), geometry })
  const report = info.outputPath(`${name}-live-comparison.json`)
  writeFileSync(report, JSON.stringify(result, null, 2))
  await info.attach(`${name}-live-comparison.json`, { path: report, contentType: 'application/json' })
  expect(result.anchor.areaRatio).toBeGreaterThan(.85)
  expect(result.anchor.areaRatio).toBeLessThan(1.15)
  expect(result.all.recall).toBeGreaterThan(.92)
  for (const label of result.labels) {
    expect(label.total, `Visible label: ${label.text}`).toBeGreaterThan(10)
    expect(label.recall, `Exported label: ${label.text}`).toBeGreaterThan(.85)
  }
}
