// Qué dice la tarjeta final del monitor: un curso nuevo cuenta lo que tiene; «Pedir cambios» cuenta lo que se añadió y los
// temas que se modificaron (antes decía «1 temas, 21 ejercicios…» como si el curso fuera nuevo). Puro: la pantalla lo traduce.
import type { RunReport, SkillRunStatus } from '@shared/generation/types'

export type SummaryItem = { key: 'topics' | 'exercises' | 'cards'; count: number }

export type DoneSummary =
  | { kind: 'created'; items: SummaryItem[]; verified: number }
  | { kind: 'extended'; added: SummaryItem[]; changed: number; verified: number }
  /** Ampliaciones de antes, sin lo que había al empezar: solo cuántos temas se tocaron. */
  | { kind: 'touched'; count: number; verified: number }

function items(topics: number, exercises: number, cards: number, keepZero: boolean): SummaryItem[] {
  const all: SummaryItem[] = [{ key: 'topics', count: topics }, { key: 'exercises', count: exercises }, { key: 'cards', count: cards }]
  return keepZero ? all : all.filter((x) => x.count > 0)
}

export function doneSummary(r: RunReport, mode: 'create' | 'extend'): DoneSummary {
  if (mode === 'create') return { kind: 'created', items: items(r.skillsReady + r.skillsNeedingReview, r.exercises, r.cards, true), verified: r.verified }
  const touched = r.changedSkills ?? r.skillsReady + r.skillsNeedingReview
  if (!r.added) return { kind: 'touched', count: touched, verified: r.verified }
  // los temas nuevos también cuentan como tocados: «modificados» son los que ya existían
  const changed = Math.max(0, touched - r.added.skills)
  return { kind: 'extended', added: items(r.added.skills, r.added.exercises, r.added.cards, false), changed, verified: r.verified }
}

/** En una ampliación terminada, un tema que nadie tocó no está «en espera»: quedó sin cambios. */
export function shownSkillStatus(status: SkillRunStatus, mode: 'create' | 'extend', working: boolean): SkillRunStatus | 'unchanged' {
  return mode === 'extend' && !working && status === 'pending' ? 'unchanged' : status
}
