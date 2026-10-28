// La gota se aparta cuando, con la vista quieta, tiene un control debajo (un interruptor, «See all», una casilla): así nunca
// tapa algo que se pueda pulsar (A4-P2-13). Una tarjeta grande que se pulsa no cuenta: se puede pulsar en cualquier otro
// sitio; cuenta lo que queda tapado en buena parte. Puro, para probarlo sin DOM.

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** Qué parte de `el` queda debajo de `orb` (0–1). */
export function coveredFraction(orb: Box, el: Box): number {
  const w = Math.max(0, Math.min(orb.right, el.right) - Math.max(orb.left, el.left))
  const h = Math.max(0, Math.min(orb.bottom, el.bottom) - Math.max(orb.top, el.top))
  const area = Math.max(1, (el.right - el.left) * (el.bottom - el.top))
  return (w * h) / area
}

/** ¿Tapa la gota alguno de estos controles? (basta con una quinta parte: el borde de un interruptor ya molesta) */
export function coversAControl(orb: Box, controls: readonly Box[], min = 0.2): boolean {
  return controls.some((c) => coveredFraction(orb, c) >= min)
}

/** Lo que se puede pulsar o enfocar (sin la propia gota). */
export const INTERACTIVE = 'button, a[href], input, select, textarea, label, summary, [role="switch"], [role="button"], [role="tab"], [role="checkbox"], [role="radio"], [role="option"], [role="link"], [tabindex="0"]'

/** Puntos de la caja de la gota donde mirar qué hay debajo (centro y cuatro lados, un poco hacia dentro). */
export function probePoints(orb: Box): Array<[number, number]> {
  const cx = (orb.left + orb.right) / 2
  const cy = (orb.top + orb.bottom) / 2
  const dx = (orb.right - orb.left) * 0.38
  const dy = (orb.bottom - orb.top) * 0.38
  return [[cx, cy], [cx - dx, cy], [cx + dx, cy], [cx, cy - dy], [cx, cy + dy]]
}
