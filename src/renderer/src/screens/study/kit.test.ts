// «Marcar y preguntar» desde una figura del enunciado de un ejercicio: el tutor sabe qué ejercicio es, lo que lleva respondido
// (si la pantalla lo sabe) y si aún está sin resolver; en el simulacro no hay tutor.
import { describe, expect, it } from 'vitest'
import { markedFigureContext, tutorScreenOf } from './kit'

const base = { courseID: 'c1', skillID: 'lesson-1', screen: 'practice' }

describe('el contexto de una pregunta de «Marcar»', () => {
  it('una figura de la lección: la figura y nada de ejercicios', () => {
    expect(markedFigureContext({ ...base, screen: 'lesson' }, 'fig-1')).toEqual({ courseID: 'c1', skillID: 'lesson-1', screen: 'lesson', blockID: 'fig-1' })
  })

  it('una figura del enunciado de un ejercicio sin resolver: el ejercicio y «sin resolver» (el tutor ayuda con pistas)', () => {
    expect(markedFigureContext(base, 'fig-2', { exerciseId: 'ex-7', unsolved: true })).toEqual({ ...base, blockID: 'fig-2', exerciseID: 'ex-7', lastResult: 'not solved yet' })
  })

  it('con lo que sabe la práctica del ejercicio: su lección, la respuesta y el resultado', () => {
    const known = { courseID: 'c1', skillID: 'lesson-3', exerciseID: 'ex-7', screen: 'practice', lastInput: 'x = 2', lastResult: 'incorrect: olvidó el signo' }
    expect(markedFigureContext(base, 'fig-2', { exerciseId: 'ex-7', unsolved: true }, known)).toEqual({ ...base, skillID: 'lesson-3', blockID: 'fig-2', exerciseID: 'ex-7', lastInput: 'x = 2', lastResult: 'incorrect: olvidó el signo' })
    // lo de otro ejercicio no cuenta
    expect(markedFigureContext(base, 'fig-2', { exerciseId: 'ex-8', unsolved: true }, known).lastInput).toBeUndefined()
  })

  it('ya resuelto (la solución a la vista): lo dice', () => {
    expect(markedFigureContext(base, 'fig-2', { exerciseId: 'ex-7', unsolved: false }).lastResult).toBe('finished: the solution is on screen')
    expect(markedFigureContext(base, 'fig-2', { exerciseId: 'ex-7', unsolved: false }, { exerciseID: 'ex-7', lastResult: 'correct' }).lastResult).toBe('correct (finished: the solution is on screen)')
  })

  it('«Marcar» lleva al tutor en todos los modos de estudio menos el simulacro', () => {
    expect(tutorScreenOf({ name: 'study', id: 'c1', mode: 'learn' })).toBe('lesson')
    expect(tutorScreenOf({ name: 'study', id: 'c1', mode: 'practice' })).toBe('practice')
    expect(tutorScreenOf({ name: 'study', id: 'c1', mode: 'mistakes' })).toBe('mistakes')
    expect(tutorScreenOf({ name: 'study', id: 'c1', mode: 'exam' })).toBeUndefined()
    expect(tutorScreenOf({ name: 'home' })).toBeUndefined()
  })
})
