// Plan diario (de StudyPlannerTests.swift, GuidedStudyPlannerTests.swift y GuidedForgettingPlanTests.swift).
import { describe, expect, it } from 'vitest'
import { attempt as outcome, freshMastery, MasteryModel, skillMastery, type SkillMastery } from './mastery'
import { dailyPlan, planSkill, type PlanInputs, type PlanItem, type PlannerOptions, type PlanSkill } from './studyPlanner'
import { addDays, settingTime, startOfDay } from '@engine/calendar/time'
import { INT_MAX, INT_MIN } from './support'
import { date, DAY, plus, TestRNG, Zones } from './testSupport.testutil'

const model = new MasteryModel()
const tz = Zones.newYork
/** Miércoles 7-oct-2026, 09:00 en Nueva York. */
const now = date(2026, 10, 7, 9, 0, 0, tz)

function skill(id: string, o: { w: number; correct?: number; wrong?: number; daysAgo?: number; est?: number; prereq?: string[]; title?: string }): PlanSkill {
  let m = freshMastery()
  const when = plus(now, -(o.daysAgo ?? 0) * DAY)
  for (let i = 0; i < (o.wrong ?? 0); i++) m = model.updated(m, outcome(0), when)
  for (let i = 0; i < (o.correct ?? 0); i++) m = model.updated(m, outcome(1), when)
  return planSkill({ id, title: o.title ?? `Tema ${id}`, weight: o.w, mastery: m, prerequisites: o.prereq ?? [], estimatedMinutes: o.est ?? 20 })
}

function inputs(minutes: number, skills: PlanSkill[], o: { exam?: Date | null; cards?: number; mistakes?: number; diag?: boolean; mocks?: number } = {}): PlanInputs {
  return { now, examDate: o.exam ?? null, minutesAvailable: minutes, skills, dueCards: o.cards ?? 0, dueMistakes: o.mistakes ?? 0, hasDiagnostic: o.diag ?? false, mockExamsDone: o.mocks ?? 0 }
}

const plan = (i: PlanInputs, o: PlannerOptions = {}): PlanItem[] => dailyPlan(i, { model, timeZone: tz, ...o })
const total = (items: PlanItem[]) => items.reduce((s, x) => s + x.minutes, 0)
const ids = (items: PlanItem[]) => items.map((x) => x.skillID).filter((x): x is string => x !== null)

function exam(inDays: number, hour = 8): Date {
  return settingTime(addDays(startOfDay(now, tz), inDays, tz), hour, 0, 0, tz)
}

/** Temario de ejemplo (suma 100 puntos). */
function trig(): PlanSkill[] {
  return [
    skill('graphs', { w: 20, correct: 3, wrong: 3, est: 30, title: 'Gráficas de seno y coseno' }),
    skill('unitcircle', { w: 15, correct: 8, wrong: 1, est: 25, title: 'Círculo unitario' }),
    skill('identities', { w: 25, correct: 0, est: 40, title: 'Identidades' }),
    skill('equations', { w: 20, correct: 1, wrong: 4, est: 30, title: 'Ecuaciones trigonométricas' }),
    skill('inverse', { w: 10, correct: 0, est: 20, title: 'Funciones inversas' }),
    skill('applications', { w: 10, correct: 5, wrong: 2, est: 20, title: 'Aplicaciones' })
  ]
}

describe('Plan · entradas límite', () => {
  it('sin tiempo no hay plan', () => {
    expect(plan(inputs(0, trig(), { cards: 10 }))).toEqual([])
    expect(plan(inputs(-20, trig(), { cards: 10 }))).toEqual([])
  })

  it('nada que hacer: descanso con la causa real', () => {
    const r = plan(inputs(45, []))
    expect(r.length).toBe(1)
    expect(r[0].kind).toBe('rest'); expect(r[0].minutes).toBe(0)
    expect(r[0].reason).toContain('Aún no hay temario')
    expect(r[0].reason).not.toContain('sólidos')
    const r2 = plan(inputs(60, [skill('a', { w: 50, correct: 14 }), skill('b', { w: 50, correct: 14 })]))
    expect(r2.map((x) => x.kind)).toEqual(['rest'])
    expect(r2[0].reason).toContain('Estás al día')
  })

  it('el descanso culpa al tiempo solo si es la causa', () => {
    const short = plan(inputs(3, trig()))
    expect(short.map((x) => x.kind)).toEqual(['rest']); expect(short[0].reason).toContain('3 min')
    const tiny = plan(inputs(2, trig(), { exam: exam(2) }))
    expect(tiny.map((x) => x.kind)).toEqual(['rest']); expect(tiny[0].reason).toContain('2 min')
    const r = plan(inputs(60, [skill('z', { w: 0 })], { diag: true }))
    expect(r.map((x) => x.kind)).toEqual(['rest']); expect(r[0].reason).toContain('Estás al día')
  })

  it('un presupuesto mínimo no da para un bloque', () => {
    const r = plan(inputs(4, trig()))
    expect(r.map((x) => x.kind)).toEqual(['rest']); expect(r[0].reason).toContain('4 min')
    const r6 = plan(inputs(6, trig()))
    expect(r6.length).toBe(1); expect(total(r6)).toBeLessThanOrEqual(6); expect(r6[0].minutes).toBeGreaterThanOrEqual(5)
  })

  it('cantidades enormes no desbordan', () => {
    const r = plan(inputs(30, trig(), { cards: INT_MAX, mistakes: INT_MAX }))
    expect(total(r)).toBeLessThanOrEqual(30); expect(r[0].kind).toBe('review')
    const r2 = plan(inputs(INT_MAX, trig(), { cards: INT_MAX, mistakes: INT_MAX }))
    expect(total(r2)).toBeGreaterThan(0); expect(r2[0].kind).toBe('review')
    const r3 = plan(inputs(45, trig(), { cards: -5, mistakes: -9 }))
    expect(r3.some((x) => x.kind === 'review' || x.kind === 'mistakes')).toBe(false)
  })
})

describe('Plan · 20 / 45 / 90 minutos', () => {
  it('20 minutos', () => {
    const r = plan(inputs(20, trig(), { exam: exam(20), cards: 12, mistakes: 3, diag: true }))
    expect(total(r)).toBeLessThanOrEqual(20)
    expect(r[0].kind).toBe('review'); expect(r[0].minutes).toBe(5)
    expect(r[1].kind).toBe('mistakes'); expect(r[1].minutes).toBe(5)
    expect(r.slice(2).every((x) => x.kind === 'learn' || x.kind === 'practice')).toBe(true)
    expect(total(r)).toBeGreaterThanOrEqual(15)
  })

  it('45 minutos', () => {
    const r = plan(inputs(45, trig(), { exam: exam(20), cards: 20, mistakes: 6, diag: true }))
    expect(total(r)).toBeLessThanOrEqual(45)
    expect(r[0].kind).toBe('review'); expect(r[0].minutes).toBe(8)
    expect(r[1].kind).toBe('mistakes'); expect(r[1].minutes).toBe(9)
    expect(r.filter((x) => x.kind === 'learn' || x.kind === 'practice').length).toBeGreaterThanOrEqual(2)
    expect(total(r)).toBeGreaterThanOrEqual(40)
  })

  it('90 minutos lejos del examen', () => {
    const r = plan(inputs(90, trig(), { exam: exam(30), cards: 30, mistakes: 8, diag: true }))
    expect(total(r)).toBeLessThanOrEqual(90)
    expect(r.slice(0, 2).map((x) => x.kind)).toEqual(['review', 'mistakes'])
    const study = r.filter((x) => x.kind === 'learn' || x.kind === 'practice')
    expect(study.length).toBeGreaterThanOrEqual(3); expect(study.length).toBeLessThanOrEqual(6)
    expect(r.some((x) => x.kind === 'mock')).toBe(false)
    expect(new Set(r.map((x) => x.id)).size).toBe(r.length)
    for (const item of study) expect(item.minutes).toBeLessThanOrEqual(25)
  })

  it('nunca se pasa del presupuesto (entradas aleatorias)', () => {
    const rng = new TestRNG(0xc0ffee)
    for (let n = 0; n < 1500; n++) {
      const skills: PlanSkill[] = []
      for (let j = 0, c = rng.int(10); j < c; j++) {
        const prereq = Array.from({ length: rng.int(3) }, () => `k${rng.int(12)}`)
        skills.push(skill(`k${j}`, { w: rng.unit() < 0.1 ? 0 : rng.double(0.5, 40), correct: rng.int(14), wrong: rng.int(6), daysAgo: rng.double(0, 80), est: rng.int(60) - 5, prereq }))
      }
      const examDays = rng.unit() < 0.3 ? null : rng.int(45) - 3
      const i = inputs(rng.int(200) - 10, skills, { exam: examDays === null ? null : exam(examDays), cards: rng.int(150), mistakes: rng.int(40), diag: rng.unit() < 0.5, mocks: rng.int(4) })
      const r = plan(i)
      expect(total(r)).toBeLessThanOrEqual(Math.max(0, i.minutesAvailable))
      expect(new Set(r.map((x) => x.id)).size).toBe(r.length)
      for (const item of r) {
        expect(item.reason.length).toBeGreaterThan(0); expect(item.title.length).toBeGreaterThan(0)
        expect(item.minutes).toBeGreaterThanOrEqual(0)
        if (item.kind !== 'rest') expect(item.minutes).toBeGreaterThan(0)
      }
      if (i.minutesAvailable > 0) expect(r.length).toBeGreaterThan(0)
    }
  })

  it('determinista e independiente del orden', () => {
    const skills = trig()
    const a = plan(inputs(90, skills, { exam: exam(12), cards: 9, mistakes: 2, diag: true }))
    expect(plan(inputs(90, skills, { exam: exam(12), cards: 9, mistakes: 2, diag: true }))).toEqual(a)
    expect(plan(inputs(90, [...skills].reverse(), { exam: exam(12), cards: 9, mistakes: 2, diag: true }))).toEqual(a)
  })
})

describe('Plan · orden de las reglas', () => {
  it('repaso, errores y estudio', () => {
    const r = plan(inputs(60, trig(), { cards: 10, mistakes: 4, diag: true }))
    expect(r[0].kind).toBe('review'); expect(r[1].kind).toBe('mistakes')
    expect(r.slice(2).every((x) => ['learn', 'practice'].includes(x.kind))).toBe(true)
  })

  it('repasos y errores con tope', () => {
    const r = plan(inputs(20, trig(), { cards: 500, mistakes: 100, diag: true }))
    expect(r[0].minutes).toBe(8); expect(r[1].minutes).toBe(6)
    expect(r[0].reason).toContain('500 tarjetas vencidas'); expect(r[0].reason).toContain('unas 20')
    expect(r[1].reason).toContain('100 errores'); expect(r[1].reason).toContain('unos 4')
    expect(total(r)).toBeLessThanOrEqual(20); expect(total(r)).toBeGreaterThan(14)
  })

  it('singular y plural', () => {
    const one = plan(inputs(30, [], { cards: 1, mistakes: 1 }))
    expect(one[0].reason.startsWith('Tienes 1 tarjeta vencida:')).toBe(true)
    expect(one[1].reason.startsWith('Tienes 1 error por repasar: corregirlo hoy evita repetirlo otra vez.')).toBe(true)
    const many = plan(inputs(30, [], { exam: exam(9), cards: 5, mistakes: 3 }))
    expect(many[0].reason.startsWith('Tienes 5 tarjetas vencidas:')).toBe(true)
    expect(many[1].reason).toContain('3 errores por repasar: corregirlos hoy evita repetirlos en el examen.')
    const r = plan(inputs(30, [], { cards: 1, mistakes: 1 }))
    expect(r[0].minutes).toBe(1); expect(r[1].minutes).toBe(2)
  })
})

describe('Plan · puntos por minuto y prerrequisitos', () => {
  it('ordenado por puntos por minuto', () => {
    const r = plan(inputs(60, [skill('a', { w: 30, est: 30 }), skill('b', { w: 30, correct: 1, wrong: 1, est: 15 }), skill('c', { w: 40, correct: 14, est: 10 })], { diag: true }))
    expect(ids(r)).not.toContain('c')
    expect(new Set(ids(r))).toEqual(new Set(['a', 'b']))
    expect(ids(plan(inputs(120, [skill('slow', { w: 20, est: 60 }), skill('cheap', { w: 5, est: 5 }), skill('rich', { w: 40, correct: 1, wrong: 2, est: 20 })], { diag: true })))).toEqual(['rich', 'cheap', 'slow'])
    expect(ids(plan(inputs(120, [skill('ok', { w: 20, correct: 4, wrong: 1 }), skill('weak', { w: 20, wrong: 4 })], { diag: true })))).toEqual(['weak', 'ok'])
  })

  it('se respetan los prerrequisitos y el bonus los adelanta', () => {
    const r = plan(inputs(90, [skill('derivs', { w: 40, est: 30, prereq: ['limits'], title: 'Derivadas' }), skill('limits', { w: 10, wrong: 3, title: 'Límites' }), skill('misc', { w: 5, est: 15 })], { diag: true }))
    expect(ids(r)).not.toContain('derivs'); expect(ids(r)).toContain('limits'); expect(ids(r)[0]).toBe('limits')
    const prereq = skill('algebra', { w: 1, wrong: 2, title: 'Álgebra' })
    const big = skill('big', { w: 50, est: 40, prereq: ['algebra'], title: 'Tema grande' })
    const competitor = skill('rival', { w: 10, title: 'Rival' })
    const r2 = plan(inputs(25, [prereq, big, competitor], { diag: true }))
    expect(ids(r2)[0]).toBe('algebra')
    expect(r2.find((x) => x.skillID === 'algebra')?.reason).toContain('Es la base de «Tema grande»')
    expect(ids(plan(inputs(25, [prereq, competitor], { diag: true })))[0]).toBe('rival')
  })

  it('un prerrequisito cumplido desbloquea (con al menos 2 intentos)', () => {
    expect(ids(plan(inputs(60, [skill('limits', { w: 10, correct: 5 }), skill('derivs', { w: 40, est: 30, prereq: ['limits'] })], { diag: true })))).toContain('derivs')
    expect(ids(plan(inputs(90, [skill('limits', { w: 10, correct: 1 }), skill('derivs', { w: 40, est: 30, prereq: ['limits'] })], { diag: true })))).not.toContain('derivs')
  })

  it('cadenas, ciclos e ids desconocidos', () => {
    expect(ids(plan(inputs(90, [skill('c', { w: 40, est: 15, prereq: ['b'] }), skill('b', { w: 10, est: 15, prereq: ['a'] }), skill('a', { w: 5, est: 15 })], { diag: true })))).toEqual(['a'])
    const r = plan(inputs(90, [skill('a', { w: 30, prereq: ['b'] }), skill('b', { w: 30, prereq: ['a'] }), skill('s', { w: 30, prereq: ['s'] })], { diag: true }))
    expect(new Set(ids(r))).toEqual(new Set(['a', 'b', 's']))
    const r3 = plan(inputs(90, [skill('x', { w: 10, est: 10, prereq: ['z'] }), skill('y', { w: 10, est: 10, prereq: ['x'] }), skill('z', { w: 10, est: 10, prereq: ['y'] })], { diag: true }))
    expect(new Set(ids(r3))).toEqual(new Set(['x', 'y', 'z']))
    expect(ids(plan(inputs(60, [skill('a', { w: 30, prereq: ['ghost', 'ghost'] })], { diag: true })))).toEqual(['a'])
  })

  it('un prerrequisito sin peso se programa porque desbloquea', () => {
    const r = plan(inputs(60, [skill('algebra', { w: 0, wrong: 2, est: 15, title: 'Álgebra básica' }), skill('main', { w: 60, est: 30, prereq: ['algebra'], title: 'Tema principal' })], { diag: true }))
    const item = r.find((x) => x.skillID === 'algebra')
    expect(item?.reason).toContain('No cae directamente en el examen')
    expect(item?.reason).toContain('«Tema principal»')
    expect(plan(inputs(60, [skill('lonely', { w: 0, est: 15 })], { diag: true })).filter((x) => x.skillID !== null)).toEqual([])
  })

  it('lo dominado queda para las tarjetas; desempates estables; ids repetidos', () => {
    expect(ids(plan(inputs(60, [skill('done', { w: 50, correct: 14 }), skill('todo', { w: 10 })], { diag: true })))).toEqual(['todo'])
    const s = Array.from({ length: 6 }, (_, i) => skill(`t${i}`, { w: 10 }))
    const forward = ids(plan(inputs(200, s, { diag: true })))
    expect(forward).toEqual(['t0', 't1', 't2', 't3', 't4', 't5'])
    expect(ids(plan(inputs(200, [...s].reverse(), { diag: true })))).toEqual(forward)
    expect(ids(plan(inputs(200, [s[3], s[0], s[5], s[1], s[4], s[2]], { diag: true })))).toEqual(forward)
    expect(ids(plan(inputs(200, [skill('light', { w: 10, est: 10 }), skill('heavy', { w: 40, est: 40 })], { diag: true })))).toEqual(['heavy', 'light'])
    const r = plan(inputs(60, [skill('a', { w: 20, title: 'Primero' }), skill('a', { w: 99, est: 5, title: 'Segundo' })], { diag: true }))
    expect(r.length).toBe(1); expect(r[0].title).toBe('Aprende: Primero')
  })
})

describe('Plan · diagnóstico y simulacro', () => {
  it('sin datos: diagnóstico primero', () => {
    const r = plan(inputs(45, [skill('a', { w: 50 }), skill('b', { w: 50 })]))
    expect(r[0].kind).toBe('diagnostic'); expect(r[0].minutes).toBe(10); expect(r[0].reason).toContain('Aún no tengo datos')
    expect(r.slice(1).every((x) => x.kind === 'learn')).toBe(true)
    expect(total(r)).toBeLessThanOrEqual(45)
  })

  it('la duración del diagnóstico escala con el temario', () => {
    const diag = (n: number, budget = 90) => plan(inputs(budget, Array.from({ length: n }, (_, i) => skill(`k${i}`, { w: 10 })))).find((x) => x.kind === 'diagnostic')?.minutes
    expect(diag(2)).toBe(10); expect(diag(10)).toBe(15); expect(diag(30)).toBe(20); expect(diag(30, 12)).toBe(12)
  })

  it('sin diagnóstico si ya se hizo, si hay datos, sin temario o sin tiempo', () => {
    expect(plan(inputs(45, [skill('a', { w: 50 })], { diag: true })).some((x) => x.kind === 'diagnostic')).toBe(false)
    expect(plan(inputs(45, [skill('a', { w: 50, correct: 1 }), skill('b', { w: 50 })])).some((x) => x.kind === 'diagnostic')).toBe(false)
    expect(plan(inputs(45, [])).some((x) => x.kind === 'diagnostic')).toBe(false)
    expect(plan(inputs(4, [skill('a', { w: 50 })])).some((x) => x.kind === 'diagnostic')).toBe(false)
    expect(plan(inputs(60, [skill('a', { w: 50 })], { cards: 10, mistakes: 2 })).slice(0, 3).map((x) => x.kind)).toEqual(['review', 'mistakes', 'diagnostic'])
  })

  it('simulacro en la última semana con cobertura', () => {
    const skills = [skill('a', { w: 40, correct: 6, wrong: 2 }), skill('b', { w: 40, correct: 4, wrong: 2 }), skill('c', { w: 20 })]
    const r = plan(inputs(90, skills, { exam: exam(6), diag: true }))
    const mock = r.find((x) => x.kind === 'mock')
    expect(mock?.minutes).toBe(60)
    expect(mock?.reason).toContain('Faltan 6 días'); expect(mock?.reason).toContain('80 %')
    expect(total(r)).toBeLessThanOrEqual(90)
  })

  it('reglas del simulacro', () => {
    const seen = [skill('a', { w: 50, correct: 6, wrong: 2 }), skill('b', { w: 50, correct: 4, wrong: 2 })]
    const hasMock = (days: number | null, skills: PlanSkill[], mocks = 0, minutes = 90) =>
      plan(inputs(minutes, skills, { exam: days === null ? null : exam(days), diag: true, mocks })).some((x) => x.kind === 'mock')
    expect(hasMock(8, seen)).toBe(false); expect(hasMock(7, seen)).toBe(true); expect(hasMock(5, seen)).toBe(true); expect(hasMock(3, seen)).toBe(true)
    expect(hasMock(null, seen)).toBe(false)
    expect(hasMock(6, seen, 1)).toBe(false); expect(hasMock(4, seen, 1)).toBe(true); expect(hasMock(4, seen, 2)).toBe(false)
    expect(hasMock(5, [skill('a', { w: 50, correct: 6 }), skill('b', { w: 50 })])).toBe(false)
    expect(hasMock(5, seen, 0, 20)).toBe(false); expect(hasMock(5, seen, 0, 25)).toBe(true)
    const r = plan(inputs(45, seen, { exam: exam(5), cards: 10, mistakes: 3, diag: true }))
    expect(r.slice(0, 3).map((x) => x.kind)).toEqual(['review', 'mistakes', 'mock'])
    expect(r.find((x) => x.kind === 'mock')?.minutes).toBe(45 - 4 - 5)
    expect(total(r)).toBe(45)
    const past = plan({ ...inputs(60, seen, { diag: true }), examDate: plus(now, -3600) })
    expect(past.some((x) => x.kind === 'mock')).toBe(false); expect(past.some((x) => x.kind === 'practice')).toBe(true)
  })
})

describe('Plan · repaso final', () => {
  it('en los dos últimos días', () => {
    for (const days of [2, 1, 0]) {
      const r = plan(inputs(90, trig(), { exam: exam(days, 18), cards: 25, mistakes: 6, diag: true }))
      const kinds = r.map((x) => x.kind)
      expect(kinds.slice(0, 3)).toEqual(['review', 'mistakes', 'review'])
      expect(r[2].id).toBe('formulas')
      expect(kinds.some((k) => ['learn', 'practice', 'mock', 'diagnostic'].includes(k))).toBe(false)
      expect(total(r)).toBeLessThanOrEqual(90)
      expect(kinds.includes('rest')).toBe(days <= 1)
      if (days === 1) expect(r[r.length - 1].reason).toContain('Duerme bien')
    }
  })

  it('reparto del tiempo y hoja de fórmulas', () => {
    const r = plan(inputs(40, trig(), { exam: exam(1), cards: 400, mistakes: 100, diag: true }))
    expect(r[0].minutes).toBe(20); expect(r[1].minutes).toBe(14); expect(r[2].id).toBe('formulas'); expect(r[2].minutes).toBe(6); expect(total(r)).toBe(40)
    expect(plan(inputs(200, trig(), { exam: exam(2), diag: true })).find((x) => x.id === 'formulas')?.minutes).toBe(15)
    expect(plan(inputs(8, trig(), { exam: exam(2), diag: true })).find((x) => x.id === 'formulas')?.minutes).toBe(5)
    const formulas = (minutes: number) => plan(inputs(minutes, trig(), { exam: exam(1, 18) })).find((x) => x.id === 'formulas')
    expect(formulas(2)).toBeUndefined()
    expect(formulas(3)?.minutes).toBe(3); expect(formulas(4)?.minutes).toBe(4); expect(formulas(10)?.minutes).toBe(5); expect(formulas(20)?.minutes).toBe(5)
    expect(formulas(40)?.minutes).toBe(10); expect(formulas(48)?.minutes).toBe(12); expect(formulas(100)?.minutes).toBe(15)
  })

  it('examen mañana sin datos: triage', () => {
    const r = plan(inputs(60, [skill('a', { w: 60, est: 30, title: 'Tema A' }), skill('b', { w: 40, est: 30, title: 'Tema B' })], { exam: exam(1) }))
    expect(r.some((x) => x.kind === 'diagnostic' || x.kind === 'mock')).toBe(false)
    expect(r[0].kind).toBe('learn'); expect(r[0].skillID).toBe('a')
    expect(r[0].reason.startsWith('Falta 1 día y casi no tienes datos: vale 60 puntos')).toBe(true)
  })

  it('días de calendario a través del cambio de hora', () => {
    const n = date(2026, 3, 7, 22, 0, 0, tz)
    const skills = [planSkill({ id: 'a', title: 'A', weight: 100, mastery: model.updated(freshMastery(), outcome(1), n), estimatedMinutes: 20 })]
    const r = dailyPlan({ now: n, examDate: date(2026, 3, 9, 8, 0, 0, tz), minutesAvailable: 60, skills, dueCards: 5, hasDiagnostic: true }, { model, timeZone: tz })
    expect(r.map((x) => x.id)).toEqual(['review', 'formulas'])
    const r3 = dailyPlan({ now: n, examDate: date(2026, 3, 10, 8, 0, 0, tz), minutesAvailable: 60, skills, dueCards: 5, hasDiagnostic: true }, { model, timeZone: tz })
    expect(r3.some((x) => x.id === 'formulas')).toBe(false)
    expect(r3.some((x) => x.kind === 'mock')).toBe(true)
  })

  it('examen hoy más tarde', () => {
    const r = plan(inputs(30, [skill('a', { w: 100, correct: 6, wrong: 1 })], { exam: plus(now, 3 * 3600), cards: 5, diag: true }))
    expect(r.some((x) => x.id === 'formulas')).toBe(true)
    expect(r[r.length - 1].reason).toContain('examen')
  })

  it('razones exactas del repaso final y del triage', () => {
    const p = (d: number) => plan(inputs(60, trig(), { exam: exam(d, 18) }))
    expect(p(0).find((x) => x.id === 'formulas')?.reason).toBe('Hoy es el examen: un último vistazo a tu hoja de fórmulas, sin aprender nada nuevo.')
    expect(p(1).find((x) => x.id === 'formulas')?.reason).toBe('El examen es mañana: repasa tu hoja de fórmulas, es lo que más rinde por minuto la víspera.')
    expect(p(2).find((x) => x.id === 'formulas')?.reason).toBe('Faltan 2 días: tu hoja de fórmulas y tus errores son lo que más puntos rescata ahora.')
    expect(p(0)[p(0).length - 1].reason).toBe('Hoy es el examen: llega con tiempo y descansado, y confía en lo que has practicado.')
    expect(p(1)[p(1).length - 1].reason).toBe('Duerme bien esta noche: el sueño consolida lo que repasaste y rinde más que otra hora de estudio.')
    expect(p(2)[p(2).length - 1].kind).not.toBe('rest')
    const fresh = [skill('a', { w: 100, est: 30, title: 'Todo' })]
    const first = (d: number) => plan(inputs(60, fresh, { exam: exam(d, 18) })).find((x) => x.skillID === 'a')?.reason
    expect(first(0)).toBe('Hoy es el examen y casi no tienes datos: vale 100 puntos y aún no la has visto.')
    expect(first(1)).toBe('Falta 1 día y casi no tienes datos: vale 100 puntos y aún no la has visto.')
    expect(first(2)).toBe('Faltan 2 días y casi no tienes datos: vale 100 puntos y aún no la has visto.')
  })
})

describe('Plan · razones', () => {
  it('el ejemplo del contrato', () => {
    const m = skillMastery({ alpha: 2.45, beta: 4.55, attempts: 5 })
    const r = plan(inputs(60, [planSkill({ id: 'x', title: 'Tema X', weight: 12, mastery: m, estimatedMinutes: 10 }), planSkill({ id: 'rest', title: 'Resto', weight: 88 })], { diag: true }))
    const item = r.find((x) => x.skillID === 'x') as PlanItem
    expect(item.reason).toBe('Vale 12 puntos y vas en 35 %.')
    expect(item.kind).toBe('practice'); expect(item.title).toBe('Practica: Tema X')
    const en = dailyPlan(inputs(60, [planSkill({ id: 'x', title: 'Tema X', weight: 12, mastery: m, estimatedMinutes: 10 }), planSkill({ id: 'rest', title: 'Resto', weight: 88 })], { diag: true }), { model, timeZone: tz, lang: 'en' })
    expect(en.find((x) => x.skillID === 'x')?.reason).toBe("Worth 12 points and you're at 35%.")
    expect(en.find((x) => x.skillID === 'x')?.title).toBe('Practice: Tema X')
  })

  it('no vista; porcentajes; un punto; decimales con coma o punto', () => {
    const r = plan(inputs(60, [skill('a', { w: 100, title: 'Todo' })], { diag: true }))
    expect(r[0].reason).toBe('Vale 100 puntos y aún no la has visto.'); expect(r[0].kind).toBe('learn'); expect(r[0].title).toBe('Aprende: Todo'); expect(r[0].id).toBe('learn:a')
    const pct = plan(inputs(90, [skill('a', { w: 1, est: 10 }), skill('b', { w: 2, est: 10 }), skill('c', { w: 3, est: 10 })], { diag: true }))
    expect(pct.find((x) => x.skillID === 'c')?.reason).toBe('Pesa el 50 % del examen y aún no la has visto.')
    expect(pct.find((x) => x.skillID === 'a')?.reason).toBe('Pesa el 17 % del examen y aún no la has visto.')
    const one = [planSkill({ id: 'a', title: 'A', weight: 1, estimatedMinutes: 10 }), planSkill({ id: 'b', title: 'B', weight: 99, estimatedMinutes: 10 })]
    expect(plan(inputs(90, one, { diag: true })).find((x) => x.skillID === 'a')?.reason).toBe('Vale 1 punto y aún no la has visto.')
    const dec = [planSkill({ id: 'a', title: 'A', weight: 7.5, estimatedMinutes: 10 }), planSkill({ id: 'b', title: 'B', weight: 92.5, estimatedMinutes: 10 })]
    expect(plan(inputs(90, dec, { diag: true }), { decimalSeparator: ',' }).find((x) => x.skillID === 'a')?.reason).toBe('Vale 7,5 puntos y aún no la has visto.')
    expect(plan(inputs(90, dec, { diag: true }), { decimalSeparator: '.' }).find((x) => x.skillID === 'a')?.reason).toBe('Vale 7.5 puntos y aún no la has visto.')
  })

  it('avisa del olvido', () => {
    const r = plan(inputs(60, [skill('old', { w: 50, correct: 10, daysAgo: 40, title: 'Antiguo' }), skill('new', { w: 50 })], { diag: true }))
    const item = r.find((x) => x.skillID === 'old') as PlanItem
    expect(item.kind).toBe('practice')
    expect(item.reason).toContain('Llevas 40 días sin practicarla y se te está olvidando')
    expect(plan(inputs(60, [skill('recent', { w: 50, correct: 2, wrong: 1, daysAgo: 1 })], { diag: true }))[0].reason).not.toContain('olvidando')
    const fast = new MasteryModel(7)
    const reason = (daysAgo: number, correct: number, wrong = 0) =>
      dailyPlan(inputs(60, [skill('x', { w: 50, correct, wrong, daysAgo })], { diag: true }), { model: fast, timeZone: tz }).find((x) => x.skillID === 'x')?.reason ?? ''
    expect(reason(10, 10)).not.toContain('olvidando'); expect(reason(13, 10)).not.toContain('olvidando')
    expect(reason(14, 10)).toContain('Llevas 14 días sin practicarla y se te está olvidando')
    expect(reason(30, 10)).toContain('Llevas 30 días')
    expect(reason(30, 0, 6)).not.toContain('olvidando')
    const slow = dailyPlan(inputs(60, [skill('y', { w: 50, correct: 3, wrong: 3, daysAgo: 15 })], { diag: true }), { model: new MasteryModel(365), timeZone: tz })
    expect(slow.find((x) => x.skillID === 'y')?.reason).not.toContain('olvidando')
  })

  it('todas las razones son frases con cifras', () => {
    const r = plan(inputs(120, trig(), { exam: exam(5), cards: 30, mistakes: 9, diag: true }))
    for (const item of r) {
      expect(item.reason.endsWith('.')).toBe(true)
      expect(item.reason[0]).toBe(item.reason[0].toUpperCase())
      expect(/\d/.test(item.reason) || item.kind === 'rest').toBe(true)
    }
  })

  it('wording en puntos solo si los pesos suman 100; a su ritmo, el curso', () => {
    const reason = (weights: number[]) =>
      plan(inputs(200, weights.map((w, i) => planSkill({ id: `s${i}`, title: 'S', weight: w, estimatedMinutes: 10 })), { diag: true })).find((x) => x.skillID === 's0')?.reason
    expect(reason([20, 40, 40])).toBe('Vale 20 puntos y aún no la has visto.')
    expect(reason([20, 40.4, 40])).toBe('Vale 20 puntos y aún no la has visto.')
    expect(reason([20, 39.6, 40])).toBe('Vale 20 puntos y aún no la has visto.')
    expect(reason([20, 41, 40])).toBe('Pesa el 20 % del examen y aún no la has visto.')
    expect(reason([20, 20, 40])).toBe('Pesa el 25 % del examen y aún no la has visto.')
    expect(reason([30, 30, 60])).toBe('Pesa el 25 % del examen y aún no la has visto.')
    expect(reason([50])).toBe('Pesa el 100 % del examen y aún no la has visto.')
    const course = (weights: number[], seen = false) => {
      const m: SkillMastery = seen ? skillMastery({ alpha: 7, beta: 13, attempts: 20 }) : freshMastery()
      const skills = weights.map((w, i) => planSkill({ id: `s${i}`, title: 'S', weight: w, mastery: i === 0 ? m : freshMastery(), estimatedMinutes: 10 }))
      return plan({ ...inputs(200, skills, { diag: true }), selfPaced: true }).find((x) => x.skillID === 's0')?.reason ?? ''
    }
    expect(course([16, 84])).toBe('Es el 16 % del curso y aún no la has visto.')
    expect(course([20, 40, 40])).toBe('Es el 20 % del curso y aún no la has visto.')
    expect(course([1, 2, 3])).toBe('Es el 17 % del curso y aún no la has visto.')
    expect(course([30, 70], true)).not.toContain('examen')
    expect(course([30, 70], true).startsWith('Es el 30 % del curso y vas en')).toBe(true)
  })

  it('el dominio manda, no solo el peso; prioridad por minutos', () => {
    const known = planSkill({ id: 'known', title: 'Sabida', weight: 20, mastery: skillMastery({ alpha: 8, beta: 2, attempts: 10 }), estimatedMinutes: 20 })
    expect(ids(plan(inputs(120, [known, skill('unknown', { w: 10 })], { diag: true })))).toEqual(['unknown', 'known'])
    expect(ids(plan(inputs(200, [skill('slow', { w: 30, est: 60 }), skill('quick', { w: 20, est: 10 })], { diag: true })))).toEqual(['quick', 'slow'])
  })
})

describe('Plan · tiempos por bloque', () => {
  it('escalados por dominio y acotados', () => {
    const mid = skill('m', { w: 50, correct: 2, wrong: 2, title: 'Media' })
    const r = plan(inputs(120, [skill('u', { w: 50, est: 40, title: 'Nueva' }), mid], { diag: true }))
    expect(r.find((x) => x.skillID === 'u')?.minutes).toBe(25)
    const p = model.probability(mid.mastery, now)
    expect(r.find((x) => x.skillID === 'm')?.minutes).toBe(Math.round(20 * Math.max(0.35, 1 - p)))
    expect(plan(inputs(120, [skill('al', { w: 50, correct: 6, wrong: 1, est: 10 })], { diag: true }))[0].minutes).toBeGreaterThanOrEqual(5)
    expect(plan(inputs(120, [skill('t', { w: 50, est: 3 })], { diag: true }))[0].minutes).toBe(3)
  })

  it('truncados, como mucho seis, y estimaciones por defecto', () => {
    expect(plan(inputs(32, [skill('a', { w: 50, est: 30 }), skill('b', { w: 50, est: 30 })], { diag: true })).map((x) => x.minutes)).toEqual([16, 16])
    expect(plan(inputs(32, [skill('a', { w: 50, est: 30 })], { diag: true })).map((x) => x.minutes)).toEqual([25])
    expect(plan(inputs(300, Array.from({ length: 20 }, (_, i) => skill(`k${i}`, { w: 5, est: 5 })), { diag: true })).length).toBe(6)
    const r = plan(inputs(120, [planSkill({ id: 'a', title: 'A', weight: 50, estimatedMinutes: 0 }), planSkill({ id: 'b', title: 'B', weight: 50, estimatedMinutes: -30 })], { diag: true }))
    expect(r.map((x) => x.minutes)).toEqual([15, 15])
    expect(plan(inputs(12, [skill('a', { w: 50, est: 30 }), skill('b', { w: 50, est: 30 })], { diag: true })).map((x) => x.minutes)).toEqual([10])
  })

  it('valores hostiles no rompen el plan', () => {
    const bad = [
      planSkill({ id: 'nan', title: '', weight: NaN, mastery: skillMastery({ alpha: NaN, beta: NaN, attempts: 3 }), estimatedMinutes: INT_MAX }),
      planSkill({ id: 'inf', title: 'Inf', weight: Infinity, mastery: skillMastery({ alpha: 1e300, beta: -4, attempts: INT_MAX }), estimatedMinutes: INT_MIN }),
      planSkill({ id: 'neg', title: 'Neg', weight: -5, estimatedMinutes: 10 }),
      planSkill({ id: 'ok', title: '', weight: 10, estimatedMinutes: 10 })
    ]
    const r = plan(inputs(60, bad, { diag: true }))
    expect(total(r)).toBeLessThanOrEqual(60)
    expect(r.find((x) => x.skillID === 'ok')?.title).toBe('Aprende: ok')
    const huge = [planSkill({ id: 'a', title: 'A', weight: Number.MAX_VALUE, estimatedMinutes: 10 }), planSkill({ id: 'b', title: 'B', weight: Number.MAX_VALUE, estimatedMinutes: 10 })]
    const h = plan(inputs(60, huge, { diag: true }))
    expect(ids(h)).toEqual(['a', 'b'])
    for (const item of h) expect(/nan|inf/i.test(item.reason)).toBe(false)
  })

  it('JSON y progreso entre días', () => {
    const r = plan(inputs(60, trig(), { cards: 7, mistakes: 2, diag: true }))
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
    const a0 = skill('a', { w: 50, correct: 1, wrong: 3 }), b = skill('b', { w: 50, correct: 1, wrong: 3, title: 'B' })
    expect(ids(plan(inputs(40, [a0, b], { diag: true })))).toEqual(['a', 'b'])
    let m = a0.mastery
    for (let i = 0; i < 8; i++) m = model.updated(m, outcome(1), now)
    expect(ids(plan(inputs(40, [{ ...a0, mastery: m }, b], { diag: true })))[0]).toBe('b')
  })
})

describe('Plan · umbrales, bonus e identificadores', () => {
  it('umbral de prerrequisito', () => {
    const scheduled = (p: number) =>
      ids(plan(inputs(90, [planSkill({ id: 'base', title: 'Base', weight: 10, mastery: skillMastery({ alpha: p * 10, beta: (1 - p) * 10, attempts: 6 }) }), skill('dep', { w: 50, est: 30, prereq: ['base'] })], { diag: true }))).includes('dep')
    expect(scheduled(0.5)).toBe(false); expect(scheduled(0.55)).toBe(false); expect(scheduled(0.59)).toBe(false); expect(scheduled(0.61)).toBe(true); expect(scheduled(0.75)).toBe(true)
  })

  it('umbral de mantenimiento', () => {
    const scheduled = (p: number) =>
      plan(inputs(60, [planSkill({ id: 'x', title: 'X', weight: 40, mastery: skillMastery({ alpha: p * 20, beta: (1 - p) * 20, attempts: 20 }) })], { diag: true })).some((x) => x.skillID === 'x')
    expect(scheduled(0.5)).toBe(true); expect(scheduled(0.85)).toBe(true); expect(scheduled(0.88)).toBe(true)
    expect(scheduled(0.92)).toBe(false); expect(scheduled(0.95)).toBe(false); expect(scheduled(0.99)).toBe(false)
  })

  it('los dos dependientes más valiosos; bonus repartido; dependientes sin peso no se nombran', () => {
    const base = skill('base', { w: 1, wrong: 2, title: 'Base' })
    const d1 = skill('d1', { w: 30, prereq: ['base'], title: 'Alfa' }), d2 = skill('d2', { w: 20, prereq: ['base'], title: 'Beta' }), d3 = skill('d3', { w: 10, prereq: ['base'], title: 'Gamma' })
    const filler = skill('other', { w: 39, correct: 14, title: 'Otra' })
    for (const order of [[base, d1, d2, d3, filler], [d3, d2, d1, filler, base], [filler, d2, base, d3, d1]]) {
      const reason = plan(inputs(120, order, { diag: true })).find((x) => x.skillID === 'base')?.reason ?? ''
      expect(reason.endsWith('Es la base de «Alfa» (30 puntos) y «Beta» (20 puntos).'), reason).toBe(true)
    }
    const one = plan(inputs(120, [base, d1, skill('other', { w: 69, correct: 14, title: 'Otra' })], { diag: true })).find((x) => x.skillID === 'base')?.reason ?? ''
    expect(one.endsWith('Es la base de «Alfa» (30 puntos).')).toBe(true)
    const p1 = skill('p1', { w: 1, wrong: 2 }), p2 = skill('p2', { w: 1, wrong: 2 })
    expect(ids(plan(inputs(200, [p1, p2, skill('d', { w: 40, est: 30, prereq: ['p1', 'p2'] }), skill('rival', { w: 15 })], { diag: true })))).toEqual(['rival', 'p1', 'p2'])
    const reason = plan(inputs(60, [skill('base', { w: 10, wrong: 2 }), skill('ghost', { w: 0, prereq: ['base'], title: 'Fantasma' })], { diag: true })).find((x) => x.skillID === 'base')?.reason ?? ''
    expect(reason).not.toContain('Es la base'); expect(reason).not.toContain('Fantasma')
  })

  it('identificadores, títulos y tipos estables', () => {
    const seen = [skill('a', { w: 50, correct: 6, wrong: 2, title: 'Alfa' }), skill('b', { w: 50, correct: 4, wrong: 2, title: 'Beta' })]
    const mock = plan(inputs(120, seen, { exam: exam(5), cards: 10, mistakes: 3, diag: true }))
    expect(mock.slice(0, 3).map((x) => x.id)).toEqual(['review', 'mistakes', 'mock'])
    expect(mock.slice(0, 3).map((x) => x.title)).toEqual(['Repaso de tarjetas', 'Repaso de errores', 'Simulacro de examen'])
    expect(mock.slice(0, 3).map((x) => x.skillID)).toEqual([null, null, null])
    expect(mock.slice(3).every((x) => x.id.startsWith('practice:') && x.title.startsWith('Practica: ') && x.kind === 'practice')).toBe(true)
    const diag = plan(inputs(45, [skill('n', { w: 100, title: 'Nueva' })]))
    expect(diag.map((x) => x.id)).toEqual(['diagnostic', 'learn:n'])
    expect(diag.map((x) => x.title)).toEqual(['Diagnóstico inicial', 'Aprende: Nueva'])
    const finalDay = plan(inputs(45, seen, { exam: exam(1, 18), cards: 6, mistakes: 1 }))
    expect(finalDay.map((x) => x.id)).toEqual(['review', 'mistakes', 'formulas', 'rest'])
    expect(finalDay.map((x) => x.title)).toEqual(['Repaso de tarjetas', 'Repaso de errores', 'Hoja de fórmulas', 'Descanso'])
    expect(finalDay.map((x) => x.kind)).toEqual(['review', 'mistakes', 'review', 'rest'])
    expect(finalDay[3].minutes).toBe(0)
  })

  it('temarios enormes con cadenas profundas, rápido', () => {
    const skills: PlanSkill[] = []
    for (let i = 0; i < 600; i++) skills.push(planSkill({ id: `c${i}`, title: `Cadena ${i}`, weight: 1 + (i % 7), prerequisites: i === 0 ? [] : [`c${i - 1}`], estimatedMinutes: 10 + (i % 20) }))
    const rng = new TestRNG(1234)
    for (let i = 0; i < 600; i++) {
      skills.push(planSkill({ id: `r${i}`, title: `Cruzada ${i}`, weight: rng.double(0, 5), prerequisites: Array.from({ length: 3 }, () => (rng.unit() < 0.5 ? `r${rng.int(600)}` : `c${rng.int(600)}`)), estimatedMinutes: 15 }))
    }
    const start = Date.now()
    const r = plan(inputs(120, skills, { exam: exam(20), cards: 40, mistakes: 10, diag: true }))
    expect(Date.now() - start).toBeLessThan(8000)
    expect(total(r)).toBeLessThanOrEqual(120); expect(r.length).toBeGreaterThan(2)
    expect(ids(r)).not.toContain('c1')
  })
})

describe('Plan · lecciones guiadas', () => {
  const t = new Date(1_800_000_000_000)
  const gplan = (skills: PlanSkill[]) => dailyPlan({ now: t, minutesAvailable: 60, skills, hasDiagnostic: true }, { timeZone: 'UTC' })

  it('una lección guiada sin terminar bloquea a sus dependientes', () => {
    const high = skillMastery({ alpha: 100, beta: 1, attempts: 99, lastPracticed: t })
    const items = gplan([planSkill({ id: 'base', title: 'Base', weight: 30, mastery: high, needsTeaching: true, progressReady: false }),
      planSkill({ id: 'next', title: 'Next', weight: 70, prerequisites: ['base'], needsTeaching: true, progressReady: false })])
    expect(ids(items)).toEqual(['base']); expect(items[0].kind).toBe('learn')
  })

  it('dos comprobaciones guiadas desbloquean sin exigir 0,9', () => {
    const items = gplan([planSkill({ id: 'base', title: 'Base', weight: 30, mastery: skillMastery({ alpha: 3, beta: 1, attempts: 2, lastPracticed: t }), needsTeaching: false, progressReady: true }),
      planSkill({ id: 'next', title: 'Next', weight: 70, prerequisites: ['base'], needsTeaching: true, progressReady: false })])
    expect(items[0].skillID).toBe('next'); expect(items[0].kind).toBe('learn')
    expect(items.some((x) => x.skillID === 'base' && x.kind === 'learn')).toBe(false)
  })

  it('el diagnóstico no sustituye a enseñar', () => {
    const s = planSkill({ id: 's', title: 'S', weight: 100, mastery: skillMastery({ alpha: 2, beta: 2, attempts: 2, lastPracticed: t }), needsTeaching: true, progressReady: false })
    expect(gplan([s])[0].kind).toBe('learn')
    expect(gplan([{ ...s, needsTeaching: false }])[0].kind).toBe('practice')
  })

  it('no desaparece con dominio redondeado al 100 % o peso 0', () => {
    const perfect = skillMastery({ alpha: 1e100, beta: 1, attempts: 50, lastPracticed: t })
    for (const weight of [0, 100]) {
      const items = gplan([planSkill({ id: 's', title: 'S', weight, mastery: perfect, needsTeaching: true, progressReady: false })])
      expect(items[0].kind).toBe('learn'); expect(items[0].skillID).toBe('s')
    }
  })

  it('una guiada terminada pero olvidada se vuelve a practicar; si está fuerte, no', () => {
    const weak = skillMastery({ alpha: 2, beta: 8, attempts: 10, lastPracticed: plus(t, -60 * DAY) })
    const a = gplan([planSkill({ id: 's', title: 'S', weight: 100, mastery: weak, needsTeaching: false })])
    const b = gplan([planSkill({ id: 's', title: 'S', weight: 100, mastery: weak, needsTeaching: false, progressReady: true })])
    expect(ids(b).length).toBeGreaterThan(0); expect(ids(b)).toEqual(ids(a))
    const strong = skillMastery({ alpha: 40, beta: 1, attempts: 40, lastPracticed: plus(t, -3600) })
    expect(gplan([planSkill({ id: 's', title: 'S', weight: 100, mastery: strong, needsTeaching: false, progressReady: true })]).some((x) => x.skillID === 's' && x.kind === 'practice')).toBe(false)
    expect(gplan([planSkill({ id: 's', title: 'S', weight: 100, mastery: strong, needsTeaching: true, progressReady: false })]).some((x) => x.skillID === 's')).toBe(true)
  })
})

