// Preparación común: el layout completo decide etiquetas y semillas antes de ocultar etapas.
import type { DrawItem } from '@shared/schema/common'
import { seedOf } from '@renderer/design/paint/random'
import { applyFrame, boundsOf, drawingLayout, labelBox, paintOrder, type Box, type DrawShape, type ItemFrame, type Pt, type ShapeContext } from '../lib/drawing'
import { handAmplitude, handPath } from '../lib/hand'
import { loopInk } from '../lib/loopInk'

export function prepareDrawingLayout(items: DrawItem[], W: number, H: number, context: ShapeContext, hand: boolean, seed: string) {
  const shapes = drawingLayout(items, W, H, context)
  const amplitude = handAmplitude(W, H)
  const handD = shapes.map((shape, i) => shape.paths.map((path, j) => path.pts && !path.crisp && !path.fillOnly && (path.hand || hand)
    ? handPath(path.pts, !!path.closed, seedOf(`${seed}:${i}:${j}`), amplitude) : undefined))
  return { shapes, handD, order: paintOrder(items) }
}
export type PreparedDrawingLayout = ReturnType<typeof prepareDrawingLayout>

export function drawingShapeBox(shape: DrawShape, frame: ItemFrame | undefined, context: ShapeContext): Box | undefined {
  const points: Pt[] = [...shape.paths.flatMap((path) => path.pts ?? []), ...shape.outline]
  if (!points.length && shape.around) points.push([shape.around.x, shape.around.y], [shape.around.x + shape.around.w, shape.around.y + shape.around.h])
  const moved = frame ? points.map((point) => applyFrame(point, frame)) : points
  for (const label of shape.labels) {
    const box = labelBox(label, context)
    const point = frame ? applyFrame([label.x, label.y], frame) : [label.x, label.y]
    const dx = point[0] - label.x, dy = point[1] - label.y
    moved.push([box.x + dx, box.y + dy], [box.x + box.w + dx, box.y + box.h + dy])
  }
  return boundsOf(moved)
}

export function prepareDrawingRing(shape: DrawShape, frame: ItemFrame | undefined, context: ShapeContext, k: number, seed: string, index: number) {
  const box = drawingShapeBox(shape, frame, context)
  if (!box) return undefined
  const padding = 7
  let width = (box.w + padding * 2) * k, height = (box.h + padding * 2) * k
  const x = (box.x - padding) * k - (Math.max(width, height * 0.5) - width) / 2 - 4
  const y = (box.y - padding) * k - (Math.max(height, width * 0.5) - height) / 2 - 4
  width = Math.max(width, height * 0.5)
  height = Math.max(height, width * 0.5)
  return { x, y, width: width + 8, height: height + 8, drawing: loopInk(width + 8, height + 8, `${seed}:loop:${index}`) }
}
