// Mientras se hace un simulacro, el menú del clic derecho solo copia: sin consultar, traducir, buscar ni ortografía (lo
// decide el proceso principal: context-menu.ts, con un solo interruptor). Lo enciende el simulacro en marcha mientras está
// delante; al cambiar de un simulacro a otro, la capa que se va lo suelta después de que lo tome la nueva, así que se cuenta
// quién lo tiene: se apaga cuando lo suelta el último.
import { useEffect } from 'react'
import { api } from '@renderer/lib/api'

export interface ExamGuard {
  /** Lo toma; devuelve cómo soltarlo (soltarlo dos veces no hace nada). */
  hold(): () => void
}

/** `send(true)` con el primero que lo toma y `send(false)` cuando lo suelta el último. */
export function createExamGuard(send: (on: boolean) => void): ExamGuard {
  const holders = new Set<symbol>()
  return {
    hold() {
      const me = Symbol('exam')
      if (holders.size === 0) send(true)
      holders.add(me)
      return () => {
        if (holders.delete(me) && holders.size === 0) send(false)
      }
    }
  }
}

const guard = createExamGuard((on) => void api.invoke('app.setExamMode', { exam: on }).catch(() => undefined))

/** El menú de examen mientras `on` (el simulacro en marcha y su pantalla delante). Un dispositivo a distancia usa el menú de
 *  su navegador. */
export function useExamGuard(on: boolean): void {
  useEffect(() => {
    if (!on || api.remote) return
    return guard.hold()
  }, [on])
}
