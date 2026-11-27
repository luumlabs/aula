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

// Caché SWR en memoria para que volver a una pantalla (Hoy, Cursos, Aula, Calendario…) pinte al instante sin destello
// de esqueleto ni espera de red; la llamada se refresca en segundo plano y solo repinta si los datos cambiaron.
const CACHE_LIMIT = 64
const cache = new Map<string, { value: unknown; json: string }>()
let cacheBridge: unknown

function syncBridge(): void {
  const cur = typeof window !== 'undefined' ? window.aula : undefined
  if (cur !== cacheBridge) {
    cache.clear()
    cacheBridge = cur
  }
}

function readCache<T>(cacheKey: string): { value: T; json: string } | undefined {
  syncBridge()
  const hit = cache.get(cacheKey)
  if (!hit) return undefined
  // LRU ligero
  cache.delete(cacheKey)
  cache.set(cacheKey, hit)
  return hit as { value: T; json: string }
}

function writeCache(cacheKey: string, value: unknown, json?: string): string {
  syncBridge()
  let serialized = json ?? ''
  if (!serialized) {
    try {
      serialized = JSON.stringify(value) ?? ''
    } catch {
      serialized = ''
    }
  }
  cache.delete(cacheKey)
  cache.set(cacheKey, { value, json: serialized })
  if (cache.size > CACHE_LIMIT) {
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  return serialized
}

export function clearRpcCache(): void {
  cache.clear()
}

/**
 * Llama a `method` con `args` y vuelve a llamar cuando cambian los argumentos o llega alguno de `events`.
 * `args === undefined` con métodos sin argumentos; pasa `skip` para no llamar todavía.
 */
export function useRpc<M extends RpcMethod>(method: M, args: RpcArgs<M>, opts: { events?: RpcEvent[]; skip?: boolean; filter?: (payload: unknown) => boolean } = {}): RpcState<RpcResult<M>> {
  const key = JSON.stringify(args ?? null)
  const cacheKey = `${method}\0${key}`
  const initial = opts.skip ? undefined : readCache<RpcResult<M>>(cacheKey)
  const [data, setDataState] = useState<RpcResult<M> | undefined>(initial?.value)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(!opts.skip && !initial)
  const lastJson = useRef<string>(initial?.json ?? '')
  const prevCacheKey = useRef<string>(cacheKey)
  const seq = useRef(0)

  // Si cambia la clave (p. ej. otro curso), arrancar con su caché en lugar de la pantalla anterior
  if (prevCacheKey.current !== cacheKey) {
    prevCacheKey.current = cacheKey
    const hit = opts.skip ? undefined : readCache<RpcResult<M>>(cacheKey)
    lastJson.current = hit?.json ?? ''
    setDataState(hit?.value)
    setError(null)
    setLoading(!opts.skip && !hit)
  }

  const setData = useCallback(
    (v: RpcResult<M> | ((prev: RpcResult<M> | undefined) => RpcResult<M>)) => {
      setDataState((prev) => {
        const next = typeof v === 'function' ? (v as (p: RpcResult<M> | undefined) => RpcResult<M>)(prev) : v
        if (next !== undefined) lastJson.current = writeCache(cacheKey, next)
        return next
      })
    },
    [cacheKey]
  )

  const load = useCallback(async () => {
    if (opts.skip) return
    const mine = ++seq.current
    if (!readCache(cacheKey)) setLoading(true)
    try {
      const v = await (api.invoke as (m: string, a?: unknown) => Promise<RpcResult<M>>)(method, args)
      if (mine === seq.current) {
        let nextJson = ''
        try {
          nextJson = JSON.stringify(v) ?? ''
        } catch {
          nextJson = ''
        }
        const had = lastJson.current !== '' && nextJson !== '' && nextJson === lastJson.current
        lastJson.current = writeCache(cacheKey, v, nextJson)
        if (!had) setDataState(v)
        setError(null)
      }
    } catch (e) {
      if (mine === seq.current) setError(e as Error)
    } finally {
      if (mine === seq.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, key, cacheKey, opts.skip])

  useEffect(() => {
    void load()
  }, [load])

  const eventsKey = (opts.events ?? []).join('|')
  useEffect(() => {
    if (!opts.events?.length) return
    let t: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => void load(), 120)
    }
    const offs = opts.events.map((ev) =>
      api.on(ev, (payload) => {
        if (opts.filter && !opts.filter(payload)) return
        schedule()
      })
    )
    if (api.remote) {
      offs.push(api.on('remote.reconnected' as RpcEvent, schedule))
    }
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
