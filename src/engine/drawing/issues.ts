// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/draw.ts (drawIssues).
// Lo que estorbaría a quien lee el dibujo, para que la IA lo arregle antes de que lo vea el estudiante: textos que se pisan y
// formas que se salen del lienzo, en reposo y en cada paso. Se calcula con la misma geometría que pinta la interfaz.
import type { DrawingBlock } from '@shared/schema/common'
import { boundsOf, overlapArea, type Box, type Pt } from './geometry'
import { drawingLayout } from './labels'
import { applyFrame, drawingEngine, drawingEnv, saneDrawParams, resolveFrame, type ItemFrame } from './motion'
import { canvasSize, DEFAULT_SHAPE_CONTEXT, labelBox, type DrawShape, type ShapeContext } from './shapes'
import { stepState, visibleAt } from './steps'

export interface DrawingIssue {
  /** Índice del elemento (para la ruta del aviso) o undefined si es del dibujo entero. */
  item?: number
  message: string
}

/** Cómo se nombra un elemento en un aviso: por su id, por su etiqueta o por su número. */
function describe(d: DrawingBlock, i: number): string {
  const it = d.items[i]
  if (it.id) return `el elemento «${it.id}»`
  const text = it.kind === 'text' ? it.text : it.label ?? it.name
  return text ? `${it.kind === 'object' ? it.object ?? 'object' : it.kind} «${text.slice(0, 40)}» (items[${i}])` : `${it.kind === 'object' ? `el objeto ${it.object ?? ''}` : `el ${it.kind}`} items[${i}]`
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** Puntos que ocupa un elemento (sin sus etiquetas), ya movidos. */
function inkPoints(s: DrawShape, fr: ItemFrame | undefined): Pt[] {
  const pts: Pt[] = []
  for (const p of s.paths) for (const q of p.pts ?? []) pts.push(q)
  for (const q of s.outline) pts.push(q)
  if (!pts.length && s.around) pts.push([s.around.x, s.around.y], [s.around.x + s.around.w, s.around.y + s.around.h])
  return fr ? pts.map((p) => applyFrame(p, fr)) : pts
}

function labelBoxes(s: DrawShape, fr: ItemFrame | undefined, ctx: ShapeContext): Array<{ text: string; box: Box }> {
  return s.labels.map((l) => {
    const b = labelBox(l, ctx)
    if (!fr) return { text: l.text, box: b }
    const [x, y] = applyFrame([l.x, l.y], fr)
    return { text: l.text, box: { ...b, x: b.x + x - l.x, y: b.y + y - l.y } }
  })
}

/** Avisos del dibujo (en español, para la IA). */
export function drawingIssues(d: DrawingBlock, ctx: ShapeContext = DEFAULT_SHAPE_CONTEXT): DrawingIssue[] {
  const out: DrawingIssue[] = []
  const seen = new Set<string>()
  const add = (msg: string, item?: number): void => { if (!seen.has(msg)) { seen.add(msg); out.push(item === undefined ? { message: msg } : { item, message: msg }) } }
  const { W, H } = canvasSize(d.width, d.height)
  const items = d.items.slice(0, 500)
  const shapes = drawingLayout(items, W, H, ctx)
  const params = saneDrawParams(d.params ?? [])
  const engine = drawingEngine({ params, time: d.time })
  const tm = d.time
  const states: Array<{ index: number | null; when: string }> = [{ index: null, when: ' en reposo' }]
  ;(d.steps ?? []).forEach((_, k) => states.push({ index: k, when: ` en el paso ${k + 1}` }))
  const slack = Math.max(W, H) * 0.03
  for (const { index, when } of states) {
    const st = stepState(d.steps ?? [], params, index)
    const t0 = tm ? engine.timeBounds(st.values)?.[0] : undefined
    const frames = items.some((it) => it.motion) ? resolveFrame(items, shapes, engine, drawingEnv(engine, st.values, t0)) : []
    const visible = items.map((it) => visibleAt(it, st.show))
    // textos que se pisan (más del 30 % de la caja menor)
    const texts = shapes.flatMap((s, i) => (visible[i] ? labelBoxes(s, frames[i], ctx) : []))
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i].box, b = texts[j].box
        if (overlapArea(a, b) > 0.3 * Math.min(a.w * a.h, b.w * b.h)) add(`Los textos «${texts[i].text.slice(0, 40)}» y «${texts[j].text.slice(0, 40)}» se pisan${when}: sepáralos (o pon la etiqueta en el elemento con "anchor":"auto").`)
      }
    }
    // formas que se salen del lienzo (las etiquetas no cuentan: pueden asomar)
    shapes.forEach((s, i) => {
      if (!visible[i]) return
      const b = boundsOf(inkPoints(s, frames[i]))
      if (!b) return
      if (b.x < -slack || b.y < -slack || b.x + b.w > W + slack || b.y + b.h > H + slack) add(`${cap(describe(d, i))} se sale del lienzo de ${W}×${H}${when}: muévelo dentro o agranda el lienzo.`, i)
    })
  }
  return out
}
