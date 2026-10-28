// Resumen de Inicio (`home.summary`), port de StudyUI/App/StudyDigest.swift: lo pendiente de hoy en todos los cursos, plan
// combinado (primero el curso del examen más cercano, alternando cursos hasta la meta diaria), racha, exámenes y eventos.
import type { HomeCourse, HomeEvent, HomeExam, HomePlanItem, HomeSummary } from '@shared/ipc/home'
import { localTimeZone, startOfDay } from '@engine/calendar/time'
import { ownValue, emptyProgress, type ItemID, type Pack, type StudyProgress } from '@shared/schema'
import { L } from '@engine/grading/messages'
import type { SkillsInput, StudyLang } from './types'
import { LearnBridge } from './bridge'
import { Recorder } from './recorder'
import { StudyStatsCalc } from './stats'
import { hasAttempts, toHomePlanItem } from './overview'
import { dayKey, skillMap, toDate } from './util'

/** Un curso para el resumen: el curso, sus habilidades y si aún se está creando. */
export interface HomeCourseInput {
  pack: Pack
  skills: SkillsInput
  /** Aún se está creando: ni plan de hoy ni nota. */
  generating?: boolean
}

export interface HomeSettings {
  /** Nombre con el que Aula saluda. */
  name: string
  /** Meta diaria en minutos (60 por defecto, como la app Swift). */
  dailyMinutes?: number
  /** ¿Hay una IA lista? */
  aiReady: boolean
  lang?: StudyLang
  /** Bloques del plan combinado (4 por defecto). */
  planLimit?: number
  /** Días de «Próximamente» (14 por defecto). */
  upcomingDays?: number
}

interface CourseDigest {
  pack: Pack
  progress: StudyProgress
  dueCards: number
  dueMistakes: number
  readiness: number
  low: number
  high: number
  coverage: number
  /** ¿Hay algún intento? Sin él, la nota estimada no dice nada (se muestra «Sin empezar»). */
  started: boolean
  plan: HomePlanItem[]
  generating: boolean
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** «Repasa 4 tarjetas y 5 errores» (frases completas, con plural). */
export function dueTitle(cards: number, mistakes: number, lang?: StudyLang): string {
  const c = L(lang, plural(cards, 'tarjeta', 'tarjetas'), plural(cards, 'card', 'cards'))
  const m = L(lang, plural(mistakes, 'error', 'errores'), plural(mistakes, 'mistake', 'mistakes'))
  if (cards > 0 && mistakes > 0) return L(lang, `Repasa ${c} y ${m}`, `Review ${c} and ${m}`)
  if (cards > 0) return L(lang, `Repasa ${c}`, `Review ${c}`)
  if (mistakes > 0) return L(lang, `Repasa ${m}`, `Review ${m}`)
  return L(lang, 'Repaso del día', "Today's review")
}

/** La fecha del examen si aún no pasó (si ya pasó o no hay, +∞): un examen ya hecho no adelanta su curso. */
function upcoming(date: Date | null, now: Date): number {
  if (!date || date.getTime() < startOfDay(now, localTimeZone()).getTime()) return Number.POSITIVE_INFINITY
  return date.getTime()
}

function digest(input: HomeCourseInput, progress: StudyProgress, goal: number, now: Date, lang?: StudyLang): CourseDigest {
  const { pack } = input
  const skills = skillMap(input.skills)
  const generating = input.generating === true
  const r = LearnBridge.readiness(pack, progress, now, lang)
  const seen = hasAttempts(pack, progress)
  return {
    pack, progress, generating,
    dueCards: LearnBridge.dueCardCount(pack, skills, progress, now),
    // sin los errores sin habilidad ni los de ejercicios que ya no existen: no se pueden repasar
    dueMistakes: Recorder.dueMistakes(progress, now, skills).length,
    readiness: seen ? r.expectedScore : 0, low: seen ? r.low : 0, high: seen ? r.high : 0, coverage: r.coverage, started: seen,
    plan: generating ? [] : LearnBridge.dailyPlan(pack, skills, progress, goal, now, lang).filter((i) => i.kind !== 'rest').map((i) => toHomePlanItem(pack, i))
  }
}

/** Plan combinado: por curso, un bloque con lo vencido (tarjetas y errores juntos) y luego sus pasos, alternando cursos. */
export function combinedPlan(courses: readonly CourseDigest[], goal: number, limit: number, now: Date, lang?: StudyLang): HomePlanItem[] {
  const ordered = [...courses].filter((c) => !c.generating).sort((a, b) => {
    const da = upcoming(toDate(a.pack.exam?.date), now), db = upcoming(toDate(b.pack.exam?.date), now)
    return da !== db ? da - db : (b.dueCards + b.dueMistakes) - (a.dueCards + a.dueMistakes)
  })
  const isDue = (i: HomePlanItem): boolean => i.kind === 'cards' || i.kind === 'mistakes'
  const queues = ordered.map((c) => {
    const items: HomePlanItem[] = []
    const due = c.plan.filter(isDue)
    if (due.length) {
      items.push({
        id: `${c.pack.id}:due`, courseId: c.pack.id, courseTitle: c.pack.title, icon: c.pack.icon, hue: c.pack.hue, kind: c.dueCards > 0 ? 'cards' : 'mistakes',
        title: dueTitle(c.dueCards, c.dueMistakes, lang), detail: L(lang, 'Toca hoy según la repetición espaciada', 'Due today by spaced repetition'),
        minutes: due.reduce((s, i) => s + Math.max(0, i.minutes), 0)
      })
    }
    items.push(...c.plan.filter((i) => !isDue(i)))
    return items
  })
  const out: HomePlanItem[] = []
  let minutes = 0
  for (let round = 0; out.length < limit && round < 8; round++) {
    let added = false
    for (const q of queues) {
      if (round >= q.length || out.length >= limit) continue
      const item = q[round]
      if (minutes >= goal && out.length > 0 && !item.id.endsWith(':due')) continue
      out.push(item)
      minutes += item.minutes
      added = true
    }
    if (!added) break
  }
  return out
}

/** Actividades hechas hoy en un curso: una por habilidad practicada, por lección terminada y por sesión de tarjetas. */
function itemsDoneToday(p: StudyProgress, now: Date): number {
  const today = dayKey(now)
  const practiced = new Set<string>()
  for (const a of p.attempts) {
    const t = Date.parse(a.date)
    if (!Number.isNaN(t) && dayKey(new Date(t)) === today) practiced.add(`${a.mode === 'exam' ? 'exam' : a.mode === 'review' ? 'review' : 'study'}:${a.skill}`)
  }
  const lessons = Object.values(p.skills).filter((s) => s.lessonDoneAt && dayKey(new Date(s.lessonDoneAt)) === today).length
  const cards = Object.values(p.cards).some((c) => c.lastReview && dayKey(new Date(c.lastReview)) === today) ? 1 : 0
  return practiced.size + lessons + cards
}

export function buildHomeSummary(inputs: readonly HomeCourseInput[], progressByPack: Readonly<Record<ItemID, StudyProgress>>, events: readonly HomeEvent[],
  settings: HomeSettings, now: Date): HomeSummary {
  const lang = settings.lang
  const goal = Math.max(5, Math.trunc(settings.dailyMinutes ?? 60) || 60)
  const tz = localTimeZone()
  const courses = inputs.map((c) => digest(c, ownValue(progressByPack, c.pack.id) ?? emptyProgress(), goal, now, lang))
  const plan = combinedPlan(courses, goal, Math.max(1, settings.planLimit ?? 4), now, lang)
  const progresses = courses.map((c) => c.progress)
  const stats = StudyStatsCalc.summary(progresses, now, 7, tz)
  const done = courses.reduce((s, c) => s + itemsDoneToday(c.progress, now), 0)
  const today0 = startOfDay(now, tz).getTime()

  const homeCourses: HomeCourse[] = courses.map((c) => {
    const h: HomeCourse = {
      id: c.pack.id, title: c.pack.title, subject: c.pack.subject, icon: c.pack.icon, hue: c.pack.hue, readiness: c.readiness, coverage: c.coverage,
      examDate: c.pack.exam?.date ?? null, dueCards: c.dueCards, mistakes: c.dueMistakes, skillCount: c.pack.skills.length, started: c.started
    }
    if (c.generating) h.generating = true
    return h
  })

  // exámenes: los del curso y los del calendario enlazados a un curso que no tiene fecha propia
  const exams: HomeExam[] = []
  const examOf = (c: CourseDigest, title: string, date: string): HomeExam => ({
    courseId: c.pack.id, title, courseTitle: c.pack.title, icon: c.pack.icon, hue: c.pack.hue, date,
    readiness: c.readiness, readinessLow: c.low, readinessHigh: c.high, coverage: c.coverage, started: c.started
  })
  for (const c of courses) {
    const d = toDate(c.pack.exam?.date)
    if (d && d.getTime() >= today0) exams.push(examOf(c, c.pack.exam?.title || L(lang, 'Examen', 'Exam'), d.toISOString()))
  }
  for (const e of events) {
    if (e.kind !== 'exam' || !e.courseId || e.done) continue
    const c = courses.find((x) => x.pack.id === e.courseId)
    const d = toDate(e.start)
    if (!c || !d || d.getTime() < today0 || exams.some((x) => x.courseId === c.pack.id)) continue
    exams.push(examOf(c, e.title, d.toISOString()))
  }
  exams.sort((a, b) => Date.parse(a.date) - Date.parse(b.date))

  // próximamente: eventos del calendario (y las fechas de examen que no estén ya) en los próximos días
  const horizon = now.getTime() + Math.max(1, settings.upcomingDays ?? 14) * 86_400_000
  const upcomingEvents: HomeEvent[] = events.filter((e) => {
    const s = toDate(e.start)
    if (!s || e.done) return false
    const end = toDate(e.end ?? undefined)
    const from = e.allDay ? today0 : now.getTime()
    return (end ? end.getTime() : s.getTime()) >= from && s.getTime() <= horizon
  }).map((e) => ({ ...e }))
  for (const x of exams) {
    const t = Date.parse(x.date)
    if (t > horizon) continue
    const already = upcomingEvents.some((e) => e.kind === 'exam' && e.courseId === x.courseId)
    if (!already) upcomingEvents.push({ id: `exam:${x.courseId}`, title: `${x.title} · ${x.courseTitle}`, start: x.date, kind: 'exam', courseId: x.courseId })
  }
  upcomingEvents.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))

  return {
    name: settings.name,
    today: { minutesDone: Math.round(stats.minutesToday), minutesGoal: goal, itemsDone: done, itemsTotal: done + plan.length },
    streak: { days: stats.streak.current, best: Math.max(stats.streak.best, stats.streak.current), week: stats.week },
    plan,
    exams,
    courses: homeCourses,
    upcoming: upcomingEvents.slice(0, 8),
    dueCards: courses.reduce((s, c) => s + c.dueCards, 0),
    mistakes: courses.reduce((s, c) => s + c.dueMistakes, 0),
    aiReady: settings.aiReady
  }
}
