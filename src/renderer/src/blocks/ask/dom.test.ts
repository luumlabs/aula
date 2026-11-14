// Lo que «Marcar» lee del DOM de un bloque, con un DOM de juguete (las pruebas corren en Node): solo cuentan las partes
// dentro del lienzo y que se ven; una ruta o un objeto de un dibujo (un grupo SVG) es su línea, no su caja; y el lienzo de un
// bloque con partes también fuera de la figura (los botones de los grupos de una estructura) es el pozo de la figura.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { collectTargets, findCanvas, headSlot, keyboardTargets, unionBox } from './dom'
import { summarizeMarks, type Pt } from './marks'

const SVG = 'http://www.w3.org/2000/svg'
const HTML = 'http://www.w3.org/1999/xhtml'

type Style = Partial<Record<'display' | 'opacity' | 'visibility' | 'overflow' | 'overflowX' | 'transform' | 'fill' | 'backgroundColor' | 'justifyContent', string>>
interface Rect { left: number; top: number; width: number; height: number }

const DEFAULTS: Record<string, string> = {
  display: 'block', opacity: '1', overflow: 'visible', overflowX: 'visible', transform: 'none', fill: 'none', position: 'static',
  backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', boxShadow: 'none', justifyContent: 'normal', borderTopLeftRadius: '0px',
  borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px',
  borderTopStyle: 'none', borderRightStyle: 'none', borderBottomStyle: 'none', borderLeftStyle: 'none'
}

/** Un elemento de juguete: lo justo que lee dom.ts. */
class El {
  parentElement: El | null = null
  children: El[] = []
  childNodes: Array<El | { nodeType: number; textContent: string }> = []
  readonly nodeType = 1
  readonly style = {}
  constructor(readonly tagName: string, readonly namespaceURI: string, private attrs: Record<string, string>, private css: Style, private rect: Rect | null) {}
  add(...kids: El[]): this {
    for (const k of kids) {
      k.parentElement = this
      this.children.push(k)
      this.childNodes.push(k)
    }
    return this
  }
  text(t: string): this {
    this.childNodes.push({ nodeType: 3, textContent: t })
    return this
  }
  get firstElementChild(): El | null {
    return this.children[0] ?? null
  }
  get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join('')
  }
  getAttribute(n: string): string | null {
    return this.attrs[n] ?? null
  }
  hasAttribute(n: string): boolean {
    return n in this.attrs
  }
  contains(o: El | null): boolean {
    for (let e = o; e; e = e.parentElement) if (e === this) return true
    return false
  }
  private all(): El[] {
    return this.children.flatMap((c) => [c, ...c.all()])
  }
  querySelectorAll(sel: string): El[] {
    const tests = sel.split(',').map((s) => s.trim())
    return this.all().filter((e) => tests.some((t) => t === '*' || (t.startsWith('[') ? e.hasAttribute(t.slice(1, -1)) : e.tagName.toLowerCase() === t.toLowerCase())))
  }
  querySelector(sel: string): El | null {
    return this.querySelectorAll(sel)[0] ?? null
  }
  computed(): Record<string, string> {
    const own = this.css as Record<string, string | undefined>
    const visibility = own.visibility ?? (this.parentElement ? this.parentElement.computed().visibility : 'visible')
    return { ...DEFAULTS, ...(this.css as Record<string, string>), visibility }
  }
  private displayed(): boolean {
    for (let e: El | null = this; e; e = e.parentElement) if (e.computed().display === 'none') return false
    return true
  }
  getBoundingClientRect(): Rect & { right: number; bottom: number } {
    const r = this.displayed() && this.rect ? this.rect : { left: 0, top: 0, width: 0, height: 0 }
    return { ...r, right: r.left + r.width, bottom: r.top + r.height }
  }
  getClientRects(): Rect[] {
    return this.displayed() && this.rect ? [this.rect] : []
  }
}

/** Un trazo SVG de juguete: una línea quebrada (cerrada si `closed`). */
class Geo extends El {
  constructor(tag: string, attrs: Record<string, string>, css: Style, private pts: Pt[], private closed = false) {
    super(tag, SVG, attrs, css, boundsOf(pts))
  }
  private segs(): Array<[Pt, Pt]> {
    const p = this.closed ? [...this.pts, this.pts[0]] : this.pts
    return p.slice(1).map((b, i) => [p[i], b])
  }
  getTotalLength(): number {
    return this.segs().reduce((s, [a, b]) => s + Math.hypot(b.x - a.x, b.y - a.y), 0)
  }
  getPointAtLength(d: number): Pt {
    let run = 0
    for (const [a, b] of this.segs()) {
      const l = Math.hypot(b.x - a.x, b.y - a.y)
      if (run + l >= d && l > 0) return { x: a.x + ((b.x - a.x) * (d - run)) / l, y: a.y + ((b.y - a.y) * (d - run)) / l }
      run += l
    }
    return this.pts[this.pts.length - 1]
  }
  getScreenCTM(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
  }
}

function boundsOf(pts: Pt[]): Rect {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
  return { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}
const rect = (left: number, top: number, width: number, height: number): Rect => ({ left, top, width, height })
const div = (attrs: Record<string, string> = {}, css: Style = {}, r: Rect | null = rect(0, 0, 0, 0)): El => new El('div', HTML, attrs, css, r)
const part = (id: string, label: string, r: Rect, css: Style = {}, extra: Record<string, string> = {}): El => new El('div', HTML, { 'data-ask-part': id, 'data-ask-label': label, ...extra }, css, r)
const g = (attrs: Record<string, string> = {}): El => new El('g', SVG, attrs, {}, null)
const ids = (els: Array<{ id: string }>): string[] => els.map((t) => t.id)
const asEl = (e: El): HTMLElement => e as unknown as HTMLElement

const realStyle = globalThis.getComputedStyle
beforeAll(() => {
  globalThis.getComputedStyle = ((e: El) => e.computed()) as unknown as typeof getComputedStyle
})
afterAll(() => {
  globalThis.getComputedStyle = realStyle
})

describe('las partes que cuentan', () => {
  it('fuera del lienzo no (unos botones debajo de la figura), y la caja del teclado no se estira hasta ellos', () => {
    const canvas = div({}, { overflow: 'hidden' }, rect(0, 0, 400, 300))
    const inFig = part('group-g0', 'hidroxilo', rect(100, 100, 40, 30))
    const chip = part('group-g0', 'hidroxilo', rect(0, 320, 90, 28))
    const root = div({}, {}, rect(0, 0, 400, 360)).add(canvas.add(inFig), div().add(chip))
    const [t] = collectTargets(asEl(root), asEl(canvas))
    expect(t.shapes).toHaveLength(1)
    expect(unionBox(t)).toEqual({ x: 100, y: 100, width: 40, height: 30 })
  })

  it('lo que no se ve no: opacidad 0 en ella o en un antepasado, visibility hidden, display none, aria-hidden', () => {
    const canvas = div({}, { overflow: 'hidden' }, rect(0, 0, 400, 300))
    const root = div({}, {}, rect(0, 0, 400, 300)).add(
      canvas.add(
        part('ok', 'Se ve', rect(10, 10, 40, 20)),
        part('op', 'Opacidad 0', rect(60, 10, 40, 20), { opacity: '0' }),
        div({}, { opacity: '0' }, rect(0, 40, 400, 40)).add(part('anc', 'Antepasado apagado', rect(10, 50, 40, 20))),
        part('vis', 'Oculta', rect(110, 10, 40, 20), { visibility: 'hidden' }),
        div({}, { display: 'none' }, rect(0, 90, 400, 40)).add(part('none', 'Sin pintar', rect(10, 100, 40, 20))),
        part('aria', 'Paso por llegar', rect(160, 10, 40, 20), {}, { 'aria-hidden': 'true' })
      )
    )
    expect(ids(collectTargets(asEl(root), asEl(canvas)))).toEqual(['ok'])
  })

  it('un nodo de un diagrama por salir (la opacidad 0 en el hijo que lo pinta todo) no; atenuado (en un paso), sí', () => {
    const canvas = div({}, { overflow: 'hidden' }, rect(0, 0, 400, 300))
    const node = (id: string, opacity: string, x: number): El =>
      part(id, id.toUpperCase(), rect(x, 10, 80, 40)).add(div({}, { opacity }, rect(x, 10, 80, 40)).add(div({}, { backgroundColor: 'rgb(255, 255, 255)' }, rect(x, 10, 80, 40)).text(id)))
    const root = div({}, {}, rect(0, 0, 400, 300)).add(canvas.add(node('shown', '1', 10), node('hidden', '0', 110), node('dim', '0.3', 210)))
    expect(ids(collectTargets(asEl(root), asEl(canvas)))).toEqual(['shown', 'dim'])
    expect(ids(keyboardTargets(asEl(root), asEl(canvas)))).toEqual(['shown', 'dim'])
  })
})

describe('un grupo SVG (una ruta de un mapa, un objeto de un dibujo) es lo que dibuja, no su caja', () => {
  // un mapa de 800 × 500: la ruta en diagonal (100,300)→(600,150) con su punta y un país dentro de su caja, lejos de la línea
  const setup = () => {
    const canvas = div({}, { overflow: 'hidden' }, rect(0, 0, 800, 500))
    const svg = new El('svg', SVG, {}, {}, rect(0, 0, 800, 500))
    const square = [{ x: 420, y: 230 }, { x: 520, y: 230 }, { x: 520, y: 290 }, { x: 420, y: 290 }]
    const country = new Geo('path', { 'data-ask-part': 'country:FR', 'data-ask-label': 'Francia', 'data-ask-kind': 'area', d: 'M… Z' }, {}, square, true)
    const route = g({ 'data-ask-part': 'route:0', 'data-ask-label': 'Ruta de Aníbal' }).add(
      new Geo('path', { d: 'M100 300 L600 150' }, {}, [{ x: 100, y: 300 }, { x: 600, y: 150 }]),
      new Geo('polygon', {}, {}, [{ x: 600, y: 150 }, { x: 590, y: 145 }, { x: 592, y: 158 }], true)
    )
    // la caja del grupo, la de su línea (lo que daría un navegador)
    Object.assign(route, { getBoundingClientRect: () => ({ left: 100, top: 145, width: 500, height: 155, right: 600, bottom: 300 }), getClientRects: () => [rect(100, 145, 500, 155)] })
    const root = div({}, {}, rect(0, 0, 800, 500)).add(canvas.add(svg.add(country, route)))
    return { root, canvas }
  }

  it('la ruta llega como su línea y su punta; subrayar el país da el país, no la ruta', () => {
    const { root, canvas } = setup()
    const targets = collectTargets(asEl(root), asEl(canvas))
    const route = targets.find((t) => t.id === 'route:0')!
    expect(route.shapes.map((s) => !!s.poly && !s.closed)).toEqual([true, false])
    // una línea no es una zona por el tamaño de su caja
    expect(route.kind).toBe('item')
    const under = Array.from({ length: 21 }, (_, i) => ({ x: 430 + i * 4, y: 270 }))
    expect(summarizeMarks(targets, [{ kind: 'pen', points: under }]).marked.map((t) => t.name)).toEqual(['Francia'])
    const along = Array.from({ length: 6 }, (_, i) => ({ x: 340 + i * 4, y: 222 }))
    expect(summarizeMarks(targets, [{ kind: 'pen', points: along }]).marked.map((t) => t.name)).toEqual(['Ruta de Aníbal'])
  })

  it('con el teclado, el recuadro de la ruta es el del grupo entero', () => {
    const { root, canvas } = setup()
    const route = keyboardTargets(asEl(root), asEl(canvas)).find((t) => t.id === 'route:0')!
    expect(unionBox(route)).toEqual({ x: 100, y: 145, width: 500, height: 155 })
  })
})

describe('el lienzo', () => {
  it('una estructura con grupos: el pozo de la figura (no el bloque entero, con su cabecera y los botones de los grupos)', () => {
    const header = div({}, { display: 'flex', justifyContent: 'space-between' }, rect(0, 0, 600, 32)).add(div(), div({}, { display: 'flex' }))
    const well = div({}, { overflow: 'hidden' }, rect(0, 40, 600, 300))
    const drawing = div({}, { transform: 'matrix(1, 0, 0, 1, 0, 0)' }, rect(0, 40, 600, 300))
    const svg = new El('svg', SVG, {}, {}, rect(0, 40, 600, 300))
    const atoms = [1, 2, 3].map((i) => g({ 'data-ask-part': `atom-${i}`, 'data-ask-label': `átomo ${i}` }))
    const group = g({ 'data-ask-part': 'group-g0', 'data-ask-label': 'hidroxilo' })
    const chips = div({}, {}, rect(0, 350, 600, 28)).add(new El('button', HTML, { 'data-ask-part': 'group-g0', 'data-ask-label': 'hidroxilo' }, {}, rect(0, 350, 90, 28)))
    const root = div({}, {}, rect(0, 0, 600, 380)).add(header, div({}, {}, rect(0, 40, 600, 300)).add(well.add(drawing.add(svg.add(...atoms, group)))), chips)
    const canvas = findCanvas(asEl(root))
    expect(canvas).toBe(well)
    // el botón «Marcar» va en la cabecera, fuera de la capa de marcar
    expect(headSlot(asEl(root), canvas!)).toBe(header.children[1])
  })

  it('con `data-ask-canvas`, ese; con todas las partes en un pozo que recorta, el pozo', () => {
    const explicit = div({ 'data-ask-canvas': '' }, {}, rect(0, 0, 100, 100))
    expect(findCanvas(asEl(div().add(explicit)))).toBe(explicit)
    const well = div({}, { overflow: 'hidden' }, rect(0, 0, 400, 300))
    const root = div({}, {}, rect(0, 0, 400, 300)).add(well.add(div().add(part('a', 'A', rect(10, 10, 40, 20)), part('b', 'B', rect(60, 10, 40, 20)))))
    expect(findCanvas(asEl(root))).toBe(well)
  })
})
