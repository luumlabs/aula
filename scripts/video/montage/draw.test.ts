import { describe, expect, it } from 'vitest'
import { drawGroup, drawPlan, drawProgress, drawingStrokes, type PieceLike } from './draw.ts'

const P = (kind: PieceLike['kind'], edge: boolean, size: number): PieceLike => ({ kind, edge, size, box: [0, 0, 1, 1], group: 0 })

describe('personajes que se dibujan: el orden y el tiempo de los trazos', () => {
  // como un muñeco: manchas (cuerpo, mejilla, ojo de tinta), la silueta (corta y larga), una línea de dentro
  const pieces = [P('fill', false, 120), P('fill', false, 8), P('blot', false, 2), P('ink', true, 10), P('ink', true, 60), P('ink', false, 6), P('color', false, 3)]
  const plan = drawPlan(pieces, 2)
  it('contorno primero (la línea más larga la primera), luego las aguadas de mayor a menor y al final los detalles', () => {
    expect(plan.order).toEqual([4, 3, 0, 1, 2, 5, 6])
    expect(plan.phase[4]).toBe('outline')
    expect(plan.phase[0]).toBe('fill')
    expect(plan.phase[2]).toBe('detail')
    expect(Math.min(plan.start[2], plan.start[5], plan.start[6])).toBeGreaterThanOrEqual(plan.start[0])
  })
  it('dura lo pedido; cada trazo, según su largo; nada antes de empezar y todo al acabar', () => {
    expect(Math.max(...plan.end)).toBeCloseTo(2, 9)
    expect(plan.end[4] - plan.start[4]).toBeGreaterThan(plan.end[3] - plan.start[3])
    expect(drawProgress(plan, -0.01).every((v) => v === 0)).toBe(true)
    expect(drawProgress(plan, 2).every((v) => v === 1)).toBe(true)
    const mid = drawProgress(plan, 0.3)
    expect(mid[4]).toBeGreaterThan(0)
    expect(mid[0]).toBe(0)
  })
  it('la hoja de efectos: un trazo por pieza en su orden, con acento al empezar y al acabar', () => {
    const s = drawingStrokes(plan, { who: 'companion:gato', t: 3, dur: 2, at: [0.3, 0.5], size: 400 })
    expect(s).toHaveLength(pieces.length + 1)
    expect(s[0].t).toBeCloseTo(3, 6)
    expect(s[0].accent).toBe(true)
    expect(s[s.length - 1]).toMatchObject({ phase: 'done', accent: true })
    expect(s[s.length - 1].t).toBeCloseTo(5, 6)
  })
  it('con rampa, el dibujo va a cámara lenta en su momento y acaba a su hora', () => {
    const s = drawingStrokes(plan, { who: 'companion:gato', t: 3, dur: 2, at: [0.3, 0.5], size: 400, ramps: [{ from: 3, to: 5, at: 4, slow: 0.25 }] })
    expect(s[s.length - 1].t).toBeCloseTo(5, 3)
  })
  it('en grupo: escalonados', () => {
    const g = drawGroup({ t: 1, who: ['icon:math', 'icon:study', 'companion:gato'], at: [[0.2, 0.5], [0.4, 0.5]], size: 200, stagger: 0.25 })
    expect(g.map((d) => d.t)).toEqual([1, 1.25, 1.5])
    expect(g[2].at).toEqual([0.2, 0.5])
  })
})

describe('dibujos en el hueco del portátil', async () => {
  const { laptopTest } = await import('./v6-laptop.ts')
  const { drawingPlace } = await import('./draw.ts')
  const { laptopSweptBox } = await import('./laptop.ts')
  const c = laptopTest([1920, 1080])
  const m = { name: 'x', fps: 60, size: [1920, 1080] as [number, number], theme: 'light' as const, duration: c.duration, takes: {}, clips: [], laptop: { keys: c.keys } }
  it('en fila, dentro del hueco libre y sin tocar el portátil', () => {
    const g = drawGroup({ t: 2.4, until: 4.8, who: ['companion:gato', 'companion:buho', 'companion:luna'], at: 'gap', side: 'right', size: 300 })
    const box = laptopSweptBox(m, m.laptop, 2.4, 4.8)
    const ps = g.map((d) => drawingPlace(m, d))
    expect(ps[0].x).toBeLessThan(ps[1].x)
    expect(ps[1].x).toBeLessThan(ps[2].x)
    for (const p of ps) {
      expect(p.x - p.size / 2).toBeGreaterThan(box.x + box.w)
      expect(p.x + p.size / 2).toBeLessThanOrEqual(1920)
      expect(p.y + p.size / 2).toBeLessThanOrEqual(1080)
    }
  })
})

describe('dibujos sobre las cartelas y el final: no pisan el texto', async () => {
  const { clearOfText } = await import('./draw.ts')
  const { cardTextRects, finaleTextRects } = await import('./v5.ts')
  const names = ['Plan', 'Learn', 'See it', 'Ask', 'Always on', 'Documents', 'Everywhere']
  const m = {
    name: 'x', fps: 60, size: [1920, 1080] as [number, number], theme: 'light' as const, duration: 130, takes: {}, clips: [],
    chapters: { names, cards: [{ t: 81.6, dur: 2.4, n: 5, sub: 'Like a tutor who never leaves.' }] },
    finale: { start: 124.8, dur: 4.8, size: 320, at: [0.5, 0.4] as [number, number], title: 'Aula', sub: 'Your study companion.' }
  }
  const frame = { W: 1920, H: 1080 }
  const overlaps = (p: { x: number; y: number; size: number }, R: { x: number; y: number; w: number; h: number }) =>
    p.x + p.size / 2 > R.x && p.x - p.size / 2 < R.x + R.w && p.y + p.size / 2 > R.y && p.y - p.size / 2 < R.y + R.h
  const inside = (p: { x: number; y: number; size: number }) => p.x - p.size / 2 >= 0 && p.x + p.size / 2 <= 1920 && p.y - p.size / 2 >= 0 && p.y + p.size / 2 <= 1080
  it('el texto de la cartela (número, título, subtítulo y la fila) tiene su caja', () => {
    const [title, row] = cardTextRects(m, m.chapters.cards[0])
    expect(title.x).toBeGreaterThan(0)
    expect(title.x + title.w / 2).toBeCloseTo(960, 0)
    expect(row.y).toBeGreaterThan(title.y + title.h)
  })
  it('un dibujo encima del título de la cartela sale de él y se queda en el cuadro; el farol de DIR no lo pisa', () => {
    const rects = cardTextRects(m, m.chapters.cards[0])
    const p = clearOfText({ x: 960, y: 500, size: 200 }, rects, frame)
    for (const R of rects) expect(overlaps(p, R)).toBe(false)
    expect(inside(p)).toBe(true)
    const farol = clearOfText({ x: 0.3 * 1920, y: 0.33 * 1080, size: 170 }, rects, frame)
    for (const R of rects) expect(overlaps(farol, R)).toBe(false)
    expect(Math.hypot(farol.x - 576, farol.y - 356)).toBeLessThan(200)
  })
  it('la luna y el gato a los lados del icono del final se quedan donde estaban (no pisan ni el icono ni «Aula»)', () => {
    const rects = finaleTextRects(m)
    expect(rects).toHaveLength(2)
    for (const at of [[0.33, 0.4], [0.67, 0.4]]) {
      const p0 = { x: at[0] * 1920, y: at[1] * 1080, size: 170 }
      const p = clearOfText(p0, rects, frame)
      expect(p).toEqual(p0)
    }
    // y uno puesto encima de «Aula» sale de su caja
    const p = clearOfText({ x: 960, y: rects[1].y + rects[1].h / 2, size: 150 }, rects, frame)
    for (const R of rects) expect(overlaps(p, R)).toBe(false)
  })
})
