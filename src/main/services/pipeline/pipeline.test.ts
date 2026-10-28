// La tubería de generación con agentes simulados que llaman a las herramientas REALES (port de PipelineTests.swift y
// TeamTests.swift): flujo clásico y en equipo, reparación, verificación con árbitro, reanudar tras un fallo, ampliar,
// preguntas al estudiante, lectores en paralelo y límites de uso.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decodeRequest, encodeRunState, decodeRunState, languageName, makeRequest, materialsMap, MAX_AGENTS, readingGroups, runProgress, usesTeam, type GenerationRequest, type GenerationStage } from '@engine/pipeline'
import { makePack } from '@shared/schema'
import { AIError } from '../ai'
import { BudgetError } from '../costs'
import { Library, type PackStore } from '../store'
import { loadDigests } from '../tools'
import { packImporter } from './adapters'
import { scriptedAgents, type AgentTask } from './agents'
import { fakeTeamScript, skillIDIn } from './fakeTeam'
import { AgentGate } from './gate'
import { GenerationPipeline } from './runner'
import { GenerationService } from './service'

type Call = (name: string, args: unknown) => Promise<unknown>
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// MARK: Contenido de prueba (el `Fixture` de Swift)

const Fixture = {
  plan: { title: 'Aritmética', subject: 'Matemáticas', language: 'es', icon: 'function', hue: 0.6, exam: { title: 'Parcial 1', date: '2026-11-02', duration_minutes: 60, total_points: 100 }, guidance: 'Fracciones simplificadas.',
    units: [{ id: 'u1', title: 'Operaciones', skills: [{ id: 'suma', title: 'Sumar', objectives: ['Sumar enteros'], weight: 50, minutes: 15 }, { id: 'resta', title: 'Restar', objectives: ['Restar enteros'], prerequisites: ['suma'], weight: 50, minutes: 15 }] }] },
  skillID: (task: AgentTask): string => skillIDIn(task.prompt) ?? '',
  lesson: (id: string, tryIt = true): Obj => ({ blocks: [`# ${id}`,
    { type: 'predict', question: '¿Cuánto es 2+2?', options: [{ md: '4', correct: true, why: 'Suma básica' }, { md: '5', correct: false, why: 'Error de conteo' }], explanation: 'Es 4.' },
    'Una idea sencilla.', { type: 'callout', kind: 'definition', title: 'Suma', md: 'Combinar cantidades.' }, { type: 'math', tex: 'a+b=c', label: 'Suma' },
    { type: 'example', problem: 'Calcula $2+3$.', steps: [{ md: 'Sumar', note: 'Contar' }], answer: '$5$' },
    ...(tryIt ? [{ type: 'tryit', exerciseIDs: [`${id}-e1`, `${id}-e2`] }] : ['Otra idea.']),
    { type: 'callout', kind: 'mistake', md: 'No olvides llevar.' }, { type: 'recap', points: ['Sumar combina', 'Practica'] }] }),
  exercises: (count: number, from = 1): Obj => {
    const items: Obj[] = []
    for (let k = from; k < from + count; k++) {
      if (k % 3 === 0) items.push({ question: `¿Cuál es el resultado de ${k}+${k}?`, options: [String(k), String(2 * k), String(3 * k)], answer: 'B', level: 2, hints: ['Suma el número consigo mismo'], solution: `${k}+${k}=${2 * k}.`, wrongs: [] })
      else if (k % 3 === 1) items.push({ prompt: `Calcula $${k}+10$.`, answer: { kind: 'numeric', value: String(k + 10) }, level: 1, hints: ['Suma'], solution: `${k}+10=${k + 10}.`, wrongs: [{ input: String(k), why: 'Olvidó sumar 10' }] })
      else items.push({ prompt: `¿Cómo se llama la operación de combinar cantidades (ej. ${k}) ?`, answer: { kind: 'short', accepted: ['suma', 'adición'] }, level: 3, hints: ['Empieza con s'], solution: 'Es la suma.' })
    }
    return { exercises: items }
  },
  cards: { cards: [{ front: '¿Qué es sumar?', back: 'Combinar' }, { front: '¿Conmutativa?', back: 'a+b=b+a' }, { front: '¿Neutro?', back: '0' }, { front: '¿Asociativa?', back: '(a+b)+c=a+(b+c)' }, { front: '¿Resultado de 1+1?', back: '2' }] },
  glossary: { entries: [{ term: 'Suma', definition: 'Operación que combina cantidades.' }, { term: 'Resta', definition: 'Operación inversa de la suma.' }] },
  formulas: { groups: [{ title: 'Básicas', items: [{ name: 'Conmutativa', tex: 'a+b=b+a' }] }] },
  blueprint: { duration_minutes: 60, total_points: 100, sections: [{ title: 'Sumas', skill_ids: ['suma'], count: 5, points_each: 10 }, { title: 'Restas', skill_ids: ['resta'], count: 5, points_each: 10 }] },

  async author(task: AgentTask, call: Call, underdeliverFirst: boolean): Promise<string> {
    const id = Fixture.skillID(task)
    const repair = task.prompt.includes('repair attempt')
    await call('get_skill', {})
    await call('write_lesson', Fixture.lesson(id))
    await call('add_exercises', Fixture.exercises(underdeliverFirst && !repair ? 3 : 8))
    await call('add_cards', Fixture.cards)
    await call('validate_skill', {})
    return `Habilidad ${id} lista.`
  },
  async crossCutting(call: Call): Promise<string> {
    await call('set_glossary', Fixture.glossary)
    await call('set_formula_sheet', Fixture.formulas)
    await call('set_exam_blueprint', Fixture.blueprint)
    return 'Listo.'
  },
  /** Resuelve leyendo la clave del curso (el solucionador de la prueba hace trampa a propósito); `sabotage` falla a propósito. */
  async solver(task: AgentTask, call: Call, store: PackStore, sabotage: Set<string>, override: Record<string, string> = {}): Promise<string> {
    const sid = Fixture.skillID(task)
    const skill = store.loadSkill(sid)
    const list = await call('list_exercises_to_solve', {})
    for (const ex of isObj(list) && Array.isArray(list.exercises) ? list.exercises.filter(isObj) : []) {
      const id = String(ex.id)
      const stored = skill.exercises.find((e) => e.id === id)
      if (!stored) continue
      const a = stored.answer
      let answer = a.kind === 'numeric' ? a.value : a.kind === 'choice' ? a.options.find((o) => o.correct)?.id ?? 'a' : a.kind === 'short' ? a.accepted[0] ?? '' : ''
      if (sabotage.has(id)) answer = answer === '999' ? '998' : a.kind === 'choice' ? (answer === 'a' ? 'c' : 'a') : '999'
      if (override[id] !== undefined) answer = override[id]
      await call('submit_solution', { exercise_id: id, answer, work: 'hecho' })
    }
    return 'Resuelto.'
  }
}

const TeamFixture = {
  /** Un agente del equipo según las herramientas que recibió (lección, práctica o habilidad completa al reparar). */
  async author(task: AgentTask, call: Call): Promise<string> {
    const names = new Set(task.tools.map((t) => t.name))
    const id = Fixture.skillID(task)
    if (names.has('write_lesson') && !names.has('add_exercises')) {
      expect(task.prompt).toContain('write the LESSON')
      await call('write_lesson', Fixture.lesson(id, false))
      await call('add_cards', Fixture.cards)
      await call('validate_skill', { scope: 'lesson' })
      return 'lección'
    }
    if (!names.has('write_lesson') && names.has('add_exercises')) {
      expect(task.prompt).toContain('write the PRACTICE')
      await call('add_exercises', Fixture.exercises(8))
      const v = await call('validate_skill', { scope: 'practice' })
      const issues = isObj(v) && Array.isArray(v.issues) ? v.issues.filter(isObj) : []
      expect(issues.some((i) => String(i.path).startsWith('lesson'))).toBe(false)
      return 'práctica'
    }
    return Fixture.author(task, call, false)
  },
  async cross(task: AgentTask, call: Call): Promise<string> {
    if (task.prompt.includes('# Task: GLOSSARY (team mode')) { await call('set_glossary', Fixture.glossary); return 'glosario' }
    if (task.prompt.includes('FORMULA SHEET and MOCK-EXAM BLUEPRINT (team mode')) { await call('set_formula_sheet', Fixture.formulas); await call('set_exam_blueprint', Fixture.blueprint); return 'fórmulas' }
    return Fixture.crossCutting(call)
  }
}

/** Cuenta cuántos agentes simulados trabajan a la vez. */
class Concurrency {
  now = 0
  peak = 0
  enter(): void { this.now += 1; this.peak = Math.max(this.peak, this.now) }
  leave(): void { this.now -= 1 }
}

let root: string
let lib: Library
let store: PackStore

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aula-p-'))
  lib = new Library(root)
  store = lib.createPack(makePack({ id: '', title: 'Nuevo curso' }))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

/** Flujo clásico (un agente por etapa); el equipo tiene sus propias pruebas. */
function request(o: { verify?: boolean; parallel?: number; mode?: GenerationRequest['mode']; team?: boolean } = {}): GenerationRequest {
  return makeRequest({ packID: store.id, title: 'Aritmética', subject: 'Matemáticas', language: 'es', goal: 'Parcial 1', topics: 'Suma y resta de enteros', depth: 'quick', allowWeb: false,
    verifyAnswers: o.verify ?? true, maxParallel: o.parallel ?? 2, mode: o.mode ?? { kind: 'create' }, team: o.team ?? false })
}

function teamRequest(parallel = 3, verify = true): GenerationRequest {
  const r = request({ verify, parallel })
  delete r.team
  return r
}

function doneStages(s: { stages: Record<GenerationStage, string> }): GenerationStage[] {
  return (['prepare', 'gather', 'plan', 'author', 'crossCutting', 'verify', 'polish'] as GenerationStage[]).filter((g) => s.stages[g] === 'done')
}

describe('flujo clásico', () => {
  it('crea y verifica un curso completo', async () => {
    const roles: string[] = []
    const agents = scriptedAgents(async (task, call) => {
      roles.push(task.role)
      switch (task.role) {
        case 'planner': await call('set_course_plan', Fixture.plan); return 'Plan listo.'
        case 'author': return Fixture.author(task, call, false)
        case 'crossCutting': return Fixture.crossCutting(call)
        // sabotea un ejercicio de «resta»: el árbitro debe declarar que el solucionador se equivocó
        case 'verifier': return Fixture.solver(task, call, store, Fixture.skillID(task) === 'resta' ? new Set(['resta-e2']) : new Set())
        case 'adjudicator': {
          const d = await call('list_disagreements', {})
          for (const item of isObj(d) && Array.isArray(d.disagreements) ? d.disagreements.filter(isObj) : []) {
            const id = isObj(item.exercise) ? item.exercise.id : undefined
            await call('resolve_disagreement', { exercise_id: id, verdict: 'solver_wrong', note: 'La clave es correcta.' })
          }
          return 'Arbitraje hecho.'
        }
        default: return ''
      }
    })
    const pipe = new GenerationPipeline({ library: lib, request: request(), agents })
    const s = await pipe.run()
    expect(s.aula2.state, s.failure).toBe('done')
    expect(doneStages(s)).toEqual(['prepare', 'plan', 'author', 'crossCutting', 'verify', 'polish'])
    expect(s.stages.gather).toBe('skipped')
    expect(s.skills.every((k) => k.status === 'done')).toBe(true)
    expect(s.aula2.verify).toEqual({ verified: 16, fixed: 0, flagged: 0, disagreements: 1, skipped: 0 })
    // plan + 2 autores + transversal + 2 solucionadores + 1 árbitro
    expect(roles.sort()).toEqual(['adjudicator', 'author', 'author', 'crossCutting', 'planner', 'verifier', 'verifier'])
    expect(s.usage.promptTokens + s.usage.completionTokens).toBe(1200 * 7)
    const pack = store.loadPack()
    expect(pack.skills).toHaveLength(2)
    expect(pack.glossary).toHaveLength(2)
    expect(pack.blueprint).toBeDefined()
    expect(pack.exam?.durationMinutes).toBe(60)
    for (const ref of pack.skills) expect(ref.status, ref.id).toBe('ready')
    expect(store.loadSkill('resta').exercises.every((e) => e.review?.state === 'verified')).toBe(true)
    // el guion escribe los mismos ejercicios en las dos habilidades: la revisión final quita de «resta» las copias que no usa
    // su lección, sin bajar del mínimo (6 en «quick»); «suma», la primera, se queda entera
    expect(store.loadSkill('suma').exercises).toHaveLength(8)
    const resta = store.loadSkill('resta').exercises.map((e) => e.id)
    expect(resta).toHaveLength(6)
    expect(resta).toEqual(expect.arrayContaining(['resta-e1', 'resta-e2']))
    // el registro quedó guardado, en el formato de Swift
    const saved = GenerationPipeline.loadRun(store, pipe.runID)
    expect(saved?.stages.polish).toBe('done')
    expect(saved?.finishedAt).toBeDefined()
    expect(GenerationPipeline.previousRuns(store)[0]?.runID).toBe(pipe.runID)
    expect(pipe.runID).toMatch(/^run-\d{8}-\d{6}-[a-z0-9]{3}$/)
    // los carriles cuentan lo que hizo cada agente
    expect(s.aula2.lanes.map((l) => l.title)).toContain('Autor · Sumar')
    expect(s.aula2.lanes.every((l) => l.status === 'done' && l.steps > 0)).toBe(true)
  })

  it('el bucle de reparación arregla a un autor que se queda corto', async () => {
    const agents = scriptedAgents(async (task, call) => {
      switch (task.role) {
        case 'planner': await call('set_course_plan', Fixture.plan); return 'ok'
        case 'author': {
          if (task.prompt.includes('repair attempt')) expect(task.prompt).toContain('exercises:')
          return Fixture.author(task, call, Fixture.skillID(task) === 'resta')
        }
        case 'crossCutting': return Fixture.crossCutting(call)
        default: return ''
      }
    })
    const pipe = new GenerationPipeline({ library: lib, request: request({ verify: false }), agents })
    const s = await pipe.run()
    expect(s.aula2.state).toBe('done')
    expect(s.skills.find((k) => k.id === 'resta')).toMatchObject({ attempts: 2, status: 'done' })
    expect(s.skills.find((k) => k.id === 'suma')?.attempts).toBe(1)
    expect(s.stages.verify).toBe('skipped')
  })

  it('una habilidad que nunca cumple queda por revisar, no fallida', async () => {
    const agents = scriptedAgents(async (task, call) => {
      switch (task.role) {
        case 'planner': await call('set_course_plan', Fixture.plan); return 'ok'
        case 'author':
          if (Fixture.skillID(task) === 'resta') { await call('write_lesson', Fixture.lesson('resta')); await call('add_exercises', Fixture.exercises(2)); return 'poco' }
          return Fixture.author(task, call, false)
        case 'crossCutting': return Fixture.crossCutting(call)
        default: return ''
      }
    })
    const s = await new GenerationPipeline({ library: lib, request: request({ verify: false }), agents }).run()
    const st = s.skills.find((k) => k.id === 'resta')
    expect(st).toMatchObject({ status: 'needsReview', attempts: 3 })
    expect(st?.openIssues).toBeGreaterThan(0)
    expect(store.loadPack().skills.find((r) => r.id === 'resta')?.status).toBe('needsReview')
    expect(s.aula2.notes.some((n) => n.startsWith('Restar:'))).toBe(true)
  })

  it('un fallo del proveedor detiene la ejecución y se reanuda sin repetir lo hecho', async () => {
    const broken = scriptedAgents(async (task, call) => {
      switch (task.role) {
        case 'planner': await call('set_course_plan', Fixture.plan); return 'ok'
        case 'author':
          if (Fixture.skillID(task) === 'resta') throw new AIError('notLoggedIn', 'Abre Terminal y ejecuta `claude` para iniciar sesión')
          return Fixture.author(task, call, false)
        default: return ''
      }
    })
    const first = new GenerationPipeline({ library: lib, request: request({ verify: false, parallel: 1 }), agents: broken })
    const s1 = await first.run()
    expect(s1.aula2.state).toBe('failed')
    expect(s1.failure).toContain('claude')
    expect(s1.skills.find((k) => k.id === 'suma')?.status).toBe('done')

    const calls: string[] = []
    const fixed = scriptedAgents(async (task, call) => {
      switch (task.role) {
        case 'planner': calls.push('plan'); await call('set_course_plan', Fixture.plan); return 'ok'
        case 'author': calls.push('author:' + Fixture.skillID(task)); return Fixture.author(task, call, false)
        case 'crossCutting': return Fixture.crossCutting(call)
        default: return ''
      }
    })
    const second = new GenerationPipeline({ library: lib, request: request({ verify: false }), agents: fixed, resumeRunID: first.runID })
    expect(second.runID).toBe(first.runID)
    const s2 = await second.run()
    expect(calls).toEqual(['author:resta'])
    expect(s2.aula2.state).toBe('done')
    expect(s2.skills.every((k) => k.status === 'done')).toBe(true)
    expect(GenerationPipeline.previousRuns(store)).toHaveLength(1)
  })

  it('un desacuerdo sin resolver marca el ejercicio y la habilidad no se declara lista', async () => {
    const agents = scriptedAgents(async (task, call) => {
      switch (task.role) {
        case 'planner': await call('set_course_plan', Fixture.plan); return 'ok'
        case 'author': return Fixture.author(task, call, false)
        case 'crossCutting': return Fixture.crossCutting(call)
        case 'verifier': return Fixture.solver(task, call, store, Fixture.skillID(task) === 'suma' ? new Set(['suma-e1']) : new Set())
        case 'adjudicator': {
          // dice «la clave estaba mal» pero no la arregla: la herramienta lo rechaza y queda sin resolver
          const r = await call('resolve_disagreement', { exercise_id: 'suma-e1', verdict: 'key_wrong', note: 'creo que estaba mal' })
          expect(isObj(r) && r.ok).toBe(false)
          return 'no pude'
        }
        default: return ''
      }
    })
    const s = await new GenerationPipeline({ library: lib, request: request(), agents }).run()
    expect(s.aula2.verify.flagged).toBe(1)
    const suma = store.loadSkill('suma')
    expect(suma.exercises.find((e) => e.id === 'suma-e1')?.review?.state).toBe('flagged')
    expect(suma.status).toBe('needsReview')
  })

  it('el árbitro que corrige una clave equivocada la deja «corregida»', async () => {
    const agents = scriptedAgents(async (task, call) => {
      switch (task.role) {
        case 'planner': await call('set_course_plan', Fixture.plan); return 'ok'
        case 'author': {
          const r = await Fixture.author(task, call, false)
          // la autora deja una clave equivocada: «suma-e1» (1+10=11) pasa a decir 12
          if (Fixture.skillID(task) === 'suma') await call('add_exercises', { exercises: [{ id: 'suma-e1', prompt: 'Calcula $1+10$.', answer: { kind: 'numeric', value: '12' }, level: 1, hints: ['Suma'], solution: '1+10=11.' }] })
          return r
        }
        case 'crossCutting': return Fixture.crossCutting(call)
        case 'verifier': return Fixture.solver(task, call, store, new Set(), { 'suma-e1': '11' })
        case 'adjudicator': {
          await call('add_exercises', { exercises: [{ id: 'suma-e1', prompt: 'Calcula $1+10$.', answer: { kind: 'numeric', value: '11' }, level: 1, hints: ['Suma'], solution: '1+10=11.' }] })
          const r = await call('resolve_disagreement', { exercise_id: 'suma-e1', verdict: 'key_wrong', note: 'La clave decía 12; es 11.' })
          expect(isObj(r) && r.ok, JSON.stringify(r)).toBe(true)
          return 'corregido'
        }
        default: return ''
      }
    })
    const s = await new GenerationPipeline({ library: lib, request: request(), agents }).run()
    expect(s.aula2.verify.fixed).toBe(1)
    expect(s.aula2.verify.flagged).toBe(0)
    const ex = store.loadSkill('suma').exercises.find((e) => e.id === 'suma-e1')
    expect(ex?.review?.state).toBe('fixed')
    expect(ex?.answer.kind === 'numeric' && ex.answer.value).toBe('11')
  })

  it('ampliar usa un solo agente y vuelve a verificar solo lo que cambió (deshacer con el historial)', async () => {
    const base = scriptedAgents(async (task, call) => {
      switch (task.role) {
        case 'planner': await call('set_course_plan', Fixture.plan); return 'ok'
        case 'author': return Fixture.author(task, call, false)
        case 'crossCutting': return Fixture.crossCutting(call)
        default: return ''
      }
    })
    await new GenerationPipeline({ library: lib, request: request({ verify: false }), agents: base }).run()
    const before = store.loadSkill('suma').revision
    // lo que tenía el curso antes de ampliarlo (la revisión final ya quitó los ejercicios repetidos entre temas)
    const exercisesBefore = store.loadSkills().reduce((n, k) => n + k.exercises.length, 0)
    const seen: string[] = []
    const extender = scriptedAgents(async (task, call) => {
      seen.push(task.role)
      if (task.role === 'extender') {
        expect(task.prompt).toContain('más ejercicios de nivel 3')
        await call('add_exercises', Fixture.exercises(3, 20))
        return 'añadí 3'
      }
      if (task.role === 'verifier') return Fixture.solver(task, call, store, new Set())
      return ''
    })
    const pipe = new GenerationPipeline({ library: lib, request: request({ verify: true, mode: { kind: 'extend', instruction: 'más ejercicios de nivel 3', skill: 'suma' } }), agents: extender })
    const s = await pipe.run()
    expect(s.aula2.state).toBe('done')
    expect(store.loadSkill('suma').revision).toBeGreaterThan(before)
    expect(store.loadSkill('suma').exercises).toHaveLength(11)
    expect(seen.filter((r) => r === 'extender')).toHaveLength(1)
    expect(seen.filter((r) => r === 'verifier')).toHaveLength(1)
    // el informe dice lo que se añadió (3 ejercicios en 1 tema tocado), no el curso entero como si fuera nuevo
    expect(s.aula2.baseline).toMatchObject({ skills: 2, exercises: exercisesBefore })
    const report = new GenerationService({ library: () => lib, agents: async () => extender }).view(s, undefined, store).report
    expect(report?.added).toEqual({ skills: 0, exercises: 3, cards: 0, lessonBlocks: 0 })
    expect(report?.changedSkills).toBe(1)
    expect(s.skills.find((k) => k.id === 'resta')?.status).toBe('pending')
    // todo lo que escribió la ampliación queda en un grupo del historial, que se puede deshacer
    const history = lib.history
    expect(history).toBeDefined()
    const group = history?.groups({ courseID: store.id }).find((g) => g.id === `pipeline-${pipe.runID}`)
    expect(group, JSON.stringify(history?.groups({ courseID: store.id }).map((g) => g.id))).toBeDefined()
    expect(group?.label).toContain('Pedir cambios')
    history?.undo(`pipeline-${pipe.runID}`)
    expect(store.loadSkill('suma').exercises).toHaveLength(8)
  })

  it('sin ningún material falla enseguida con un mensaje claro', async () => {
    const r = request()
    r.topics = ''
    r.allowWeb = false
    const s = await new GenerationPipeline({ library: lib, request: r, agents: scriptedAgents(async () => { throw new Error('no debe llamar a la IA') }) }).run()
    expect(s.aula2.state).toBe('failed')
    expect(s.failure).toContain('temario')
    expect(s.stages.prepare).toBe('failed')
  })

  it('una pregunta al estudiante se ve como pendiente y su respuesta vuelve a la IA', async () => {
    let pipe: GenerationPipeline | undefined
    let sawQuestion = false
    const agents = scriptedAgents(async (task, call) => {
      switch (task.role) {
        case 'planner': {
          const answer = call('ask_user', { question: '¿Entra el capítulo 5?', options: ['Sí', 'No'] })
          for (let i = 0; i < 80; i++) {
            const q = pipe?.broker.pending()[0]
            if (q) { sawQuestion = true; expect(q.options).toEqual(['Sí', 'No']); pipe?.answer(q.id, 'No'); break }
            await sleep(20)
          }
          expect(JSON.stringify(await answer)).toContain('No')
          await call('set_course_plan', Fixture.plan); return 'ok'
        }
        case 'author': return Fixture.author(task, call, false)
        case 'crossCutting': return Fixture.crossCutting(call)
        default: return ''
      }
    })
    pipe = new GenerationPipeline({ library: lib, request: request({ verify: false }), agents })
    const s = await pipe.run()
    expect(sawQuestion).toBe(true)
    expect(s.aula2.state).toBe('done')
  })

  it('el tope de gasto para la ejecución entera y queda para reanudar («limit»)', async () => {
    const agents = scriptedAgents(async (task, call) => {
      switch (task.role) {
        case 'planner': await call('set_course_plan', Fixture.plan); return 'ok'
        case 'author':
          if (Fixture.skillID(task) === 'resta') throw new BudgetError({ type: 'reached', limit: 1, spent: 1.2 }, { resumesAt: Date.parse('2026-11-01T00:00:00Z'), midRun: true })
          return Fixture.author(task, call, false)
        default: return ''
      }
    })
    const s = await new GenerationPipeline({ library: lib, request: request({ verify: false, parallel: 1 }), agents }).run()
    expect(s.aula2.state).toBe('limit')
    expect(s.aula2.errorCode).toBe('ai_budget')
    expect(s.aula2.resumeAt).toBe('2026-11-01T00:00:00.000Z')
    expect(s.stages.crossCutting).toBe('pending')
  })

  it('sin red el plan falla tras UN reintento rápido, y el monitor dijo por qué esperaba', async () => {
    let calls = 0
    const waits: string[] = []
    const agents = scriptedAgents(async () => {
      calls++
      throw new AIError('network', 'Claude Code no pudo conectarse a internet. Revisa tu conexión e inténtalo de nuevo. Detalle: API Error: Connection refused (ECONNREFUSED)')
    })
    const started = Date.now()
    const pipe = new GenerationPipeline({
      library: lib, request: request({ verify: false }), agents,
      onChange: (p) => { const cur = p.currentState.aula2.lanes[0]?.current; if (cur && !waits.includes(cur)) waits.push(cur) }
    })
    const s = await pipe.run()
    expect(s.aula2.state).toBe('failed')
    expect(s.aula2.errorCode).toBe('ai_network')
    expect(s.failure).toContain('no pudo conectarse')
    expect(calls).toBe(2)
    expect(Date.now() - started).toBeLessThan(9_000)
    expect(waits).toContain('Sin conexión con la IA. Pruebo otra vez en 5 s…')
  }, 15_000)

  it('sin red durante la escritura se para la ejecución entera (no cada habilidad por su cuenta)', async () => {
    const roles: string[] = []
    const agents = scriptedAgents(async (task, call) => {
      roles.push(task.role)
      if (task.role === 'planner') { await call('set_course_plan', Fixture.plan); return 'ok' }
      throw new AIError('network', 'getaddrinfo ENOTFOUND api.anthropic.com')
    })
    const s = await new GenerationPipeline({ library: lib, request: request({ verify: false, parallel: 1 }), agents }).run()
    expect(s.aula2.state).toBe('failed')
    expect(s.failure).toContain('ENOTFOUND')
    // un reintento rápido del primer autor y ya: el segundo no llega a empezar
    expect(roles).toEqual(['planner', 'author', 'author'])
  }, 15_000)

  it('si la búsqueda en internet falla y no se guarda ninguna fuente, el informe lo dice', async () => {
    const offline = (): never => { throw new AIError('network', 'No pude conectar: fetch failed') }
    const web = { search: async () => offline(), fetch: async () => offline(), fetchData: async () => offline(), searchImages: async () => offline() }
    const agents = scriptedAgents(async (task, call) => {
      switch (task.role) {
        case 'planner':
          await call('save_web_source', { url: 'https://es.wikipedia.org/wiki/Suma', title: 'Wikipedia: Suma' })
          await call('set_course_plan', Fixture.plan); return 'ok'
        case 'author': return Fixture.author(task, call, false)
        case 'crossCutting': return Fixture.crossCutting(call)
        default: return ''
      }
    })
    const req = request({ verify: false })
    req.allowWeb = true
    const s = await new GenerationPipeline({ library: lib, request: req, agents, services: { web, importer: (st) => packImporter(st) } }).run()
    expect(s.aula2.state, s.failure).toBe('done')
    expect(s.aula2.web).toMatchObject({ ok: 0, failed: 1 })
    expect(s.aula2.notes[0]).toContain('La búsqueda en internet falló (no se pudo conectar con internet)')
    expect(s.aula2.researchNote).toBe(s.aula2.notes[0])
    const view = new GenerationService({ library: () => lib, agents: async () => agents }).view(s, undefined, store)
    expect(view.report?.researchNote).toBe(s.aula2.researchNote)
    expect(view.report?.notes[0]).toBe(s.aula2.researchNote)
  })

  it('detener una creación la deja en pausa (y no empiezan más agentes)', async () => {
    let pipe: GenerationPipeline | undefined
    const roles: string[] = []
    const agents = scriptedAgents(async (task, call) => {
      roles.push(task.role)
      if (task.role === 'planner') { await call('set_course_plan', Fixture.plan); pipe?.cancel(); return 'ok' }
      return Fixture.author(task, call, false)
    })
    pipe = new GenerationPipeline({ library: lib, request: request({ verify: false }), agents })
    const s = await pipe.run()
    expect(s.aula2.state).toBe('paused')
    expect(s.cancelled).toBe(true)
    expect(roles).toEqual(['planner'])
  })
})

describe('equipo de agentes', () => {
  it('escribe las habilidades en paralelo, verifica pronto y enlaza la práctica', async () => {
    const busy = new Concurrency()
    let tick = 0
    let firstVerifier = -1
    let lastAuthorDone = -1
    let authorsDone = 0
    const agents = scriptedAgents(async (task, call) => {
      busy.enter()
      try {
        await sleep(40)
        switch (task.role) {
          case 'planner': await call('set_course_plan', Fixture.plan); return 'Plan listo.'
          case 'author': return await TeamFixture.author(task, call)
          case 'crossCutting': return await TeamFixture.cross(task, call)
          case 'verifier': return await Fixture.solver(task, call, store, new Set())
          default: return ''
        }
      } finally { busy.leave() }
    })
    expect(usesTeam(teamRequest())).toBe(true)
    const pipe = new GenerationPipeline({
      library: lib, request: teamRequest(), agents, onChange: (p) => {
        tick++
        const lanes = p.currentState.aula2.lanes
        if (firstVerifier < 0 && lanes.some((l) => l.role === 'verifier')) firstVerifier = tick
        const done = lanes.filter((l) => l.role === 'author' && l.status === 'done').length
        if (done > authorsDone) { authorsDone = done; lastAuthorDone = tick }
      }
    })
    const s = await pipe.run()
    expect(s.aula2.state, s.failure).toBe('done')
    expect(s.skills.every((k) => k.status === 'done')).toBe(true)
    expect(s.aula2.verify.verified).toBe(16)
    const titles = new Set(s.aula2.lanes.map((l) => l.title))
    for (const t of ['Planificador', 'Lección · Sumar', 'Ejercicios · Sumar', 'Lección · Restar', 'Ejercicios · Restar', 'Glosario', 'Fórmulas y simulacro', 'Verificador · Sumar', 'Verificador · Restar']) {
      expect(titles.has(t), `falta el carril «${t}»: ${[...titles].join(', ')}`).toBe(true)
    }
    expect(s.aula2.lanes.every((l) => l.status === 'done' && l.provider && l.finishedAt)).toBe(true)
    expect(s.aula2.agents).toBe(s.aula2.lanes.length)
    // papeles de la interfaz (cada uno con su compañero pixel-art)
    const roles = new Set(s.aula2.lanes.map((l) => l.uiRole))
    for (const r of ['planner', 'lesson', 'exercises', 'verifier', 'glossary', 'formulas']) expect(roles.has(r as never), r).toBe(true)
    expect(busy.peak).toBeLessThanOrEqual(3)
    expect(busy.peak).toBeGreaterThanOrEqual(2)
    expect(s.aula2.peakAgents).toBeGreaterThanOrEqual(busy.peak)
    expect(s.aula2.peakAgents).toBeLessThanOrEqual(3)
    // la verificación de una habilidad empieza antes de que termine de escribirse la última
    expect(firstVerifier).toBeGreaterThan(0)
    expect(firstVerifier).toBeLessThan(lastAuthorDone)
    expect(new Set(doneStages(s))).toEqual(new Set(['prepare', 'plan', 'author', 'crossCutting', 'verify', 'polish']))
    // la app enlazó la práctica: «Pruébalo» tras el primer ejemplo, con ejercicios que existen
    const suma = store.loadSkill('suma')
    const tries = suma.lesson.filter((b) => b.type === 'tryit')
    expect(tries).toHaveLength(2)
    expect(tries[0].type === 'tryit' && tries[0].title).toBe('Pruébalo')
    const known = new Set(suma.exercises.map((e) => e.id))
    expect(tries.every((t) => t.type === 'tryit' && t.exerciseIDs.length > 0 && t.exerciseIDs.every((id) => known.has(id)))).toBe(true)
    const exampleAt = suma.lesson.findIndex((b) => b.type === 'example')
    expect(suma.lesson[exampleAt + 1].type).toBe('tryit')
  })

  it('los lectores fichan materiales grandes a la vez antes del planificador', async () => {
    const importer = packImporter(store)
    const ids: string[] = []
    for (const [i, topic] of ['fracciones', 'decimales', 'porcentajes'].entries()) {
      const body = `Capítulo ${i + 1}: ${topic}. Ejemplos y ejercicios de ${topic}.\n\n`.repeat(900)
      ids.push((await importer.importText(body, `Apuntes ${topic}`, 'official')).id)
    }
    const readers = new Concurrency()
    const agents = scriptedAgents(async (task, call) => {
      switch (task.role) {
        case 'reader': {
          readers.enter()
          try {
            await sleep(60)
            expect(task.system).not.toContain('write_lesson')
            const mine = ids.filter((id) => task.prompt.includes('`' + id + '`'))
            expect(mine.length).toBeGreaterThan(0)
            for (const sid of mine) await call('save_source_digest', { source_id: sid, kind: 'notes', summary: 'Apuntes del profesor.', topics: [`Tema de ${sid}`], formulas: ['$a/b$'] })
            // no puede fichar materiales de otro lector
            const other = ids.find((id) => !mine.includes(id))
            if (other) { const r = await call('save_source_digest', { source_id: other, summary: 'x', topics: ['x'] }); expect(isObj(r) && r.ok === false || typeof r === 'string').toBe(true) }
            return 'fichas'
          } finally { readers.leave() }
        }
        case 'planner':
          expect(task.prompt).toContain('Digests of the materials')
          for (const sid of ids) expect(task.prompt).toContain(`Tema de ${sid}`)
          await call('set_course_plan', Fixture.plan); return 'plan'
        case 'author': return TeamFixture.author(task, call)
        case 'crossCutting': return TeamFixture.cross(task, call)
        default: return ''
      }
    })
    const req = teamRequest(3, false)
    req.sourceIDs = ids
    const s = await new GenerationPipeline({ library: lib, request: req, agents }).run()
    expect(s.aula2.state, s.failure).toBe('done')
    expect(s.aula2.lanes.filter((l) => l.role === 'reader')).toHaveLength(2)
    expect(readers.peak).toBe(2)
    const pack = store.loadPack()
    expect(loadDigests(store, pack)).toHaveLength(3)
    // los autores reciben el mapa de materiales
    expect(materialsMap(req, { pack, firstChunk: () => undefined, digests: loadDigests(store, pack) })).toContain(`Tema de ${ids[0]}`)
  })

  it('con poco material el planificador lo lee directamente (sin lectores)', async () => {
    await packImporter(store).importText('Sumar y restar enteros. Ejemplos: 2+3=5.', 'Hoja', 'official')
    const agents = scriptedAgents(async (task, call) => {
      switch (task.role) {
        case 'reader': throw new Error('con poco material no hay lectores')
        case 'planner': await call('set_course_plan', Fixture.plan); return 'plan'
        case 'author': return TeamFixture.author(task, call)
        case 'crossCutting': return TeamFixture.cross(task, call)
        default: return ''
      }
    })
    const s = await new GenerationPipeline({ library: lib, request: teamRequest(3, false), agents }).run()
    expect(s.aula2.state, s.failure).toBe('done')
    expect(s.aula2.lanes.some((l) => l.role === 'reader')).toBe(false)
  })

  it('el avance no retrocede al detener ni al reanudar (68 % → 58 % en el informe del juez)', async () => {
    const req = makeRequest({ packID: store.id, title: 'Fracciones', topics: 'Suma de fracciones, resta de fracciones', depth: 'quick', allowWeb: false, maxParallel: 4 })
    const team = fakeTeamScript(req)
    let pipe: GenerationPipeline | undefined
    let peak = 0
    let verifiedAtStop = 0
    const svc = new GenerationService({ library: () => lib, agents: async () => scriptedAgents(team) })
    const shown = (p: GenerationPipeline): number => svc.view(p.currentState, undefined, p.store).progress
    // se detiene con alguna habilidad ya verificada (el contador de verificaciones solo vive en memoria)
    const agents = scriptedAgents(async (task, call) => {
      const out = await team(task, call)
      if (task.role === 'verifier' && pipe!.verifiedSkills === 0) await sleep(30)
      if ((task.role === 'crossCutting' || task.role === 'verifier') && pipe!.verifiedSkills >= 1 && !pipe!.signal.aborted) {
        verifiedAtStop = pipe!.verifiedSkills
        peak = Math.max(peak, runProgress(pipe!.currentState, false, pipe!.verifiedSkills))
        pipe!.cancel()
      }
      return out
    })
    pipe = new GenerationPipeline({ library: lib, request: req, agents, onChange: (p) => { peak = Math.max(peak, runProgress(p.currentState, false, p.verifiedSkills)) } })
    const stopped = await pipe.run()
    expect(stopped.aula2.state).toBe('paused')
    expect(verifiedAtStop).toBeGreaterThanOrEqual(1)
    expect(peak).toBeGreaterThan(0.3)
    // sin el contador de verificaciones en memoria el cálculo da menos; lo mostrado no baja
    expect(runProgress(stopped, false, 0)).toBeLessThan(peak)
    expect(svc.view(stopped, undefined, store).progress).toBeGreaterThanOrEqual(Math.round(peak * 1000) / 1000)
    const saved = GenerationPipeline.loadRun(store, pipe.runID)!
    expect(saved.aula2.progress).toBeGreaterThanOrEqual(Math.round(peak * 1000) / 1000)
    // al reanudar sigue desde ahí
    const resumed = new GenerationPipeline({ library: lib, request: req, agents: scriptedAgents(team), resumeRunID: pipe.runID })
    expect(shown(resumed)).toBeGreaterThanOrEqual(Math.round(peak * 1000) / 1000)
    const done = await resumed.run()
    expect(done.aula2.state, done.failure).toBe('done')
  })

  it('el equipo simulado de AULA_FAKE_AI crea un curso válido de punta a punta', async () => {
    const req = makeRequest({ packID: store.id, title: 'Fracciones', topics: 'Suma de fracciones, resta de fracciones', depth: 'quick', allowWeb: false, maxParallel: 4 })
    const s = await new GenerationPipeline({ library: lib, request: req, agents: scriptedAgents(fakeTeamScript(req)) }).run()
    expect(s.aula2.state, s.failure).toBe('done')
    const pack = store.loadPack()
    expect(pack.skills.map((r) => r.title)).toEqual(['Suma de fracciones', 'Resta de fracciones'])
    expect(pack.skills.every((r) => r.status === 'ready')).toBe(true)
    expect(pack.glossary.length).toBeGreaterThan(0)
    expect(pack.formulaSheet.length).toBeGreaterThan(0)
    expect(pack.blueprint?.sections.length).toBe(2)
    for (const r of pack.skills) {
      const k = store.loadSkill(r.id)
      expect(k.exercises.length).toBe(8)
      expect(k.cards.length).toBe(5)
      expect(k.mistakes.length).toBe(1)
      expect(k.issues.filter((i) => i.severity === 'error')).toEqual([])
      expect(k.exercises.every((e) => e.review?.state === 'verified')).toBe(true)
    }
  })
})

describe('equipo simulado en cada profundidad', () => {
  for (const depth of ['standard', 'deep'] as const) {
    it(`cumple los mínimos de «${depth}» a la primera (sin repasos)`, async () => {
      const req = makeRequest({ packID: store.id, title: 'Potencias', topics: 'Potencias y raíces', depth, allowWeb: false, maxParallel: 4, verifyAnswers: false })
      const s = await new GenerationPipeline({ library: lib, request: req, agents: scriptedAgents(fakeTeamScript(req)) }).run()
      expect(s.aula2.state, s.failure).toBe('done')
      expect(s.skills.map((k) => [k.status, k.attempts])).toEqual(s.skills.map(() => ['done', 1]))
    })
  }
})

describe('piezas del equipo', () => {
  it('la puerta limita y deja pasar antes lo urgente', async () => {
    const gate = new AgentGate(2)
    const order: string[] = []
    await gate.acquire('normal'); await gate.acquire('normal')
    const normal = gate.acquire('normal').then(() => order.push('normal'))
    await sleep(20)
    const urgent = gate.acquire('high').then(() => order.push('urgente'))
    await sleep(20)
    expect(order).toEqual([])
    gate.release()
    await urgent
    expect(order).toEqual(['urgente'])
    gate.release()
    await normal
    expect(order).toEqual(['urgente', 'normal'])
    expect(gate.peak).toBe(2)
  })

  it('el reparto de lectura equilibra el trabajo', () => {
    const g = readingGroups([{ id: 'a', characters: 200_000 }, { id: 'b', characters: 30_000 }, { id: 'c', characters: 30_000 }, { id: 'd', characters: 20_000 }, { id: 'e', characters: 10_000 }], 4)
    expect(g).toHaveLength(4)
    expect(g.find((x) => x.includes('a'))).toEqual(['a'])
    expect(new Set(g.flat())).toEqual(new Set(['a', 'b', 'c', 'd', 'e']))
    expect(readingGroups([{ id: 'a', characters: 5000 }, { id: 'b', characters: 4000 }], 4)).toHaveLength(1)
    expect(readingGroups([{ id: 'a', characters: 500_000 }, { id: 'b', characters: 400_000 }, { id: 'c', characters: 300_000 }], 2)).toHaveLength(2)
    expect(readingGroups([], 3)).toEqual([])
  })

  it('las peticiones antiguas se leen con el equipo activado y el paralelo acotado; el registro va y vuelve', () => {
    const json = '{"packID":"p","title":"T","subject":"","level":"","language":"es","goal":"","topics":"","examNotes":"","sourceIDs":[],"exampleSourceIDs":[],"userNotes":"","depth":"quick","allowWeb":true,"includeDecks":false,"verifyAnswers":true,"maxParallel":3,"mode":{"create":{}}}'
    const r = decodeRequest(JSON.parse(json))
    expect(r?.team).toBeUndefined()
    expect(r && usesTeam(r)).toBe(true)
    expect(makeRequest({ packID: 'p', title: 'T', maxParallel: 50 }).maxParallel).toBe(MAX_AGENTS)
    expect(languageName('ja')).toBe('Japanese')
    const ext = makeRequest({ packID: 'p', title: 'T', mode: { kind: 'extend', instruction: 'más', skill: 's' } })
    const st = { runID: 'run-20260101-000000-abc', request: ext, stages: { prepare: 'done', gather: 'skipped', plan: 'skipped', author: 'running', crossCutting: 'pending', verify: 'pending', polish: 'pending' }, skills: [], startedAt: '2026-01-01T00:00:00.000Z', usage: { promptTokens: 1, completionTokens: 2, reasoningTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 }, providerNames: {}, summaries: {}, cancelled: false, aula2: { lanes: [], verify: { verified: 0, fixed: 0, flagged: 0, disagreements: 0, skipped: 0 }, agents: 0, peakAgents: 0, notes: [] } } as const
    const enc = encodeRunState(st as never) as Record<string, unknown>
    expect((enc.request as Record<string, unknown>).mode).toEqual({ extend: { instruction: 'más', skill: 's' } })
    const back = decodeRunState(JSON.parse(JSON.stringify(enc)))
    expect(back?.request.mode).toEqual({ kind: 'extend', instruction: 'más', skill: 's' })
    expect(back?.stages.author).toBe('running')
  })
})
