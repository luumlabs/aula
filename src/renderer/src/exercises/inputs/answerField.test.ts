import { describe, expect, it } from 'vitest'
import { answerField } from './answerField'

describe('campos de respuesta', () => {
  it('se marcan para el menú del clic derecho', () => {
    expect(answerField['data-answer-field']).toBe('')
    expect(typeof answerField.onContextMenu).toBe('function')
  })
  it('el sentido lo da lo escrito: «-3» sigue siendo «-3» en un curso de derecha a izquierda', () => {
    expect(answerField.dir).toBe('auto')
  })
})
