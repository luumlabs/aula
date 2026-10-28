// Tres semanas de estudio simulado: plan, práctica, dominio, preparación, simulacros y estadísticas juntos
// (de IntegrationTests.swift y PublicAPITests.swift).
import { describe, expect, it } from 'vitest'
import * as Learn from './index'
import { attempt as outcome, attemptFromRating, freshMastery, MasteryModel, type SkillMastery } from './mastery'
import { dailyPlan, planSkill, type PlanItem } from './studyPlanner'
import { PracticePicker, ExamPicker, type ExerciseRef } from './pickers'
import { ReadinessEstimator, type Readiness } from './readiness'
import { dayKey, StudyStats, type DayStat } from './studyStats'
import { FSRS, newReviewState, type Rating } from './fsrs'
import { UTC } from '@engine/calendar/time'
import { date, DAY, plus, t0, TestRNG } from './testSupport.testutil'

interface SkillDef { id: string; title: string; weight: number; minutes: number; prerequisites: string[]; truth: number }
const defs = (): SkillDef[] => [
  { id: 'circle', title: 'Círculo unitario', weight: 15, minutes: 25, prerequisites: [], truth: 0.45 },
  { id: 'graphs', title: 'Gráficas', weight: 20, minutes: 30, prerequisites: [], truth: 0.4 },
  { id: 'identities', title: 'Identidades', weight: 25, minutes: 40, prerequisites: ['circle'], truth: 0.3 },
  { id: 'equations', title: 'Ecuaciones', weight: 20, minutes: 30, prerequisites: ['identities'], truth: 0.3 },
  { id: 'inverse', title: 'Inversas', weight: 10, minutes: 20, prerequisites: ['graphs'], truth: 0.35 },
  { id: 'apps', title: 'Aplicaciones', weight: 10, minutes: 20, prerequisites: ['circle'], truth: 0.4 }
]
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

describe('LearnKit · integración', () => {
  it('tres semanas de estudio simulado', () => {
    const model = new MasteryModel()
    const start = date(2026, 10, 1, 9)
    const examDate = date(2026, 10, 22, 8)
    const truth: Record<string, number> = Object.fromEntries(defs().map((d) => [d.id, d.truth]))
    const mastery: Record<string, SkillMastery> = {}
    const pool: ExerciseRef[] = []
    for (const d of defs()) for (let level = 1; level <= 3; level++) for (let i = 0; i < 40; i++) pool.push({ id: `${d.id}-${level}-${i}`, skillID: d.id, level })
    const recent: string[] = []
    const rng = new TestRNG(2026)
    const readiness: Readiness[] = []
    let mocks = 0
    let sawMock = false
    const days: DayStat[] = []
    let lastPlanIDs: string[] = []
    let counter = 0

    for (let day = 0; day < 21; day++) {
      const now = plus(start, day * DAY)
      const skills = defs().map((d) => planSkill({ id: d.id, title: d.title, weight: d.weight, mastery: mastery[d.id] ?? freshMastery(), prerequisites: d.prerequisites, estimatedMinutes: d.minutes }))
      const plan: PlanItem[] = dailyPlan({ now, examDate, minutesAvailable: 60, skills, dueCards: 6 + (day % 5), dueMistakes: day % 4, hasDiagnostic: day > 0, mockExamsDone: mocks }, { model, timeZone: UTC })
      lastPlanIDs = plan.map((x) => x.id)
      expect(plan.reduce((s, x) => s + x.minutes, 0)).toBeLessThanOrEqual(60)
      expect(new Set(plan.map((x) => x.id)).size).toBe(plan.length)
      for (const item of plan.filter((x) => x.kind === 'learn' || x.kind === 'practice')) {
        const def = defs().find((d) => d.id === item.skillID) as SkillDef
        for (const pre of def.prerequisites) {
          const m = mastery[pre] ?? freshMastery()
          expect(model.probability(m, now) >= 0.6 && m.attempts >= 2, `día ${day}: «${def.id}» con «${pre}» sin cumplir`).toBe(true)
        }
        expect(item.kind === 'learn').toBe((mastery[def.id]?.attempts ?? 0) === 0)
      }
      let attempts = 0, credit = 0, minutesStudied = 0
      for (const item of plan) {
        minutesStudied += item.minutes
        if (!['learn', 'practice', 'diagnostic', 'mock'].includes(item.kind)) continue
        if (item.kind === 'mock') { mocks += 1; sawMock = true }
        for (let k = 0; k < Math.max(1, Math.trunc(item.minutes / 2)); k++) {
          counter += 1
          const ex = PracticePicker.next({ pool, masteryBySkill: mastery, recent, focusSkill: item.skillID, now, seed: counter, model })
          expect(ex).not.toBeNull()
          if (!ex) return
          const t = truth[ex.skillID]
          const p = sigmoid(Math.log(Math.max(t, 0.01) / Math.max(1 - t, 0.01)) + (2 - ex.level))
          const ok = rng.unit() < p
          const mode = item.kind === 'mock' ? 'exam' : item.kind === 'diagnostic' ? 'diagnostic' : item.kind === 'learn' ? 'lesson' : 'practice'
          mastery[ex.skillID] = model.updated(mastery[ex.skillID] ?? freshMastery(), outcome(ok ? 1 : 0, { difficulty: ex.level, mode }), now)
          truth[ex.skillID] = Math.min(0.97, t + 0.012)
          recent.push(ex.id)
          if (recent.length > 12) recent.shift()
          attempts += 1
          credit += ok ? 1 : 0
        }
      }
      days.push({ day: dayKey(now, UTC), minutes: minutesStudied, attempts, correct: credit })
      readiness.push(ReadinessEstimator.estimate(defs().map((d) => ({ weight: { skillID: d.id, weight: d.weight }, mastery: mastery[d.id] ?? freshMastery() })), model, now))
    }

    const last = readiness[readiness.length - 1]
    expect(readiness[0].expectedScore).toBeLessThan(0.5)
    expect(last.expectedScore).toBeGreaterThan(readiness[0].expectedScore + 0.2)
    expect(last.coverage).toBeGreaterThan(0.95)
    expect(last.expectedScore).toBeGreaterThanOrEqual(0.55)
    for (const r of readiness) expect(r.low <= r.expectedScore && r.expectedScore <= r.high).toBe(true)
    expect(last.high - last.low).toBeLessThan(readiness[2].high - readiness[2].low)
    expect(sawMock).toBe(true)
    expect(mocks).toBeLessThanOrEqual(3)
    expect(lastPlanIDs.every((id) => ['review', 'mistakes', 'formulas', 'rest'].includes(id))).toBe(true)
    expect(lastPlanIDs).toContain('rest')
    const s = StudyStats.streak(days, plus(start, 20 * DAY), UTC)
    expect(s).toEqual({ current: 21, best: 21 })
    const trend = StudyStats.accuracyTrend(days, 5)
    expect(trend.length).toBe(days.filter((d) => d.attempts > 0).length)
    expect(trend[trend.length - 1]).toBeGreaterThan(trend[0] - 0.05)
    expect(days.reduce((acc, d) => acc + d.minutes, 0)).toBeGreaterThan(600)
  })

  it('tarjetas, dominio y plan durante un mes', () => {
    const f = new FSRS({ maximumIntervalDays: 90 })
    const model = new MasteryModel()
    let card = newReviewState(t0)
    let mastery = freshMastery()
    let now = t0
    const rng = new TestRNG(5)
    let reviews = 0
    while (now.getTime() < plus(t0, 120 * DAY).getTime()) {
      const r = f.retrievability(card, now)
      const rating: Rating = card.phase === 'new' ? 3 : rng.unit() < r ? (rng.unit() < 0.2 ? 4 : 3) : 1
      mastery = model.updated(mastery, attemptFromRating(rating), now)
      card = f.next(card, rating, now)
      now = card.due
      reviews += 1
      expect(card.due.getTime()).toBeGreaterThanOrEqual((card.lastReview as Date).getTime())
    }
    expect(reviews).toBeGreaterThan(5)
    expect(reviews).toBeLessThan(60)
    expect(mastery.attempts).toBeGreaterThan(5)
    expect(model.probability(mastery, plus(now, -DAY))).toBeGreaterThan(0.5)
  })

  it('la API pública existe tal como la usarán la interfaz y el planificador', () => {
    const now = new Date(1_800_000_000_000)
    expect(typeof Learn.FSRS).toBe('function')
    expect(typeof Learn.dailyPlan).toBe('function')
    expect(typeof Learn.ExamPicker.pick).toBe('function')
    const fsrs = new Learn.FSRS()
    const s1 = fsrs.next(Learn.newReviewState(now), 3, now)
    expect(Math.abs(fsrs.retrievability(s1, now) - 1)).toBeLessThan(1e-9)
    expect(Object.keys(fsrs.preview(s1, now)).length).toBe(4)
    expect(Learn.FSRS.intervalDescription(now, plus(now, 600))).toBe('10 min')
    const custom = { ...Learn.defaultFSRSParameters(), learningSteps: [30, 300], relearningSteps: [120] }
    expect((new Learn.FSRS(custom).next(Learn.newReviewState(now), 1, now).due.getTime() - now.getTime()) / 1000).toBe(30)
    const model = new Learn.MasteryModel(21)
    const m = model.updated(Learn.freshMastery(), Learn.attempt(1, { seconds: 30, expectedSeconds: 60 }), now)
    expect(model.probability(m, now)).toBeGreaterThan(0.5); expect(model.level(m, now)).toBe('practicing')
    const readiness = Learn.ReadinessEstimator.estimate([{ weight: { skillID: 'a', weight: 10 }, mastery: m }, { weight: { skillID: 'b', weight: 5 }, mastery: Learn.freshMastery() }], model, now)
    expect(readiness.coverage).toBeGreaterThan(0); expect(readiness.low).toBeLessThanOrEqual(readiness.high)
    const plan = Learn.dailyPlan({ now, examDate: plus(now, 10 * DAY), minutesAvailable: 45, skills: [Learn.planSkill({ id: 's', title: 'Tema', weight: 50 })], dueCards: 5, dueMistakes: 2, hasDiagnostic: true })
    expect(plan.reduce((s, x) => s + x.minutes, 0)).toBeLessThanOrEqual(45)
    expect(plan[0].kind).toBe('review')
    const pool = [1, 2, 3].flatMap((l) => [0, 1, 2].map((i) => ({ id: `a${l}${i}`, skillID: 'a', level: l })))
    expect(ExamPicker.pick([{ title: 'Parte A', skillIDs: ['a'], count: 2, minLevel: 1, maxLevel: 3 }], pool, 7)[0].length).toBe(2)
    expect(PracticePicker.next({ pool, masteryBySkill: { a: Learn.freshMastery() }, now, seed: 3 })).not.toBeNull()
    expect(StudyStats.formatMinutes(80)).toBe('1 h 20 min')
    expect(Learn.learnKitSeed('tarjeta-1')).not.toBe(Learn.learnKitSeed('tarjeta-2'))
  })
})
