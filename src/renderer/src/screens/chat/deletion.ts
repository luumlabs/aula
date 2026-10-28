// Borrar una conversación se puede deshacer: desaparece de la lista al momento, un aviso ofrece «Deshacer» y solo se borra de
// verdad (con sus adjuntos) cuando pasa el aviso. Vive fuera de las pantallas: salir del chat no cancela ni adelanta nada.
import { create } from 'zustand'

/** Lo que tarda en borrarse de verdad (lo mismo que dura el aviso con acción). */
export const DELETE_DELAY_MS = 8000

interface PendingDeletes {
  ids: string[]
}

export const usePendingDeletes = create<PendingDeletes>(() => ({ ids: [] }))

const timers = new Map<string, ReturnType<typeof setTimeout>>()
let commitFn: (id: string) => Promise<unknown> = async () => undefined

/** Quién borra de verdad (el IPC en la app; las pruebas ponen el suyo). */
export function setDeleteCommitter(fn: (id: string) => Promise<unknown>): void {
  commitFn = fn
}

const setIds = (fn: (ids: string[]) => string[]) => usePendingDeletes.setState((s) => ({ ids: fn(s.ids) }))

/** Esconde la conversación y la borra dentro de `DELETE_DELAY_MS` (salvo que se deshaga). */
export function scheduleDelete(id: string, delayMs = DELETE_DELAY_MS): void {
  if (timers.has(id)) return
  setIds((ids) => [...ids, id])
  timers.set(id, setTimeout(() => void commit(id), delayMs))
}

/** «Deshacer»: vuelve a la lista tal cual. false si ya se había borrado. */
export function undoDelete(id: string): boolean {
  const timer = timers.get(id)
  if (!timer) return false
  clearTimeout(timer)
  timers.delete(id)
  setIds((ids) => ids.filter((x) => x !== id))
  return true
}

async function commit(id: string): Promise<void> {
  timers.delete(id)
  try {
    await commitFn(id)
  } finally {
    setIds((ids) => ids.filter((x) => x !== id))
  }
}

/** Al cerrar la ventana: lo que el estudiante borró se borra ya (no vuelve a aparecer al abrir). */
export function flushDeletes(): void {
  for (const id of [...timers.keys()]) {
    clearTimeout(timers.get(id)!)
    void commit(id)
  }
}
