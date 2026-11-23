// Los campos donde se escribe la respuesta de un ejercicio. Al clic derecho se avisa al proceso principal justo antes de su
// menú nativo: ahí el menú no ofrece la ortografía ni consultar o traducir lo escrito (darían la respuesta).
import type { MouseEvent } from 'react'
import { api } from '@renderer/lib/api'

function tellAnswerField(_e: MouseEvent<HTMLElement>): void {
  // un dispositivo a distancia usa el menú de su navegador
  if (api.remote) return
  void api.invoke('app.contextTarget', { exerciseField: true }).catch(() => undefined)
}

/** Se pone en cada campo de respuesta: `<input {...answerField} … />`. `dir="auto"`: el sentido lo da lo escrito (una
 *  respuesta en árabe, de derecha a izquierda; «-3» o «2x+1», de izquierda a derecha aunque el curso sea de derecha a izquierda).
 *  En el teclado de la pantalla: sin mayúscula al empezar ni autocorrector (cambiaría la respuesta), e Intro dice «OK». */
export const answerField = { 'data-answer-field': '', dir: 'auto', onContextMenu: tellAnswerField, autoCapitalize: 'off', autoCorrect: 'off', enterKeyHint: 'done' } as const

/** Lo que mira `enterAction` de una tecla (vale el `KeyboardEvent` tal cual). */
export type EnterKey = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'isComposing' | 'keyCode'>

/**
 * Qué hace Intro en un campo de respuesta. En el de una línea, comprobar. En el que crece (la respuesta corta), Mayús+Intro
 * hace un salto de línea, como en el chat, e Intro o ⌘/Ctrl+Intro comprueban. Mientras se compone con un IME (japonés,
 * chino, acentos…), Intro cierra la composición y no comprueba: Safari y la vista web del iPhone lo avisan ya sin
 * `isComposing`, pero con el keyCode 229.
 */
export function enterAction(e: EnterKey, multiline: boolean): 'check' | 'newline' | 'none' {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return 'none'
  if (multiline && e.shiftKey && !e.metaKey && !e.ctrlKey) return 'newline'
  return 'check'
}
