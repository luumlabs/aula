// Contrato común de los controles de respuesta: el borrador de un ejercicio (o de una de sus partes), cómo cambiarlo y qué
// enseñar tras comprobar.
import { useEffect, useRef } from 'react'
import type { Answer } from '@shared/schema/exercises'
import type { BlockContext } from '@renderer/blocks/types'
import type { Draft } from '../model'
import type { GradeResult } from '../types'
import { isTypingTarget } from '../normalize'

/** Qué marcar tras comprobar: terminado, todo; comprobado sin terminar, solo lo que está mal (así «Intentar de nuevo» no deja la respuesta a la vista). */
export type RevealLevel = 'none' | 'mistakesOnly' | 'all'

export interface InputProps<A extends Answer = Answer> {
  answer: A
  draft: Draft
  set: (fn: (d: Draft) => Draft) => void
  /** Ya no se puede cambiar (terminado o simulacro entregado). */
  locked: boolean
  reveal: RevealLevel
  /** Resultado de este ejercicio o parte (para marcar huecos, parejas…). */
  result?: GradeResult
  exerciseId: string
  /** Idioma del contenido (coma decimal). */
  lang: string
  ctx: BlockContext
  onSubmit: () => void
  autoFocus: boolean
  /** Atajos de teclado activos (solo el ejercicio a la vista). */
  active: boolean
  /** Simulacro: sin vista de corrección. */
  exam: boolean
}

/** Escucha teclas en la ventana mientras `active`, salvo si se escribe en un campo o hay modificadores. */
export function useKeys(active: boolean, handler: (e: KeyboardEvent) => boolean | void): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!active) return
    const fn = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(document.activeElement as HTMLElement | null)) return
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (ref.current(e) === true) e.preventDefault()
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [active])
}

/** Color del resultado de una parte (hueco, pareja, punto). */
export function partTone(r: GradeResult | undefined): string | undefined {
  if (!r) return undefined
  return r.status === 'correct' ? 'var(--success)' : r.status === 'partial' ? 'var(--warning)' : 'var(--danger)'
}
