// Port de Tests/StudyEngineTests/LearningControllerTests.swift.
import { describe, expect, it } from 'vitest'
import { decodeSkillProgress, encodeSkillProgress, makeAttempt, makeLearningConcept, makeReviewMark, makeSkillProgress, type Block, type Exercise, type Skill, type SkillProgress } from '@shared/schema'
import { invalidGrade, makeGrade, type GradeResult } from '@engine/grading'
import { LearningController as LC } from './learning'
import type { LearningConcept } from './types'
import { correct, exercise, numeric, recap, sumSkill, template, templateVar, text, tryIt } from './testutil'

const conceptOf = (skill: Skill): LearningConcept => { const c = LC.concepts(skill)[0]; expect(c).toBeDefined(); return c }
const reload = (p: SkillProgress): SkillProgress => decodeSkillProgress(JSON.parse(JSON.stringify(encodeSkillProgress(p))))!

/** Prepara la pregunta y la contesta bien; devuelve la fase y el progreso nuevo. */
function answer(concept: LearningConcept, skill: Skill, progress: SkillProgress, result: GradeResult = correct): { phase: string; progress: SkillProgress } {
  const prepared = LC.prepareCheck(concept, skill, progress)
  expect(prepared.exercise).toBeDefined()
  const r = LC.recordCheck(concept, skill, prepared.exercise!, result, { hints: 0, revealed: false }, prepared.progress)
  return { phase: r.phase, progress: r.progress }
}

describe('LearningController', () => {
  it('enseña antes de dos comprobaciones independientes y leer nunca cuenta', () => {
    const skill = sumSkill(), concept = conceptOf(skill)
    let p = makeSkillProgress({ lessonDone: true })
    expect(LC.status(concept, p)).toBe('explanation')
    expect(LC.nextCheck(concept, skill, p)).toBeUndefined()
    expect(LC.isMastered(skill, p)).toBe(false)
    const ack = LC.acknowledgeExplanation(concept, skill, p)
    expect(ack.exercise).toBeDefined()
    p = ack.progress
    let r = answer(concept, skill, p); p = r.progress
    expect(r.phase).toBe('check')
    expect(LC.canAdvance(concept, p)).toBe(false)
    r = answer(concept, skill, p); p = r.progress
    expect(r.phase).toBe('mastered')
    expect(LC.isMastered(skill, p)).toBe(true)
    expect(p.learning[concept.id].successfulChecks.length).toBe(2)
    expect(p.lessonDone).toBe(true)
  })

  it('un error reexplica con la solución y otro ejemplo resuelto antes de preguntas nuevas', () => {
    const skill = sumSkill(), concept = conceptOf(skill)
    const ack = LC.acknowledgeExplanation(concept, skill, undefined)
    const failed = ack.exercise!
    const result = makeGrade('incorrect', 0, { feedback: [{ kind: 'explanation', markdown: 'Has quitado dos en lugar de añadirlos.' }] })
    const r = LC.recordCheck(concept, skill, failed, result, { hints: 0, revealed: false }, ack.progress)
    expect(r.phase).toBe('reteach')
    let p = r.progress
    expect(LC.nextCheck(concept, skill, p)).toBeUndefined()
    const blocks = LC.remediationBlocks(concept, skill, p)
    expect(blocks.some((b) => b.type === 'text' && b.md.includes('Has quitado'))).toBe(true)
    expect(blocks.some((b) => b.type === 'text' && b.md.includes('Respuesta comprobada'))).toBe(true)
    expect(r.remediation.length).toBe(blocks.length)
    const alt = blocks.find((b): b is Extract<Block, { type: 'example' }> => b.type === 'example')
    expect(alt).toBeDefined()
    expect(alt!.problem).toContain('2 y 2')
    expect(alt!.steps.length).toBeGreaterThan(0)
    expect(alt!.answer).toBe('$4$')
    const fresh = LC.acknowledgeExplanation(concept, skill, p)
    expect(fresh.exercise?.id).toBe('e3')
    p = fresh.progress
    let a = answer(concept, skill, p); p = a.progress
    expect(a.phase).toBe('check')
    a = answer(concept, skill, p)
    expect(a.phase).toBe('mastered')
  })

  it('pistas y ver la solución invalidan la pregunta al instante y sobreviven a recargar', () => {
    for (const [hints, revealed] of [[1, false], [0, true]] as const) {
      const skill = sumSkill(), concept = conceptOf(skill)
      const ack = LC.acknowledgeExplanation(concept, skill, undefined)
      const r = LC.recordAssistance(concept, skill, ack.exercise!, { hints, revealed }, ack.progress)
      expect(r.phase).toBe('reteach')
      expect(r.progress.learning[concept.id].activeExercise).toBeUndefined()
      const restored = reload(r.progress)
      expect(LC.status(concept, restored)).toBe('reteach')
      expect(restored.learning[concept.id].attemptedChecks).toEqual([LC.fingerprint(ack.exercise!)])
      expect(LC.canAdvance(concept, restored)).toBe(false)
    }
  })

  it('acertar tras reintentar, el crédito parcial y acertar con pista nunca certifican', () => {
    const cases: Array<[GradeResult, number, boolean, boolean]> = [[correct, 1, false, true], [correct, 0, true, true], [correct, 0, false, false], [makeGrade('partial', 0.8), 0, false, true]]
    for (const [result, hints, revealed, first] of cases) {
      const skill = sumSkill(), concept = conceptOf(skill)
      let p = LC.acknowledgeExplanation(concept, skill, undefined).progress
      const a = answer(concept, skill, p); p = a.progress
      expect(a.phase).toBe('check')
      const second = LC.prepareCheck(concept, skill, p)
      const r = LC.recordCheck(concept, skill, second.exercise!, result, { hints, revealed, firstAttempt: first }, second.progress)
      expect(r.phase).toBe('reteach')
      expect(r.progress.learning[concept.id].successfulChecks).toEqual([])
    }
  })

  it('una entrada ilegible o sin corregir conserva la pregunta y no cuenta como error', () => {
    const skill = sumSkill(), concept = conceptOf(skill)
    const ack = LC.acknowledgeExplanation(concept, skill, undefined)
    let p = ack.progress
    for (const result of [invalidGrade('Escribe un número'), makeGrade('incorrect', 0, { needsReview: true })]) {
      const r = LC.recordCheck(concept, skill, ack.exercise!, result, { hints: 0, revealed: false }, p)
      expect(r.phase).toBe('check')
      p = r.progress
      expect(p.learning[concept.id].attemptedChecks).toEqual([])
      expect(p.learning[concept.id].activeExercise?.id).toBe(ack.exercise!.id)
    }
  })

  it('copiar una pregunta con otro id u opciones barajadas no fabrica evidencia', () => {
    const original: Exercise = { ...exercise('one', 1), answer: { kind: 'choice', multi: false, shuffle: true, options: [{ id: 'a', md: 'Tres', correct: true, why: '1 + 2' }, { id: 'b', md: 'Dos', correct: false }] } }
    const copy: Exercise = {
      ...original, id: 'copy', seed: '99', prompt: [text('Calcula  la suma de 1 y 2.', 'copy-p')],
      answer: { kind: 'choice', multi: false, shuffle: false, options: [{ id: 'z', md: 'Dos', correct: false }, { id: 'y', md: 'Tres', correct: true, why: 'Otra nota' }] }
    }
    expect(LC.fingerprint(original)).toBe(LC.fingerprint(copy))
    const base = sumSkill(1)
    const skill: Skill = { ...base, exercises: [original, copy], lesson: [base.lesson[0], tryIt([original.id, copy.id], 'checks')] }
    const concept = conceptOf(skill)
    let p = LC.acknowledgeExplanation(concept, skill, undefined).progress
    const a = answer(concept, skill, p); p = a.progress
    expect(a.phase).toBe('check')
    const next = LC.prepareCheck(concept, skill, p)
    expect(next.exercise).toBeUndefined()
    expect(next.prepareMore).toBe(true)
    expect(LC.status(concept, next.progress)).toBe('needsPractice')
    expect(LC.canAdvance(concept, next.progress)).toBe(false)
  })

  it('los subtítulos y las comprobaciones seguidas pertenecen a su explicación y el resumen no es una puerta sin preguntas', () => {
    const base = sumSkill()
    const lesson = [text('# Sumas\nSe añaden unidades.', 'a'), text('## Cómo hacerlo\nCuenta dos pasos.'), tryIt(['e1']), tryIt(['e2']), text('# Repaso'), recap(['Añade dos.'])]
    const skill: Skill = { ...base, lesson }
    const cs = LC.concepts(skill)
    expect(cs.length).toBe(1)
    expect(cs[0].exerciseIDs.length).toBe(4)
    expect(cs[0].teachingBlocks.some((b) => b.type === 'recap')).toBe(true)
    const prose: Skill = { ...skill, lesson: [...lesson.slice(0, -1), text('Añadir dos es contar dos pasos.')] }
    expect(LC.concepts(prose).length).toBe(1)
    const two: Skill = { ...skill, lesson: [...lesson, text('# Restas\nAhora quita unidades.'), tryIt(['e3', 'e4'])] }
    expect(LC.concepts(two).length).toBe(2)
  })

  it('un concepto posterior no empieza antes de dominar el anterior', () => {
    const base = sumSkill()
    const skill: Skill = { ...base, lesson: [text('# Sumas\nAñade dos.', 'first'), tryIt(['e1', 'e2']), text('# Otra parte\nUn método diferente.', 'second'), tryIt(['e3', 'e4'])] }
    const cs = LC.concepts(skill)
    const r = LC.acknowledgeExplanation(cs[1], skill, undefined)
    expect(r.exercise).toBeUndefined()
    expect(LC.status(cs[1], r.progress)).toBe('explanation')
  })

  it('solo las plantillas y preguntas del banco relacionadas son elegibles', () => {
    const base = sumSkill(1)
    const skill: Skill = {
      ...base,
      exercises: [...base.exercises, exercise('variant', 4), { ...exercise('unrelated', 0, ['círculo']), prompt: [text('Calcula el área del círculo.', 'u-p')], answer: numeric('9') }],
      templates: [
        template('sum', [templateVar('n', 'int', 10, 50)], 'Calcula la suma de {{n}} y 2.', 'n+2', { solution: [text('{{n}} + 2 = {{n+2}}.', 'sum-s')], tags: ['suma'] }),
        template('area', [], 'Calcula el área del círculo.', '9', { tags: ['círculo'] })
      ]
    }
    const concept = conceptOf(skill)
    expect(new Set(concept.exerciseIDs)).toEqual(new Set(['e1', 'variant']))
    expect(concept.templateIDs).toEqual(['sum'])
    let p = LC.acknowledgeExplanation(concept, skill, undefined).progress
    p = answer(concept, skill, p).progress
    expect(LC.prepareCheck(concept, skill, p).exercise?.id).toBe('variant')
  })

  it('variables sin usar y semillas repetidas no cuentan como preguntas distintas', () => {
    const base = sumSkill(0)
    const skill: Skill = { ...base, exercises: [], lesson: [base.lesson[0], tryIt(['t'], 'checks')], templates: [template('t', [templateVar('unused', 'int', 0, 1_000_000)], 'Calcula la suma de 1 y 2.', '3')] }
    const concept = conceptOf(skill)
    const ack = LC.acknowledgeExplanation(concept, skill, undefined)
    expect(ack.exercise).toBeDefined()
    const a = answer(concept, skill, ack.progress)
    expect(a.phase).toBe('check')
    const next = LC.prepareCheck(concept, skill, a.progress, { seed: 983 })
    expect(next.exercise).toBeUndefined()
    expect(LC.status(concept, next.progress)).toBe('needsPractice')
  })

  it('la pregunta pendiente y lo escrito persisten, y la misma pregunta vuelve con otra semilla', () => {
    const skill = sumSkill(), concept = conceptOf(skill)
    const ack = LC.acknowledgeExplanation(concept, skill, undefined, { seed: 100 })
    const p: SkillProgress = { ...ack.progress, learning: { ...ack.progress.learning, [concept.id]: { ...ack.progress.learning[concept.id], activeInput: { text: '3' } } } }
    const restored = reload(p)
    const again = LC.prepareCheck(concept, skill, restored, { seed: 200 })
    expect(again.exercise?.id).toBe(ack.exercise?.id)
    expect(again.progress.learning[concept.id].activeInput).toEqual({ text: '3' })
    const a = answer(concept, skill, again.progress)
    expect(a.progress.learning[concept.id].activeInput).toBeUndefined()
  })

  it('ampliar el banco conserva la evidencia y permite terminar', () => {
    let skill = sumSkill(1)
    const original = conceptOf(skill)
    let p = LC.acknowledgeExplanation(original, skill, undefined).progress
    p = answer(original, skill, p).progress
    const none = LC.prepareCheck(original, skill, p)
    expect(none.exercise).toBeUndefined()
    p = none.progress
    skill = { ...skill, exercises: [...skill.exercises, exercise('new', 30)], lesson: [skill.lesson[0], tryIt(['e1', 'new'], 'checks')] }
    const expanded = conceptOf(skill)
    expect(expanded.revision).toBe(original.revision)
    const ack = LC.acknowledgeExplanation(expanded, skill, p)
    expect(ack.exercise).toBeDefined()
    expect(ack.progress.learning[expanded.id].successfulChecks.length).toBe(1)
    expect(answer(expanded, skill, ack.progress).phase).toBe('mastered')
  })

  it('cambiar la explicación o una respuesta usada invalida la evidencia pero conserva el historial', () => {
    const originalSkill = sumSkill(), original = conceptOf(originalSkill)
    let p = LC.acknowledgeExplanation(original, originalSkill, makeSkillProgress({ attempts: 40, lessonDone: true })).progress
    p = answer(original, originalSkill, p).progress
    p = answer(original, originalSkill, p).progress
    expect(LC.isMastered(originalSkill, p)).toBe(true)
    const changedKey: Skill = { ...originalSkill, exercises: [{ ...originalSkill.exercises[0], answer: numeric('100') }, ...originalSkill.exercises.slice(1)] }
    expect(LC.status(conceptOf(changedKey), p)).toBe('explanation')
    const changed: Skill = { ...originalSkill, lesson: [text('# Sumas\nUna explicación revisada.', 'concept'), originalSkill.lesson[1]] }
    const updated = conceptOf(changed)
    expect(LC.status(updated, p)).toBe('explanation')
    p = LC.acknowledgeExplanation(updated, changed, p).progress
    expect(p.learning[updated.id].successfulChecks).toEqual([])
    expect(p.learning[updated.id].attemptedChecks.length).toBe(2)
    expect(p.attempts).toBe(40)
    expect(p.lessonDone).toBe(true)
  })

  it('las preguntas marcadas, abiertas o con claves inválidas no son evidencia', () => {
    const base = sumSkill()
    const ex = base.exercises
    const skill: Skill = {
      ...base,
      exercises: [
        { ...ex[0], review: makeReviewMark('flagged') },
        { ...ex[1], answer: { kind: 'open', modelAnswer: 'Cuenta dos más.', rubric: [] } },
        { ...ex[2], answer: numeric('not a number') },
        { ...ex[3], prompt: [] }
      ]
    }
    const concept = conceptOf(skill)
    const offered = LC.acknowledgeExplanation(concept, skill, undefined)
    expect(offered.exercise?.id).toBe(skill.exercises[1].id)
    expect(LC.checkKind(concept, skill)).toBe('selfAssessed')
    expect(LC.status(concept, offered.progress)).toBe('check')
    expect(LC.isMastered(skill, offered.progress)).toBe(false)
    let p = offered.progress
    for (const broken of [skill.exercises[0], skill.exercises[2], skill.exercises[3]]) {
      const r = LC.recordCheck(concept, skill, broken, correct, { hints: 0, revealed: false }, p)
      expect(r.phase).toBe('check')
      p = r.progress
    }
    expect(LC.successfulCheckCount(concept, p)).toBe(0)
  })

  it('el historial estadístico antiguo y las fuentes duplicadas no dan el dominio guiado', () => {
    const skill = sumSkill(1), concept = conceptOf(skill)
    const old = [makeAttempt({ exerciseID: 'e1', skill: 's', credit: 1, mode: 'practice' })]
    const r = LC.acknowledgeExplanation(concept, skill, makeSkillProgress({ alpha: 100, beta: 1, attempts: 99, lessonDone: true }), { attempts: old })
    expect(r.exercise).toBeUndefined()
    expect(LC.status(concept, r.progress)).toBe('needsPractice')
    const forged: SkillProgress = { ...r.progress, learning: { [concept.id]: makeLearningConcept({ revision: concept.revision, phase: 'mastered', successfulChecks: ['x', 'x'] }) } }
    expect(LC.canAdvance(concept, forged)).toBe(false)
  })

  it('ampliar con una plantilla conserva la evidencia; cambiar la clave usada la invalida junto a lo escrito', () => {
    const base = sumSkill(0)
    const t = template('t', [templateVar('n', 'int', 1, 1_000)], 'Calcula la suma de {{n}} y 2.', 'n+2', { hints: ['Añade dos unidades.'], solution: [text('{{n}} + 2 = {{n+2}}.', 't-s')], tags: ['suma'] })
    let skill: Skill = { ...base, exercises: [], lesson: [base.lesson[0], tryIt(['t'], 'checks')], templates: [t] }
    const original = conceptOf(skill)
    let p = LC.acknowledgeExplanation(original, skill, undefined).progress
    const a = answer(original, skill, p); p = a.progress
    expect(a.phase).toBe('check')
    skill = { ...skill, templates: [t, { ...t, id: 'extra' }] }
    const expanded = conceptOf(skill)
    expect(LC.successfulCheckCount(expanded, p)).toBe(1)
    const prepared = LC.prepareCheck(expanded, skill, p)
    expect(prepared.exercise).toBeDefined()
    p = { ...prepared.progress, learning: { ...prepared.progress.learning, [expanded.id]: { ...prepared.progress.learning[expanded.id], activeInput: '12' } } }
    skill = { ...skill, templates: [{ ...t, answer: numeric('n+3') }, { ...t, id: 'extra' }] }
    const changed = conceptOf(skill)
    expect(LC.status(changed, p)).toBe('explanation')
    expect(LC.successfulCheckCount(changed, p)).toBe(0)
    const again = LC.acknowledgeExplanation(changed, skill, p)
    expect(again.exercise).toBeDefined()
    expect(again.progress.learning[changed.id].activeInput).toBeUndefined()
  })

  it('el historial antiguo de una plantilla gasta su pregunta aunque sea con otra semilla', () => {
    const base = sumSkill(0)
    const skill: Skill = { ...base, exercises: [], lesson: [base.lesson[0], tryIt(['t'], 'checks')], templates: [template('t', [templateVar('unused', 'int', 1, 100)], 'Calcula la suma de 1 y 2.', '3')] }
    const concept = conceptOf(skill)
    const history = [makeAttempt({ exerciseID: 't#17', skill: 's', credit: 1, mode: 'diagnostic' })]
    const r = LC.acknowledgeExplanation(concept, skill, undefined, { seed: 2_000, attempts: history })
    expect(r.exercise).toBeUndefined()
    expect(LC.status(concept, r.progress)).toBe('needsPractice')
    expect(LC.isMastered(skill, r.progress)).toBe(false)
  })

  it('seguir sin comprobar deja el concepto superado y abre el siguiente', () => {
    const skill = sumSkill(1), concept = conceptOf(skill)
    let p = LC.acknowledgeExplanation(concept, skill, undefined).progress
    p = answer(concept, skill, p).progress
    const none = LC.prepareCheck(concept, skill, p)
    expect(none.prepareMore).toBe(true)
    const r = LC.continueWithoutChecks(concept, skill, none.progress)
    expect(r.applied).toBe(true)
    expect(LC.canAdvance(concept, r.progress)).toBe(true)
    expect(LC.isUnchecked(concept, r.progress)).toBe(true)
    const view = LC.overview(skill, r.progress)
    expect(view[0].unchecked).toBe(true)
    expect(view[0].canAdvance).toBe(true)
  })

  it('no modifica el progreso de entrada', () => {
    const skill = sumSkill(), concept = conceptOf(skill)
    const p0 = makeSkillProgress()
    const snapshot = JSON.stringify(p0)
    const ack = LC.acknowledgeExplanation(concept, skill, p0)
    expect(JSON.stringify(p0)).toBe(snapshot)
    const before = JSON.stringify(ack.progress)
    LC.recordCheck(concept, skill, ack.exercise!, correct, { hints: 0, revealed: false }, ack.progress)
    expect(JSON.stringify(ack.progress)).toBe(before)
  })
})
