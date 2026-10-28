// Cuestionarios del chat: al volver a abrir la conversación siguen donde se quedaron (o enseñan la nota).
import { describe, expect, it } from 'vitest'
import type { AssistantStudySet } from '@shared/assistant/types'
import type { Exercise } from '@shared/schema/exercises'
import { flashcardFaces, inputForAula, quizMistakes, quizProgress, suggestSaveCourse, suggestSaveLesson } from './studySet'

const ex = (id: string): Exercise => ({ id, answer: { kind: 'numeric', value: '1' } } as unknown as Exercise)
const set = (results: Record<string, boolean>, inputs: Record<string, string> = {}): AssistantStudySet => ({
  id: 's', title: 'Test', exercises: [ex('q1'), ex('q2'), ex('q3')], cards: [], results, inputs
})

describe('cuestionario del chat', () => {
  it('sin responder empieza por la primera; a medias sigue por la que falta', () => {
    expect(quizProgress(set({}))).toEqual({ total: 3, answered: 0, right: 0, next: 0, done: false })
    expect(quizProgress(set({ q1: true }))).toMatchObject({ answered: 1, right: 1, next: 1, done: false })
    // lo recién respondido cuenta aunque aún no haya vuelto del proceso principal
    expect(quizProgress(set({ q1: true }), { q2: false })).toMatchObject({ answered: 2, right: 1, next: 2 })
  })

  it('respondido entero: la nota (bien a la primera) y las falladas con lo que puso', () => {
    const s = set({ q1: true, q2: false, q3: true, otra: false }, { q2: '13' })
    expect(quizProgress(s)).toEqual({ total: 3, answered: 3, right: 2, next: -1, done: true })
    expect(quizMistakes(s)).toEqual([{ n: 2, input: '13' }])
  })

  it('lo que respondió va corto y en una línea', () => {
    expect(inputForAula('  x =\n 2 ')).toBe('x = 2')
    expect(inputForAula('')).toBeUndefined()
    expect(inputForAula('a'.repeat(300))?.length).toBe(200)
  })

  it('las tarjetas de huecos esconden la respuesta en el frente', () => {
    expect(flashcardFaces({ kind: 'cloze', front: 'Las raíces son {{c1::$\\pm 2$}}.', back: '' })).toEqual({ front: 'Las raíces son **[…]**.', back: 'Las raíces son **$\\pm 2$**.' })
    expect(flashcardFaces({ kind: 'basic', front: 'A', back: 'B' })).toEqual({ front: 'A', back: 'B' })
  })
})

describe('dónde guardar (J2-22 / A3-P2-16)', () => {
  const courses = [
    { id: 'photo', title: 'Photosynthesis', subject: 'Biology' },
    { id: 'trig', title: 'Exam #2 · MATH 112', subject: 'Trigonometry' },
    { id: 'quim', title: 'Química orgánica', subject: 'Química' }
  ]
  const trigSet = { title: 'Trigonometry: exact values', cards: [{ front: 'sin 30°' }, { front: 'cos 60°' }], exercises: [] } as unknown as AssistantStudySet
  it('propone el curso del tema, no el más reciente', () => {
    expect(suggestSaveCourse(trigSet, courses)).toBe('trig')
    expect(suggestSaveCourse({ ...trigSet, title: 'Tarjetas de química' }, courses)).toBe('quim')
  })
  it('lo que dijo Aula y el curso de la conversación van primero', () => {
    expect(suggestSaveCourse({ ...trigSet, courseID: 'photo' }, courses)).toBe('photo')
    expect(suggestSaveCourse(trigSet, courses, 'quim')).toBe('quim')
    // uno que ya no existe no cuenta
    expect(suggestSaveCourse({ ...trigSet, courseID: 'borrado' }, courses, 'otro')).toBe('trig')
  })
  it('si nada encaja, no preselecciona', () => {
    expect(suggestSaveCourse({ title: 'Verbos irregulares', cards: [{ front: 'go' }], exercises: [] } as unknown as AssistantStudySet, courses)).toBeNull()
    expect(suggestSaveCourse(trigSet, [])).toBeNull()
  })
  it('la lección: la propuesta, la que encaja o la única', () => {
    const lessons = [{ id: 'ref', title: 'Reference angles' }, { id: 'exact', title: 'Exact trig values' }]
    expect(suggestSaveLesson(trigSet, lessons)).toBe('exact')
    expect(suggestSaveLesson({ ...trigSet, skillID: 'ref' }, lessons)).toBe('ref')
    expect(suggestSaveLesson(trigSet, lessons, 'ref')).toBe('ref')
    expect(suggestSaveLesson({ title: 'Otra cosa', cards: [], exercises: [] } as unknown as AssistantStudySet, lessons)).toBeNull()
    expect(suggestSaveLesson({ title: 'Otra cosa', cards: [], exercises: [] } as unknown as AssistantStudySet, [lessons[0]])).toBe('ref')
  })
})
