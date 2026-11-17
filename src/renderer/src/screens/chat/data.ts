// Datos del chat: lista de conversaciones y la conversación abierta (la usan el chat y el tutor del estudio), que se actualiza con
// los eventos 'chat.message' (mensajes), 'chat.status' (si responde) y 'chat.queue' (lo que se escribió mientras respondía).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { figureContentOf } from '@engine/assistant/trust'
import type { AssistantAttachment, AssistantMessage, AssistantRef, AssistantThread, AssistantThreadSummary, TutorContext } from '@shared/assistant/types'
import type { AssistantThreadView } from '@shared/ipc/assistant'
import { api } from '@renderer/lib/api'
import { isDemo } from '@renderer/lib/demo'
import { askAIConsent, isConsentDeclined } from '@renderer/lib/aiConsent'
import { toast } from '@renderer/design'
import { demoThreads } from './demo'
import { flushDeletes, setDeleteCommitter, usePendingDeletes } from './deletion'
import { createRetryRequest, retryableFailure, type PendingRetry } from './retry'

// borrar de verdad pasa por el IPC; lo pendiente se borra si se cierra la ventana antes de que pase el aviso
setDeleteCommitter((id) => api.invoke('chat.deleteThread', { id }).catch(() => undefined))
if (typeof window !== 'undefined') window.addEventListener('beforeunload', flushDeletes)

export function useThreads() {
  const [threads, setThreads] = useState<AssistantThreadSummary[]>([])
  const load = useCallback(async () => {
    try {
      setThreads(await api.invoke('chat.threads'))
    } catch {
      if (isDemo()) setThreads(demoThreads().map((t) => ({ id: t.id, title: t.title, preview: t.messages.at(-1)?.text.slice(0, 80) ?? '', updated: t.updated, pinned: t.pinned, busy: false })))
    }
  }, [])
  useEffect(() => {
    void load()
    return api.on('chat.threads', () => void load())
  }, [load])
  // lo que se acaba de borrar (y aún se puede deshacer) no se ve
  const pending = usePendingDeletes((s) => s.ids)
  const shown = useMemo(() => (pending.length ? threads.filter((t) => !pending.includes(t.id)) : threads), [threads, pending])
  return { threads: shown, reload: load }
}

export interface BusyState {
  busy: boolean
  label?: string
}

/** Lo que se envía desde la caja de escribir. */
export interface Draft {
  text: string
  files: string[]
  mentions: AssistantRef[]
  /** Procedencia explícita de un borrador contextual. Reintentar usa el mensaje guardado en main. */
  context?: TutorContext
}

/** Un borrador contextual conserva su procedencia; una pregunta nueva del compositor sí es texto del estudiante. */
export function draftContext(draft: Draft, current?: TutorContext): TutorContext | undefined {
  if (draft.context) return draft.context
  if (!current?.blockID || current.markedFigure) return current
  return { ...current, markedFigure: { studentText: draft.text, context: '' } }
}

export interface Conversation {
  thread: AssistantThread | null
  setThread: React.Dispatch<React.SetStateAction<AssistantThread | null>>
  /** Pone una conversación ya pedida (p. ej. la del tutor) con lo que trae de memoria (si responde y la cola). */
  adopt: (view: AssistantThreadView) => void
  busy: BusyState
  /** Lo que espera a que Aula termine (en el orden en que se escribió). */
  queued: AssistantMessage[]
  /** Aula espera la respuesta a una pregunta o un permiso: lo que se escriba la contesta (no va a la cola). */
  awaiting: boolean
  /** La última respuesta de Aula (la que se está escribiendo, si responde). */
  lastAssistantId?: string
  /** La conversación pedida no existe (p. ej. un enlace a un hilo borrado): la pantalla empieza una nueva. */
  missing: boolean
  /** La respuesta que se está escribiendo ahora (la última del hilo, solo mientras responde). */
  liveId?: string
  /** Se acaba de enviar y la respuesta aún no existe: desde cuándo (para la línea de «pensando»). */
  pendingSince?: string
  send: (threadId: string, draft: Draft, context?: TutorContext) => Promise<boolean>
  /** Fallo que se puede reintentar ahora; nunca reconstruye archivos ni contexto en el renderer. */
  retryableId?: string
  retry: (threadId: string, failedMessageId: string) => Promise<boolean>
  /** Quita un mensaje de la cola; devuelve lo que tenía si de verdad se quitó (para devolverlo a la caja). */
  cancel: (messageId: string) => Promise<AssistantMessage | undefined>
  stop: () => void
}

/** La conversación `id` en vivo, con la cola y el envío optimista (el mensaje se ve al momento). */
export function useConversation(id: string | null): Conversation {
  const [thread, setThread] = useState<AssistantThread | null>(null)
  const [busy, setBusy] = useState<BusyState>({ busy: false })
  const [queued, setQueued] = useState<AssistantMessage[]>([])
  const [missing, setMissing] = useState(false)
  /** Envíos que el proceso principal aún no ha confirmado. */
  const [sending, setSending] = useState(0)
  const sendingTo = useRef(new Map<string, number>())
  const [retries, setRetries] = useState(() => new Map<string, PendingRetry>())
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const visibleId = useRef(id)
  visibleId.current = id
  // Un refresh solicitado antes de un evento no debe sobrescribir el texto/estado más reciente.
  const revision = useRef(0)

  const adopt = useCallback((view: AssistantThreadView) => {
    revision.current++
    const { run, ...t } = view
    // lo que se acaba de enviar puede no estar aún en la respuesta (se pidió antes): no se pierde
    setThread((cur) => (cur && cur.id === t.id ? keepOptimistic(t, cur) : t))
    setBusy(run ? { busy: run.busy, ...(run.label ? { label: run.label } : {}) } : { busy: false })
    setQueued(run?.queued ?? [])
  }, [])

  useEffect(() => {
    // la conversación recién creada que ya se enseña no se borra mientras llega
    setThread((cur) => (cur && cur.id === id ? cur : null))
    setQueued([])
    setBusy({ busy: false })
    setMissing(false)
    if (!id) return
    let alive = true
    api
      .invoke('chat.thread', { id })
      .then((t) => {
        if (!alive) return
        if (t) adopt(t)
        else setMissing(true)
      })
      .catch(() => alive && isDemo() && setThread(demoThreads().find((t) => t.id === id) ?? null))
    const offs = [
      api.on('chat.message', ({ threadId, message }) => {
        if (threadId === id) { revision.current++; setThread((t) => (t ? upsert(t, message) : t)) }
      }),
      api.on('chat.status', (s) => {
        if (s.threadId === id) { revision.current++; setBusy({ busy: s.busy, ...(s.label ? { label: s.label } : {}) }) }
      }),
      api.on('chat.queue', ({ threadId, queued: list, sent }) => {
        if (threadId !== id) return
        revision.current++
        setQueued(list)
        if (sent) setThread((t) => (t ? upsert(t, sent) : t))
      })
    ]
    return () => {
      alive = false
      for (const off of offs) off()
    }
  }, [id, adopt])

  const lastAssistant = useMemo(() => thread?.messages.filter((m) => m.role === 'assistant').at(-1), [thread])
  const retrying = id ? retries.get(id) : undefined
  const currentBusy = retrying ? { ...busy, busy: true } : busy
  const awaiting = busy.busy && !!lastAssistant?.cards.some((c) => c.state === 'pending' && (c.kind === 'question' || c.kind === 'approval'))
  const retryableId = retryableFailure(thread?.messages ?? [], currentBusy.busy || sending > 0 || queued.length > 0)
  const live = useRef({ busy: currentBusy.busy, awaiting, retryableId })
  live.current = { busy: currentBusy.busy, awaiting, retryableId }

  const requestRetry = useMemo(() => createRetryRequest({
    send: async (request) => {
      await api.invoke('chat.retry', request)
      if (!mounted.current || visibleId.current !== request.threadId) return
      // Un recibo idempotente puede no emitir eventos nuevos. Reconciliar también el run/busy de main.
      const before = revision.current
      const fresh = await api.invoke('chat.thread', { id: request.threadId })
      if (mounted.current && visibleId.current === request.threadId && revision.current === before) {
        if (fresh) adopt(fresh)
        else { setThread(null); setMissing(true) }
      }
    },
    changed: ({ threadId }, pending) => {
      if (!mounted.current) return
      setRetries((current) => {
        const next = new Map(current)
        if (pending) next.set(threadId, pending)
        else next.delete(threadId)
        return next
      })
    },
    failed: (request, error) => {
      if (mounted.current && visibleId.current === request.threadId) toast.error((error as Error).message)
    }
  }), [adopt])

  const retry = useCallback((threadId: string, failedMessageId: string): Promise<boolean> => {
    if (!mounted.current || visibleId.current !== threadId || live.current.retryableId !== failedMessageId || (sendingTo.current.get(threadId) ?? 0) > 0) return Promise.resolve(false)
    return requestRetry(threadId, failedMessageId)
  }, [requestRetry])

  /** Envía (o deja en cola). `false` si no se pudo: quien llama devuelve el texto a la caja (A3-P2-7: no se pierde). */
  const send = useCallback(async (threadId: string, draft: Draft, context?: TutorContext): Promise<boolean> => {
    // en un dispositivo, el aviso de la IA va antes que el mensaje: si se cancela, el texto vuelve a la caja sin parpadeos
    try {
      await askAIConsent('chat.send')
    } catch (e) {
      if (!isConsentDeclined(e)) toast.error((e as Error).message)
      return false
    }
    context = draftContext(draft, context)
    const optimistic = { ...userMessage(draft), ...(context ? { context } : {}) }
    revision.current++
    // mientras Aula responde (y no espera una respuesta), el mensaje espera en cola
    const toQueue = live.current.busy && (!live.current.awaiting || !!figureContentOf(optimistic))
    if (toQueue) setQueued((q) => [...q, optimistic])
    else setThread((th) => (th ? { ...th, messages: [...th.messages, optimistic] } : th))
    sendingTo.current.set(threadId, (sendingTo.current.get(threadId) ?? 0) + 1)
    setSending((n) => n + 1)
    try {
      const r = await api.invoke('chat.send', {
        threadId, text: draft.text, attachments: draft.files, messageId: optimistic.id, ...(draft.mentions.length ? { mentions: draft.mentions } : {}), ...(context ? { context } : {})
      })
      // el proceso principal decide: si estaba respondiendo, a la cola; si no, enviado ya
      if (r.queued && !toQueue) {
        setThread((th) => (th ? { ...th, messages: th.messages.filter((m) => m.id !== optimistic.id) } : th))
        setQueued((q) => (q.some((m) => m.id === optimistic.id) ? q : [...q, optimistic]))
      } else if (!r.queued && toQueue) {
        setQueued((q) => q.filter((m) => m.id !== optimistic.id))
        setThread((th) => (th && !th.messages.some((m) => m.id === optimistic.id) ? { ...th, messages: [...th.messages, optimistic] } : th))
      }
      return true
    } catch (e) {
      setQueued((q) => q.filter((m) => m.id !== optimistic.id))
      setThread((th) => (th ? { ...th, messages: th.messages.filter((m) => m.id !== optimistic.id) } : th))
      toast.error((e as Error).message)
      return false
    } finally {
      const count = (sendingTo.current.get(threadId) ?? 1) - 1
      if (count) sendingTo.current.set(threadId, count)
      else sendingTo.current.delete(threadId)
      setSending((n) => Math.max(0, n - 1))
    }
  }, [])

  const cancel = useCallback(async (messageId: string) => {
    if (!id) return undefined
    const m = queued.find((x) => x.id === messageId)
    revision.current++
    setQueued((q) => q.filter((x) => x.id !== messageId))
    try {
      const r = await api.invoke('chat.cancelQueued', { threadId: id, messageId })
      return r.removed ? m : undefined
    } catch {
      return undefined
    }
  }, [id, queued])

  const stop = useCallback(() => {
    if (id) void api.invoke('chat.stop', { threadId: id }).catch(() => undefined)
  }, [id])

  // lo que ya se envió (llegó a la conversación) deja de verse en la cola
  const waiting = useMemo(() => queued.filter((q) => !thread?.messages.some((m) => m.id === q.id)), [queued, thread])
  const last = thread?.messages.at(-1)
  const liveId = busy.busy && last?.role === 'assistant' && !last.failed ? last.id : undefined
  const pendingSince = retrying && last?.id === retrying.failedMessageId ? retrying.since : (busy.busy || sending > 0) && last?.role === 'user' ? last.date : undefined
  return { thread, setThread, adopt, busy: currentBusy, queued: waiting, awaiting, missing, lastAssistantId: lastAssistant?.id, liveId, pendingSince, send, retryableId, retry, cancel, stop }
}

let localSeq = 0

/** El mensaje del estudiante tal como se enseña antes de que lo confirme el proceso principal. */
function userMessage(draft: Draft): AssistantMessage {
  localSeq += 1
  const attachments: AssistantAttachment[] = draft.files.map((p, i) => ({
    id: `local-file-${localSeq}-${i}`, kind: 'other', name: p.split(/[\\/]/).at(-1) ?? p, bytes: 0, status: 'processing', pages: 0, characters: 0, imageAssets: []
  }))
  return {
    id: `local-${Date.now().toString(36)}-${localSeq}`, role: 'user', text: draft.text, date: new Date().toISOString(), mentions: draft.mentions, attachments,
    cards: [], steps: [], notices: [], failed: false, interrupted: false
  }
}

/** La conversación recibida con los mensajes optimistas que aún no trae (los de id «local-…»). */
export function keepOptimistic(fresh: AssistantThread, cur: AssistantThread): AssistantThread {
  const missing = cur.messages.filter((m) => m.id.startsWith('local-') && !fresh.messages.some((x) => x.id === m.id))
  return missing.length ? { ...fresh, messages: [...fresh.messages, ...missing] } : fresh
}

function upsert(t: AssistantThread, m: AssistantMessage): AssistantThread {
  const i = t.messages.findIndex((x) => x.id === m.id)
  const messages = i >= 0 ? t.messages.map((x, k) => (k === i ? m : x)) : [...t.messages, m]
  return { ...t, messages, updated: m.date }
}

/** Parte el texto de un mensaje en trozos de prosa y bloques visuales (```aula-block {json}```). */
export type Segment = { kind: 'text'; text: string } | { kind: 'block'; raw: unknown } | { kind: 'slides'; raw: unknown }

export function splitSegments(text: string): Segment[] {
  const out: Segment[] = []
  const re = /```(aula-block|aula-slides|estudio-block|estudio-slides)\s*\n([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) })
    try {
      const raw = JSON.parse(m[2]) as unknown
      out.push({ kind: m[1].endsWith('slides') ? 'slides' : 'block', raw })
    } catch {
      out.push({ kind: 'text', text: m[0] })
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out.filter((s) => s.kind !== 'text' || s.text.trim())
}
