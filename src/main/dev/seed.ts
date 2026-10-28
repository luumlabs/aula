// Solo desarrollo y capturas (AULA_SEED=demo, nunca en la app empaquetada): simula seis semanas de estudio con el motor
// real (intentos, tiempo, tarjetas) en los cursos que aún no tienen progreso, para ver Inicio y Estadísticas con datos.
import { getLibrary } from '@main/services/store'
import { recordAttempt, recordStudyTime, reviewCard, dueCards } from '@engine/study'
import { Rating } from '@engine/learn'
import { log } from '@main/services/log'
import { checkAchievements } from '@main/services/achievements'
import { calendarService } from '@main/services/calendar'
import { paths } from '@main/services/paths'
import { readJSON } from '@main/services/fs'
import { weeklyRule } from '@engine/calendar/rrule'
import type { Exercise, Skill, StudyProgress } from '@shared/schema'

/** Generador con semilla (mulberry32): las capturas salen siempre iguales. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DAYS = 42

export function seedDemoProgress(now = new Date()): void {
  const lib = getLibrary()
  for (const summary of lib.listPacks()) {
    const store = lib.openPack(summary.id)
    if (!store) continue
    let progress: StudyProgress = store.loadProgress()
    if ((progress.attempts?.length ?? 0) > 0) continue
    const pack = store.loadPack()
    const skills: Skill[] = store.loadSkills()
    if (!skills.length) continue
    const r = rng(summary.id.length * 7919)
    for (let d = DAYS; d >= 1; d--) {
      const day = new Date(now)
      day.setDate(day.getDate() - d)
      day.setHours(17, 30, 0, 0)
      // descansos: más los fines de semana; al principio, menos constancia
      const weekend = day.getDay() === 0 || day.getDay() === 6
      if (r() < (weekend ? 0.45 : 0.18) + (d > 30 ? 0.2 : 0)) continue
      const progressFraction = (DAYS - d) / DAYS
      // los temas se abren poco a poco
      const open = Math.max(1, Math.ceil(skills.length * Math.min(1, 0.25 + progressFraction)))
      const todays = [skills[Math.floor(r() * open)], skills[Math.floor(r() * open)]]
      let seconds = 0
      for (const skill of todays) {
        const pool: Exercise[] = skill.exercises ?? []
        const n = 3 + Math.floor(r() * 6)
        for (let i = 0; i < n && pool.length; i++) {
          const ex = pool[Math.floor(r() * pool.length)]
          const p = Math.min(0.92, 0.45 + progressFraction * 0.5)
          const roll = r()
          const credit = roll < p ? 1 : roll < p + 0.08 ? 0.5 : 0
          const secs = 40 + Math.floor(r() * 110)
          seconds += secs
          const at = new Date(day.getTime() + seconds * 1000)
          progress = recordAttempt(progress, ex, { credit, seconds: secs, mode: 'practice' }, at)
        }
      }
      // tarjetas que tocan ese día
      const due = dueCards(pack, skills, progress, { now: day, newLimit: 6, limit: 14 })
      for (const c of due) {
        const roll = r()
        const rating = roll < 0.12 ? Rating.again : roll < 0.25 ? Rating.hard : roll < 0.9 ? Rating.good : Rating.easy
        progress = reviewCard(progress, c.card.id, rating, new Date(day.getTime() + (seconds += 20) * 1000), { skillId: c.skillId, skills })
      }
      progress = recordStudyTime(progress, seconds + Math.floor(r() * 600), day)
    }
    store.saveProgress(progress)
    // un examen dentro de unos días, para ver la cuenta atrás y la preparación
    if (!pack.exam?.date) {
      const exam = new Date(now)
      exam.setDate(exam.getDate() + 12 + (summary.id.length % 3) * 4)
      exam.setHours(9, 0, 0, 0)
      store.updatePack((p) => { p.exam = { ...(p.exam ?? { title: p.title }), date: exam.toISOString() } })
    }
    log.info(`[seed] progreso de ejemplo en ${summary.id}: ${progress.attempts.length} intentos`)
  }
  // los logros del estudio simulado quedan apuntados sin celebrarlos (las capturas no salen con avisos)
  try { checkAchievements() } catch { /* sin logros: da igual */ }
}

/** Un calendario de ejemplo (solo desarrollo y capturas): clases dos veces por semana, entregas y un grupo de estudio. */
export function seedDemoCalendar(now = new Date(), courseId = 'exam-2-math112'): void {
  const file = readJSON<{ events?: unknown[] }>(paths.calendar())
  if (file?.events?.length) return
  const cal = calendarService()
  const at = (days: number, h: number, m = 0): Date => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    d.setHours(h, m, 0, 0)
    return d
  }
  // la clase: martes y jueves a las 10:00 desde hace cinco semanas hasta el examen (1 = domingo)
  const firstTuesday = at(-35, 10)
  while (firstTuesday.getDay() !== 2) firstTuesday.setDate(firstTuesday.getDate() + 1)
  const classEnd = new Date(firstTuesday.getTime() + 80 * 60_000)
  try {
    cal.add({ title: 'Trigonometry lecture', kind: 'lecture', start: firstTuesday, end: classEnd, location: 'Room 214', packID: courseId,
      recurrence: weeklyRule([3, 5], { until: at(30, 23, 59) }) })
    cal.add({ title: 'Problem set 4', kind: 'assignment', isTask: true, start: at(2, 23, 59), allDay: false, packID: courseId })
    cal.add({ title: 'Study group', kind: 'event', start: at(4, 17), end: at(4, 18, 30), location: 'Library, 2nd floor' })
    cal.add({ title: 'Problem set 5', kind: 'assignment', isTask: true, start: at(9, 23, 59), packID: courseId })
    cal.add({ title: 'Office hours', kind: 'event', start: at(-3, 12), end: at(-3, 13) })
    cal.add({ title: 'Review quiz', kind: 'exam', start: at(-8, 9), end: at(-8, 9, 30), packID: courseId })
  } catch (err) {
    log.warn('[seed] calendario de ejemplo', err)
  }
}
