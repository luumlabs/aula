// Guardar en una lección las tarjetas que Aula sacó de un documento (port de DocumentCards en DocumentAI.swift): validadas
// como las demás y apuntadas en el historial de cambios (se pueden deshacer desde «Cambios de Aula»).
import { IDs } from '@engine/base/ids'
import { ContentValidator } from '@engine/content/validator'
import type { DocumentCardDraft, DocumentCardTarget } from '@shared/documents'
import type { Flashcard, SourceRef } from '@shared/schema'
import { orderedSkills } from '@shared/schema'
import { AulaError } from '../errors'
import { ChangeContext, getLibrary, notifyCourseChanged, type PackStore } from '../store'

/** Guarda las tarjetas válidas en la lección. Devuelve cuántas. Lanza si ninguna vale o la lección no existe. */
export function saveDocumentCards(store: PackStore, skillID: string, cards: DocumentCardDraft[], opts: { source?: SourceRef; label: string; lang?: 'es' | 'en' }): number {
  const pack = store.loadPack()
  if (!pack.skills.some((s) => s.id === skillID)) throw new AulaError('not_found', opts.lang === 'en' ? "That lesson doesn't exist." : 'Esa lección no existe.')
  const validator = new ContentValidator()
  const ok: Flashcard[] = []
  for (const c of cards.slice(0, 24)) {
    const card: Flashcard = { id: `doc-${IDs.short(5)}`, skill: skillID, kind: 'basic', front: c.front.trim(), back: c.back.trim(), tags: [] }
    if (opts.source) card.source = opts.source
    if (!card.front || !card.back) continue
    if (validator.checkCard(card, 'card').some((i) => i.severity === 'error')) continue
    ok.push(card)
  }
  if (!ok.length) throw new AulaError('invalid_cards', opts.lang === 'en' ? 'The cards are not valid.' : 'Las tarjetas no son válidas.')
  const actor = ChangeContext.newActor('other', opts.label, store.id)
  ChangeContext.run(actor, () => store.updateSkill(skillID, (s) => { s.cards.push(...ok) }))
  notifyCourseChanged(store.id)
  return ok.length
}

/** Dónde se pueden guardar tarjetas: el curso del documento primero y después el resto, con sus lecciones en orden. */
export function cardTargets(firstCourseId?: string): DocumentCardTarget[] {
  const lib = getLibrary()
  const out: DocumentCardTarget[] = []
  for (const summary of lib.listPacks()) {
    const store = lib.openPack(summary.id)
    if (!store) continue
    try {
      const pack = store.loadPack()
      const skills = (orderedSkills(pack).length ? orderedSkills(pack) : pack.skills).map((s) => ({ id: s.id, title: s.title }))
      if (skills.length) out.push({ courseId: store.id, courseTitle: pack.title, hue: pack.hue, skills })
    } catch { /* nada */ }
  }
  return out.sort((a, b) => Number(b.courseId === firstCourseId) - Number(a.courseId === firstCourseId))
}
