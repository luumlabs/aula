// Practicar dentro del chat y del tutor (port de AssistantStudyTools.swift): cuestionarios que se corrigen con el mismo motor que la
// práctica, tarjetas que se giran ahí mismo, guardarlos en una lección (con permiso), la graficadora exacta y el conversor de
// unidades. Lo que la IA escribe pasa por el normalizador y el validador de las lecciones: lo inválido no se enseña.
import { analyzeGraph, clip, foldPlain, graphNumber, graphResultJSON, plotBlockFor, decodeAIBlock, type GraphResult } from '@engine/assistant'
import { IDs } from '@engine/base/ids'
import type { JSONValue } from '@engine/base/json'
import { ContentNormalizer } from '@engine/content/normalizer'
import type { ContentValidator } from '@engine/content/validator'
import { NumberFormat, UnitTable, unitQuantityName } from '@engine/math'
import { tr } from '@shared/ai/i18n'
import type { JSONObject } from '@shared/ai/json'
import type { AssistantStudySet } from '@shared/assistant/types'
import { decodeExercise, decodeFlashcard, type ContentIssue, type Exercise, type Flashcard } from '@shared/schema'
import type { AgentTool } from '../../ai/model'
import type { Library } from '../../store/library'
import type { ToolEnv } from '../host'
import { newCard, newStudySet } from '../models'
import { outError, outJSON, Schema, tool } from '../toolkit'
import { BLOCK_CATALOG, VISUAL_BLOCKS_BRIEF } from '../blockCatalog'
import { approval, enrichRef, fact, findCourse, showItems, unknownCourse } from './common'

export const EXERCISE_CHEAT_SHEET = 'Exercise objects (same as a course): {prompt (markdown, or blocks when it needs a figure), answer, level 1–3, hints [2–3, never the answer], solution (worked steps), wrongs [{input, why}]}. '
  + 'Answer kinds: choice {"kind":"choice","options":[{"id":"a","md":"…","correct":true,"why":"…"},…]} · numeric {"kind":"numeric","value":"3/4","unit":"m/s"} · '
  + 'expression {"kind":"expression","expected":"2*x+1"} · equation {"kind":"equation","expected":"y=2*x+1"} · set {"kind":"set","expected":["2","3"]} · '
  + 'interval {"kind":"interval","expected":"(-inf,3]"} · point {"kind":"point","expected":["1","-2"]} · short {"kind":"short","accepted":["mitocondria","mitochondria"]} · '
  + 'cloze {"kind":"cloze","text":"The [[1]] makes [[2]].","blanks":[{"accepted":["mitochondrion"]},{"accepted":["ATP"]}]} · ordering {"kind":"ordering","items":[in correct order]} · '
  + 'matching {"kind":"matching","pairs":[{"left":"…","right":"…"}]} · truefalse {"kind":"truefalse","value":false} · chem {"kind":"chem","mode":"formula|equation|name|number","expected":"Fe2O3"}.'

const errorsOf = (issues: ContentIssue[]): ContentIssue[] => issues.filter((i) => i.severity === 'error')
const issuesJSON = (issues: ContentIssue[], limit = 8): JSONValue[] => issues.slice(0, limit).map((i) => ({ severity: i.severity, path: i.path, message: i.message }))

export interface SavedStudySet { count: number; label: string; courseID: string; skillID: string }

/** Guarda los ejercicios y las tarjetas en la lección `skillID` del curso `courseID` (con ids nuevos; lo inválido se descarta).
 * Lo usan la herramienta y el botón «Guardar en el curso…» de la tarjeta (la pulsación del estudiante es el permiso). */
export function saveStudySet(set: AssistantStudySet, library: Library, courseID: string, skillID: string, validator: ContentValidator): SavedStudySet {
  const store = library.openPack(courseID)
  if (!store) throw new Error(tr('No encuentro ese curso.', "I can't find that course."))
  const pack = store.loadPack()
  const ref = pack.skills.find((s) => s.id === skillID) ?? pack.skills.find((s) => foldPlain(s.title) === foldPlain(skillID))
  if (!ref) throw new Error(tr('No encuentro esa lección en el curso.', "I can't find that lesson in the course."))
  const exercises: Exercise[] = []
  for (const e of set.exercises) {
    const x: Exercise = { ...e, id: `${ref.id}-aula-${IDs.short(6)}`, skill: ref.id }
    delete x.review
    if (!errorsOf(validator.checkExercise(x, 'chat')).length) exercises.push(x)
  }
  const cards: Flashcard[] = []
  for (const c of set.cards) {
    const y: Flashcard = { ...c, id: `${ref.id}-aula-${IDs.short(6)}`, skill: ref.id }
    if (!errorsOf(validator.checkCard(y, 'chat')).length) cards.push(y)
  }
  if (!exercises.length && !cards.length) throw new Error(tr('No había nada válido que guardar.', 'There was nothing valid to save.'))
  store.updateSkill(ref.id, (s) => {
    s.exercises.push(...exercises)
    s.cards.push(...cards)
    if (s.status === 'empty') s.status = 'draft'
  })
  return { count: exercises.length + cards.length, label: `${pack.title} · ${ref.title}`, courseID: pack.id, skillID: ref.id }
}

export function makeQuizTool(env: ToolEnv): AgentTool {
  return tool('make_quiz',
    'Create a short quiz (1–8 questions) the student solves RIGHT HERE in the chat: Aula grades each answer instantly with its exact engine, gives hints, explains the mistake and shows the worked solution. Use it to check understanding, to practise before an exam or when they ask «ponme ejercicios / hazme un test». Verify every key with `calculate` / `chemistry` first. Do NOT repeat the questions or answers in your text (the quiz card shows them); just introduce it in one line. Their results reach you with their next message. To keep it in a course use save_study_set (or they press «Guardar en el curso»). ' + EXERCISE_CHEAT_SHEET,
    Schema.object([
      ['title', Schema.string('short title, e.g. «Vértice de la parábola · 4 preguntas»')], ['exercises', Schema.array(Schema.free('Exercise object'), '1–8 exercises')],
      ['course_id', Schema.string('course where it would be saved, if it belongs to one')], ['skill_id', Schema.string('lesson where it would be saved')]
    ], ['title', 'exercises']),
    (a) => {
      const raw = a.array('exercises', ['questions', 'items'])
      if (!raw || !raw.length) return outError("Missing 'exercises' (an array of exercise objects).", EXERCISE_CHEAT_SHEET)
      const setID = IDs.short(8)
      const good: Exercise[] = []
      const report: JSONObject[] = []
      raw.slice(0, 8).forEach((r, i) => {
        const id = `q${setID}-${i + 1}`
        const ex = decodeExercise(ContentNormalizer.exercise(r, 'chat', id))
        if (!ex) { report.push({ index: i, shown: false, issues: [{ severity: 'error', path: '', message: 'Not a valid exercise object.' }] }); return }
        ex.id = id
        delete ex.review
        const issues = env.validator.checkExercise(ex, `exercises[${i}]`)
        const errs = errorsOf(issues)
        if (!errs.length) good.push(ex)
        if (issues.length) report.push({ index: i, shown: errs.length === 0, issues: issuesJSON(issues) })
      })
      if (!good.length) return outJSON({ ok: false, shown: 0, problems: report, fix: EXERCISE_CHEAT_SHEET })
      const title = a.string('title')?.trim() || tr('Pon a prueba lo que sabes', 'Test what you know')
      const courseID = a.string('course_id') ?? env.defaultCourseID
      const set = newStudySet(title, { id: setID, exercises: good, ...(courseID ? { courseID } : {}), ...(a.string('skill_id') ? { skillID: a.string('skill_id')! } : {}) })
      env.io.show(newCard('quiz', title, { icon: 'checklist', state: 'done', studySet: set, allowsOther: false }))
      const o: JSONObject = { ok: true, set_id: setID, shown: good.length, note: "The quiz is on screen. Introduce it in ONE short line and stop; don't list the questions or answers." }
      if (report.length) o.problems = report
      return outJSON(o)
    })
}

export function makeFlashcardsTool(env: ToolEnv): AgentTool {
  return tool('make_flashcards',
    "Create flashcards (2–16) the student can flip right here in the chat: definitions, formulas with WHEN to use them, distinctions, typical mistakes, vocabulary, anatomy terms… One idea per card; Markdown + $LaTeX$. kind: basic (front/back), cloze (front contains {{c1::answer}}), reversible. Don't repeat them in your text. To keep them for spaced repetition use save_study_set (or they press «Guardar en el curso»).",
    Schema.object([
      ['title', Schema.string()], ['cards', Schema.array(Schema.free('{front, back, kind?: basic|cloze|reversible, hint?}'))], ['course_id', Schema.string('course where they would be saved')],
      ['skill_id', Schema.string('lesson where they would be saved')]
    ], ['title', 'cards']),
    (a) => {
      const raw = a.array('cards', ['flashcards', 'items'])
      if (!raw || !raw.length) return outError("Missing 'cards' (an array of {front, back}).")
      const setID = IDs.short(8)
      const good: Flashcard[] = []
      let rejected = 0
      raw.slice(0, 16).forEach((r, i) => {
        const id = `c${setID}-${i + 1}`
        const c = decodeFlashcard(ContentNormalizer.card(r, 'chat', id))
        if (!c) { rejected++; return }
        c.id = id
        if (errorsOf(env.validator.checkCard(c, `cards[${i}]`)).length) rejected++
        else good.push(c)
      })
      if (!good.length) return outError('No valid cards: each needs a non-empty front and back (cloze: {{c1::…}} in the front).')
      const title = a.string('title')?.trim() || tr('Tarjetas de repaso', 'Review cards')
      const courseID = a.string('course_id') ?? env.defaultCourseID
      const set = newStudySet(title, { id: setID, cards: good, ...(courseID ? { courseID } : {}), ...(a.string('skill_id') ? { skillID: a.string('skill_id')! } : {}) })
      env.io.show(newCard('flashcards', title, { icon: 'rectangle.stack', state: 'done', studySet: set, allowsOther: false }))
      return outJSON({ ok: true, set_id: setID, shown: good.length, rejected, note: 'The cards are on screen. One short line is enough.' })
    })
}

export function saveStudySetTool(env: ToolEnv): AgentTool {
  return tool('save_study_set',
    'Save a quiz (make_quiz) or flashcards (make_flashcards) shown in this conversation into a lesson of a course, so they come back in practice and spaced repetition. Shows a confirmation card. Use the set_id the tool returned.',
    Schema.object([['set_id', Schema.string()], ['course_id', Schema.string()], ['skill_id', Schema.string('the lesson')]], env.defaultCourseID ? ['set_id', 'skill_id'] : ['set_id', 'course_id', 'skill_id']),
    async (a) => {
      const sid = a.string('set_id', ['id', 'quiz_id'])
      const set = sid ? env.studySets(sid) : undefined
      if (!set) return outError('Unknown set_id. Use the set_id returned by make_quiz / make_flashcards in this conversation.')
      const c = findCourse(env, a.string('course_id') ?? set.courseID ?? env.defaultCourseID)
      if (!c) return unknownCourse(env, a.string('course_id'))
      const skillArg = a.string('skill_id') ?? set.skillID
      const ref = skillArg ? c.pack.skills.find((s) => s.id === skillArg) ?? c.pack.skills.find((s) => foldPlain(s.title) === foldPlain(skillArg)) : undefined
      if (!ref) return outError(`Unknown lesson. Lessons of «${c.pack.title}»: ` + c.pack.skills.slice(0, 30).map((s) => `${s.id} («${s.title}»)`).join(', '))
      const what = set.exercises.length ? tr(`${set.exercises.length} ejercicios`, `${set.exercises.length} exercises`) : tr(`${set.cards.length} tarjetas de repaso`, `${set.cards.length} review cards`)
      const no = await approval(env, tr('Guardar en el curso', 'Save to the course'), [fact(tr('Qué', 'What'), `${set.title} · ${what}`), fact(tr('Curso', 'Course'), c.pack.title), fact(tr('Lección', 'Lesson'), ref.title)],
        tr('Guardar', 'Save'), 'square.and.arrow.down')
      if (no) return no
      try {
        const saved = saveStudySet(set, env.library, c.pack.id, ref.id, env.validator)
        set.savedTo = saved.label
        showItems(env, tr('Guardado en tu curso', 'Saved to your course'), [enrichRef(env, { kind: 'lesson', courseID: c.pack.id, itemID: ref.id, title: ref.title, subtitle: c.pack.title })], 'checkmark.circle')
        env.courseChanged?.(c.pack.id)
        return outJSON({ ok: true, saved: saved.count, where: saved.label })
      } catch (err) {
        return outError(`Could not save: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

export function graphFunctionTool(env: ToolEnv): AgentTool {
  return tool('graph_function',
    'Exact graphing calculator (Aula\'s own math engine): for one or more functions y = f(x) it finds the zeros, maxima and minima, the y-intercept and jumps/asymptotes in [x_min, x_max], and returns a ready `plot_block` you can paste as a ```aula-block``` (adjust labels if you like). Use it before drawing or discussing a graph so the points you mark are right. Functions use x: "x^2-4x+3", "sin(x)", "1/(x-2)", "e^(-x^2)". Values like "pi", "2pi", "-3/2" are fine.',
    Schema.object([
      ['functions', Schema.array(Schema.string(), '1–4 expressions in x')], ['x_min', Schema.string('default -10 (or -2pi for trig)')], ['x_max', Schema.string('default 10 (or 2pi for trig)')],
      ['degrees', Schema.boolean('trig in degrees (default false)')], ['labels', Schema.array(Schema.string(), 'curve labels, optional')]
    ], ['functions']),
    (a) => {
      const exprs = (a.strings('functions') ?? (a.string('function', ['expr', 'f']) ? [a.string('function', ['expr', 'f'])!] : [])).map((e) => e.trim()).filter((e) => e)
      if (!exprs.length) return outError('Missing \'functions\' (e.g. ["x^2-4x+3"]).')
      const degrees = a.bool('degrees') ?? false
      const trig = !degrees && exprs.some((e) => ['sin', 'cos', 'tan', 'sec', 'csc', 'cot'].some((t) => e.toLowerCase().includes(t)))
      const lo = (a.string('x_min') ? graphNumber(a.string('x_min')!) : undefined) ?? (trig ? -2 * Math.PI : -10)
      const hi = (a.string('x_max') ? graphNumber(a.string('x_max')!) : undefined) ?? (trig ? 2 * Math.PI : 10)
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return outError('x_max must be greater than x_min.')
      if (Math.abs(lo) > 1e9 || Math.abs(hi) > 1e9) return outError('x_min and x_max must be between -1e9 and 1e9.')
      const labels = a.strings('labels') ?? []
      const curves: GraphResult[] = []
      for (const [i, e] of exprs.slice(0, 4).entries()) {
        try {
          curves.push(analyzeGraph(e, lo, hi, degrees, labels[i], trig))
        } catch (err) {
          return outError(`«${e}»: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      const block = plotBlockFor(curves, lo, hi, degrees, trig)
      const o: JSONObject = { ok: true, x_range: [lo, hi], functions: curves.map(graphResultJSON) }
      // el bloque se comprueba con el mismo validador que las lecciones: si se dibuja aquí, se dibuja en el chat
      const b = decodeAIBlock(block)
      if (b && !errorsOf(env.validator.checkBlock(b, 'graph')).length) o.plot_block = block
      o.tip = 'Exact values: check them with calculate (e.g. the vertex x = -b/(2a)). Show the plot_block as a ```aula-block``` fenced block.'
      return outJSON(o)
    })
}

export function convertUnitsTool(): AgentTool {
  return tool('convert_units',
    "Convert a quantity between units (Aula's unit converter: length, mass, time, speed, area, volume, pressure, energy, power, temperature, amount of substance, concentration, data…). Examples: 12 km/h → m/s, 98.6 °F → °C, 2.5 atm → kPa, 500 mL → L. 3 mg/dL → mmol/L is NOT a unit conversion (needs a molar mass: use chemistry).",
    Schema.object([['value', Schema.string('number or expression, e.g. 12, 3/4, 6.02e23')], ['from', Schema.string('unit, e.g. km/h')], ['to', Schema.string('unit, e.g. m/s')]], ['value', 'from', 'to']),
    (a) => {
      const rawValue = a.string('value'), from = a.string('from')?.trim(), to = a.string('to')?.trim()
      if (!rawValue || !from || !to) return outError("Missing 'value', 'from' or 'to'.")
      const v = graphNumber(rawValue)
      if (v === undefined) return outError(`'value' is not a number: ${rawValue}`)
      const f = UnitTable.parse(from)
      if (!f) return outError(`Unknown unit «${from}».`)
      const t = UnitTable.parse(to)
      if (!t) return outError(`Unknown unit «${to}».`)
      const r = UnitTable.convertUnits(v, f, t)
      if (r === null) return outError(`«${from}» (${unitQuantityName(f)}) and «${to}» (${unitQuantityName(t)}) measure different things; they can't be converted directly.`)
      const text = NumberFormat.significant(r, 10)
      return outJSON({ ok: true, value: v, from, to, result: r, result_text: `${rawValue} ${from} = ${text} ${to}`, quantity: unitQuantityName(f) })
    })
}

/** El detalle de un tipo de bloque (lo que dice el catálogo de él), bajo demanda. */
export function blockReferenceTool(): AgentTool {
  return tool('block_reference',
    'The exact JSON shape of one Aula block type (as in the lessons): its schema line from the catalog and the rules. Call it before writing a block you are not sure about (labeled, model3d, simulation, map, timeline, diagram with steps…).',
    Schema.object([['type', Schema.string('block type, e.g. plot, table, diagram, timeline, labeled, model3d, simulation, map')]], ['type']),
    (a) => {
      const type = (a.string('type') ?? '').trim()
      if (!type) return outError("Missing 'type'.")
      const lines = BLOCK_CATALOG.split('\n').filter((l) => l.includes(`"type":"${type}"`))
      const brief = VISUAL_BLOCKS_BRIEF.split('\n').filter((l) => l.includes(`\`${type}\``))
      if (!lines.length && !brief.length) return outError(`Unknown block type «${type}».`, 'Use one of the types in the block catalog of the instructions.')
      return outJSON({ ok: true, type, schema: [...lines, ...brief].map((l) => clip(l, 3000)), rules: 'ONE JSON block per ```aula-block``` fence; double every backslash inside JSON strings; keep labels short.' })
    })
}
