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
 *  respuesta en árabe, de derecha a izquierda; «-3» o «2x+1», de izquierda a derecha aunque el curso sea de derecha a izquierda). */
export const answerField = { 'data-answer-field': '', dir: 'auto', onContextMenu: tellAnswerField }
