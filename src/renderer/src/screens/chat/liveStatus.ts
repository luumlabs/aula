// ¿Está Aula respondiendo en alguna conversación? Para la marca de fuera del chat (la barra lateral, el botón flotante): el sol
// cruza el arco mientras responde y salta al terminar. Una sola suscripción para toda la app, que empieza con el primer uso.
import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from '@renderer/lib/api'
import { useMarkPhase, type MarkState } from '@renderer/design'

interface LiveStatus {
  busy: Record<string, true>
  set: (threadId: string, busy: boolean) => void
  reset: (ids: string[]) => void
}

const useLive = create<LiveStatus>((set) => ({
  busy: {},
  set: (id, busy) =>
    set((s) => {
      if (!!s.busy[id] === busy) return s
      const next = { ...s.busy }
      if (busy) next[id] = true
      else delete next[id]
      return { busy: next }
    }),
  reset: (ids) => set({ busy: Object.fromEntries(ids.map((id) => [id, true as const])) })
}))

let users = 0
let off: (() => void) | null = null

function subscribe(): () => void {
  users += 1
  if (users === 1) {
    const load = () =>
      void api
        .invoke('chat.threads')
        .then((list) => useLive.getState().reset(list.filter((t) => t.busy).map((t) => t.id)))
        .catch(() => undefined)
    load()
    const offs = [api.on('chat.status', (s) => useLive.getState().set(s.threadId, s.busy))]
    off = () => offs.forEach((f) => f())
  }
  return () => {
    users -= 1
    if (users === 0) {
      off?.()
      off = null
    }
  }
}

/** Las conversaciones en las que Aula está respondiendo ahora. */
export function useBusyThreads(): Record<string, true> {
  useEffect(subscribe, [])
  return useLive((s) => s.busy)
}

/** Si Aula está respondiendo en alguna conversación. */
export function useAulaBusy(): boolean {
  useEffect(subscribe, [])
  return useLive((s) => Object.keys(s.busy).length > 0)
}

/** La marca de Aula para fuera del chat: trabajando mientras responde, «listo» al terminar, y `rest` el resto del tiempo. */
export function useAulaMarkState(rest: MarkState = 'idle'): MarkState {
  return useMarkPhase(useAulaBusy(), { rest })
}
