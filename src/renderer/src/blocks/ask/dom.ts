// Marcar y preguntar al tutor, lo que se lee del DOM de un bloque visual. El contrato que cumplen todos los bloques: cada
// parte con nombre (un nodo, un objeto de un dibujo, un país, un átomo, una parte rotulada…) lleva en su elemento
//   data-ask-part="<id estable>"  y  data-ask-label="<el nombre tal y como lo ve el estudiante>"
// y, si quiere, data-ask-kind="area" (una región grande: lo concreto que tenga dentro gana). Dos marcas opcionales más:
// data-ask-canvas (el recuadro donde se marca; si no, se deduce) y data-ask-surface (lo que se mueve y se amplía: las marcas
// lo siguen; si no, se busca el antepasado de las partes que lleva una transformación CSS).
// Solo cuentan las partes que están DENTRO del lienzo (unos botones debajo de la figura no son la figura) y que se ven: nada
// con opacidad 0 (ella o un antepasado del bloque), visibility hidden, display none, aria-hidden="true" en la propia parte (un
// paso de una construcción que aún no ha salido) ni una parte que solo pinta con hijos que están todos apagados.
import type { Box, MarkTarget, Pt, TargetShape } from './marks'
import { cleanText, MARK_LIMITS } from './marks'

export const PART = 'data-ask-part'
const SVG_NS = 'http://www.w3.org/2000/svg'

const toBox = (r: DOMRect | { left: number; top: number; width: number; height: number }): Box => ({ x: r.left, y: r.top, width: r.width, height: r.height })

/** Las partes con nombre del bloque (sin las de la propia capa de marcas). */
export function partElements(root: Element, skip?: Element | null): Element[] {
  return Array.from(root.querySelectorAll(`[${PART}]`)).filter((el) => !(skip && skip.contains(el)))
}

/** El antepasado común más cercano de unos elementos. */
function commonAncestor(els: Element[]): Element | null {
  if (!els.length) return null
  let anc: Element | null = els[0]
  for (const el of els.slice(1)) {
    while (anc && !anc.contains(el)) anc = anc.parentElement
  }
  return anc
}

const clips = (el: Element): boolean => {
  const s = getComputedStyle(el)
  return /(hidden|clip)/.test(s.overflow) || /(hidden|clip)/.test(s.overflowX)
}

/** La figura más grande del bloque (un SVG, un lienzo o una imagen de 120 × 80 px o más), para un bloque sin partes. */
function largestMedia(root: Element, skip?: Element | null): Element | null {
  let best: Element | null = null
  let bestArea = 120 * 80
  for (const el of Array.from(root.querySelectorAll('svg, canvas, img'))) {
    if (skip && skip.contains(el)) continue
    if (el.parentElement?.closest('svg')) continue
    const r = el.getBoundingClientRect()
    if (r.width * r.height >= bestArea) [best, bestArea] = [el, r.width * r.height]
  }
  return best
}

const isHTML = (el: Element | null): el is HTMLElement => !!el && el.namespaceURI !== SVG_NS && typeof (el as HTMLElement).style === 'object'

/**
 * Las partes están repartidas por todo el bloque (la figura y, debajo, unos botones con los mismos nombres): el recuadro que
 * recorta (el pozo del lienzo) que tiene dentro la mayoría de las partes. Sin uno así, null.
 */
function clipWithMostParts(root: Element, parts: Element[]): HTMLElement | null {
  const counts = new Map<HTMLElement, number>()
  for (const p of parts) {
    for (let el = p.parentElement; el && el !== root; el = el.parentElement) {
      if (isHTML(el) && clips(el)) counts.set(el, (counts.get(el) ?? 0) + 1)
    }
  }
  let best: HTMLElement | null = null
  let n = 0
  for (const [el, k] of counts) if (k > n) [best, n] = [el, k]
  return best && n >= Math.max(2, Math.ceil(parts.length / 2)) ? best : null
}

/**
 * El recuadro donde se marca: `[data-ask-canvas]`, o el primer antepasado de las partes que recorta lo que sale (el pozo
 * del lienzo que se amplía), o el antepasado común (un dibujo SVG: su caja). Siempre un elemento HTML (la capa va dentro).
 * Si las partes no se juntan dentro de un recuadro así (hay partes también fuera de la figura, como unos botones debajo), el
 * que recorta con la mayoría dentro. Sin partes, el de la figura más grande; sin nada que marcar todavía (cargando), null.
 */
export function findCanvas(root: HTMLElement, skip?: Element | null): HTMLElement | null {
  const explicit = root.querySelector<HTMLElement>('[data-ask-canvas]')
  if (explicit) return explicit
  const parts = partElements(root, skip)
  let anc = parts.length ? commonAncestor(parts) : largestMedia(root, skip)
  if (!anc || !root.contains(anc)) return null
  // si el antepasado común es una de las partes (o la figura misma), se empieza por su padre
  if ((anc.hasAttribute(PART) || !parts.length) && anc.parentElement) anc = anc.parentElement
  for (let el: Element | null = anc; el && el !== root; el = el.parentElement) {
    if (isHTML(el) && clips(el)) return el
  }
  const clip = parts.length ? clipWithMostParts(root, parts) : null
  if (clip) return clip
  let el: Element | null = anc
  while (el && !isHTML(el)) el = el.parentElement
  return isHTML(el) && root.contains(el) ? el : null
}

/**
 * Lo que se mueve y se amplía dentro del lienzo (`[data-ask-surface]`, o el antepasado de las partes con una transformación
 * CSS): las marcas se guardan en fracciones de su caja y así siguen al zoom y al desplazamiento. Sin él, el propio lienzo.
 */
export function findSurface(canvas: HTMLElement, skip?: Element | null): Element {
  const explicit = canvas.querySelector('[data-ask-surface]')
  if (explicit) return explicit
  const parts = partElements(canvas, skip)
  let anc = commonAncestor(parts)
  if (anc && anc.hasAttribute(PART)) anc = anc.parentElement
  for (let el: Element | null = anc; el && el !== canvas && canvas.contains(el); el = el.parentElement) {
    if (isHTML(el) && getComputedStyle(el).transform !== 'none') return el
  }
  return canvas
}

/**
 * Dónde va el botón «Marcar» en la cabecera del bloque (la fila del título, con su `justify-between`): al final de sus
 * acciones o, si no tiene, al final de la fila. Sin una cabecera así (un dibujo con pie), null: va en una esquina del lienzo.
 */
export function headSlot(root: HTMLElement, canvas: HTMLElement): HTMLElement | null {
  const head = root.firstElementChild
  if (!isHTML(head) || head.contains(canvas)) return null
  const s = getComputedStyle(head)
  if (s.display !== 'flex' || s.justifyContent !== 'space-between') return null
  const kids = Array.from(head.children).filter((k) => !k.hasAttribute('data-ask-head'))
  if (kids.length >= 2) {
    const last = kids[kids.length - 1]
    return isHTML(last) && getComputedStyle(last).display === 'flex' ? last : null
  }
  return head
}

/** El hijo directo de `root` que contiene el lienzo: la barra de marcar va justo después. */
export function barAnchor(root: HTMLElement, canvas: HTMLElement): Element | null {
  let el: Element | null = canvas
  while (el && el.parentElement !== root) el = el.parentElement
  return el && el.parentElement === root ? el : null
}

const isGeometry = (el: Element): el is SVGGeometryElement => typeof (el as SVGGeometryElement).getTotalLength === 'function' && typeof (el as SVGGeometryElement).getScreenCTM === 'function'

/** ¿Es una zona cerrada (un país, una región) o una línea (una flecha, una ruta)? */
function closedShape(el: SVGGeometryElement): boolean {
  const tag = el.tagName.toLowerCase()
  if (tag === 'polygon' || tag === 'circle' || tag === 'ellipse' || tag === 'rect') return true
  if (tag === 'path') {
    const d = (el.getAttribute('d') ?? '').trim()
    if (/[zZ]\s*$/.test(d)) return true
  }
  const fill = getComputedStyle(el).fill
  return !!fill && fill !== 'none' && !/rgba\([^)]*,\s*0\)/.test(fill)
}

/** El contorno (o la línea) de un trazo SVG en coordenadas de pantalla: hasta 96 puntos repartidos por su largo. */
export function samplePath(el: SVGGeometryElement): Pt[] {
  let len = 0
  try {
    len = el.getTotalLength()
  } catch {
    return []
  }
  const m = el.getScreenCTM()
  if (!m || !(len > 0) || !Number.isFinite(len)) return []
  const n = Math.max(8, Math.min(96, Math.ceil(len / 6)))
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const p = el.getPointAtLength((i / n) * len)
    out.push({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f })
  }
  return out
}

/** La caja de un elemento; si es un punto (un marcador de 0 × 0 con su dibujo fuera), la de lo que tiene dentro. */
function elementBox(el: Element): Box {
  let r = toBox(el.getBoundingClientRect())
  if (r.width < 4 || r.height < 4) {
    let x0 = r.x, y0 = r.y, x1 = r.x + r.width, y1 = r.y + r.height
    for (const c of Array.from(el.querySelectorAll('*')).slice(0, 16)) {
      const b = c.getBoundingClientRect()
      if (b.width <= 0 && b.height <= 0) continue
      x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top); x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom)
    }
    r = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  }
  // un punto sin dibujo: ±9 px a su alrededor
  if (r.width < 4 && r.height < 4) r = { x: r.x + r.width / 2 - 9, y: r.y + r.height / 2 - 9, width: 18, height: 18 }
  return r
}

/** ¿Está apagado él o un antepasado hasta `stop` (incluido)? Opacidad 0 o display none. Se recuerda por elemento. */
function faded(el: Element | null, stop: Element, memo: Map<Element, boolean>): boolean {
  if (!el) return false
  const known = memo.get(el)
  if (known !== undefined) return known
  const s = getComputedStyle(el)
  const off = s.display === 'none' || parseFloat(s.opacity) < 0.01 || (el !== stop && faded(el.parentElement, stop, memo))
  memo.set(el, off)
  return off
}

const BLANK_COLOR = /^(transparent|rgba\([^)]*,\s*0\))$/

/** ¿Pinta algo él mismo (fondo, borde, sombra, texto suelto, o es un trazo SVG)? Si no, lo que se ve son sus hijos. */
function paintsItself(el: Element, s: CSSStyleDeclaration): boolean {
  if (isGeometry(el)) return true
  if (Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '')) return true
  if (el.namespaceURI === SVG_NS) return false
  const sides: Array<[string, string]> = [[s.borderTopWidth, s.borderTopStyle], [s.borderRightWidth, s.borderRightStyle], [s.borderBottomWidth, s.borderBottomStyle], [s.borderLeftWidth, s.borderLeftStyle]]
  const border = sides.some(([w, st]) => parseFloat(w) > 0 && !!st && st !== 'none')
  return border || !BLANK_COLOR.test(s.backgroundColor || 'transparent') || (s.backgroundImage || 'none') !== 'none' || (s.boxShadow || 'none') !== 'none'
}

/** ¿Está apagado él mismo (sin mirar a sus antepasados)? */
function offItself(el: Element): boolean {
  const s = getComputedStyle(el)
  return s.display === 'none' || parseFloat(s.opacity) < 0.01 || s.visibility === 'hidden' || s.visibility === 'collapse'
}

/** Una parte que no se ve aunque esté en la página (un nodo de un diagrama que aún no ha salido, un paso por llegar). */
function hiddenPart(el: Element, root: Element, memo: Map<Element, boolean>): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return true
  const s = getComputedStyle(el)
  if (s.visibility === 'hidden' || s.visibility === 'collapse') return true
  if (faded(el, root, memo)) return true
  // la opacidad puede estar en el hijo que lo pinta todo (la caja de un nodo dentro de su marco)
  const kids = Array.from(el.children)
  return kids.length > 0 && !paintsItself(el, s) && kids.every(offItself)
}

/** ¿Se pinta? (con tamaño y a la vista) y, si se pide, ¿cae dentro del lienzo (no fuera por el zoom)? */
function shown(el: Element, root: Element, box: Box, frame: Box | null, memo: Map<Element, boolean>): boolean {
  if (!el.getClientRects().length) return false
  if (hiddenPart(el, root, memo)) return false
  return !frame || (box.x <= frame.x + frame.width && frame.x <= box.x + box.width && box.y <= frame.y + frame.height && frame.y <= box.y + box.height)
}

/** El nombre de una parte: `data-ask-label`, o su etiqueta accesible, o su texto. */
function labelOf(el: Element): string {
  const raw = el.getAttribute('data-ask-label') ?? el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.textContent ?? ''
  return cleanText(raw, MARK_LIMITS.nameChars)
}

const GEOMETRY = 'path, line, polyline, polygon, circle, ellipse, rect'

/** Un trazo SVG: su contorno (cerrado) o su línea, en coordenadas de pantalla. */
function geometryShape(el: SVGGeometryElement, box: Box): TargetShape {
  const poly = samplePath(el)
  return poly.length >= 2 ? { box, poly, closed: closedShape(el) } : { box }
}

/**
 * Las formas de una parte: un trazo SVG, su contorno o su línea; un grupo SVG (una ruta de un mapa, un objeto de un dibujo),
 * cada trazo suyo por separado y sus textos por su caja (así una ruta en diagonal no ocupa toda su caja); lo demás, su caja.
 */
function shapesOf(el: Element, box: Box): TargetShape[] {
  const tag = el.tagName.toLowerCase()
  if (isGeometry(el) && tag !== 'svg') return [geometryShape(el, box)]
  if (el.namespaceURI !== SVG_NS || tag === 'svg') return [{ box }]
  const out: TargetShape[] = []
  for (const g of Array.from(el.querySelectorAll(GEOMETRY)).slice(0, 12)) {
    if (!isGeometry(g) || offItself(g)) continue
    const b = toBox(g.getBoundingClientRect())
    if (b.width > 0 || b.height > 0) out.push(geometryShape(g, b))
  }
  for (const t of Array.from(el.querySelectorAll('text, foreignObject, image, use')).slice(0, 6)) {
    const b = toBox(t.getBoundingClientRect())
    if (b.width > 0 && b.height > 0 && !offItself(t)) out.push({ box: b })
  }
  return out.length ? out : [{ box }]
}

const isLineShape = (s: TargetShape): boolean => !!s.poly && s.poly.length >= 2 && !s.closed

/** La caja de varias cajas. */
function unionOf(boxes: Box[]): Box {
  let x0 = boxes[0].x, y0 = boxes[0].y, x1 = x0 + boxes[0].width, y1 = y0 + boxes[0].height
  for (const b of boxes.slice(1)) {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height)
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/**
 * Las partes con nombre del bloque, en coordenadas de pantalla: una por id (varios elementos con el mismo id —el punto, su
 * nombre y su zona— suman formas). Una parte que ocupa una cuarta parte del lienzo o más cuenta como zona. Con
 * `inView`, solo las que se ven en el lienzo (con zoom, una marca hecha antes puede quedar fuera junto a su parte). Solo
 * las de dentro del lienzo y que se ven (ver arriba).
 */
export function collectTargets(root: Element, canvas: Element, skip?: Element | null, inView = false): MarkTarget[] {
  const frame = toBox(canvas.getBoundingClientRect())
  const byId = new Map<string, MarkTarget>()
  // la caja de cada elemento de la parte y si es una zona (para el recuadro del teclado: lo concreto antes que las zonas)
  const rings = new Map<string, Array<{ box: Box; zone: boolean }>>()
  const memo = new Map<Element, boolean>()
  for (const el of partElements(root, skip)) {
    const id = el.getAttribute(PART) ?? ''
    // fuera del lienzo (unos botones debajo de la figura) no es la figura
    if (!id || !canvas.contains(el)) continue
    const box = elementBox(el)
    if (!shown(el, root, box, inView ? frame : null, memo)) continue
    const shapes = shapesOf(el, box)
    const name = labelOf(el)
    const area = el.getAttribute('data-ask-kind') === 'area'
    const zone = isGeometry(el) && el.tagName.toLowerCase() !== 'svg' && !!shapes[0]?.poly && !!shapes[0].closed
    rings.set(id, [...(rings.get(id) ?? []), { box, zone }])
    const known = byId.get(id)
    if (known) {
      known.shapes.push(...shapes)
      if (!known.name && name) known.name = name
      if (area) known.kind = 'area'
    } else byId.set(id, { id, name, kind: area ? 'area' : 'item', shapes })
  }
  // una parte cuya forma mayor cubre una cuarta parte del lienzo o más es una zona (el citoplasma, un país grande); una
  // línea no cuenta por su caja (una ruta en diagonal no es una zona)
  const quarter = frame.width * frame.height * 0.25
  for (const t of byId.values()) {
    if (t.shapes.some((s) => !isLineShape(s) && s.box.width * s.box.height >= quarter)) t.kind = 'area'
    const r = rings.get(t.id) ?? []
    const concrete = r.filter((x) => !x.zone)
    if (r.length) t.ring = unionOf((concrete.length ? concrete : r).map((x) => x.box))
  }
  return [...byId.values()].filter((t) => t.name)
}

/** Las partes para elegir con el teclado: en orden de lectura (filas de 24 px, de izquierda a derecha). */
export function keyboardTargets(root: Element, canvas: Element, skip?: Element | null): MarkTarget[] {
  return collectTargets(root, canvas, skip, true).sort((a, b) => {
    const ba = unionBox(a), bb = unionBox(b)
    const row = Math.round((ba.y + ba.height / 2) / 24) - Math.round((bb.y + bb.height / 2) / 24)
    return row !== 0 ? row : ba.x - bb.x
  })
}

/** La caja que cubre una parte para el teclado (la más concreta: las líneas y los puntos antes que las zonas). */
export function unionBox(t: MarkTarget): Box {
  if (t.ring) return t.ring
  const concrete = t.shapes.filter((s) => !(s.poly && s.closed))
  return unionOf((concrete.length ? concrete : t.shapes).map((s) => s.box))
}
