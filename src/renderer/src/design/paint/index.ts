// Dibujo a mano («Papel y luz» con tinta, pluma, pincel y lápiz): líneas que se dibujan una vez al aparecer, con el ritmo
// de una mano, y rellenos planos de borde cortado a mano. Ver design/README.md.
export { Paint, BrushUnderline, InkRing, DrawnTile, DrawnBorder, CoverBand, InkStrike, InkCheck, InkBurst, PencilRays, InkArrow, type PaintProps } from './Paint'
export { Ink, useInkReveal, type RevealPlan } from './Ink'
export { requestPaint, peekPaint } from './cache'
export { seedOf } from './random'
export type { PaintKind, PaintSpec } from './recipes'
export type { InkDrawing, InkStroke } from './drawings'
