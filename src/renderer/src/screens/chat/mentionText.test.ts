// La «@» de la caja de escribir: cuándo abre el selector y cómo queda el texto al elegir.
import { describe, expect, it } from 'vitest'
import { insertAt, mentionQueryAt, removeMentionQuery } from './mentionText'

describe('menciones en la caja', () => {
  it('abre el selector con la «@» al principio o tras un espacio, no en un correo', () => {
    expect(mentionQueryAt('@', 1)).toEqual({ at: 0, query: '' })
    expect(mentionQueryAt('Explícame @trig', 15)).toEqual({ at: 10, query: 'trig' })
    expect(mentionQueryAt('(@ángulos', 9)).toEqual({ at: 1, query: 'ángulos' })
    expect(mentionQueryAt('ana@correo.com', 14)).toBeNull()
    expect(mentionQueryAt('sin arroba', 10)).toBeNull()
    // la consulta es lo que hay antes del cursor
    expect(mentionQueryAt('@trig y más', 5)).toEqual({ at: 0, query: 'trig' })
  })

  it('no abre con un espacio justo detrás, un salto de línea o una consulta larguísima', () => {
    expect(mentionQueryAt('@ hola', 6)).toBeNull()
    expect(mentionQueryAt('@uno\ndos', 8)).toBeNull()
    expect(mentionQueryAt('@' + 'a'.repeat(41), 42)).toBeNull()
  })

  it('al elegir, quita «@consulta» y deja un solo espacio', () => {
    expect(removeMentionQuery('Explícame @trig', 10, 15)).toEqual({ text: 'Explícame ', caret: 10 })
    expect(removeMentionQuery('Mira @tri por favor', 5, 9)).toEqual({ text: 'Mira por favor', caret: 5 })
    expect(removeMentionQuery('@curso', 0, 6)).toEqual({ text: '', caret: 0 })
  })

  it('el botón «@» escribe la arroba en el cursor', () => {
    expect(insertAt('', 0)).toEqual({ text: '@', caret: 1 })
    expect(insertAt('Hola', 4)).toEqual({ text: 'Hola @', caret: 6 })
    expect(insertAt('Hola ', 5)).toEqual({ text: 'Hola @', caret: 6 })
  })
})
