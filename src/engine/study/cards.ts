// Repaso espaciado de las tarjetas de un curso con FSRS (port de StudyEngine/Learning/CardReview.swift).
import { FSRS, attemptFromRating, isDueToday, type Rating, type SkillMastery } from '@engine/learn'
import { localTimeZone } from '@engine/calendar/time'
import { ownValue, type CardProgress, type ItemID, type Pack, type StudyProgress } from '@shared/schema'
import type { DueCard, DueCardOptions, ReviewCardOptions, SkillsInput, StudyLang } from './types'
import { LearnBridge } from './bridge'
import { addInt, dayKey, finite, skillMap } from './util'
import { renderCloze } from './cloze'

/** Cuánto cuenta una calificación de tarjeta frente a la evidencia normal de un repaso. */
const CARD_WEIGHT = 0.3
/** Dominio máximo al que llegan las tarjetas solas (lo que ya demostraban los ejercicios no se toca). */
const CARD_CEILING = 0.7
const DISTANT_PAST = new Date(-62135596800000).toISOString()

export const CardReview = {
  cardWeight: CARD_WEIGHT,
  cardCeiling: CARD_CEILING,

  /**
   * Tarjetas que tocan hoy (primero las vencidas, de la más atrasada a la más reciente) y, si se pide, algunas nuevas. Las
   * nuevas salen solo de las habilidades ya estudiadas (lección hecha o algo de práctica), o de la pedida con `skillId`; si aún
   * no se ha estudiado nada, de las primeras del curso (si no, «Repasar» saldría vacío el primer día).
   */
  queue(pack: Pack, skillsInput: SkillsInput, progress: StudyProgress, opts: DueCardOptions = {}): DueCard[] {
    const now = opts.now ?? new Date()
    const includeNew = opts.includeNew ?? true, newLimit = opts.newLimit ?? 8, limit = opts.limit ?? 60, only = opts.skillId
    const skills = skillMap(skillsInput)
    const tz = localTimeZone()
    const studied = new Set(pack.skills.filter((s) => { const sp = ownValue(progress.skills, s.id); return sp ? sp.lessonDone || sp.attempts > 0 : false }).map((s) => s.id))
    const due: Array<DueCard & { at: number }> = [], fresh: DueCard[] = []
    // una habilidad o una tarjeta repetidas (mismo id) no deben salir dos veces en la misma sesión
    const seenSkills = new Set<ItemID>(), seenCards = new Set<ItemID>()
    for (const ref of pack.skills) {
      if ((only !== undefined && ref.id !== only) || seenSkills.has(ref.id)) continue
      seenSkills.add(ref.id)
      const s = ownValue(skills, ref.id)
      if (!s) continue
      const newHere = only !== undefined || studied.size === 0 || studied.has(ref.id)
      for (const c of s.cards) {
        if (seenCards.has(c.id)) continue
        seenCards.add(c.id)
        const p = ownValue(progress.cards, c.id)
        if (p && p.reps > 0) {
          const st = LearnBridge.reviewState(p, now)
          if (isDueToday(st, now, tz)) due.push({ card: c, skillId: ref.id, isNew: false, due: p.due, at: st.due.getTime() })
        } else if (includeNew && newHere) fresh.push({ card: c, skillId: ref.id, isNew: true, due: DISTANT_PAST })
      }
    }
    due.sort((a, b) => a.at - b.at)
    const ordered: DueCard[] = due.map(({ at: _at, ...d }) => d)
    return [...ordered, ...fresh.slice(0, Math.max(0, newLimit))].slice(0, Math.max(0, limit))
  },

  /** El dominio tras calificar una tarjeta: evidencia débil (30 %) y con techo (ver `rate`). */
  masteryAfterCard(before: SkillMastery, rating: Rating, seconds: number | null, now: Date): SkillMastery {
    const model = LearnBridge.masteryModel
    const full = model.updated(before, attemptFromRating(rating, seconds), now)
    const d = model.decayed(before, now)
    // intentos, racha y último acierto: solo los ejercicios
    const m: SkillMastery = { ...before }
    m.alpha = d.alpha + CARD_WEIGHT * (full.alpha - d.alpha)
    m.beta = d.beta + CARD_WEIGHT * (full.beta - d.beta)
    m.lastPracticed = full.lastPracticed // α y β quedan «al día» de ahora
    const cap = Math.max(CARD_CEILING, before.attempts > 0 ? model.probability(before, now) : 0)
    if (cap < 1 && m.alpha / (m.alpha + m.beta) > cap) m.alpha = (cap * m.beta) / (1 - cap)
    return m
  },

  /** Cuánto tardaría en volver a aparecer con cada calificación («Otra vez 1 min · Difícil 6 min · Bien 1 día · Fácil 4 días»). */
  preview(p: CardProgress | undefined, now: Date, lang?: StudyLang): Record<Rating, string> {
    const st = LearnBridge.reviewState(p, now)
    const next = LearnBridge.fsrs.preview(st, now)
    const out = {} as Record<Rating, string>
    for (const r of [1, 2, 3, 4] as Rating[]) out[r] = FSRS.intervalDescription(now, next[r].due, { lang })
    return out
  },

  /**
   * Anota la calificación de una tarjeta: FSRS, el dominio de su habilidad y la estadística del día.
   * Recordar una definición no es resolver un ejercicio: es evidencia débil (30 %), no suma intentos (ni «visto», ni racha) y
   * no sube el dominio por encima de max(70 %, el que ya había).
   */
  rate(p: StudyProgress, cardId: ItemID, rating: Rating, now: Date, opts: ReviewCardOptions = {}): StudyProgress {
    const st = LearnBridge.reviewState(ownValue(p.cards, cardId), now)
    const next = LearnBridge.fsrs.next(st, rating, now)
    const out: StudyProgress = { ...p, cards: { ...p.cards, [cardId]: LearnBridge.cardProgress(next) } }
    const skill = opts.skillId ?? (opts.skills ? CardReview.skillOfCard(cardId, opts.skills) : undefined)
    const seconds = opts.seconds !== undefined && Number.isFinite(opts.seconds) && opts.seconds >= 0 ? Math.min(opts.seconds, 3_600) : undefined
    if (skill) {
      const sp = ownValue(p.skills, skill)
      const m = CardReview.masteryAfterCard(LearnBridge.mastery(sp), rating, seconds ?? null, now)
      out.skills = { ...p.skills, [skill]: LearnBridge.apply(m, sp) }
    }
    const key = dayKey(now)
    const minutes = finite(seconds ?? 8, 8) / 60
    const i = p.days.findIndex((d) => d.day === key)
    const days = [...p.days]
    if (i >= 0) days[i] = { ...days[i], minutes: days[i].minutes + minutes }
    else days.push({ day: key, minutes, attempts: 0, correct: 0 })
    out.days = days
    out.xp = addInt(p.xp, rating === 1 ? 1 : rating === 2 ? 3 : 5)
    return out
  },

  /** La habilidad que tiene la tarjeta. */
  skillOfCard(cardId: ItemID, skillsInput: SkillsInput): ItemID | undefined {
    for (const s of Object.values(skillMap(skillsInput))) if (s.cards.some((c) => c.id === cardId)) return s.id
    return undefined
  },

  /** Texto de una tarjeta cloze con los huecos ocultos («**[…]**»; en una fórmula, «\boxed{\,?\,}») o resueltos (ver `renderCloze`). */
  clozeText(front: string, revealed: boolean): string {
    return renderCloze(front, revealed)
  },

  /** El último repaso de hoy (para la estadística). */
  reviewedToday(p: StudyProgress, now: Date): number {
    const key = dayKey(now)
    return Object.values(p.cards).filter((c) => c.lastReview && dayKey(new Date(c.lastReview)) === key).length
  }
}
