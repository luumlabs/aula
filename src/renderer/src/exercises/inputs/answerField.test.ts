import { describe, expect, it } from 'vitest'
import { answerField, enterAction, type EnterKey } from './answerField'

describe('campos de respuesta', () => {
  it('se marcan para el menú del clic derecho', () => {
    expect(answerField['data-answer-field']).toBe('')
    expect(typeof answerField.onContextMenu).toBe('function')
  })
  it('el sentido lo da lo escrito: «-3» sigue siendo «-3» en un curso de derecha a izquierda', () => {
    expect(answerField.dir).toBe('auto')
  })
})

const key = (o: Partial<EnterKey> = {}): EnterKey => ({ key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: false, isComposing: false, keyCode: 13, ...o })

describe('Intro en un campo de respuesta', () => {
  it('en la respuesta corta (crece): Intro comprueba y Mayús+Intro hace un salto de línea, como en el chat', () => {
    expect(enterAction(key(), true)).toBe('check')
    expect(enterAction(key({ shiftKey: true }), true)).toBe('newline')
  })
  it('⌘+Intro y Ctrl+Intro también comprueban (como en la respuesta abierta), con Mayús o sin ella', () => {
    expect(enterAction(key({ metaKey: true }), true)).toBe('check')
    expect(enterAction(key({ ctrlKey: true }), true)).toBe('check')
    expect(enterAction(key({ metaKey: true, shiftKey: true }), true)).toBe('check')
  })
  it('en las de una línea (números, fórmulas, química), Intro comprueba siempre, como antes', () => {
    expect(enterAction(key(), false)).toBe('check')
    expect(enterAction(key({ shiftKey: true }), false)).toBe('check')
    expect(enterAction(key({ ctrlKey: true }), false)).toBe('check')
  })
  it('mientras se compone con un IME no comprueba nada a medias (tampoco el Intro de Safari que cierra la composición)', () => {
    for (const multiline of [true, false]) {
      expect(enterAction(key({ isComposing: true }), multiline)).toBe('none')
      expect(enterAction(key({ keyCode: 229 }), multiline)).toBe('none')
      expect(enterAction(key({ isComposing: true, shiftKey: true }), multiline)).toBe('none')
    }
  })
  it('las demás teclas no hacen nada', () => {
    expect(enterAction(key({ key: 'a', keyCode: 65 }), true)).toBe('none')
    expect(enterAction(key({ key: 'Tab', keyCode: 9, shiftKey: true }), true)).toBe('none')
  })
})
