// Qué pasa al pulsar un elemento del plan: abre el modo de estudio adecuado.
import type { HomePlanItem } from '@shared/ipc/home'
import { navigate } from '@renderer/app/router'

export function startPlanItem(p: HomePlanItem): void {
  const mode = p.kind === 'cards' ? 'cards' : p.kind === 'mistakes' ? 'mistakes' : p.kind === 'exam' ? 'exam' : p.kind === 'learn' ? 'learn' : 'practice'
  navigate({ name: 'study', id: p.courseId, mode, skill: p.skillId })
}
