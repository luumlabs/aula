// Equipo simulado (`AULA_FAKE_AI=1` y pruebas): cada agente «actúa» llamando a las herramientas REALES con contenido
// preparado (aritmética sencilla), así se recorre de verdad todo el camino —validación, enlaces de «Pruébalo», verificación
// independiente, glosario, simulacro y registro— sin red ni claves. Port de `FakeAgents`/`Fixture` de las pruebas Swift.
import { IDs } from '@engine/base/ids'
import { DEPTHS, type GenerationRequest } from '@engine/pipeline'
import type { AgentScript, AgentTask } from './agents'

type Call = (name: string, args: unknown) => Promise<unknown>
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** «SKILL_ID: suma» en el prompt (lo ponen los prompts de autor, solucionador y árbitro). */
export function skillIDIn(prompt: string): string | undefined {
  const m = /SKILL_ID: ([a-z0-9-]+)/.exec(prompt)
  return m?.[1]
}

const has = (task: AgentTask, name: string): boolean => task.tools.some((t) => t.name === name)

/** Los temas del temario («Suma, resta y fracciones» → tres habilidades); como mucho cuatro. */
export function fakeSkillTitles(request: Pick<GenerationRequest, 'topics' | 'title' | 'language'>): string[] {
  const en = request.language.startsWith('en')
  const parts = request.topics.split(/[\n,;·•]|\s+(?:y|and|e)\s+/u).map((s) => s.replace(/^[-*\d.)\s]+/, '').trim()).filter((s) => s.length > 1)
  const unique = [...new Set(parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)))].slice(0, 4)
  if (unique.length >= 2) return unique
  if (unique.length === 1) return [unique[0], en ? `${unique[0]}: practice` : `${unique[0]}: práctica`]
  return en ? ['Foundations', 'Practice'] : ['Fundamentos', 'Práctica']
}

/** Ids de las habilidades del plan simulado (en orden). */
function planIDs(request: GenerationRequest): string[] {
  const used: string[] = []
  fakeSkillTitles(request).forEach((t, i) => {
    let id = IDs.slug(t, 32)
    if (used.includes(id)) id = `${id}-${i + 1}`
    used.push(id)
  })
  return used
}

/** La asignatura que pondría el planificador si no la dieron (por el título y los temas; vacía si no se sabe). */
export function fakeSubject(request: Pick<GenerationRequest, 'title' | 'topics' | 'language'>): string {
  const en = request.language.startsWith('en')
  const text = `${request.title} ${request.topics}`.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
  const table: Array<[RegExp, string, string]> = [
    [/\b(math\w*|matem\w*|trig\w*|algebra|calculus|calculo|geometr\w*|statistic\w*|estadistica)\b/, 'Mathematics', 'Matemáticas'],
    [/\b(chem\w*|quimica)\b/, 'Chemistry', 'Química'],
    [/\b(physics|fisica)\b/, 'Physics', 'Física'],
    [/\b(bio\w*|anatom\w*|cell|celula)\b/, 'Biology', 'Biología'],
    [/\b(aws|cloud|nube|programming|programacion|python|javascript|code|software|computing|informatica)\b/, 'Computing', 'Informática'],
    [/\b(english|ingles|spanish|espanol|french|frances|german|aleman|language|idioma)\b/, 'Languages', 'Idiomas'],
    [/\b(history|historia)\b/, 'History', 'Historia']
  ]
  const hit = table.find(([re]) => re.test(text))
  return hit ? (en ? hit[1] : hit[2]) : ''
}

function plan(request: GenerationRequest): Obj {
  const titles = fakeSkillTitles(request)
  const ids = planIDs(request)
  const skills = titles.map((t, i) => {
    const s: Obj = { id: ids[i], title: t, objectives: [t], weight: 1, minutes: 15 }
    if (i > 0) s.prerequisites = [ids[0]]
    return s
  })
  const en = request.language.startsWith('en')
  const p: Obj = {
    title: request.title, subject: request.subject || fakeSubject(request), language: request.language,
    guidance: en ? 'Short, clear steps.' : 'Pasos cortos y claros.', units: [{ id: 'u1', title: request.title || (en ? 'Unit 1' : 'Unidad 1'), skills }]
  }
  if (request.examDate) p.exam = { title: request.goal || (en ? 'Exam' : 'Examen'), date: request.examDate.slice(0, 10), duration_minutes: 60, total_points: 100 }
  return p
}

function lesson(title: string, en: boolean, minBlocks: number): Obj {
  const extra = Array.from({ length: Math.max(0, minBlocks - 9) }, (_, i) => (en ? `Idea ${i + 3}: check each step before moving on.` : `Idea ${i + 3}: comprueba cada paso antes de seguir.`))
  return {
    blocks: [
      `# ${title}`,
      { type: 'predict', question: en ? 'What is 2+2?' : '¿Cuánto es 2+2?', options: [{ md: '4', correct: true, why: en ? 'Basic addition' : 'Suma básica' }, { md: '5', correct: false, why: en ? 'Counting slip' : 'Error de conteo' }], explanation: en ? 'It is 4.' : 'Es 4.' },
      en ? `In this lesson you will practise **${title}** step by step.` : `En esta lección practicarás **${title}** paso a paso.`,
      { type: 'callout', kind: 'definition', title: en ? 'Addition' : 'Suma', md: en ? 'Combining quantities.' : 'Combinar cantidades.' },
      { type: 'math', tex: 'a+b=c', label: en ? 'Addition' : 'Suma' },
      { type: 'example', problem: en ? 'Work out $2+3$.' : 'Calcula $2+3$.', steps: [{ md: en ? 'Start at 2' : 'Empieza en 2', note: en ? 'The first addend' : 'El primer sumando' }, { md: en ? 'Count on 3: 3, 4, 5' : 'Cuenta 3 más: 3, 4, 5', note: en ? 'Count on' : 'Contar' }], answer: '$5$' },
      en ? 'Another idea: the order does not change the sum.' : 'Otra idea: el orden no cambia la suma.',
      ...extra,
      { type: 'callout', kind: 'mistake', md: en ? "Don't forget to carry." : 'No olvides llevar.' },
      { type: 'recap', points: en ? ['Adding combines', 'Practise'] : ['Sumar combina', 'Practica'] }
    ]
  }
}

function exercises(skill: string, count: number, from: number, en: boolean): Obj {
  const items: Obj[] = []
  for (let k = from; k < from + count; k++) {
    // ids fijos: repetir la tarea (un repaso) sustituye en vez de duplicar
    const id = `${skill}-e${k - from + 1}`
    switch (k % 3) {
      case 0:
        items.push({ id, question: en ? `What is ${k}+${k}?` : `¿Cuál es el resultado de ${k}+${k}?`, options: [String(k), String(2 * k), String(3 * k)], answer: 'B', level: 2,
          hints: [en ? 'Add the number to itself' : 'Suma el número consigo mismo'], solution: `${k}+${k}=${2 * k}.`, wrongs: [] })
        break
      case 1:
        items.push({ id, prompt: en ? `Work out $${k}+10$.` : `Calcula $${k}+10$.`, answer: { kind: 'numeric', value: String(k + 10) }, level: 1, hints: [en ? 'Add' : 'Suma'],
          solution: `${k}+10=${k + 10}.`, wrongs: [{ input: String(k), why: en ? 'Forgot to add 10' : 'Olvidó sumar 10' }] })
        break
      default:
        items.push({ id, prompt: en ? `What is the operation of combining quantities called (e.g. ${k})?` : `¿Cómo se llama la operación de combinar cantidades (ej. ${k})?`,
          answer: { kind: 'short', accepted: en ? ['addition', 'sum'] : ['suma', 'adición'] }, level: 3, hints: [en ? 'It starts with a' : 'Empieza con s'], solution: en ? 'It is addition.' : 'Es la suma.' })
    }
  }
  return { exercises: items }
}

function cards(skill: string, count: number, from: number, en: boolean): Obj {
  const base = en
    ? [{ front: 'What is adding?', back: 'Combining' }, { front: 'Commutative?', back: '$a+b=b+a$' }, { front: 'Identity?', back: '0' }, { front: 'Associative?', back: '$(a+b)+c=a+(b+c)$' }]
    : [{ front: '¿Qué es sumar?', back: 'Combinar' }, { front: '¿Conmutativa?', back: '$a+b=b+a$' }, { front: '¿Neutro?', back: '0' }, { front: '¿Asociativa?', back: '$(a+b)+c=a+(b+c)$' }]
  const list = Array.from({ length: Math.max(count, base.length) }, (_, i) => {
    const c = i < base.length ? base[i] : { front: en ? `What is ${from + i}+${from + i}?` : `¿Cuánto es ${from + i}+${from + i}?`, back: String(2 * (from + i)) }
    return { id: `${skill}-c${i + 1}`, ...c }
  })
  return { cards: list }
}

function mistakes(en: boolean): Obj {
  return { mistakes: [{ title: en ? 'Forgetting to carry' : 'Olvidar llevarse', wrong: '$18+5=13$', right: '$18+5=23$', why: en ? 'The tens are lost.' : 'Se pierden las decenas.' }] }
}

const glossary = (en: boolean): Obj => ({ entries: en
  ? [{ term: 'Addition', definition: 'Operation that combines quantities.' }, { term: 'Subtraction', definition: 'Inverse operation of addition.' }]
  : [{ term: 'Suma', definition: 'Operación que combina cantidades.' }, { term: 'Resta', definition: 'Operación inversa de la suma.' }] })

const formulas = (en: boolean): Obj => ({ groups: [{ title: en ? 'Basics' : 'Básicas', items: [{ name: en ? 'Commutative' : 'Conmutativa', tex: 'a+b=b+a' }] }] })

async function blueprint(call: Call, en: boolean): Promise<void> {
  const course = await call('get_course', {})
  const ids = isObj(course) && Array.isArray(course.skills) ? course.skills.filter(isObj).map((s) => String(s.id)) : []
  if (!ids.length) return
  const sections = ids.map((id) => ({ title: id, skill_ids: [id], count: 2, points_each: 10 }))
  await call('set_exam_blueprint', { duration_minutes: 60, total_points: sections.length * 20, sections, pass_percent: 50 })
  void en
}

/** Un autor según las herramientas que recibió: la lección, la práctica o la habilidad entera (repaso). */
async function author(task: AgentTask, call: Call, en: boolean, request: GenerationRequest): Promise<string> {
  const id = skillIDIn(task.prompt) ?? ''
  const d = DEPTHS[request.depth]
  // cada habilidad con sus propios números (sin enunciados repetidos entre habilidades)
  const from = 1 + Math.max(0, planIDs(request).indexOf(id)) * 20
  const titleOf = async (): Promise<string> => {
    const s = await call('get_skill', { skill_id: id })
    return isObj(s) && typeof s.title === 'string' ? s.title : id
  }
  const lessonTools = has(task, 'write_lesson')
  const practiceTools = has(task, 'add_exercises')
  if (lessonTools) {
    await call('write_lesson', { skill_id: id, ...lesson(await titleOf(), en, d.minLessonBlocks) })
    await call('add_cards', { skill_id: id, ...cards(id, Math.max(5, d.minCards), from, en) })
    await call('set_common_mistakes', { skill_id: id, ...mistakes(en) })
  }
  if (practiceTools) await call('add_exercises', { skill_id: id, ...exercises(id, Math.max(8, d.minExercises), from, en) })
  await call('validate_skill', { skill_id: id, scope: lessonTools && practiceTools ? 'all' : lessonTools ? 'lesson' : 'practice' })
  await call('finish', { summary: en ? `Topic ${id} written.` : `Tema ${id} escrito.` })
  return en ? 'Done.' : 'Listo.'
}

/** Resuelve de verdad lo que puede (sumas sencillas) a partir del enunciado, sin ver las claves. */
export function solveFake(ex: Obj): string {
  const prompt = typeof ex.prompt === 'string' ? ex.prompt : ''
  const m = /(\d+)\s*\+\s*(\d+)/.exec(prompt)
  const sum = m ? String(Number(m[1]) + Number(m[2])) : ''
  if (ex.kind === 'choice' && Array.isArray(ex.options)) {
    const hit = ex.options.filter(isObj).find((o) => String(o.text).replace(/\$/g, '').trim() === sum)
    return hit ? String(hit.id) : String(isObj(ex.options[0]) ? ex.options[0].id : 'a')
  }
  if (ex.kind === 'short') return /combining/i.test(prompt) ? 'addition' : /combinar/i.test(prompt) ? 'suma' : '?'
  if (ex.kind === 'truefalse') return 'true'
  return sum || '0'
}

async function solver(task: AgentTask, call: Call, en: boolean): Promise<string> {
  const id = skillIDIn(task.prompt)
  const list = await call('list_exercises_to_solve', id ? { skill_id: id } : {})
  const items = isObj(list) && Array.isArray(list.exercises) ? list.exercises.filter(isObj) : []
  for (const ex of items) await call('submit_solution', { skill_id: id, exercise_id: ex.id, answer: solveFake(ex), work: en ? 'worked out' : 'calculado' })
  return en ? 'Solved.' : 'Resuelto.'
}

async function adjudicator(task: AgentTask, call: Call, en: boolean): Promise<string> {
  const id = skillIDIn(task.prompt)
  const d = await call('list_disagreements', id ? { skill_id: id } : {})
  const items = isObj(d) && Array.isArray(d.disagreements) ? d.disagreements.filter(isObj) : []
  for (const item of items) {
    const exID = isObj(item.exercise) ? item.exercise.id : item.exercise_id
    await call('resolve_disagreement', { skill_id: id, exercise_id: exID, verdict: 'solver_wrong', note: en ? 'The key is correct.' : 'La clave es correcta.' })
  }
  return en ? 'Disagreements settled.' : 'Arbitraje hecho.'
}

async function reader(task: AgentTask, call: Call, en: boolean): Promise<string> {
  const list = await call('list_sources', {})
  const sources = isObj(list) && Array.isArray(list.sources) ? list.sources.filter(isObj) : []
  for (const s of sources) {
    const sid = String(s.id)
    if (!task.prompt.includes('`' + sid + '`')) continue
    await call('save_source_digest', { source_id: sid, kind: 'notes', summary: en ? `Material “${String(s.title ?? sid)}”.` : `Material «${String(s.title ?? sid)}».`, topics: [String(s.title ?? sid)], formulas: [] })
  }
  return en ? 'Materials read.' : 'Materiales leídos.'
}

async function extender(task: AgentTask, call: Call, en: boolean): Promise<string> {
  let id = skillIDIn(task.prompt) ?? /concerns the skill `([^`]+)`/.exec(task.prompt)?.[1]
  if (!id) {
    const course = await call('get_course', {})
    const first = isObj(course) && Array.isArray(course.skills) ? course.skills.find(isObj) : undefined
    id = first ? String(first.id) : undefined
  }
  if (!id) return en ? 'Nothing to change.' : 'Nada que cambiar.'
  const s = await call('get_skill', { skill_id: id })
  const existing = isObj(s) && Array.isArray(s.exercises) ? s.exercises.length : 0
  const more = exercises(id, 3, 200 + existing, en)
  // ids nuevos (los asigna la app) para no sustituir los que ya hay
  await call('add_exercises', { skill_id: id, exercises: (more.exercises as Obj[]).map(({ id: _drop, ...rest }) => rest) })
  if (/tarjeta|card|flash/i.test(task.prompt)) await call('add_cards', { skill_id: id, cards: [{ front: en ? 'What is 100+100?' : '¿Cuánto es 100+100?', back: '200' }] })
  await call('validate_skill', { skill_id: id })
  await call('finish', { summary: en ? 'Added 3 exercises.' : 'Añadí 3 ejercicios.' })
  return en ? 'Added 3 exercises.' : 'Añadí 3 ejercicios.'
}

/** El guion del equipo simulado para una ejecución. `delayMs` hace que los agentes se solapen (el monitor se ve trabajar). */
export function fakeTeamScript(request: GenerationRequest, opts: { delayMs?: number } = {}): AgentScript {
  const en = request.language.startsWith('en')
  const pause = (): Promise<void> => (opts.delayMs ? new Promise((r) => setTimeout(r, opts.delayMs)) : Promise.resolve())
  return async (task, call) => {
    await pause()
    switch (task.role) {
      case 'planner':
        if (has(task, 'note_progress')) await call('note_progress', { message: en ? 'Designing the course' : 'Diseñando el curso' })
        await call('set_course_plan', plan(request))
        return en ? 'Plan ready.' : 'Plan listo.'
      case 'reader': return reader(task, call, en)
      case 'gatherer': return en ? 'Nothing found.' : 'No encontré nada.'
      case 'author': {
        const r = await author(task, call, en, request)
        await pause()
        return r
      }
      case 'crossCutting':
        if (task.prompt.includes('# Task: GLOSSARY (team mode')) { await call('set_glossary', glossary(en)); return en ? 'Glossary ready.' : 'Glosario listo.' }
        if (task.prompt.includes('FORMULA SHEET and MOCK-EXAM BLUEPRINT (team mode')) { await call('set_formula_sheet', formulas(en)); await blueprint(call, en); return en ? 'Formula sheet and mock exam ready.' : 'Fórmulas y simulacro listos.' }
        await call('set_glossary', glossary(en)); await call('set_formula_sheet', formulas(en)); await blueprint(call, en)
        return en ? 'Done.' : 'Listo.'
      case 'verifier': return solver(task, call, en)
      case 'adjudicator': return adjudicator(task, call, en)
      case 'extender': return extender(task, call, en)
      default: return ''
    }
  }
}
