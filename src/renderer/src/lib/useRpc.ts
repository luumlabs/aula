// Ganchos para leer datos del proceso principal y refrescarlos cuando llegan eventos.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcArgs, RpcEvent, RpcMethod, RpcResult } from '@shared/ipc'
import { api } from './api'

export interface RpcState<T> {
  data: T | undefined
  error: Error | null
  loading: boolean
  reload: () => Promise<void>
  setData: (v: T | ((prev: T | undefined) => T)) => void
}

/**
 * Llama a `method` con `args` y vuelve a llamar cuando cambian los argumentos o llega alguno de `events`.
 * `args === undefined` con métodos sin argumentos; pasa `skip` para no llamar todavía.
 */
export function useRpc<M extends RpcMethod>(method: M, args: RpcArgs<M>, opts: { events?: RpcEvent[]; skip?: boolean; filter?: (payload: unknown) => boolean } = {}): RpcState<RpcResult<M>> {
  const [data, setData] = useState<RpcResult<M> | undefined>(undefined)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(!opts.skip)
  const key = JSON.stringify(args ?? null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (opts.skip) return
    const mine = ++seq.current
    setLoading(true)
    try {
      const v = await (api.invoke as (m: string, a?: unknown) => Promise<RpcResult<M>>)(method, args)
      if (mine === seq.current) {
        setData(v)
        setError(null)
      }
    } catch (e) {
      if (mine === seq.current) setError(e as Error)
    } finally {
      if (mine === seq.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, key, opts.skip])

  useEffect(() => {
    void load()
  }, [load])

  const eventsKey = (opts.events ?? []).join('|')
  useEffect(() => {
    if (!opts.events?.length) return
    let t: ReturnType<typeof setTimeout> | null = null
    const offs = opts.events.map((ev) =>
      api.on(ev, (payload) => {
        if (opts.filter && !opts.filter(payload)) return
        if (t) clearTimeout(t)
        t = setTimeout(() => void load(), 120)
      })
    )
    return () => {
      if (t) clearTimeout(t)
      offs.forEach((off) => off())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsKey, load])

  return { data, error, loading, reload: load, setData: setData as RpcState<RpcResult<M>>['setData'] }
}

/** Escucha un evento mientras el componente está montado. */
export function useRpcEvent<E extends RpcEvent>(event: E, fn: (payload: Parameters<Parameters<typeof api.on<E>>[1]>[0]) => void): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => api.on(event, (p) => ref.current(p)), [event])
}
