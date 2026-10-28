// Ayudas para las pruebas del motor de estudio (no se usan en la app).
import {
  makeExercise, makeSkill, type Answer, type AnswerOf, type Block, type Exercise, type ExerciseTemplate, type Skill, type TemplateVarSpec
} from '@shared/schema'
import { makeGrade, type GradeResult } from '@engine/grading'

let n = 0
export const text = (md: string, id = `b${++n}`): Block => ({ id, type: 'text', md })
export const tryIt = (exerciseIDs: string[], id = `t${++n}`, inline: Exercise[] = []): Block => ({ id, type: 'tryit', exerciseIDs, inline })
export const recap = (points: string[], id = `r${++n}`): Block => ({ id, type: 'recap', points })

export function numeric(value: string, more: Partial<AnswerOf<'numeric'>> = {}): Answer {
  return { kind: 'numeric', value, alternatives: [], absTol: 0, relTol: 0, form: 'any', unitMode: 'optional', angle: 'radians', ...more }
}

export function exercise(id: string, value: number, tags: string[] = ['suma'], skill = 's'): Exercise {
  return makeExercise({
    id, skill, prompt: [text(`Calcula la suma de ${value} y 2.`, `${id}-p`)], answer: numeric(String(value + 2)),
    hints: ['Añade dos unidades.'], solution: [text(`${value} + 2 = ${value + 2}.`, `${id}-s`)], tags
  })
}

/** «Sumas»: un concepto con su tryit y `count` ejercicios (e1…). */
export function sumSkill(count = 4): Skill {
  const exercises = Array.from({ length: Math.max(1, count) }, (_, i) => exercise(`e${i + 1}`, i + 1))
  return makeSkill({
    id: 's', title: 'Sumas',
    lesson: [text('# Sumas\nSumar dos añade dos unidades a la cantidad inicial.', 'concept'), tryIt(exercises.map((e) => e.id), 'checks')],
    exercises: exercises.slice(0, count)
  })
}

export function templateVar(name: string, kind: string, min?: number, max?: number): TemplateVarSpec {
  const v: TemplateVarSpec = { name, kind, exclude: [], values: [], proper: true }
  if (min !== undefined) v.min = min
  if (max !== undefined) v.max = max
  return v
}

export function template(id: string, vars: TemplateVarSpec[], prompt: string, value: string, more: Partial<ExerciseTemplate> = {}): ExerciseTemplate {
  return { id, skill: 's', level: 2, vars, constraints: [], prompt: [text(prompt, `${id}-p`)], answer: numeric(value), hints: [], solution: [], wrongs: [], points: 1, tags: [], ...more }
}

export const correct: GradeResult = makeGrade('correct', 1)
