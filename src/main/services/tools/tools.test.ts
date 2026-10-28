// Herramientas de autoría y verificación: validan al escribir y devuelven problemas PRECISOS (ruta + mensaje) a la IA.
// (port de las pruebas de AulaTools/VerificationTools de la app Swift).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makePack } from '@shared/schema'
import type { AgentTool } from '../ai'
import { Library, type PackStore } from '../store'
import { boundValidator } from '../study/assets'
import { applyVerification, parseExamDate, parseSolverAnswer, parseToolSet, makeTools, toolSetName, VerificationStore, type ToolContext, type ToolSet } from '.'

let root: string
let store: PackStore

const PLAN = { title: 'Aritmética', subject: 'Matemáticas', language: 'es', exam: { title: 'Parcial 1', date: '2026-11-02', duration_minutes: 60, total_points: 100 },
  units: [{ id: 'u1', title: 'Operaciones', skills: [{ id: 'suma', title: 'Sumar', objectives: ['Sumar enteros'] }, { id: 'resta', title: 'Restar', prerequisites: ['suma'] }] }] }

function ctx(extra: Partial<ToolContext> = {}): ToolContext {
  return { store, validator: () => boundValidator(store), notify: () => {}, runID: 'run-20260101-000000-abc', ...extra }
}

function tools(set: ToolSet = { kind: 'all' }, extra: Partial<ToolContext> = {}): Map<string, AgentTool> {
  return new Map(makeTools(set, ctx(extra), false).map((t) => [t.name, t]))
}

async function call(t: Map<string, AgentTool>, name: string, args: unknown): Promise<{ ok: boolean; json: Record<string, unknown>; text: string }> {
  const tool = t.get(name)
  if (!tool) throw new Error(`sin ${name}`)
  const out = await tool.run(args as never, { signal: new AbortController().signal, callId: 'x' } as never)
  const o = typeof out === 'string' ? { text: out } : out
  let json: Record<string, unknown> = {}
  try { json = JSON.parse(o.text) as Record<string, unknown> } catch { json = {} }
  return { ok: !('isError' in o && o.isError) && json.ok !== false, json, text: o.text }
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'aula-tools-'))
  store = new Library(root, { recordsHistory: false }).createPack(makePack({ id: '', title: 'Nuevo curso' }))
  const r = await call(tools(), 'set_course_plan', PLAN)
  expect(r.ok, r.text).toBe(true)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('set_course_plan', () => {
  it('guarda unidades, habilidades y el examen', () => {
    const p = store.loadPack()
    expect(p.title).toBe('Aritmética')
    expect(p.skills.map((s) => s.id)).toEqual(['suma', 'resta'])
    expect(p.units[0].skillIDs).toEqual(['suma', 'resta'])
    expect(p.exam?.durationMinutes).toBe(60)
    // como en Swift, el archivo de la habilidad nace con su primer contenido
    expect(store.hasSkill('suma')).toBe(false)
  })

  it('rechaza ids que no son slugs y duplicados, con la ruta exacta', async () => {
    const r = await call(tools(), 'set_course_plan', { units: [{ id: 'U 1', title: 'x', skills: [{ id: 'Mal Id', title: 'x' }, { id: 'ok', title: 'y' }, { id: 'ok', title: 'z' }] }] })
    expect(r.ok).toBe(false)
    const paths = (r.json.issues as Array<{ path: string; message: string }>).map((i) => i.path)
    expect(paths).toContain('units[0].id')
    expect(paths).toContain('units[0].skills[0].id')
    expect(paths).toContain('units[0].skills[2].id')
    expect(store.loadPack().skills.map((s) => s.id)).toEqual(['suma', 'resta'])
  })
})

describe('write_lesson', () => {
  it('un bloque con error no guarda nada y dice qué bloque y qué campo', async () => {
    const r = await call(tools(), 'write_lesson', { skill_id: 'suma', blocks: ['# Sumar', { type: 'math', tex: '\\frac{1}{' }, { type: 'example', problem: 'Calcula $2+3$.', steps: [{ md: 'a' }, { md: 'b' }], answer: '$5$' }] })
    expect(r.ok).toBe(false)
    expect(r.json.saved).toBe(false)
    const issues = r.json.issues as Array<{ path: string; severity: string; message: string }>
    expect(issues.some((i) => i.severity === 'error' && i.path.startsWith('blocks[1]'))).toBe(true)
    expect(store.hasSkill('suma')).toBe(false)
  })

  it('una lección válida se guarda con ids estables', async () => {
    const r = await call(tools(), 'write_lesson', { skill_id: 'suma', blocks: ['# Sumar', { type: 'callout', kind: 'definition', title: 'Suma', md: 'Combinar.' }, { type: 'example', problem: 'Calcula $2+3$.', steps: [{ md: 'Contar' }, { md: 'Sumar' }], answer: '$5$' }] })
    expect(r.ok, r.text).toBe(true)
    const lesson = store.loadSkill('suma').lesson
    expect(lesson.map((b) => b.type)).toEqual(['text', 'callout', 'example'])
    expect(new Set(lesson.map((b) => b.id)).size).toBe(3)
  })

  it('el autor de una habilidad no puede tocar otra', async () => {
    const r = await call(tools({ kind: 'lessonAuthor', skill: 'suma' }), 'write_lesson', { skill_id: 'resta', blocks: ['# x'] })
    expect(r.ok).toBe(false)
    expect(store.hasSkill('resta')).toBe(false)
  })
})

describe('add_exercises', () => {
  it('guarda los válidos y devuelve los inválidos con su índice y su problema', async () => {
    const r = await call(tools(), 'add_exercises', {
      skill_id: 'suma',
      exercises: [
        { prompt: 'Calcula $1+10$.', answer: { kind: 'numeric', value: '11' }, level: 1, hints: ['Suma'], solution: '1+10=11.', wrongs: [{ input: '1', why: 'Olvidó sumar 10' }] },
        { prompt: 'Elige', answer: { kind: 'choice', options: [{ id: 'a', md: '1', correct: false }, { id: 'b', md: '2', correct: false }] }, level: 2, hints: ['x'], solution: 'x' },
        { prompt: '', answer: { kind: 'numeric', value: 'abc' }, level: 1 }
      ]
    })
    const saved = store.loadSkill('suma').exercises
    expect(saved.map((e) => e.id)).toEqual(['suma-e1'])
    expect(r.json.added).toBe(1)
    expect(r.json.rejected).toBe(2)
    const results = r.json.results as Array<{ index: number; saved: boolean; issues: Array<{ path: string; severity: string; message: string }> }>
    const errors = (i: number): Array<{ path: string; message: string }> => results.find((x) => x.index === i)?.issues.filter((x) => x.severity === 'error') ?? []
    expect(errors(1)).toEqual([expect.objectContaining({ path: 'exercises[#1].answer.options', message: expect.stringMatching(/correct: true/) })])
    expect(errors(2).map((e) => e.path)).toEqual(['exercises[#2].prompt[0]', 'exercises[#2].answer.value'])
  })

  it('una clave que no se corrige a sí misma es un error', async () => {
    const r = await call(tools(), 'add_exercises', { skill_id: 'suma', exercises: [{ prompt: 'Elige la mayor', answer: { kind: 'choice', options: [{ id: 'a', md: '3' }, { id: 'b', md: '5' }] }, level: 1, hints: ['x'], solution: 'b' }] })
    expect(store.hasSkill('suma')).toBe(false)
    expect(r.json.added).toBe(0)
  })

  it('los ids son únicos en todo el curso', async () => {
    const ex = { prompt: 'Calcula $2+2$.', answer: { kind: 'numeric', value: '4' }, level: 1, hints: ['h'], solution: '4' }
    await call(tools(), 'add_exercises', { skill_id: 'suma', exercises: [ex] })
    await call(tools(), 'add_exercises', { skill_id: 'resta', exercises: [{ ...ex, id: 'suma-e1', prompt: 'Calcula $3+3$.', answer: { kind: 'numeric', value: '6' } }] })
    const ids = [...store.loadSkill('suma').exercises, ...store.loadSkill('resta').exercises].map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('validate_skill y tarjetas', () => {
  it('un «Pruébalo» sin su ejercicio se guarda como aviso, pero validar lo marca como error y deja la habilidad por revisar', async () => {
    await call(tools(), 'add_cards', { skill_id: 'suma', cards: [{ front: '¿Qué es sumar?', back: 'Combinar' }, { kind: 'cloze', front: 'El neutro es {{c1::0}}' }] })
    expect(store.loadSkill('suma').cards).toHaveLength(2)
    const w = await call(tools(), 'write_lesson', { skill_id: 'suma', blocks: ['# S', { type: 'tryit', exerciseIDs: ['nope-1'] }] })
    expect(w.ok).toBe(true)
    expect(w.json.issues).toEqual([expect.objectContaining({ path: 'blocks[1].exerciseIDs', severity: 'warning' })])
    const r = await call(tools(), 'validate_skill', { skill_id: 'suma' })
    expect(r.json.status).toBe('needsReview')
    expect(r.json.issues).toContainEqual(expect.objectContaining({ path: 'lesson[1].exerciseIDs', severity: 'error' }))
    expect((r.json.checklist as unknown[]).length).toBeGreaterThan(5)
    expect(store.loadSkill('suma').status).toBe('needsReview')
  })

  it('set_exam_blueprint rechaza habilidades que no existen', async () => {
    const r = await call(tools(), 'set_exam_blueprint', { duration_minutes: 60, total_points: 10, sections: [{ title: 'x', skill_ids: ['no-existe'], count: 2, points_each: 5 }] })
    expect(r.ok).toBe(false)
    expect(r.text).toContain('no-existe')
  })
})

describe('verificación independiente', () => {
  it('el solucionador no ve las claves; una respuesta distinta se registra y queda marcada', async () => {
    await call(tools(), 'add_exercises', { skill_id: 'suma', exercises: [
      { prompt: 'Calcula $1+10$.', answer: { kind: 'numeric', value: '11' }, level: 1, hints: ['Suma'], solution: '1+10=11.' },
      { prompt: 'Calcula $2+10$.', answer: { kind: 'numeric', value: '12' }, level: 1, hints: ['Suma'], solution: '2+10=12.' }
    ] })
    const solver = tools({ kind: 'solver', skill: 'suma' })
    const list = await call(solver, 'list_exercises_to_solve', {})
    expect(list.json.count).toBe(2)
    expect(list.text).not.toContain('1+10=11')
    expect(list.text).not.toContain('"hints"')
    expect(list.text).not.toContain('"value"')
    await call(solver, 'submit_solution', { exercise_id: 'suma-e1', answer: '11', work: 'ok' })
    await call(solver, 'submit_solution', { exercise_id: 'suma-e2', answer: '13', work: 'mal' })
    const file = VerificationStore.load(store, 'run-20260101-000000-abc', 'suma')
    expect(file.records['suma-e1'].outcome).toBe('match')
    expect(file.records['suma-e2'].outcome).toBe('mismatch')
    const sum = applyVerification(store, 'run-20260101-000000-abc', 'suma', new Date())
    expect(sum.verified).toBe(1)
    expect(sum.flagged).toBe(1)
    const exs = store.loadSkill('suma').exercises
    expect(exs.find((e) => e.id === 'suma-e1')?.review?.state).toBe('verified')
    expect(exs.find((e) => e.id === 'suma-e2')?.review?.state).toBe('flagged')
  })

  it('parseSolverAnswer entiende opciones, verdadero/falso y partes', () => {
    const choice = parseSolverAnswer({ kind: 'choice', options: [{ id: 'a', md: '1', correct: false }, { id: 'b', md: '2', correct: true }], multi: false } as never, 'b')
    expect(choice.ok).toBe(true)
    expect(parseSolverAnswer({ kind: 'choice', options: [{ id: 'a', md: '1', correct: true }], multi: false } as never, 'z').ok).toBe(false)
    expect(parseSolverAnswer({ kind: 'truefalse', value: true } as never, 'Verdadero').ok).toBe(true)
  })
})

describe('conjuntos de herramientas', () => {
  it('reparten el trabajo del equipo (como TeamTests de Swift)', () => {
    const names = (s: ToolSet): Set<string> => new Set(makeTools(s, ctx(), false).map((t) => t.name))
    const lesson = names({ kind: 'lessonAuthor', skill: 's' })
    const practice = names({ kind: 'practiceAuthor', skill: 's' })
    for (const n of ['write_lesson', 'add_cards', 'set_common_mistakes', 'validate_skill']) expect(lesson.has(n)).toBe(true)
    for (const n of ['add_exercises', 'add_templates']) expect(lesson.has(n)).toBe(false)
    for (const n of ['add_exercises', 'add_templates', 'validate_skill', 'calculate']) expect(practice.has(n)).toBe(true)
    for (const n of ['write_lesson', 'add_cards']) expect(practice.has(n)).toBe(false)
    const reader = new Set(makeTools({ kind: 'reader', sources: ['x'] }, ctx(), true).map((t) => t.name))
    expect(reader.has('save_source_digest')).toBe(true)
    expect(reader.has('web_search')).toBe(false)
    expect(reader.has('write_lesson')).toBe(false)
    expect(names({ kind: 'solver', skill: 's' }).has('get_skill')).toBe(false)
  })

  it('nombres de los conjuntos (compatibles con Swift)', () => {
    expect(parseToolSet('lesson:suma')).toEqual({ kind: 'lessonAuthor', skill: 'suma' })
    expect(parseToolSet('practice:suma')).toEqual({ kind: 'practiceAuthor', skill: 'suma' })
    expect(parseToolSet('read:a,b')).toEqual({ kind: 'reader', sources: ['a', 'b'] })
    expect(toolSetName({ kind: 'reader', sources: ['a', 'b'] })).toBe('read:a,b')
  })
})

describe('fechas del examen', () => {
  it('un día sin hora es a las 08:00 de la zona; con zona, estricto', () => {
    expect(parseExamDate('2026-11-02', 'Europe/Madrid')?.toISOString()).toBe('2026-11-02T07:00:00.000Z')
    expect(parseExamDate('2026-11-02T10:30:00Z')?.toISOString()).toBe('2026-11-02T10:30:00.000Z')
    expect(parseExamDate('2026-02-30')).toBeUndefined()
    expect(parseExamDate('mañana')).toBeUndefined()
  })
})
