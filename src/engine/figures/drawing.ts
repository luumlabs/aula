// Frontera estricta: copia únicamente presentación conocida y cuenta recursos antes de serializar.
import { FIGURE_LIMITS, FigureValidationError } from '@shared/figures'
import type { DrawingRenderSceneV1, PreparedDrawingPath, PreparedDrawingLabel, PreparedDrawingRing, PreparedVisibleItem } from '@shared/figuresDrawing'

export const DRAWING_LIMITS = { maxBytes: 2 * 1024 * 1024, maxItems: 500, maxPrimitives: 10_000, maxTextBytes: 64 * 1024, maxLabelBytes: 8 * 1024, maxLayoutDimension: 16_384, maxSceneExtent: 32_768 } as const
const fail = (large = false): never => { throw new FigureValidationError(large ? 'too_large' : 'invalid') }
const numberToken = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y
const arities: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }

class Reader {
  bytes = 0
  primitives = 0
  texts = 0
  pathExtent = new Map<string, number>()
  add(bytes: number): void { this.bytes += bytes; if (this.bytes > DRAWING_LIMITS.maxBytes) fail(true) }
  primitive(): void { if (++this.primitives > DRAWING_LIMITS.maxPrimitives) fail(true) }
  object(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail()
    const names = Reflect.ownKeys(value)
    if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))) return fail()
    const out: Record<string, unknown> = {}
    for (const key of keys) {
      const prop = Object.getOwnPropertyDescriptor(value, key)
      if (!prop || !('value' in prop) || !prop.enumerable) return fail()
      out[key] = prop.value
    }
    this.add(2 + keys.reduce((sum, key) => sum + key.length + 4, 0))
    return out
  }
  array<T>(value: unknown, max: number, read: (value: unknown) => T): T[] {
    if (!Array.isArray(value)) return fail()
    if (value.length > max) return fail(true)
    if (Reflect.ownKeys(value).length !== value.length + 1) return fail()
    this.add(value.length + 2)
    const out: T[] = []
    for (let i = 0; i < value.length; i++) {
      const prop = Object.getOwnPropertyDescriptor(value, i)
      if (!prop || !('value' in prop) || !prop.enumerable) return fail()
      out.push(read(prop.value))
    }
    return out
  }
  number(value: unknown, min: number = -FIGURE_LIMITS.maxCoordinate, max: number = FIGURE_LIMITS.maxCoordinate): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return fail()
    this.add(String(value).length); return value
  }
  enum<T extends string | number>(value: unknown, choices: readonly T[]): T {
    if (!choices.includes(value as T)) return fail()
    this.add(String(value).length + 2); return value as T
  }
  bool(value: unknown): boolean { if (typeof value !== 'boolean') return fail(); this.add(5); return value }
  string(value: unknown, max: number, empty = false): string {
    if (typeof value !== 'string' || (!empty && !value.length)) return fail()
    if (value.length > max) return fail(true)
    let bytes = 2
    for (const c of value) {
      const n = c.codePointAt(0)!
      if ((n < 32 && ![9, 10, 13].includes(n)) || (n >= 0xd800 && n <= 0xdfff) || n === 0xfffe || n === 0xffff) fail()
      bytes += n < 128 ? (/["\\\n\r\t]/.test(c) ? 2 : 1) : n < 2048 ? 2 : n < 65536 ? 3 : 4
    }
    if (bytes - 2 > max) fail(true)
    this.add(bytes); return value
  }
  color(value: unknown, none = false): string {
    const color = this.string(value, 7)
    if (!(none && color === 'none') && !/^#[\da-f]{6}$/i.test(color)) return fail()
    return color
  }
  path(value: unknown, empty = false): string {
    const path = this.string(value, 128_000, empty)
    if (!path && empty) return path
    if (!/^\s*[Mm]/.test(path) || /,\s*,|[MmLlHhVvCcSsQqTtAaZz]\s*,|,\s*(?:[MmLlHhVvCcSsQqTtAaZz]|$)/.test(path)) return fail()
    let at = 0, command = '', values: number[] = [], count = 0, x = 0, y = 0, sx = 0, sy = 0, extent = 0, previous = '', controlX = 0, controlY = 0
    const point = (px: number, py: number): void => { extent = Math.max(extent, Math.abs(px), Math.abs(py)); if (!Number.isFinite(px) || !Number.isFinite(py) || Math.abs(px) > FIGURE_LIMITS.maxCoordinate || Math.abs(py) > FIGURE_LIMITS.maxCoordinate) fail(true) }
    const apply = (): void => {
      const upper = command.toUpperCase(), relative = upper !== command, dx = relative ? x : 0, dy = relative ? y : 0
      if (upper === 'A') {
        if (values[0] < 0 || values[1] < 0 || ![0, 1].includes(values[3]) || ![0, 1].includes(values[4])) fail()
        const endX = values[5] + dx, endY = values[6] + dy, rx = values[0], ry = values[1]
        if (rx && ry) {
          // SVG amplía los radios si no alcanzan los extremos; contar sólo los radios dados no basta.
          const angle = values[2] * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
          const halfX = (x - endX) / 2, halfY = (y - endY) / 2
          const correction = Math.max(1, Math.hypot((cos * halfX + sin * halfY) / rx, (-sin * halfX + cos * halfY) / ry))
          const radiusX = Math.hypot(rx * cos, ry * sin) * correction, radiusY = Math.hypot(rx * sin, ry * cos) * correction
          point(x + radiusX * 2, y + radiusY * 2); point(x - radiusX * 2, y - radiusY * 2)
        }
        x = endX; y = endY
      } else if (upper === 'H') x = values[0] + dx
      else if (upper === 'V') y = values[0] + dy
      else {
        if (upper === 'S' && ['C', 'S'].includes(previous) || upper === 'T' && ['Q', 'T'].includes(previous)) {
          controlX = 2 * x - controlX; controlY = 2 * y - controlY; point(controlX, controlY)
        } else if (upper === 'T') { controlX = x; controlY = y }
        for (let i = 0; i < values.length; i += 2) point(values[i] + dx, values[i + 1] + dy)
        if (['C', 'S', 'Q'].includes(upper)) { controlX = values[values.length - 4] + dx; controlY = values[values.length - 3] + dy }
        x = values[values.length - 2] + dx; y = values[values.length - 1] + dy
      }
      point(x, y); previous = upper
      if (upper === 'M') { sx = x; sy = y; command = relative ? 'l' : 'L' }
      values = []
    }
    while (at < path.length) {
      if (/[\s,]/.test(path[at])) { at++; continue }
      if (/[MmLlHhVvCcSsQqTtAaZz]/.test(path[at])) {
        if (values.length) fail()
        command = path[at++]
        if (command.toUpperCase() === 'Z') { x = sx; y = sy; command = ''; previous = 'Z' }
        else {
          let next = at
          while (next < path.length && /[\s,]/.test(path[next])) next++
          if (next === path.length || /[a-df-z]/i.test(path[next])) fail()
        }
        continue
      }
      if (!command) return fail()
      numberToken.lastIndex = at
      const match = numberToken.exec(path)
      if (!match) return fail()
      const n = Number(match[0])
      if (!Number.isFinite(n) || Math.abs(n) > FIGURE_LIMITS.maxCoordinate) return fail()
      if (++count > 32_000) return fail(true)
      values.push(n); at = numberToken.lastIndex
      if (values.length === arities[command.toUpperCase()]) apply()
    }
    if (values.length) return fail()
    this.pathExtent.set(path, extent)
    return path
  }
  label(value: unknown): PreparedDrawingLabel {
    this.primitive()
    const v = this.object(value, ['x', 'y', 'size', 'anchor', 'text', 'color'])
    const before = this.bytes, text = this.string(v.text, DRAWING_LIMITS.maxLabelBytes)
    this.texts += this.bytes - before
    if (this.texts > DRAWING_LIMITS.maxTextBytes) fail(true)
    // Es fuente Markdown, nunca HTML ejecutable. El renderer estático rechaza nodos HTML/imágenes
    // tras analizar su AST; hacerlo con regex aquí confundiría fórmulas, código y escapes.
    return { x: this.number(v.x), y: this.number(v.y), size: this.number(v.size, 1, 256), anchor: this.enum(v.anchor, ['left', 'right', 'center']), text, color: this.color(v.color) }
  }
  drawingPath(value: unknown): PreparedDrawingPath {
    this.primitive()
    const v = this.object(value, ['d', 'fill', 'stroke', 'width', 'strokeOpacity', 'fillOpacity', 'dashed', 'offset'])
    const rawFill = v.fill as { kind?: unknown } | null
    // Leer kind sólo después de comprobar descriptores evita invocar getters.
    if (!rawFill || typeof rawFill !== 'object') return fail()
    const kind = Object.getOwnPropertyDescriptor(rawFill, 'kind')
    if (!kind || !('value' in kind)) return fail()
    const fill = kind.value === 'none' ? this.object(rawFill, ['kind']) : this.object(rawFill, ['kind', 'color'])
    const offset = this.object(v.offset, ['x', 'y'])
    return { d: this.path(v.d), fill: fill.kind === 'none' ? { kind: this.enum(fill.kind, ['none']) } : { kind: this.enum(fill.kind, ['solid', 'hatch']), color: this.color(fill.color) }, stroke: this.color(v.stroke, true), width: this.number(v.width, 0, 256), strokeOpacity: this.number(v.strokeOpacity, 0, 1), fillOpacity: this.number(v.fillOpacity, 0, 1), dashed: this.bool(v.dashed), offset: { x: this.number(offset.x), y: this.number(offset.y) } }
  }
  ring(value: unknown): PreparedDrawingRing {
    this.primitive()
    const v = this.object(value, ['x', 'y', 'width', 'height', 'viewWidth', 'viewHeight', 'color', 'strokes'])
    const width = this.number(v.width, .01, DRAWING_LIMITS.maxLayoutDimension), height = this.number(v.height, .01, DRAWING_LIMITS.maxLayoutDimension)
    const viewWidth = this.number(v.viewWidth, .01, DRAWING_LIMITS.maxLayoutDimension), viewHeight = this.number(v.viewHeight, .01, DRAWING_LIMITS.maxLayoutDimension)
    if (width / viewWidth > 100 || height / viewHeight > 100) fail(true)
    return { x: this.number(v.x), y: this.number(v.y), width, height, viewWidth, viewHeight, color: this.color(v.color), strokes: this.array(v.strokes, 100, value => {
      this.primitive(); const s = this.object(value, ['d', 'spine', 'reach', 'dry', 'dryWidth'])
      return { d: this.path(s.d), spine: this.path(s.spine), reach: this.number(s.reach, 0, 256), dry: this.path(s.dry, true), dryWidth: this.number(s.dryWidth, 0, 256) }
    }) }
  }
  item(value: unknown): PreparedVisibleItem {
    const v = this.object(value, ['sourceIndex', 'opacity', 'transform', 'paths', 'labels', 'rings']), t = this.object(v.transform, ['dx', 'dy', 'deg', 'px', 'py'])
    const sourceIndex = this.number(v.sourceIndex, 0, 9999)
    if (!Number.isInteger(sourceIndex)) fail()
    return { sourceIndex, opacity: this.number(v.opacity, 0, 1), transform: { dx: this.number(t.dx), dy: this.number(t.dy), deg: this.number(t.deg, -360_000, 360_000), px: this.number(t.px), py: this.number(t.py) }, paths: this.array(v.paths, DRAWING_LIMITS.maxPrimitives, x => this.drawingPath(x)), labels: this.array(v.labels, DRAWING_LIMITS.maxPrimitives, x => this.label(x)), rings: this.array(v.rings, DRAWING_LIMITS.maxPrimitives, x => this.ring(x)) }
  }
}

export function validateDrawingRenderScene(value: unknown): DrawingRenderSceneV1 {
  const r = new Reader(), v = r.object(value, ['version', 'canvas', 'metrics', 'appearance', 'items', 'output'])
  const c = r.object(v.canvas, ['width', 'height']), m = r.object(v.metrics, ['pixelWidth', 'textK', 'unitsPerPx', 'rootFontPx'])
  const a = r.object(v.appearance, ['theme', 'language', 'direction', 'palette']), p = r.object(a.palette, ['paper', 'text', 'text2', 'text3', 'brick', 'accent', 'link']), o = r.object(v.output, ['scale'])
  const canvas = { width: r.number(c.width, 1), height: r.number(c.height, 1) }
  const metrics = { pixelWidth: r.number(m.pixelWidth, 1, DRAWING_LIMITS.maxLayoutDimension), textK: r.number(m.textK, .01, 16), unitsPerPx: r.number(m.unitsPerPx, .0001, 10_000), rootFontPx: r.number(m.rootFontPx, 8, 64) }
  const k = metrics.pixelWidth / canvas.width, expectedUnits = Math.round(metrics.textK / k * 50) / 50
  if (Math.abs(metrics.unitsPerPx - expectedUnits) > 1e-6 || canvas.height * k > DRAWING_LIMITS.maxLayoutDimension) fail(true)
  const language = r.string(a.language, 32)
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language)) fail()
  const items = r.array(v.items, DRAWING_LIMITS.maxItems, value => r.item(value)), indices = new Set<number>()
  for (const item of items) {
    if (indices.has(item.sourceIndex)) fail()
    indices.add(item.sourceIndex)
    // El viewport provisional recorta pintura, pero tampoco acepta coordenadas CSS arbitrariamente lejanas.
    const t = item.transform, reach = (Math.abs(t.dx) + Math.abs(t.dy) + 2 * Math.abs(t.px) + 2 * Math.abs(t.py)) * k
    if (reach > DRAWING_LIMITS.maxSceneExtent) fail(true)
    for (const path of item.paths) {
      const extent = ((r.pathExtent.get(path.d) ?? 0) * 2 + Math.abs(path.offset.x) + Math.abs(path.offset.y) + path.width * 2) * k + reach
      if (extent > DRAWING_LIMITS.maxSceneExtent) fail(true)
    }
    for (const ring of item.rings) for (const stroke of ring.strokes) {
      const extent = Math.max(r.pathExtent.get(stroke.d) ?? 0, r.pathExtent.get(stroke.spine) ?? 0, r.pathExtent.get(stroke.dry) ?? 0)
      if ((extent + stroke.reach + stroke.dryWidth) * Math.max(ring.width / ring.viewWidth, ring.height / ring.viewHeight) > DRAWING_LIMITS.maxSceneExtent) fail(true)
    }
    for (const label of item.labels) if (Math.max(Math.abs(label.x), Math.abs(label.y)) * k > DRAWING_LIMITS.maxSceneExtent) fail(true)
    for (const ring of item.rings) if (Math.max(Math.abs(ring.x) + ring.width, Math.abs(ring.y) + ring.height) > DRAWING_LIMITS.maxSceneExtent) fail(true)
  }
  return { version: r.enum(v.version, [1]), canvas, metrics, appearance: { theme: r.enum(a.theme, ['light', 'dark']), language, direction: r.enum(a.direction, ['ltr', 'rtl']), palette: { paper: r.color(p.paper), text: r.color(p.text), text2: r.color(p.text2), text3: r.color(p.text3), brick: r.color(p.brick), accent: r.color(p.accent), link: r.color(p.link) } }, items, output: { scale: r.enum(o.scale, [1, 2]) } }
}
