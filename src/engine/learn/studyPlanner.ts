// Plan diario de estudio por puntos por minuto (portado de LearnKit/Planning/StudyPlanner.swift).
//
// Orden y reglas (deterministas; el reloj es `inputs.now`):
// 1. Repasos vencidos (≈ 24 s por tarjeta, como mucho el 40 % del tiempo). 2. Errores (≈ 90 s cada uno, ≤ 30 %).
// 3. Diagnóstico si no hay ningún dato. 4. Simulacro si faltan 3–7 días, ya se vio ≥ 60 % y no se alcanzó el número recomendado.
// 5. Lo que más puntos aporta por minuto (peso × (1 − dominio) / minutos), respetando prerrequisitos (los que desbloquean reciben
//    un bonus). 6. Repaso final (faltan ≤ 2 días y hay datos): repaso, errores y hoja de fórmulas, y descanso la víspera.
// La suma de minutos nunca supera `minutesAvailable`.
import { MasteryModel, freshMastery, type SkillMastery } from './mastery'
import { compareIds, decimal, finiteOr, listJoin, resolveText, roundHalfAway, Spanish, type Lang, type TextOptions } from './support'
import { daysBetween, localTimeZone, startOfDay } from '@engine/calendar/time'

/** Una habilidad del temario con lo que el planificador necesita. */
export interface PlanSkill {
  id: string
  title: string
  /** Puntos en el examen (o peso relativo). */
  weight: number
  mastery: SkillMastery
  /** Ids que conviene dominar antes (los desconocidos se ignoran). */
  prerequisites: string[]
  /** Minutos para estudiarla entera (lección + práctica). */
  estimatedMinutes: number
  /** Distingue «hay que enseñarla» de «ya intentó un diagnóstico». `undefined` = criterio estadístico. */
  needsTeaching?: boolean | null
  /** Progreso guiado: exige comprobaciones independientes en vez de la probabilidad global. */
  progressReady?: boolean | null
}

/** Habilidad del plan con valores por defecto (sin intentos, sin prerrequisitos, 20 min). */
export function planSkill(p: Pick<PlanSkill, 'id' | 'title' | 'weight'> & Partial<PlanSkill>): PlanSkill {
  return { mastery: freshMastery(), prerequisites: [], estimatedMinutes: 20, ...p }
}

export interface PlanInputs {
  now: Date
  examDate?: Date | null
  minutesAvailable: number
  skills?: PlanSkill[]
  dueCards?: number
  dueMistakes?: number
  hasDiagnostic?: boolean
  mockExamsDone?: number
  /** Curso a su ritmo (sin examen): las razones hablan de lo que pesa cada tema en el curso. */
  selfPaced?: boolean
}

export type PlanKind = 'diagnostic' | 'learn' | 'practice' | 'review' | 'mistakes' | 'mock' | 'rest'
export const PLAN_KINDS: readonly PlanKind[] = ['diagnostic', 'learn', 'practice', 'review', 'mistakes', 'mock', 'rest']

export interface PlanItem {
  /** Estable y único: «review», «mistakes», «diagnostic», «mock», «formulas», «rest», «learn:<id>», «practice:<id>». */
  id: string
  kind: PlanKind
  skillID: string | null
  title: string
  /** Minutos (0 solo en `rest`). */
  minutes: number
  /** Por qué está, con cifras concretas («Vale 12 puntos y vas en 35 %.»). */
  reason: string
}

export interface PlannerOptions extends TextOptions {
  model?: MasteryModel
  /** Zona para contar los días de calendario hasta el examen (por defecto la del sistema). */
  timeZone?: string
}

export const StudyPlannerConstants = {
  secondsPerCard: 24.0,
  secondsPerMistake: 90.0,
  minimumStudyBlock: 5,
  maximumStudyBlock: 25,
  maximumStudyItems: 6,
  prerequisiteMastery: 0.6,
  prerequisiteAttempts: 2,
  maintenanceMastery: 0.9,
  unlockCredit: 0.5,
  mockCoverage: 0.6,
  mockMinimumMinutes: 25,
  mockMaximumMinutes: 60,
  maximumWeight: 1e12
}
const C = StudyPlannerConstants

/** Convierte a entero sin desbordar (entradas absurdas como `Int.max` tarjetas). */
export function safeInt(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1_000_000_000_000 : 0
  return Math.trunc(Math.min(Math.max(x, -1e12), 1e12))
}

/** Puntos para mostrar: 12.3 → «12», 7.5 → «7,5» (o «7.5»), 0.04 → «0». */
export function pointsText(x: number, comma = true): string {
  if (!Number.isFinite(x)) return '0'
  const v = Math.abs(x) >= 10 ? roundHalfAway(x) : roundHalfAway(x * 10) / 10
  return decimal(v, 1, comma)
}

/** Arma el plan de hoy. */
export function dailyPlan(inputs: PlanInputs, options: PlannerOptions = {}): PlanItem[] {
  return new Builder(inputs, options).build()
}

interface Info {
  skill: PlanSkill
  weight: number
  seen: boolean
  /** Dominio con olvido; 0 si nunca se intentó. */
  p: number
  /** Dominio sin olvido (para detectar «se está olvidando»). */
  rawMean: number
  baseMinutes: number
  prerequisites: string[]
}

type Value = { t: 'none' } | { t: 'onePoint' } | { t: 'points'; pts: string } | { t: 'underOne' } | { t: 'percent'; share: number }

class Builder {
  private readonly i: Required<Omit<PlanInputs, 'examDate'>> & { examDate: Date | null }
  private readonly model: MasteryModel
  private readonly tz: string
  private readonly lang: Lang
  private readonly comma: boolean
  private readonly budget: number
  private remaining: number
  private items: PlanItem[] = []
  private infos: Info[] = []
  private totalWeight = 0
  private pointsMode = false
  private coverage = 0
  private hadCandidates = false

  constructor(inputs: PlanInputs, o: PlannerOptions) {
    this.i = {
      now: inputs.now,
      examDate: inputs.examDate ?? null,
      minutesAvailable: inputs.minutesAvailable,
      skills: inputs.skills ?? [],
      dueCards: inputs.dueCards ?? 0,
      dueMistakes: inputs.dueMistakes ?? 0,
      hasDiagnostic: inputs.hasDiagnostic ?? false,
      mockExamsDone: inputs.mockExamsDone ?? 0,
      selfPaced: inputs.selfPaced ?? false
    }
    this.model = o.model ?? new MasteryModel()
    this.tz = o.timeZone ?? localTimeZone()
    const t = resolveText(o)
    this.lang = t.lang
    this.comma = t.comma
    this.budget = Math.max(0, Math.trunc(finiteOr(inputs.minutesAvailable, 0)))
    this.remaining = this.budget
  }

  private tr(es: string, en: string): string {
    return this.lang === 'en' ? en : es
  }

  // Preparación -------------------------------------------------------------------------------------------------------

  private prepare(): void {
    const seenIDs = new Set<string>()
    for (const s of this.i.skills) {
      if (seenIDs.has(s.id)) continue
      seenIDs.add(s.id)
      const w = Number.isFinite(s.weight) && s.weight > 0 ? Math.min(s.weight, C.maximumWeight) : 0
      const seen = s.mastery.attempts > 0
      const p = seen ? this.model.probability(s.mastery, this.i.now) : 0
      const a = Math.max(finiteOr(s.mastery.alpha, 1), 1e-6), b = Math.max(finiteOr(s.mastery.beta, 1), 1e-6)
      this.infos.push({
        skill: s, weight: w, seen, p, rawMean: seen ? a / (a + b) : 0,
        baseMinutes: s.estimatedMinutes > 0 ? s.estimatedMinutes : 15,
        prerequisites: s.prerequisites ?? []
      })
    }
    this.totalWeight = this.infos.reduce((acc, x) => acc + x.weight, 0)
    this.pointsMode = Math.abs(this.totalWeight - 100) < 0.5
    if (this.totalWeight > 0) this.coverage = this.infos.filter((x) => x.seen).reduce((acc, x) => acc + x.weight, 0) / this.totalWeight
  }

  /** Días de calendario hasta el examen; `null` si no hay o ya pasó. */
  private daysUntilExam(): number | null {
    const exam = this.i.examDate
    if (!exam || exam.getTime() < this.i.now.getTime()) return null
    const start = startOfDay(this.i.now, this.tz)
    const end = startOfDay(exam, this.tz)
    return Math.max(0, daysBetween(start, end, this.tz))
  }

  build(): PlanItem[] {
    if (!(this.budget > 0)) return []
    this.prepare()
    const daysLeft = this.daysUntilExam()
    const noData = this.infos.every((x) => !x.seen)
    const nearExam = (daysLeft ?? Number.MAX_SAFE_INTEGER) <= 2
    // con el examen encima y sin datos no hay nada que «repasar»: triage (aprender lo que más puntos da)
    const finalMode = nearExam && !noData
    const triage = nearExam && noData
    this.addReview(finalMode)
    this.addMistakes(finalMode, daysLeft)
    if (finalMode) {
      this.addFormulaSheet(daysLeft ?? 0)
      this.addRestForEve(daysLeft ?? 0)
    } else {
      if (!triage) this.addDiagnostic(noData)
      if (!triage && daysLeft !== null) this.addMock(daysLeft)
      this.addStudy(daysLeft, triage)
    }
    if (this.items.length === 0) this.addRest(this.hadCandidates || (finalMode && this.budget < 3))
    this.enforceBudget()
    return this.items
  }

  // Bloques fijos -----------------------------------------------------------------------------------------------------

  private take(minutes: number): number {
    const m = Math.max(0, Math.min(minutes, this.remaining))
    this.remaining -= m
    return m
  }

  private addReview(finalMode: boolean): void {
    const n = Math.max(0, safeInt(finiteOr(this.i.dueCards, 0)))
    if (!(n > 0) || !(this.remaining > 0)) return
    const needed = safeInt(Math.ceil((n * C.secondsPerCard) / 60))
    const cap = Math.max(1, safeInt(this.budget * (finalMode ? 0.5 : 0.4)))
    const minutes = this.take(Math.max(1, Math.min(needed, cap)))
    if (!(minutes > 0)) return
    const capacity = safeInt((minutes * 60) / C.secondsPerCard)
    let reason: string
    if (capacity >= n) {
      reason = n === 1
        ? this.tr('Tienes 1 tarjeta vencida: repasarla ahora fija lo aprendido en pocos minutos.', "You have 1 overdue card: reviewing it now locks in what you've learned in a few minutes.")
        : this.tr(`Tienes ${n} tarjetas vencidas: repasarlas ahora fija lo aprendido en pocos minutos.`, `You have ${n} overdue cards: reviewing them now locks in what you've learned in a few minutes.`)
    } else {
      const k = Math.max(1, capacity)
      reason = this.tr(`Tienes ${n} tarjetas vencidas: hoy te da tiempo de unas ${k}; empieza por las más atrasadas.`,
        `You have ${n} overdue cards: today you have time for about ${k}; start with the most overdue ones.`)
    }
    this.items.push({ id: 'review', kind: 'review', skillID: null, title: this.tr('Repaso de tarjetas', 'Flashcard review'), minutes, reason })
  }

  private addMistakes(finalMode: boolean, daysLeft: number | null): void {
    const n = Math.max(0, safeInt(finiteOr(this.i.dueMistakes, 0)))
    if (!(n > 0) || !(this.remaining > 0)) return
    const needed = safeInt(Math.ceil((n * C.secondsPerMistake) / 60))
    const cap = Math.max(1, safeInt(this.budget * (finalMode ? 0.35 : 0.3)))
    const minutes = this.take(Math.max(1, Math.min(needed, cap)))
    if (!(minutes > 0)) return
    const capacity = safeInt((minutes * 60) / C.secondsPerMistake)
    let reason: string
    const exam = daysLeft !== null
    if (capacity >= n) {
      if (n === 1) {
        reason = exam
          ? this.tr('Tienes 1 error por repasar: corregirlo hoy evita repetirlo en el examen.', 'You have 1 mistake to review: correcting it today stops you repeating it on the exam.')
          : this.tr('Tienes 1 error por repasar: corregirlo hoy evita repetirlo otra vez.', 'You have 1 mistake to review: correcting it today stops you repeating it.')
      } else {
        reason = exam
          ? this.tr(`Tienes ${n} errores por repasar: corregirlos hoy evita repetirlos en el examen.`, `You have ${n} mistakes to review: correcting them today stops you repeating them on the exam.`)
          : this.tr(`Tienes ${n} errores por repasar: corregirlos hoy evita repetirlos otra vez.`, `You have ${n} mistakes to review: correcting them today stops you repeating them.`)
      }
    } else {
      const k = Math.max(1, capacity)
      reason = this.tr(`Tienes ${n} errores por repasar: hoy te da tiempo de unos ${k}; empieza por los más recientes.`,
        `You have ${n} mistakes to review: today you have time for about ${k}; start with the most recent ones.`)
    }
    this.items.push({ id: 'mistakes', kind: 'mistakes', skillID: null, title: this.tr('Repaso de errores', 'Mistake review'), minutes, reason })
  }

  private addDiagnostic(noData: boolean): void {
    if (!noData || this.i.hasDiagnostic || this.infos.length === 0 || this.remaining < C.minimumStudyBlock) return
    const wanted = Math.min(Math.max(safeInt(roundHalfAway(this.infos.length * 1.5)), 10), 20)
    const minutes = this.take(wanted)
    if (!(minutes > 0)) return
    this.items.push({
      id: 'diagnostic', kind: 'diagnostic', skillID: null, title: this.tr('Diagnóstico inicial', 'Initial diagnostic'), minutes,
      reason: this.tr(`Aún no tengo datos tuyos: este diagnóstico de ${minutes} min me dice qué ya sabes y qué no para armar tu plan.`,
        `I don’t have any data from you yet: this ${minutes}-minute diagnosis tells me what you already know and what you don’t, so I can build your plan.`)
    })
  }

  private addMock(daysLeft: number): void {
    if (!(daysLeft >= 3 && daysLeft <= 7) || this.coverage < C.mockCoverage || this.remaining < C.mockMinimumMinutes) return
    const target = daysLeft >= 5 ? 1 : 2
    if (!(this.i.mockExamsDone < target)) return
    const minutes = this.take(C.mockMaximumMinutes)
    if (!(minutes > 0)) return
    const seen = Spanish.percentValue(this.coverage)
    this.items.push({
      id: 'mock', kind: 'mock', skillID: null, title: this.tr('Simulacro de examen', 'Mock exam'), minutes,
      reason: this.tr(`Faltan ${daysLeft} días y ya has visto el ${seen} % del temario: un simulacro te dice tu nota real y qué te falta.`,
        `${daysLeft} days to go and you've covered ${seen}% of the material: a mock exam tells you your real grade and what you still need to study.`)
    })
  }

  private addFormulaSheet(daysLeft: number): void {
    if (this.remaining < 3) return
    const wanted = Math.min(Math.max(safeInt(roundHalfAway(this.budget * 0.25)), 5), 15)
    const minutes = this.take(wanted)
    if (!(minutes > 0)) return
    let reason: string
    if (daysLeft === 0) reason = this.tr('Hoy es el examen: un último vistazo a tu hoja de fórmulas, sin aprender nada nuevo.', 'Today is your exam: take one last look at your formula sheet, without learning anything new.')
    else if (daysLeft === 1) reason = this.tr('El examen es mañana: repasa tu hoja de fórmulas, es lo que más rinde por minuto la víspera.', "The exam is tomorrow: review your formula sheet — it's the highest-yield thing you can do the night before.")
    else reason = this.tr(`Faltan ${daysLeft} días: tu hoja de fórmulas y tus errores son lo que más puntos rescata ahora.`, `${daysLeft} days left: your formula sheet and your mistakes are what save the most points now.`)
    this.items.push({ id: 'formulas', kind: 'review', skillID: null, title: this.tr('Hoja de fórmulas', 'Formula sheet'), minutes, reason })
  }

  private addRestForEve(daysLeft: number): void {
    const title = this.tr('Descanso', 'Break')
    if (daysLeft === 0) {
      this.items.push({ id: 'rest', kind: 'rest', skillID: null, title, minutes: 0,
        reason: this.tr('Hoy es el examen: llega con tiempo y descansado, y confía en lo que has practicado.', "Today is your exam: arrive early and rested, and trust what you've practiced.") })
    } else if (daysLeft === 1) {
      this.items.push({ id: 'rest', kind: 'rest', skillID: null, title, minutes: 0,
        reason: this.tr('Duerme bien esta noche: el sueño consolida lo que repasaste y rinde más que otra hora de estudio.', 'Sleep well tonight: sleep consolidates what you reviewed and pays off more than another hour of study.') })
    }
  }

  /** Sin bloques posibles: explica la causa real (poco tiempo, sin temario o todo al día). */
  private addRest(timeLimited: boolean): void {
    let reason: string
    if (timeLimited) {
      reason = this.tr(`Con ${this.budget} min no da para un bloque útil; mañana intenta reservar al menos ${C.minimumStudyBlock * 2}.`,
        `With ${this.budget} min there's no room for a useful block; tomorrow try to reserve at least ${C.minimumStudyBlock * 2}.`)
    } else if (this.infos.length === 0) {
      reason = this.tr('Aún no hay temario ni repasos pendientes: cuando añadas material, aquí aparecerá tu plan.', 'No pending topics or reviews yet: when you add material, your plan will appear here.')
    } else {
      reason = this.tr('Estás al día: no hay repasos pendientes y tus temas están sólidos. Descansar también es estudiar.', "You're all caught up: no reviews are pending and your topics are solid. Resting is studying too.")
    }
    this.items.push({ id: 'rest', kind: 'rest', skillID: null, title: this.tr('Descanso', 'Break'), minutes: 0, reason })
  }

  // Estudio por puntos por minuto --------------------------------------------------------------------------------------

  private isCandidateByMastery(x: Info): boolean {
    // una lección guiada sin terminar siempre entra; una terminada sigue la regla normal
    if (x.skill.progressReady === false) return true
    if (x.seen && x.p >= C.maintenanceMastery) return false
    return true
  }

  private satisfied(q: Info): boolean {
    if (q.skill.progressReady === true || q.skill.progressReady === false) return q.skill.progressReady
    return q.seen && q.p >= C.prerequisiteMastery && q.skill.mastery.attempts >= C.prerequisiteAttempts
  }

  private learningGain(x: Info): number {
    // una lección guiada sin terminar no puede desaparecer por un dominio que redondea a 100 % o un peso 0
    if (x.skill.progressReady === false) return Math.max(x.weight, 0.01) * Math.max(0.1, 1 - x.p)
    return x.weight * (1 - x.p)
  }

  /** Prerrequisitos válidos: existentes, distintos de ella y sin formar un ciclo con ella. */
  private effectivePrerequisites(byID: Map<string, Info>): Map<string, string[]> {
    const ancestorsCache = new Map<string, Set<string>>()
    const ancestors = (id: string): Set<string> => {
      const hit = ancestorsCache.get(id)
      if (hit) return hit
      const seen = new Set<string>()
      const stack = [...(byID.get(id)?.prerequisites ?? [])]
      while (stack.length > 0) {
        const q = stack.pop() as string
        if (!byID.has(q) || seen.has(q)) continue
        seen.add(q)
        stack.push(...(byID.get(q)?.prerequisites ?? []))
      }
      ancestorsCache.set(id, seen)
      return seen
    }
    const result = new Map<string, string[]>()
    for (const x of this.infos) {
      const list: string[] = []
      for (const q of x.prerequisites) {
        if (q === x.skill.id || !byID.has(q) || list.includes(q)) continue
        // si q depende (directa o indirectamente) de x, la arista forma un ciclo: se ignora
        if (ancestors(q).has(x.skill.id)) continue
        list.push(q)
      }
      result.set(x.skill.id, list)
    }
    return result
  }

  private value(x: Info): Value {
    if (x.weight <= 0) return { t: 'none' }
    if (this.pointsMode) {
      const pts = pointsText(x.weight, this.comma)
      return pts === '1' ? { t: 'onePoint' } : { t: 'points', pts }
    }
    const share = (100 * x.weight) / Math.max(this.totalWeight, 1e-12)
    return share < 1 ? { t: 'underOne' } : { t: 'percent', share: Math.trunc(roundHalfAway(share)) }
  }

  /** Primera frase de la razón: lo que vale y cómo vas. `lower`: la variante que va tras dos puntos (en minúscula). */
  private valueSentence(x: Info, lower: boolean): string {
    const pct = Spanish.percentValue(x.p)
    if (this.i.selfPaced) return this.courseValueSentence(x, pct, lower)
    const v = this.value(x)
    const seen = x.seen
    const en = this.lang === 'en'
    let text: string
    switch (v.t) {
      case 'none':
        text = en ? (seen ? `It doesn’t come up directly on the exam and you’re at ${pct}%.` : "It doesn't come up directly on the exam, and you haven't covered it yet.")
          : seen ? `No cae directamente en el examen y vas en ${pct} %.` : 'No cae directamente en el examen y aún no la has visto.'
        if (lower) text = en ? (seen ? `doesn't come up directly on the exam and you're at ${pct}%.` : "doesn't come up directly on the exam and you haven't seen it yet.") : lowerFirst(text)
        return text
      case 'onePoint':
        text = en ? (seen ? `It's worth 1 point and you're at ${pct}%.` : "Worth 1 point and you haven't seen it yet.")
          : seen ? `Vale 1 punto y vas en ${pct} %.` : 'Vale 1 punto y aún no la has visto.'
        if (lower) text = en ? (seen ? `is worth 1 point and you're at ${pct}%.` : "is worth 1 point and you haven't seen it yet.") : lowerFirst(text)
        return text
      case 'points':
        text = en ? (seen ? `Worth ${v.pts} points and you're at ${pct}%.` : `Worth ${v.pts} points and you haven't seen it yet.`)
          : seen ? `Vale ${v.pts} puntos y vas en ${pct} %.` : `Vale ${v.pts} puntos y aún no la has visto.`
        if (lower) text = en ? (seen ? `is worth ${v.pts} points and you're at ${pct}%.` : `is worth ${v.pts} points and you haven't seen it yet.`) : lowerFirst(text)
        return text
      case 'underOne':
        text = en ? (seen ? `It’s worth less than 1% of the exam and you’re at ${pct}%.` : 'It’s worth less than 1% of the exam and you haven’t seen it yet.')
          : seen ? `Pesa menos del 1 % del examen y vas en ${pct} %.` : 'Pesa menos del 1 % del examen y aún no la has visto.'
        if (lower) text = en ? (seen ? `accounts for less than 1% of the exam and you're at ${pct}%.` : "accounts for less than 1% of the exam and you haven't studied it yet.") : lowerFirst(text)
        return text
      case 'percent':
        text = en ? (seen ? `It counts for ${v.share}% of the exam, and you're at ${pct}%.` : `It’s worth ${v.share}% of the exam and you haven’t seen it yet.`)
          : seen ? `Pesa el ${v.share} % del examen y vas en ${pct} %.` : `Pesa el ${v.share} % del examen y aún no la has visto.`
        if (lower) text = en ? (seen ? `counts for ${v.share}% of the exam and you're at ${pct}%.` : `accounts for ${v.share}% of the exam and you haven't studied it yet.`) : lowerFirst(text)
        return text
    }
  }

  /** Lo que pesa en un curso a su ritmo (sin examen): su parte del curso, nunca puntos. */
  private courseShare(x: Info): number | null {
    if (!(x.weight > 0)) return null
    return Math.trunc(roundHalfAway((100 * x.weight) / Math.max(this.totalWeight, 1e-12)))
  }

  private courseValueSentence(x: Info, pct: number, lower: boolean): string {
    const s = this.courseShare(x)
    const en = this.lang === 'en'
    let text: string
    if (s === null) {
      text = en ? (x.seen ? `It’s a supporting topic and you’re at ${pct} %.` : 'It’s a supporting topic and you haven’t seen it yet.')
        : x.seen ? `Es un tema de apoyo y vas en ${pct} %.` : 'Es un tema de apoyo y aún no la has visto.'
    } else if (s < 1) {
      text = en ? (x.seen ? `It’s less than 1 % of the course and you’re at ${pct} %.` : 'It’s less than 1 % of the course and you haven’t seen it yet.')
        : x.seen ? `Es menos del 1 % del curso y vas en ${pct} %.` : 'Es menos del 1 % del curso y aún no la has visto.'
    } else {
      text = en ? (x.seen ? `It’s ${s} % of the course and you’re at ${pct} %.` : `It’s ${s} % of the course and you haven’t seen it yet.`)
        : x.seen ? `Es el ${s} % del curso y vas en ${pct} %.` : `Es el ${s} % del curso y aún no la has visto.`
    }
    if (!lower) return text
    return en ? lowerFirst(text.replace(/^It’s /, 'is ')) : lowerFirst(text)
  }

  /** Lo que vale, en corto: «20 puntos» o «12 % del examen». */
  private shortValue(x: Info): string {
    const en = this.lang === 'en'
    if (this.i.selfPaced) {
      const s = this.courseShare(x)
      if (s === null || s < 1) return en ? 'less than 1 % of the course' : 'menos del 1 % del curso'
      return en ? `${s} % of the course` : `${s} % del curso`
    }
    const v = this.value(x)
    switch (v.t) {
      case 'none': case 'underOne': return en ? 'less than 1 % of the exam' : 'menos del 1 % del examen'
      case 'onePoint': return en ? '1 point' : '1 punto'
      case 'points': return en ? `${v.pts} points` : `${v.pts} puntos`
      case 'percent': return en ? `${v.share}% of the exam` : `${v.share} % del examen`
    }
  }

  private daysSinceLastPractice(x: Info): number | null {
    const last = x.skill.mastery.lastPracticed
    if (!last) return null
    const dt = (this.i.now.getTime() - last.getTime()) / 1000
    if (!Number.isFinite(dt) || !(dt > 0)) return 0
    return safeInt(dt / 86_400)
  }

  private addStudy(daysLeft: number | null, triage: boolean): void {
    if (this.remaining < 1) return
    const byID = new Map<string, Info>()
    for (const x of this.infos) if (!byID.has(x.skill.id)) byID.set(x.skill.id, x)
    const effective = this.effectivePrerequisites(byID)

    // bloqueos y bonus por desbloquear
    const blockers = new Map<string, string[]>()
    for (const x of this.infos) {
      const open = (effective.get(x.skill.id) ?? []).filter((id) => {
        const q = byID.get(id)
        return q ? !this.satisfied(q) : false
      })
      if (open.length > 0) blockers.set(x.skill.id, open)
    }
    const bonus = new Map<string, number>()
    const unlocks = new Map<string, string[]>()
    for (const x of this.infos) {
      const open = blockers.get(x.skill.id)
      if (!open || !(x.weight > 0) || !this.isCandidateByMastery(x)) continue
      const gain = this.learningGain(x)
      for (const q of open) {
        bonus.set(q, (bonus.get(q) ?? 0) + (C.unlockCredit * gain) / open.length)
        const list = unlocks.get(q) ?? []
        list.push(x.skill.id)
        unlocks.set(q, list)
      }
    }

    interface Candidate { info: Info; priority: number; bonus: number }
    const candidates: Candidate[] = []
    for (const x of this.infos) {
      if (blockers.has(x.skill.id) || !this.isCandidateByMastery(x)) continue
      const gain = this.learningGain(x)
      const b = bonus.get(x.skill.id) ?? 0
      if (!(gain + b > 1e-12)) continue
      const priority = (gain + b) / Math.max(1, x.baseMinutes)
      // cuantizado: los empates numéricos se resuelven por el desempate y no por el ruido de redondeo
      candidates.push({ info: x, priority: roundHalfAway(priority * 1e9) / 1e9, bonus: b })
    }
    this.hadCandidates = candidates.length > 0
    candidates.sort((l, r) => {
      if (l.priority !== r.priority) return r.priority - l.priority
      if (l.info.weight !== r.info.weight) return r.info.weight - l.info.weight
      if (l.info.p !== r.info.p) return l.info.p - r.info.p
      return compareIds(l.info.skill.id, r.info.skill.id)
    })

    // intercalado: ninguna se lleva más de la mitad del tiempo de estudio (entre 10 y 25 min), salvo que solo haya una
    const planned = Math.min(candidates.length, 2)
    let blockCap: number
    if (planned <= 1) blockCap = C.maximumStudyBlock
    else {
      const half = safeInt(Math.ceil(this.remaining / planned))
      blockCap = Math.min(Math.max(half, 10), C.maximumStudyBlock)
    }

    let scheduled = 0
    for (const c of candidates) {
      if (scheduled >= C.maximumStudyItems) break
      const x = c.info
      const smallest = Math.min(C.minimumStudyBlock, x.baseMinutes)
      if (this.remaining < smallest) continue
      const scaled = x.seen ? x.baseMinutes * Math.max(0.35, 1 - x.p) : x.baseMinutes
      const wanted = Math.min(Math.max(safeInt(roundHalfAway(scaled)), smallest), blockCap)
      const minutes = this.take(wanted)
      if (!(minutes > 0)) continue
      scheduled += 1
      const title = x.skill.title === '' ? x.skill.id : x.skill.title
      const teach = x.skill.needsTeaching === true || x.skill.needsTeaching === false ? x.skill.needsTeaching : !x.seen
      const kind: PlanKind = teach ? 'learn' : 'practice'
      this.items.push({
        id: `${kind}:${x.skill.id}`, kind, skillID: x.skill.id,
        title: teach ? this.tr(`Aprende: ${title}`, `Learn: ${title}`) : this.tr(`Practica: ${title}`, `Practice: ${title}`),
        minutes,
        reason: this.studyReason(x, unlocks.get(x.skill.id) ?? [], byID, daysLeft, triage)
      })
    }
  }

  private studyReason(x: Info, unlocks: string[], byID: Map<string, Info>, daysLeft: number | null, triage: boolean): string {
    const urgent = triage && daysLeft !== null
    const sentences = [this.valueSentence(x, urgent)]
    const d = x.seen ? this.daysSinceLastPractice(x) : null
    if (d !== null && d >= 14 && x.rawMean - x.p >= 0.08) {
      sentences.push(this.tr(`Llevas ${d} días sin practicarla y se te está olvidando.`, `You haven’t practiced it for ${d} days, and you’re starting to forget it.`))
    }
    if (unlocks.length > 0) {
      // los dos dependientes que más valen (a igual peso, por id): el texto no depende del orden de entrada
      const top = unlocks.map((id) => byID.get(id)).filter((v): v is Info => !!v)
        .sort((a, b) => (a.weight !== b.weight ? b.weight - a.weight : compareIds(a.skill.id, b.skill.id)))
        .slice(0, 2)
      // las comillas van con el idioma: «…» en español, “…” en inglés
      const names = (open: string, close: string) => top.map((dep) => `${open}${dep.skill.title === '' ? dep.skill.id : dep.skill.title}${close} (${this.shortValue(dep)})`)
      if (top.length > 0) sentences.push(this.tr(`Es la base de ${listJoin(names('«', '»'), 'es')}.`, `It’s the foundation for ${listJoin(names('“', '”'), 'en')}.`))
    }
    const text = sentences.join(' ')
    if (triage && daysLeft !== null) {
      if (daysLeft === 0) return this.tr(`Hoy es el examen y casi no tienes datos: ${text}`, `Today is the exam day and you have hardly any data: ${text}`)
      if (daysLeft === 1) return this.tr(`Falta 1 día y casi no tienes datos: ${text}`, `1 day left and you have hardly any data: ${text}`)
      return this.tr(`Faltan ${daysLeft} días y casi no tienes datos: ${text}`, `${daysLeft} days to go and you have hardly any data: ${text}`)
    }
    return text
  }

  /** Red de seguridad: la suma de minutos jamás supera el tiempo disponible. */
  private enforceBudget(): void {
    let sum = this.items.reduce((acc, x) => acc + x.minutes, 0)
    let idx = this.items.length - 1
    while (sum > this.budget && idx >= 0) {
      const cut = Math.min(this.items[idx].minutes, sum - this.budget)
      this.items[idx].minutes -= cut
      sum -= cut
      idx -= 1
    }
    this.items = this.items.filter((x) => !(x.minutes === 0 && x.kind !== 'rest'))
  }
}

function lowerFirst(s: string): string {
  return s.length > 0 ? s[0].toLowerCase() + s.slice(1) : s
}

/** Igual que `dailyPlan` (nombre de la versión Swift). */
export const StudyPlanner = { dailyPlan, safeInt, pointsText, constants: StudyPlannerConstants }
