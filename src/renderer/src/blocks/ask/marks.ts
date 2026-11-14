// Marcar y preguntar al tutor, la parte pura (sin DOM): las marcas del estudiante sobre una figura (pluma, marcador y
// notas), qué partes con nombre tocan y cómo se cuenta eso al tutor en palabras.
// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: viewer/src/annotate.ts (strokePath,
// describeMarks, nearest, bounds y overlaps). Aquí la prueba de qué se marcó es más fina que la caja de Sketchy: un lazo
// marca lo que tiene DENTRO y un trazo abierto lo que toca.

export interface Pt {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export type MarkTool = 'pen' | 'marker' | 'note'
export interface Stroke {
  kind: 'pen' | 'marker'
  points: Pt[]
  /**
   * Las partes que marca, ya sabidas: las que rodea un lazo hecho con el teclado, o las que tocaba al acabar el trazo (en un
   * dibujo que se mueve, lo que se vio al marcar). `[]`: no tocaba ninguna. Sin el campo, se averiguan por la forma.
   */
  ids?: string[]
}
export interface Note {
  kind: 'note'
  x: number
  y: number
  text: string
  /** La parte junto a la que se escribió, ya sabida al dejarla (`[]`: ninguna). Sin el campo, la más cercana. */
  ids?: string[]
}
export type Mark = Stroke | Note

/** Una forma de una parte: su caja y, si es un trazo SVG, su contorno o su línea (`closed`: zona; si no, línea). */
export interface TargetShape {
  box: Box
  poly?: Pt[]
  closed?: boolean
}

/** Una parte con nombre de la figura (un nodo, una flecha, un país, una parte rotulada…). */
export interface MarkTarget {
  id: string
  name: string
  /** 'area': una región grande (un país, el citoplasma); lo concreto que tenga dentro gana. */
  kind: 'item' | 'area'
  shapes: TargetShape[]
  /** La caja que la rodea al elegirla con el teclado (si no, la de sus formas más concretas). */
  ring?: Box
}

/** Lo que se marcó: las partes, las notas (con la parte junto a la que están) y los trazos que no tocan nada. */
export interface MarkSummary {
  marked: MarkTarget[]
  notes: Array<{ text: string; near?: MarkTarget; at: Pt }>
  /** El centro de cada trazo que no toca ninguna parte con nombre. */
  loose: Pt[]
}

/** Topes para que el mensaje al tutor no crezca sin fin. */
export const MARK_LIMITS = { names: 12, nameChars: 80, notes: 5, noteChars: 200, marks: 60, points: 800, question: 2000 } as const

/** El trazo de cada herramienta (en píxeles de pantalla: no engorda con el zoom). */
export const MARK_STYLE = { pen: { width: 2.6 }, marker: { width: 16 } } as const

const r1 = (v: number): number => Math.round(v * 10) / 10

/** Un camino suave por los puntos tomados; un toque solo se queda en un punto. (Sketchy: strokePath.) */
export function strokePath(points: Pt[]): string {
  const [first, ...rest] = points
  if (!first) return ''
  if (rest.length === 0) return `M ${r1(first.x)} ${r1(first.y)} l 0.01 0`
  let d = `M ${r1(first.x)} ${r1(first.y)}`
  for (let i = 0; i < rest.length - 1; i++) {
    const p = rest[i]
    const next = rest[i + 1]
    d += ` Q ${r1(p.x)} ${r1(p.y)} ${r1((p.x + next.x) / 2)} ${r1((p.y + next.y) / 2)}`
  }
  const last = rest[rest.length - 1]
  return `${d} L ${r1(last.x)} ${r1(last.y)}`
}

/** La caja de unos puntos. (Sketchy: bounds.) */
export function bounds(points: Pt[]): Box {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of points) {
    if (p.x < x0) x0 = p.x
    if (p.y < y0) y0 = p.y
    if (p.x > x1) x1 = p.x
    if (p.y > y1) y1 = p.y
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** ¿Se solapan dos cajas (con margen)? (Sketchy: overlaps.) */
export function overlaps(a: Box, b: Box, pad = 0): boolean {
  return a.x - pad <= b.x + b.width && b.x - pad <= a.x + a.width && a.y - pad <= b.y + b.height && b.y - pad <= a.y + a.height
}

const center = (b: Box): Pt => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })

function pathLength(pts: Pt[]): number {
  let s = 0
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return s
}

/** Puntos cada `step` px a lo largo del trazo (para comprobar lo que toca sin mirar cientos de puntos). */
export function resample(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2) return pts.slice()
  const out: Pt[] = [pts[0]]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    let d = step - carry
    while (d <= seg) {
      const k = seg > 0 ? d / seg : 0
      out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k })
      d += step
    }
    carry = seg - (d - step)
  }
  const last = pts[pts.length - 1]
  const tail = out[out.length - 1]
  if (tail.x !== last.x || tail.y !== last.y) out.push(last)
  return out
}

/**
 * ¿El trazo es un lazo (rodea algo)? Sus extremos acaban cerca (a menos de 24 px o de la cuarta parte de su diagonal) y
 * da una vuelta de verdad (no es un garabato corto ni una raya que vuelve sobre sí misma).
 */
export function isLoop(points: Pt[]): boolean {
  if (points.length < 6) return false
  const b = bounds(points)
  const diag = Math.hypot(b.width, b.height)
  if (diag < 16 || Math.min(b.width, b.height) < 8) return false
  const first = points[0], last = points[points.length - 1]
  const gap = Math.hypot(last.x - first.x, last.y - first.y)
  return gap <= Math.max(24, diag * 0.25) && pathLength(points) >= diag * 1.6
}

/** ¿El punto queda dentro del contorno? Número de vueltas (sirve aunque el lazo se pase de largo al cerrar). */
export function insidePoly(p: Pt, poly: Pt[]): boolean {
  let wn = 0
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n]
    const cross = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)
    if (a.y <= p.y) {
      if (b.y > p.y && cross > 0) wn++
    } else if (b.y <= p.y && cross < 0) wn--
  }
  return wn !== 0
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

/** Distancia de un punto a una línea quebrada (cerrada si `closed`). */
export function polyDist(p: Pt, poly: Pt[], closed = false): number {
  if (poly.length === 1) return Math.hypot(p.x - poly[0].x, p.y - poly[0].y)
  let best = Infinity
  const n = poly.length
  for (let i = 0; i < (closed ? n : n - 1); i++) best = Math.min(best, segDist(p, poly[i], poly[(i + 1) % n]))
  return best
}

/** Distancia de un punto a una caja (0 dentro). */
export function boxDist(p: Pt, b: Box): number {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.width))
  const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.height))
  return Math.hypot(dx, dy)
}

/** El centro de una forma: el de su caja, o la mitad del recorrido si es una línea (una flecha, una ruta). */
export function shapeCenter(s: TargetShape): Pt {
  const poly = s.poly
  if (poly && poly.length >= 2 && !s.closed) {
    const half = pathLength(poly) / 2
    let run = 0
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1], b = poly[i]
      const seg = Math.hypot(b.x - a.x, b.y - a.y)
      if (run + seg >= half && seg > 0) {
        const k = (half - run) / seg
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
      }
      run += seg
    }
  }
  return center(s.box)
}

/** ¿El punto cae en la forma (dentro de la zona, en la caja o a `pad` px de la línea)? */
function shapeHas(s: TargetShape, p: Pt, pad: number): boolean {
  if (s.poly && s.poly.length >= 2) {
    if (s.closed && s.poly.length >= 3 && insidePoly(p, s.poly)) return true
    return polyDist(p, s.poly, s.closed) <= pad
  }
  return boxDist(p, s.box) <= pad
}

const area = (b: Box): number => Math.max(0, b.width) * Math.max(0, b.height)
const targetArea = (t: MarkTarget): number => Math.max(0, ...t.shapes.map((s) => area(s.box)))

/** Cuánto de una zona cae dentro del lazo (0–1): sus vértices o, si es una caja, una rejilla de 5 × 5. */
function coverage(t: MarkTarget, loop: Pt[]): number {
  let inside = 0, total = 0
  for (const s of t.shapes) {
    const pts = s.poly && s.closed && s.poly.length >= 3
      ? s.poly
      : Array.from({ length: 25 }, (_, i) => ({ x: s.box.x + ((i % 5) / 4) * s.box.width, y: s.box.y + (Math.floor(i / 5) / 4) * s.box.height }))
    for (const p of pts) {
      total++
      if (insidePoly(p, loop)) inside++
    }
  }
  return total ? inside / total : 0
}

const isLine = (s: TargetShape): boolean => !!s.poly && s.poly.length >= 2 && !s.closed

/** En orden de lectura (de arriba abajo y de izquierda a derecha, por filas de 24 px). */
function readingOrder(a: MarkTarget, b: MarkTarget): number {
  const ca = shapeCenter(a.shapes[0]), cb = shapeCenter(b.shapes[0])
  const row = Math.round(ca.y / 24) - Math.round(cb.y / 24)
  return row !== 0 ? row : ca.x - cb.x
}

/** Las partes que marca un lazo: las que tiene dentro (lo concreto gana a las zonas grandes que no rodea casi enteras). */
function loopTargets(loop: Pt[], targets: MarkTarget[]): MarkTarget[] {
  const lb = bounds(loop)
  const near = targets.filter((t) => t.shapes.some((s) => overlaps(s.box, lb, 2)))
  const inside = near.filter((t) => t.shapes.some((s) => insidePoly(shapeCenter(s), loop)))
  const items = inside.filter((t) => t.kind === 'item').sort(readingOrder)
  const areas = inside.filter((t) => t.kind === 'area')
  if (items.length) return [...items, ...areas.filter((a) => coverage(a, loop) >= 0.85)]
  if (areas.length) return areas.sort(readingOrder)
  // nada dentro: un trozo de una línea larga (una flecha, una ruta) que pasa por el lazo
  const lines = near.filter((t) => t.shapes.some((s) => isLine(s) && s.poly!.some((p) => insidePoly(p, loop))))
  if (lines.length) return lines.sort(readingOrder)
  // o un lazo pequeño DENTRO de una parte grande (una palabra de un nodo, un punto de un país): la más pequeña que lo tiene
  const c = center(lb)
  const holders = near.filter((t) => t.shapes.some((s) => shapeHas(s, c, 0))).sort((a, b) => targetArea(a) - targetArea(b))
  return holders.slice(0, 1)
}

/** Las partes que toca un trazo abierto (subrayar, tachar, resaltar, una flecha), en el orden en que las toca. */
function strokeTargets(stroke: Stroke, targets: MarkTarget[]): MarkTarget[] {
  const pad = stroke.kind === 'pen' ? 10 : 8
  const pts = resample(stroke.points, 4)
  const sb = bounds(pts)
  const first = new Map<MarkTarget, number>()
  for (const t of targets) {
    for (const s of t.shapes) {
      if (!overlaps(s.box, sb, pad + 2)) continue
      const linePad = isLine(s) ? Math.max(6, pad - 2) : pad
      const i = pts.findIndex((p) => shapeHas(s, p, linePad))
      if (i >= 0 && (!first.has(t) || i < first.get(t)!)) first.set(t, i)
    }
  }
  const hit = [...first.entries()].sort((a, b) => a[1] - b[1]).map(([t]) => t)
  const items = hit.filter((t) => t.kind === 'item')
  return items.length ? items : hit
}

/** Las partes que marca un trazo. */
export function marksOf(stroke: Stroke, targets: MarkTarget[]): MarkTarget[] {
  if (stroke.ids) {
    // ya se sabía: no tocaba nada, o lo que tocaba (si alguna de esas partes ya no está, se vuelve a mirar por la forma)
    if (!stroke.ids.length) return []
    const known = stroke.ids.map((id) => targets.find((t) => t.id === id)).filter((t): t is MarkTarget => t !== undefined)
    if (known.length) return known
  }
  return isLoop(stroke.points) ? loopTargets(stroke.points, targets) : strokeTargets(stroke, targets)
}

/** La parte de una nota: la que se supo al dejarla o, si no, la más cercana. */
export function noteTarget(note: Note, targets: MarkTarget[], reach = 160): MarkTarget | undefined {
  if (note.ids) {
    if (!note.ids.length) return undefined
    const known = targets.find((t) => t.id === note.ids![0])
    if (known) return known
  }
  return nearestTarget(note, targets, reach)
}

/** La parte junto a la que está una nota (a menos de `reach` px; lo concreto gana a una zona que la contiene). (Sketchy: nearest.) */
export function nearestTarget(p: Pt, targets: MarkTarget[], reach = 160): MarkTarget | undefined {
  let best: MarkTarget | undefined
  let bestScore = Infinity
  for (const t of targets) {
    for (const s of t.shapes) {
      const d = s.poly && s.poly.length >= 2 ? (s.closed && s.poly.length >= 3 && insidePoly(p, s.poly) ? 0 : polyDist(p, s.poly, s.closed)) : boxDist(p, s.box)
      if (d > reach) continue
      const score = d + (t.kind === 'area' ? 24 : 0)
      if (score < bestScore) [best, bestScore] = [t, score]
    }
  }
  return best
}

export const strokeCenter = (s: Stroke): Pt => center(bounds(s.points))

/** Resumen de las marcas para el tutor: qué partes se marcaron (sin repetir), las notas y lo que no toca nada. */
export function summarizeMarks(targets: MarkTarget[], marks: Mark[], opts: { noteReach?: number } = {}): MarkSummary {
  const marked: MarkTarget[] = []
  const notes: MarkSummary['notes'] = []
  const loose: Pt[] = []
  for (const m of marks.slice(0, MARK_LIMITS.marks)) {
    if (m.kind === 'note') {
      const text = cleanText(m.text, MARK_LIMITS.noteChars)
      if (text && notes.length < MARK_LIMITS.notes) notes.push({ text, near: noteTarget(m, targets, opts.noteReach ?? 160), at: { x: m.x, y: m.y } })
      continue
    }
    if (!m.points.length) continue
    const hit = marksOf(m, targets)
    if (!hit.length) loose.push(strokeCenter(m))
    for (const t of hit) if (!marked.includes(t) && marked.length < MARK_LIMITS.names) marked.push(t)
  }
  return { marked, notes, loose }
}

/** Texto de una sola línea, sin caracteres de control y con tope (con «…» si se corta). */
export function cleanText(s: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const one = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return one.length > max ? one.slice(0, max - 1).trimEnd() + '…' : one
}

export type Where = 'topLeft' | 'top' | 'topRight' | 'left' | 'center' | 'right' | 'bottomLeft' | 'bottom' | 'bottomRight'

/** Dónde cae un punto en un recuadro, en tercios: arriba a la izquierda, en el centro… */
export function whereOf(p: Pt, frame: Box): Where {
  const fx = frame.width > 0 ? (p.x - frame.x) / frame.width : 0.5
  const fy = frame.height > 0 ? (p.y - frame.y) / frame.height : 0.5
  const col = fx < 1 / 3 ? 0 : fx > 2 / 3 ? 2 : 1
  const row = fy < 1 / 3 ? 0 : fy > 2 / 3 ? 2 : 1
  const grid: Where[][] = [['topLeft', 'top', 'topRight'], ['left', 'center', 'right'], ['bottomLeft', 'bottom', 'bottomRight']]
  return grid[row][col]
}

/** El centro de todas las marcas (o undefined si no hay ninguna). */
export function marksCenter(marks: Mark[]): Pt | undefined {
  const pts = marks.map((m) => (m.kind === 'note' ? { x: m.x, y: m.y } : strokeCenter(m))).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  if (!pts.length) return undefined
  return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length }
}

// MARK: Lo que se pinta junto a las marcas (dentro de lienzos que recortan lo que sale)

/** Una posición para algo de `size` px que no se salga de `room` px (con `pad` de margen). */
export function clampInto(v: number, size: number, room: number, pad = 4): number {
  return Math.max(pad, Math.min(v, room - size - pad))
}

/** Dónde va el nombre de la parte elegida con el teclado: encima de su recuadro; si no cabe, debajo; si tampoco, dentro. */
export function ringLabelTop(y: number, h: number, room: number, chip = 20): number {
  if (y - 3 - chip >= 0) return y - 3 - chip
  if (y + h + 3 + chip <= room) return y + h + 3
  return Math.max(0, y) + 3
}

/** Las teclas que usan los atajos de la página (pasar de página, comprobar, elegir una opción): marcando, no les llegan. */
const PAGE_KEYS: ReadonlySet<string> = new Set(['Enter', ' ', 'Spacebar', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Delete'])

/** ¿La tecla la tomaría un atajo de la página? Intro, espacio, flechas o una letra sin ⌘/Ctrl/Alt (con ellos son de la app). */
export function isPageKey(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false
  return PAGE_KEYS.has(e.key) || Array.from(e.key).length === 1
}

/** Un lazo alrededor de una caja (para rodear una parte con el teclado): algo más de una vuelta, como a mano. */
export function loopAround(b: Box, pad = 8, n = 40): Pt[] {
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2
  // una elipse que contiene la caja (√2 veces sus semiejes) y no se cierra justo donde empezó
  const rx = (b.width / 2) * Math.SQRT2 + pad, ry = (b.height / 2) * Math.SQRT2 + pad
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const a = -Math.PI * 0.3 - t * Math.PI * 2.12
    const k = 1 + 0.06 * (t - 0.5)
    out.push({ x: r1(cx + Math.cos(a) * rx * k), y: r1(cy + Math.sin(a) * ry * k) })
  }
  return out
}

// MARK: El mensaje

/** Lo que dice el mensaje de la figura: tipo, título y pie. */
export interface AskedBlock {
  /** 'diagram', 'drawing', 'labeled', 'map', 'structure'… */
  kind: string
  title?: string
  caption?: string
}

export type Translate = (key: string, vars?: Record<string, string | number>) => string

/**
 * El mensaje al tutor: la pregunta del estudiante (o una por defecto) y, debajo, lo que marcó en palabras: la figura, las
 * partes, las notas y dónde están las marcas. `t` lee las claves de `visual:ask.*`.
 */
export function composeMarkMessage(opts: { question: string; block: AskedBlock; summary: MarkSummary; where?: Where; whereOfPoint?: (p: Pt) => Where; t: Translate; lang: string }): string {
  const { block, summary, t } = opts
  const question = cleanText(opts.question, MARK_LIMITS.question) || t('ask.defaultQuestion')
  const kinds = ['diagram', 'drawing', 'labeled', 'map', 'structure']
  const kindWord = t(`ask.what.${kinds.includes(block.kind) ? block.kind : 'other'}`)
  const title = block.title ? cleanText(block.title, MARK_LIMITS.nameChars) : ''
  const what = title ? t('ask.titled', { what: kindWord, title }) : kindWord
  const list = (items: string[]): string => {
    try {
      return new Intl.ListFormat(opts.lang, { style: 'long', type: 'conjunction' }).format(items)
    } catch {
      return items.join(', ')
    }
  }
  const quote = (name: string): string => t('ask.quoted', { name: cleanText(name, MARK_LIMITS.nameChars) })
  const whereWord = (p: Pt): string | undefined => (opts.whereOfPoint ? t(`ask.where.${opts.whereOfPoint(p)}`) : undefined)

  const parts: string[] = []
  if (summary.marked.length) parts.push(t('ask.msgMarked', { what, parts: list(summary.marked.map((m) => quote(m.name))) }))
  else if (summary.loose.length) {
    const w = whereWord(summary.loose[0])
    parts.push(w ? t('ask.msgOnlyWhere', { what, where: w }) : t('ask.msgOnly', { what }))
  } else if (!summary.notes.length) parts.push(t('ask.msgNoMarks', { what }))
  else parts.push(t('ask.msgNotesOn', { what }))
  for (const n of summary.notes) {
    const w = whereWord(n.at)
    parts.push(n.near ? t('ask.msgNote', { text: n.text, near: quote(n.near.name) }) : w ? t('ask.msgNoteWhere', { text: n.text, where: w }) : t('ask.msgNoteAlone', { text: n.text }))
  }
  if (summary.marked.length && summary.loose.length) {
    const w = whereWord(summary.loose[0])
    if (w) parts.push(t('ask.msgLoose', { where: w }))
  }
  if (summary.marked.length && opts.where) parts.push(t('ask.msgWhere', { where: t(`ask.where.${opts.where}`) }))
  const lines = [question, '', parts.join(' ')]
  const caption = block.caption ? cleanText(block.caption, 200) : ''
  if (caption) lines.push(t('ask.msgCaption', { caption }))
  return lines.join('\n')
}
