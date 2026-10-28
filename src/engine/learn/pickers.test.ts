// Selectores de práctica y de simulacros (de PracticePickerTests.swift y ExamPickerTests.swift).
import { describe, expect, it } from 'vitest'
import { attempt as outcome, freshMastery, MasteryModel, skillMastery, type SkillMastery } from './mastery'
import { ExamPicker, PracticePicker, type BlueprintSection, type ExerciseRef } from './pickers'
import { INT_MAX, INT_MIN } from './support'
import { DAY, plus, t0, TestRNG } from './testSupport.testutil'

const model = new MasteryModel()
const now = t0

function bank(skills = ['A', 'B', 'C'], perLevel = 6, levels = [1, 2, 3]): ExerciseRef[] {
  const out: ExerciseRef[] = []
  for (const s of skills) for (const l of levels) for (let i = 0; i < perLevel; i++) out.push({ id: `${s}${l}-${i}`, skillID: s, level: l })
  return out
}
const mastery = (p: number, strength = 12): SkillMastery => skillMastery({ alpha: p * strength, beta: (1 - p) * strength, attempts: 10 })
function next(pool: ExerciseRef[], m: Record<string, SkillMastery> = {}, o: { recent?: string[]; focus?: string | null; seed?: number } = {}) {
  return PracticePicker.next({ pool, masteryBySkill: m, recent: o.recent ?? [], focusSkill: o.focus ?? null, now, seed: o.seed ?? 1, model })
}

describe('PracticePicker', () => {
  it('banco vacío o foco desconocido', () => {
    expect(next([])).toBeNull()
    expect(next(bank(), {}, { focus: 'Z' })).toBeNull()
    expect(next(bank(), {}, { focus: 'A' })).not.toBeNull()
  })

  it('el foco restringe; siempre del banco; determinista y variado', () => {
    for (let seed = 0; seed < 100; seed++) expect(next(bank(), {}, { focus: 'B', seed })?.skillID).toBe('B')
    const pool = bank()
    const idSet = new Set(pool.map((e) => e.id))
    for (let seed = 0; seed < 200; seed++) expect(idSet.has(next(pool, {}, { seed })!.id)).toBe(true)
    expect(next(pool, {}, { seed: 7 })).toEqual(next(pool, {}, { seed: 7 }))
    expect(next([...pool].reverse(), {}, { seed: 7 })).toEqual(next(pool, {}, { seed: 7 }))
    const seen = new Set<string>()
    for (let seed = 0; seed < 200; seed++) seen.add(next(pool, {}, { seed })!.id)
    expect(seen.size).toBeGreaterThan(15)
    expect(next([...bank(['A']), ...bank(['A'])])).not.toBeNull()
  })

  it('no repite los recientes mientras haya otros', () => {
    const pool = bank(['A'], 5, [1])
    for (let seed = 0; seed < 100; seed++) expect(next(pool, {}, { recent: ['A1-0', 'A1-1', 'A1-2', 'A1-3'], seed })?.id).toBe('A1-4')
  })

  it('si todo es reciente, la mitad más antigua', () => {
    const pool = bank(['A'], 4, [1])
    const seen = new Set<string>()
    for (let seed = 0; seed < 200; seed++) seen.add(next(pool, {}, { recent: ['A1-0', 'A1-1', 'A1-2', 'A1-3'], seed })!.id)
    expect([...seen].sort()).toEqual(['A1-0', 'A1-1'])
    expect(next(bank(['A'], 1, [1]), {}, { recent: ['A1-0', 'A1-0', 'A1-0'] })?.id).toBe('A1-0')
  })

  it('recientes desconocidos se ignoran; con foco solo cuentan los del foco', () => {
    expect(next(bank(), {}, { recent: ['fantasma', 'otro', ''] })).not.toBeNull()
    expect(next(bank(), {}, { recent: new Array(10_000).fill('x') })).not.toBeNull()
    const r = next(bank(['A', 'B'], 2, [1]), {}, { recent: ['A1-0', 'B1-0', 'B1-1'], focus: 'B' })
    expect(r?.skillID).toBe('B'); expect(r?.id).toBe('B1-0')
  })

  it('modelo de éxito previsto', () => {
    expect(Math.abs(PracticePicker.predictedSuccess(0.5, 2) - 0.5)).toBeLessThan(1e-12)
    expect(Math.abs(PracticePicker.predictedSuccess(0.75, 2) - 0.75)).toBeLessThan(1e-12)
    expect(PracticePicker.predictedSuccess(0.6, 1)).toBeGreaterThan(PracticePicker.predictedSuccess(0.6, 2))
    expect(PracticePicker.predictedSuccess(0.6, 2)).toBeGreaterThan(PracticePicker.predictedSuccess(0.6, 3))
    expect(PracticePicker.predictedSuccess(0.8, 2)).toBeGreaterThan(PracticePicker.predictedSuccess(0.4, 2))
    for (const m of [-3, 0, 1, 7, NaN]) {
      const v = PracticePicker.predictedSuccess(m, 2)
      expect((v > 0 && v < 1) || Number.isNaN(m)).toBe(true)
    }
    expect(Number.isFinite(PracticePicker.predictedSuccess(0.5, INT_MIN))).toBe(true)
    expect(Number.isFinite(PracticePicker.predictedSuccess(0.5, INT_MAX))).toBe(true)
  })

  it('la dificultad sigue al dominio', () => {
    const pool = bank(['A'])
    const level = (p: number) => next(pool, { A: mastery(p) }, { focus: 'A', seed: 5 })?.level
    expect(level(0.15)).toBe(1); expect(level(0.4)).toBe(1); expect(level(0.6)).toBe(1)
    expect(level(0.72)).toBe(2); expect(level(0.78)).toBe(2); expect(level(0.9)).toBe(3); expect(level(0.97)).toBe(3)
    let last = 0
    for (let p = 0.05; p <= 0.98 + 1e-9; p += 0.01) { const l = level(p) as number; expect(l).toBeGreaterThanOrEqual(last); last = l }
    expect(next(bank(['A']), {}, { focus: 'A' })?.level).toBe(1)
    expect(next(bank(['A']), { A: freshMastery() }, { focus: 'A' })?.level).toBe(1)
  })

  it('niveles que faltan: el más cercano en tasa de acierto; niveles raros', () => {
    expect(next(bank(['A'], 6, [1, 3]), { A: mastery(0.75) }, { focus: 'A' })?.level).toBe(1)
    expect(next(bank(['A'], 6, [3]), { A: mastery(0.1) }, { focus: 'A' })?.level).toBe(3)
    expect(next([{ id: 'z', skillID: 'A', level: 0 }, { id: 'y', skillID: 'A', level: 7 }], {}, { focus: 'A' })).not.toBeNull()
  })

  it('la evidencia vieja baja el nivel', () => {
    let m = freshMastery()
    for (let i = 0; i < 14; i++) m = model.updated(m, outcome(1), now)
    const pool = bank(['A'])
    expect(next(pool, { A: m }, { focus: 'A' })?.level).toBe(3)
    const later = PracticePicker.next({ pool, masteryBySkill: { A: m }, recent: [], focusSkill: 'A', now: plus(now, 60 * DAY), seed: 1, model })
    expect(later!.level).toBeLessThan(3)
  })

  it('intercala: evita la habilidad recién practicada', () => {
    const pool = bank(['A', 'B', 'C'], 20)
    const m = { A: mastery(0.5), B: mastery(0.5), C: mastery(0.5) }
    let sameAsLast = 0, sameWithout = 0
    const n = 600
    for (let seed = 0; seed < n; seed++) {
      if (next(pool, m, { recent: ['A1-3'], seed })!.skillID === 'A') sameAsLast += 1
      if (next(pool, m, { seed })!.skillID === 'A') sameWithout += 1
    }
    expect(sameAsLast / n).toBeLessThan(0.12)
    expect(sameWithout / n).toBeGreaterThan(0.25); expect(sameWithout / n).toBeLessThan(0.42)
  })

  it('las flojas y las no vistas salen más', () => {
    const pool = bank(['weak', 'strong'], 20)
    let weak = 0
    const n = 1000
    for (let seed = 0; seed < n; seed++) if (next(pool, { weak: mastery(0.2), strong: mastery(0.9) }, { seed })!.skillID === 'weak') weak += 1
    expect(weak / n).toBeGreaterThan(0.7); expect(weak / n).toBeLessThan(0.88); expect(n - weak).toBeGreaterThan(80)
    let unseen = 0
    for (let seed = 0; seed < 500; seed++) if (next(bank(['seen', 'unseen'], 20), { seen: mastery(0.7) }, { seed })!.skillID === 'unseen') unseen += 1
    expect(unseen / 500).toBeGreaterThan(0.55)
    expect(next(bank(['A'], 5), {}, { recent: ['A1-0'], seed: 3 })?.skillID).toBe('A')
  })

  it('dominios hostiles no rompen la elección', () => {
    const m = { A: skillMastery({ alpha: NaN, beta: -3, attempts: 5 }), B: skillMastery({ alpha: Infinity, beta: Infinity, attempts: INT_MAX }) }
    for (let seed = 0; seed < 100; seed++) expect(next(bank(['A', 'B']), m, { seed })).not.toBeNull()
  })

  it('el bucle adaptativo mantiene el acierto cerca del 70–80 %', () => {
    for (const truth of [0.45, 0.6, 0.8, 0.92]) {
      const pool = bank(['A'], 400)
      const rng = new TestRNG(Math.trunc(truth * 1000) + 11)
      let m = freshMastery()
      let clock = now
      const recent: string[] = []
      const outcomes: boolean[] = []
      for (let step = 0; step < 400; step++) {
        const ex = PracticePicker.next({ pool, masteryBySkill: { A: m }, recent, focusSkill: 'A', now: clock, seed: step, model })!
        const ok = rng.unit() < PracticePicker.predictedSuccess(truth, ex.level)
        outcomes.push(ok)
        m = model.updated(m, outcome(ok ? 1 : 0, { difficulty: ex.level }), clock)
        recent.push(ex.id)
        if (recent.length > 20) recent.shift()
        clock = plus(clock, DAY / 4)
      }
      const tail = outcomes.slice(-250)
      const rate = tail.filter(Boolean).length / tail.length
      expect(rate, `θ=${truth}`).toBeGreaterThan(0.62); expect(rate, `θ=${truth}`).toBeLessThan(0.88)
    }
  })

  it('sube el nivel cuando el estudiante mejora', () => {
    const pool = bank(['A'], 400)
    const rng = new TestRNG(21)
    let m = freshMastery()
    let clock = now
    const levels: number[] = []
    for (let step = 0; step < 300; step++) {
      const truth = step < 150 ? 0.4 : 0.93
      const ex = PracticePicker.next({ pool, masteryBySkill: { A: m }, recent: [], focusSkill: 'A', now: clock, seed: step, model })!
      const ok = rng.unit() < PracticePicker.predictedSuccess(truth, ex.level)
      m = model.updated(m, outcome(ok ? 1 : 0, { difficulty: ex.level }), clock)
      levels.push(ex.level)
      clock = plus(clock, DAY / 4)
    }
    const early = levels.slice(100, 150).reduce((a, b) => a + b, 0), late = levels.slice(250, 300).reduce((a, b) => a + b, 0)
    expect(late).toBeGreaterThan(early + 20)
  })

  it('empate entre niveles → el más fácil', () => {
    let lo = 0.5, hi = 0.9
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2
      const g1 = Math.abs(PracticePicker.predictedSuccess(mid, 1) - 0.75), g2 = Math.abs(PracticePicker.predictedSuccess(mid, 2) - 0.75)
      if (g1 < g2) lo = mid
      else hi = mid
    }
    const p = (lo + hi) / 2
    expect(Math.abs(Math.abs(PracticePicker.predictedSuccess(p, 1) - 0.75) - Math.abs(PracticePicker.predictedSuccess(p, 2) - 0.75))).toBeLessThan(1e-12)
    expect(next(bank(['A']), { A: mastery(p) }, { focus: 'A' })?.level).toBe(1)
    expect(next(bank(['A']), { A: mastery(p + 0.01) }, { focus: 'A' })?.level).toBe(2)
  })

  it('también amortigua la penúltima', () => {
    const pool = bank(['A', 'B', 'C'], 20)
    const m = { A: mastery(0.5), B: mastery(0.5), C: mastery(0.5) }
    const counts: Record<string, number> = { A: 0, B: 0, C: 0 }
    const n = 3000
    for (let seed = 0; seed < n; seed++) counts[next(pool, m, { recent: ['A1-3', 'B1-3'], seed })!.skillID] += 1
    expect(Math.abs(counts.A / n - 1 / 3)).toBeLessThan(0.03)
    expect(Math.abs(counts.B / n - 1 / 9)).toBeLessThan(0.02)
    expect(Math.abs(counts.C / n - 5 / 9)).toBeLessThan(0.03)
  })

  it('admite un Map de dominios', () => {
    const r = PracticePicker.next({ pool: bank(['A']), masteryBySkill: new Map([['A', mastery(0.9)]]), focusSkill: 'A', now, seed: 5 })
    expect(r?.level).toBe(3)
  })
})

describe('ExamPicker', () => {
  const ebank = (skills = ['A', 'B', 'C'], perLevel = 10, levels = [1, 2, 3]) => bank(skills, perLevel, levels)
  const sec = (skillIDs: string[], count: number, minLevel?: number, maxLevel?: number, title = 'S'): BlueprintSection => ({ title, skillIDs, count, minLevel, maxLevel })
  const idsOf = (r: ExerciseRef[][]) => r.map((s) => s.map((e) => e.id))

  it('estructura básica', () => {
    const r = ExamPicker.pick([sec(['A', 'B'], 4, 1, 2, 'Parte A'), sec(['C'], 3, 2, 3, 'Parte B')], ebank(), 42)
    expect(r.length).toBe(2); expect(r[0].length).toBe(4); expect(r[1].length).toBe(3)
    expect(r[0].every((e) => ['A', 'B'].includes(e.skillID) && e.level >= 1 && e.level <= 2)).toBe(true)
    expect(r[1].every((e) => e.skillID === 'C' && e.level >= 2 && e.level <= 3)).toBe(true)
    for (const s of r) expect(s.map((e) => e.level)).toEqual([...s.map((e) => e.level)].sort((a, b) => a - b))
    const all = r.flat().map((e) => e.id)
    expect(new Set(all).size).toBe(all.length)
  })

  it('rampa de dificultad', () => {
    expect(ExamPicker.pick([sec(['A'], 6, 1, 3)], ebank(), 1)[0].map((e) => e.level)).toEqual([1, 1, 2, 2, 3, 3])
    expect(ExamPicker.pick([sec(['A'], 4, 1, 3)], ebank(), 1)[0].map((e) => e.level)).toEqual([1, 2, 2, 3])
    expect(ExamPicker.pick([sec(['A'], 1, 1, 3)], ebank(), 1)[0].map((e) => e.level)).toEqual([2])
    expect(ExamPicker.pick([sec(['A'], 5, 2, 2)], ebank(), 1)[0].map((e) => e.level)).toEqual([2, 2, 2, 2, 2])
  })

  it('equilibrio entre habilidades; vacío = cualquiera', () => {
    for (const count of [3, 6, 7, 9]) {
      const r = ExamPicker.pick([sec(['A', 'B', 'C'], count)], ebank(), 9)
      const counts: Record<string, number> = {}
      for (const e of r[0]) counts[e.skillID] = (counts[e.skillID] ?? 0) + 1
      const values = Object.values(counts)
      expect(values.reduce((a, b) => a + b, 0)).toBe(count)
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1)
      expect(Object.keys(counts).length).toBe(3)
    }
    expect(new Set(ExamPicker.pick([sec([], 9)], ebank(), 3)[0].map((e) => e.skillID))).toEqual(new Set(['A', 'B', 'C']))
  })

  it('reproducible sin importar el orden del banco', () => {
    const sections = [sec(['A', 'B'], 5), sec(['C'], 4)]
    const pool = ebank()
    const a = ExamPicker.pick(sections, pool, 77)
    expect(ExamPicker.pick(sections, pool, 77)).toEqual(a)
    expect(ExamPicker.pick(sections, [...pool].reverse(), 77)).toEqual(a)
    const rng = new TestRNG(1)
    const shuffled = [...pool]
    for (let i = shuffled.length - 1; i > 0; i--) { const j = rng.int(i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]] }
    expect(ExamPicker.pick(sections, shuffled, 77)).toEqual(a)
  })

  it('semillas distintas, exámenes distintos; todos tienen su oportunidad', () => {
    const distinct = new Set<string>()
    for (let seed = 0; seed < 30; seed++) distinct.add(JSON.stringify(idsOf(ExamPicker.pick([sec(['A', 'B', 'C'], 6)], ebank(), seed))[0]))
    expect(distinct.size).toBeGreaterThan(20)
    const seen = new Set<string>()
    for (let seed = 0; seed < 200; seed++) for (const e of ExamPicker.pick([sec(['A'], 2, 1, 1)], ebank(), seed)[0]) seen.add(e.id)
    expect(seen.size).toBe(10)
  })

  it('flujos independientes por sección', () => {
    const first = sec(['A'], 4)
    const a = ExamPicker.pick([first, sec(['B'], 2)], ebank(), 5), b = ExamPicker.pick([first, sec(['B'], 9)], ebank(), 5)
    expect(a[0]).toEqual(b[0])
    const suffixes = (s: ExerciseRef[]) => s.map((e) => e.id.slice(e.id.indexOf('-'))).sort()
    let different = 0
    for (let seed = 0; seed < 30; seed++) {
      const r = ExamPicker.pick([sec(['A'], 4, 1, 1), sec(['B'], 4, 1, 1)], ebank(['A', 'B']), seed)
      if (JSON.stringify(suffixes(r[0])) !== JSON.stringify(suffixes(r[1]))) different += 1
    }
    expect(different).toBeGreaterThan(24)
  })

  it('cuando faltan ejercicios', () => {
    const pool = [...ebank(['A'], 10, [1, 2]), { id: 'A3-0', skillID: 'A', level: 3 }, { id: 'A3-1', skillID: 'A', level: 3 }]
    expect(ExamPicker.pick([sec(['A'], 4, 3, 3)], pool, 1)[0].map((e) => e.level)).toEqual([2, 2, 3, 3])
    const small: ExerciseRef[] = [{ id: 'a', skillID: 'A', level: 1 }, { id: 'b', skillID: 'A', level: 2 }, { id: 'c', skillID: 'A', level: 2 }, { id: 'd', skillID: 'A', level: 1 }]
    expect(new Set(ExamPicker.pick([sec(['A'], 2, 3, 3)], small, 1)[0].map((e) => e.id))).toEqual(new Set(['b', 'c']))
    expect(ExamPicker.pick([sec(['A'], 3, 3, 3)], small, 1)[0].map((e) => e.level)).toEqual([1, 2, 2])
    const tiny = ebank(['A'], 1)
    expect(ExamPicker.pick([sec(['A'], 10)], tiny, 1)[0].length).toBe(3)
    expect(ExamPicker.pick([sec(['A'], 3), sec(['A'], 3)], tiny, 1).map((s) => s.length)).toEqual([3, 0])
    const r = ExamPicker.pick(Array.from({ length: 5 }, (_, i) => sec(['A', 'B'], 8, undefined, undefined, `S${i}`)), ebank(), 4)
    const all = r.flat().map((e) => e.id)
    expect(new Set(all).size).toBe(all.length); expect(all.length).toBe(40)
  })

  it('avoid es una preferencia; las plantillas siempre son nuevas', () => {
    const pool = ebank(['A'], 4, [1])
    expect(new Set(ExamPicker.pick([sec(['A'], 2, 1, 1)], pool, 1, new Set(['A1-0', 'A1-1']))[0].map((e) => e.id))).toEqual(new Set(['A1-2', 'A1-3']))
    expect(ExamPicker.pick([sec(['A'], 4, 1, 1)], pool, 1, ['A1-0', 'A1-1'])[0].length).toBe(4)
    expect(ExamPicker.pick([sec(['A'], 1, 2, 2)], [{ id: 'seen', skillID: 'A', level: 2 }, { id: 'fresh', skillID: 'A', level: 1 }], 1, ['seen'])[0].map((e) => e.id)).toEqual(['fresh'])
    const tpl: ExerciseRef[] = [{ id: 'tpl', skillID: 'A', level: 2, tags: [], isTemplate: true }, { id: 'fixed', skillID: 'A', level: 2 }]
    expect(new Set(ExamPicker.pick([sec(['A'], 2, 2, 2)], tpl, 1, ['tpl', 'fixed'])[0].map((e) => e.id))).toEqual(new Set(['tpl', 'fixed']))
    expect(ExamPicker.pick([sec(['A'], 1, 2, 2)], tpl, 1, ['tpl', 'fixed'])[0].map((e) => e.id)).toEqual(['tpl'])
    const full = ebank()
    expect(full.length).toBe(90)
    const allAvoid = new Set(full.map((e) => e.id))
    const r = ExamPicker.pick([sec(['A', 'B', 'C'], 200)], full, 2, allAvoid)
    expect(r[0].length).toBe(90); expect(new Set(r[0].map((e) => e.id)).size).toBe(90)
    const some = ExamPicker.pick([sec(['A', 'B', 'C'], 50)], full, 2, allAvoid)
    expect(some[0].length).toBe(50); expect(new Set(some[0].map((e) => e.id)).size).toBe(50)
  })

  it('prefiere etiquetas distintas', () => {
    const pool: ExerciseRef[] = []
    for (let i = 0; i < 6; i++) pool.push({ id: `g${i}`, skillID: 'A', level: 2, tags: ['grafica'] })
    for (let i = 0; i < 6; i++) pool.push({ id: `w${i}`, skillID: 'A', level: 2, tags: ['problema-verbal'] })
    for (let i = 0; i < 6; i++) pool.push({ id: `e${i}`, skillID: 'A', level: 2, tags: ['ecuacion'] })
    for (let seed = 0; seed < 20; seed++) expect(new Set(ExamPicker.pick([sec(['A'], 3, 2, 2)], pool, seed)[0].flatMap((e) => e.tags ?? [])).size).toBe(3)
  })

  it('entradas degeneradas', () => {
    expect(ExamPicker.pick([], ebank(), 1)).toEqual([])
    expect(ExamPicker.pick([sec(['A'], 3)], [], 1)).toEqual([[]])
    expect(ExamPicker.pick([sec(['Z'], 3)], ebank(), 1)).toEqual([[]])
    expect(ExamPicker.pick([sec(['A'], 0)], ebank(), 1)).toEqual([[]])
    expect(ExamPicker.pick([sec(['A'], -4)], ebank(), 1)).toEqual([[]])
    expect(ExamPicker.pick([sec(['A'], 4, 3, 2)], ebank(), 1)[0].every((e) => e.level >= 2 && e.level <= 3)).toBe(true)
    expect(ExamPicker.pick([sec(['A'], 2, INT_MIN, INT_MAX)], [{ id: 'n', skillID: 'A', level: -5 }, { id: 'm', skillID: 'A', level: 99 }], 1)[0].length).toBe(2)
    const d = ExamPicker.pick([sec(['A'], 5)], [{ id: 'x', skillID: 'A', level: 1 }, { id: 'x', skillID: 'A', level: 3 }, { id: 'y', skillID: 'A', level: 2 }], 1)
    expect(d[0].length).toBe(2); expect(new Set(d[0].map((e) => e.id))).toEqual(new Set(['x', 'y']))
    const swapped = ExamPicker.pick([sec(['A', 'B'], 6, 3, 1)], ebank(), 4), ordered = ExamPicker.pick([sec(['A', 'B'], 6, 1, 3)], ebank(), 4)
    expect(swapped).toEqual(ordered); expect(swapped[0].map((e) => e.level)).toEqual([1, 1, 2, 2, 3, 3])
    const inRange = [...Array.from({ length: 3 }, (_, i) => ({ id: `a${i}`, skillID: 'A', level: 1 })), ...Array.from({ length: 2 }, (_, i) => ({ id: `b${i}`, skillID: 'B', level: 3 }))]
    const r = ExamPicker.pick([sec(['A', 'B'], 2, 1, 1)], inRange, 1)
    expect(r[0].map((e) => e.skillID)).toEqual(['A', 'A']); expect(r[0].map((e) => e.level)).toEqual([1, 1])
    expect(ExamPicker.pick([sec(['A'], 1, 1, 3)], [{ id: 'hi', skillID: 'A', level: 4 }, { id: 'ok', skillID: 'A', level: 3 }], 1)[0].map((e) => e.id)).toEqual(['ok'])
    expect(ExamPicker.pick([sec(['A'], -3), sec(['A'], 2)], ebank(), 1).map((s) => s.length)).toEqual([0, 2])
  })

  it('rápido con bancos grandes', () => {
    const pool: ExerciseRef[] = []
    for (let s = 0; s < 20; s++) for (let l = 1; l <= 3; l++) for (let i = 0; i < 80; i++) pool.push({ id: `s${s}l${l}i${i}`, skillID: `s${s}`, level: l, tags: [`t${i % 5}`] })
    const sections = Array.from({ length: 10 }, (_, i) => sec(Array.from({ length: 20 }, (_, k) => `s${k}`), 12, undefined, undefined, `S${i}`))
    const start = Date.now()
    const r = ExamPicker.pick(sections, pool, 8)
    expect(Date.now() - start).toBeLessThan(5000)
    expect(r.flat().length).toBe(120); expect(new Set(r.flat().map((e) => e.id)).size).toBe(120)
  })
})
