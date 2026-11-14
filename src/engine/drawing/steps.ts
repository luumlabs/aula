// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: viewer/src/steps.ts (applyStep) y
// viewer/src/figures.ts (animateSliders: el deslizamiento de 550 ms).
// Dibujos paso a paso: en cada paso se ven los elementos de su etapa (`stage` ≤ show), los deslizadores van a los valores que
// fijan los pasos hasta ahí y se rodean los elementos nombrados. Sin paso (null) se ve el dibujo entero, en reposo. Puro.
import type { DrawItem } from '@shared/schema/common'
import type { DrawingStep } from '@shared/schema/drawing'
import type { SimParam } from '@shared/schema/visual'
import { clampParams } from './motion'

export interface StepState {
  /** Etapa máxima visible (Infinity = todo). */
  show: number
  /** Valores de los deslizadores en este paso. */
  values: Record<string, number>
  /** Ids rodeados en este paso. */
  highlight: string[]
}

/** Lo que muestra el paso `index` (lo que fijan los pasos anteriores se arrastra, como en Sketchy). */
export function stepState(steps: readonly DrawingStep[], params: readonly SimParam[], index: number | null): StepState {
  const values: Record<string, number> = {}
  for (const p of params) values[p.name] = p.value
  if (index === null || index < 0 || !steps.length) return { show: Infinity, values: clampParams(params, values), highlight: [] }
  const k = Math.min(index, steps.length - 1)
  let show = Infinity
  for (let i = 0; i <= k; i++) {
    const s = steps[i]
    if (s.show !== undefined) show = s.show
    for (const [name, v] of Object.entries(s.params ?? {})) if (params.some((p) => p.name === name)) values[name] = v
  }
  return { show, values: clampParams(params, values), highlight: steps[k].highlight ?? [] }
}

/** ¿Se ve el elemento con esta etapa máxima? */
export const visibleAt = (item: DrawItem, show: number): boolean => (item.stage ?? 0) <= show

/**
 * Índices de los elementos rodeados (por id). Con `show`, solo los que ya se ven en el paso: rodear algo que aún no está
 * atenuaría todo el dibujo sin rodear nada.
 */
export function highlightIndices(items: readonly DrawItem[], ids: readonly string[], show = Infinity): Set<number> {
  const want = new Set(ids)
  const out = new Set<number>()
  items.forEach((it, i) => { if (it.id && want.has(it.id) && visibleAt(it, show)) out.add(i) })
  return out
}

/** Duración del deslizamiento de los deslizadores al cambiar de paso (ms). */
export const GLIDE_MS = 550

/** Suavizado del deslizamiento (cuadrático de entrada y salida): 0 → 0, 1 → 1, siempre creciente. */
export function glideEase(k: number): number {
  const t = Math.min(1, Math.max(0, k))
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

/** Valores a mitad de un deslizamiento (`k` de 0 a 1). */
export function glideValues(from: Readonly<Record<string, number>>, to: Readonly<Record<string, number>>, k: number): Record<string, number> {
  const e = glideEase(k)
  const out: Record<string, number> = {}
  for (const name of Object.keys(to)) {
    const a = Object.hasOwn(from, name) ? from[name] : to[name]
    out[name] = a + (to[name] - a) * e
  }
  return out
}
