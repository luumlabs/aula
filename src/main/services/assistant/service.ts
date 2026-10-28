// El chat con Aula y el tutor de cada curso (port de AssistantModel.swift, la parte que no es interfaz): conversaciones, turnos con
// la respuesta en vivo (emitida entera cada ~60 ms), tarjetas, cola de lo que se escribe mientras responde, detener y continuar,
// errores contados para el estudiante, «Novedades de Aula», menciones, citas y sugerencias.
//
// Cada turno corre en nombre de un actor del historial («chat-<hilo>-<mensaje>» o «tutor-…»): lo que Aula cambie en los cursos, el
// calendario o la memoria queda en «Cambios de Aula» como un grupo y se puede deshacer entero.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { IDs } from '@engine/base/ids'
import { AssistantTurns, bestCitationMatch, buildCatalog, extractCitations, oneLine, readable, redactSecrets, titleFrom, type AssistantCatalog } from '@engine/assistant'
import type { AssistantCalendar } from '@engine/calendar'
import { ContentValidator } from '@engine/content/validator'
import { aiLocale, tr } from '@shared/ai/i18n'
import type {
  AssistantCard, AssistantCitation, AssistantMessage, AssistantRef, AssistantRunState, AssistantStudySet, AssistantThread, AssistantThreadSummary, TutorContext
} from '@shared/assistant/types'
import { UPDATES_THREAD } from '@shared/automations/types'
import type { ChangeActor } from '@shared/schema/history'
import { resolveActiveModel } from '../ai'
import { AIError } from '../ai/errors'
import type { ChatModel } from '../ai/model'
import { withAIUse } from '../costs'
import { AulaError, invalidArgs } from '../errors'
import { log } from '../log'
import type { MemoryService } from '../memory/service'
import { conversationDeleted, conversationEnded, observeTurn, type MemoryCourse } from '../memory/hook'
import type { VectorSearcher } from '../search/hybrid'
import { getSettings } from '../settings'
import { LiveWebAccess, type WebAccess } from '../tools'
import { ChangeContext } from '../store/history/context'
import type { Library } from '../store/library'
import type { PackStore } from '../store/packStore'
import { MAX_ATTACHMENTS, pendingAttachment, processAttachment, type AttachmentMedia } from './attachments'
import { Answer, AssistantBroker, type AssistantAnswer } from './broker'
import { cutOffNotice, explainError } from './errors'
import { isFakeModel, streamingFake } from './fake'
import { GoalStore } from './goals'
import type { AssistantAppControl, AssistantTarget, CourseTeam, PlatformReader } from './host'
import { contextIsEmpty, decodeContext, decodeRef, expirePending, isPendingCard, newMessage, newThread } from './models'
import type { AssistantAppInfo } from './prompts'
import { runTurn, type TurnDeps, type TurnEvents } from './session'
import { AssistantStore, displayTitle, threadPreview } from './store'
import { catalogCourses, catalogEvents, saveStudySet } from './tools'

/** «Novedades de Aula» no crece sin fin. */
export const UPDATES_CAP = 400
export { UPDATES_THREAD }

/** Adónde van los avisos (el manejador de IPC los emite a la interfaz). */
export interface AssistantSink {
  message(threadId: string, message: AssistantMessage): void
  threads(): void
  status(threadId: string, busy: boolean, label?: string): void
  navigate?(threadId: string, target: AssistantTarget): void
  /** La cola entera de lo que espera a que Aula termine; `sent` = lo que acaba de enviarse (un solo mensaje). */
  queue?(threadId: string, queued: AssistantMessage[], sent?: AssistantMessage): void
}

export interface AssistantSettingsView {
  appLanguage: string
  dailyMinutes: number
  allowWeb: boolean
}

export interface AssistantServiceOptions {
  /** `<datos>` (las conversaciones del chat van en `<datos>/Assistant`). */
  root: string
  library: () => Library
  sink?: AssistantSink
  /** La IA del chat (por defecto, la activa; la simulada responde como Aula poco a poco). */
  model?: () => Promise<ChatModel>
  visionHelpers?: () => Promise<ChatModel[]>
  calendar?: () => AssistantCalendar | undefined
  memory?: () => MemoryService | undefined
  control?: () => AssistantAppControl | undefined
  team?: () => CourseTeam | undefined
  platform?: () => PlatformReader | undefined
  media?: AttachmentMedia
  settings?: () => AssistantSettingsView
  validator?: ContentValidator
  /** Internet para `web_search`/`fetch_url` (por defecto, el lector de páginas públicas de Aula). */
  web?: () => WebAccess | undefined
  vectors?: (packDir: string) => VectorSearcher | undefined
  /** false = nadie contesta tarjetas (las preguntas caducan y los permisos se deniegan al momento). */
  interactive?: boolean
  /** Cada cuánto se emite la respuesta en vivo como mucho (60 ms). */
  throttleMs?: number
  /** Cada cuánto se guarda lo que ya llegó (1,2 s). */
  partialMs?: number
  /** Espera antes del reintento automático tras un fallo pasajero (2 s). */
  retryDelayMs?: number
  /** Pausa entre trozos de la IA simulada. */
  fakeDelayMs?: number
}

/** Una conversación con un turno en marcha (o con mensajes en cola). */
interface Run {
  thread: AssistantThread
  store: AssistantStore
  busy: boolean
  live?: AssistantMessage
  status?: string
  broker: AssistantBroker
  controller?: AbortController
  turns: AssistantTurns
  /** Mensajes automáticos que llegaron mientras respondía (van después de la respuesta). */
  deliveries: AssistantMessage[]
  /** Rutas de los adjuntos aún sin leer, por id. */
  paths: Map<string, string>
  /** Mensajes del estudiante cuyo id es el de la interfaz (sus cambios se emiten). */
  clientIDs: Set<string>
  /** Avisos para la próxima respuesta («Quité una clave del mensaje»). */
  notices: string[]
  /** La respuesta escrita en la caja a una tarjeta que esperaba: id del mensaje (y si la interfaz ya lo enseña con ese id). */
  composerReply?: { id: string; emit: boolean }
  emitTimer?: ReturnType<typeof setTimeout>
  partialTimer?: ReturnType<typeof setTimeout>
  done?: Promise<void>
}

const SAFE_ID = /^[\p{L}\p{N}_.:-]{1,80}$/u
const safeID = (raw: unknown): string | undefined => (typeof raw === 'string' && SAFE_ID.test(raw) ? raw : undefined)

/** ¿Tiene algo que enseñar? */
export const hasContent = (m: AssistantMessage): boolean => m.text !== '' || m.cards.length > 0 || m.notices.length > 0

/** Lo que el estudiante ya hizo en un cuestionario (respuestas, guardado) pasa a la versión nueva de la tarjeta. */
export function mergeStudySet(mine: AssistantStudySet, theirs: AssistantStudySet | undefined): AssistantStudySet {
  if (!theirs) return mine
  const out: AssistantStudySet = { ...mine, results: { ...mine.results, ...theirs.results }, inputs: { ...mine.inputs, ...theirs.inputs } }
  if (theirs.savedTo) {
    out.savedTo = theirs.savedTo
    if (theirs.courseID) out.courseID = theirs.courseID
    if (theirs.skillID) out.skillID = theirs.skillID
  }
  return out
}

/** El mensaje que deja el turno, con la identidad de la respuesta en vivo (la fila no se rehace) y lo que el estudiante hizo en
 * sus tarjetas mientras tanto. */
export function settled(m: AssistantMessage, live: AssistantMessage | undefined): AssistantMessage {
  if (!live) return m
  const cards = m.cards.map((c) => {
    const theirs = live.cards.find((x) => x.id === c.id)
    return c.studySet && theirs?.studySet ? { ...c, studySet: mergeStudySet(c.studySet, theirs.studySet) } : c
  })
  const notices = [...live.notices]
  for (const n of m.notices) if (!notices.includes(n)) notices.push(n)
  return { ...m, id: live.id, cards, notices, ...(live.provider && !m.provider ? { provider: live.provider } : {}) }
}

function upsertCard(m: AssistantMessage, c: AssistantCard): void {
  const i = m.cards.findIndex((x) => x.id === c.id)
  if (i < 0) { m.cards.push(c); return }
  const before = m.cards[i]
  m.cards[i] = c.studySet && before.studySet ? { ...c, studySet: mergeStudySet(c.studySet, before.studySet) } : c
}

const copyMessage = (m: AssistantMessage): AssistantMessage => ({ ...m, cards: [...m.cards], steps: [...m.steps], notices: [...m.notices], attachments: [...m.attachments], mentions: [...m.mentions] })

/** El grupo del historial de un turno: uno por mensaje del estudiante. */
export function changeActor(thread: AssistantThread, message: AssistantMessage): ChangeActor {
  const kind = thread.courseID ? 'tutor' : 'chat'
  const text = oneLine(message.text, 140)
  const actor: ChangeActor = {
    kind, group: `${kind}-${IDs.slug(thread.id, 24)}-${IDs.slug(message.id, 24)}`, label: text || (kind === 'tutor' ? tr('Tutor', 'Tutor') : tr('Chat con Aula', 'Chat with Aula'))
  }
  if (thread.courseID) actor.courseID = thread.courseID
  return actor
}

const delay = (ms: number): Promise<void> => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.() })

export class AssistantService {
  readonly assistantRoot: string
  private readonly runs = new Map<string, Run>()
  /** Conversaciones nuevas aún sin mensajes (no se guardan hasta el primero). */
  private readonly drafts = new Map<string, AssistantThread>()
  private readonly courseStores = new Map<string, AssistantStore>()
  private readonly threadCourse = new Map<string, string>()
  /** Conversaciones usadas en esta sesión (para aprender de ellas al cerrar). */
  private readonly touched = new Set<string>()
  private catalog?: { at: number; catalog: AssistantCatalog }
  private liveWeb?: WebAccess
  readonly global: AssistantStore
  private readonly validator: ContentValidator

  constructor(private readonly opts: AssistantServiceOptions) {
    this.assistantRoot = join(opts.root, 'Assistant')
    this.global = new AssistantStore(this.assistantRoot)
    this.validator = opts.validator ?? ContentValidator.withMath()
  }

  private get library(): Library { return this.opts.library() }
  private get sink(): AssistantSink | undefined { return this.opts.sink }
  private get memory(): MemoryService | undefined {
    try { return this.opts.memory?.() } catch { return undefined }
  }

  private settings(): AssistantSettingsView {
    if (this.opts.settings) return this.opts.settings()
    let allowWeb = true
    try { allowWeb = getSettings().data.webSearch } catch { allowWeb = true }
    return { appLanguage: aiLocale(), dailyMinutes: 30, allowWeb }
  }

  private async model(): Promise<ChatModel> {
    if (this.opts.model) return this.opts.model()
    const m = await resolveActiveModel()
    return isFakeModel(m) ? streamingFake(m, this.opts.fakeDelayMs) : m
  }

  // MARK: Dónde vive cada conversación

  /** El almacén de las conversaciones del tutor de un curso (undefined si el curso no existe). */
  courseStore(courseID: string): AssistantStore | undefined {
    const pack = this.library.openPack(courseID)
    if (!pack) { this.courseStores.delete(courseID); return undefined }
    const cached = this.courseStores.get(courseID)
    if (cached) return cached
    const s = new AssistantStore(this.assistantRoot, pack)
    this.courseStores.set(courseID, s)
    return s
  }

  private storeFor(courseID: string | undefined): AssistantStore {
    return (courseID ? this.courseStore(courseID) : undefined) ?? this.global
  }

  private courseOfThread(id: string): string | undefined {
    const cached = this.threadCourse.get(id)
    if (cached && existsSync(this.storeFor(cached).path(id))) return cached
    for (const cid of this.library.packIDs()) {
      const s = this.courseStore(cid)
      if (s && existsSync(s.path(id))) {
        this.threadCourse.set(id, cid)
        return cid
      }
    }
    return undefined
  }

  private find(id: string): { thread: AssistantThread; store: AssistantStore; draft?: boolean } | undefined {
    const run = this.runs.get(id)
    if (run) return { thread: run.thread, store: run.store }
    const d = this.drafts.get(id)
    if (d) return { thread: d, store: this.storeFor(d.courseID), draft: true }
    const g = this.global.thread(id)
    if (g) return { thread: g, store: this.global }
    const course = this.courseOfThread(id)
    const s = course ? this.courseStore(course) : undefined
    const t = s?.thread(id)
    return s && t ? { thread: t, store: s } : undefined
  }

  private courseOf(thread: AssistantThread): MemoryCourse | undefined {
    if (!thread.courseID) return undefined
    let title = thread.courseID
    try { title = this.library.openPack(thread.courseID)?.loadPack().title ?? title } catch { /* sin título */ }
    return { id: thread.courseID, title }
  }

  /** La conversación con un turno (la crea si hace falta; una que no existe pasa a ser nueva con ese id). */
  private runFor(id: string): Run {
    const existing = this.runs.get(id)
    if (existing) return existing
    const found = this.find(id)
    const thread = found?.thread ?? newThread({ id })
    const run: Run = {
      thread, store: found?.store ?? this.global, busy: false, broker: new AssistantBroker(), turns: new AssistantTurns(), deliveries: [], paths: new Map(),
      clientIDs: new Set(), notices: []
    }
    this.drafts.delete(id)
    this.runs.set(id, run)
    return run
  }

  /** Sin turno ni cola, la conversación vuelve a vivir solo en disco. */
  private release(run: Run): void {
    if (run.busy || run.turns.queued.length) return
    if (this.runs.get(run.thread.id) === run) this.runs.delete(run.thread.id)
  }

  private persist(run: Run, touch = true): void {
    if (touch) run.thread.updated = new Date().toISOString()
    try {
      run.store.save(run.thread, false)
    } catch (err) {
      log.warn('Chat: no se pudo guardar la conversación', err)
    }
  }

  // MARK: Al abrir y al cerrar

  /** Lo que quedó a medias al cerrarse la app pasa a su conversación como «Respuesta interrumpida». */
  recoverInterrupted(): string[] {
    const out = [...this.global.recoverInterrupted()]
    for (const cid of this.library.packIDs()) {
      const s = this.courseStore(cid)
      if (s && existsSync(s.threadsDirectory)) out.push(...s.recoverInterrupted())
    }
    if (out.length) this.sink?.threads()
    return out
  }

  /** Detiene lo que esté en marcha y deja que la memoria aprenda de las conversaciones de esta sesión. */
  shutdown(): void {
    for (const run of [...this.runs.values()]) if (run.busy) this.halt(run, 'keep')
    const memory = this.memory
    for (const id of this.touched) {
      const f = this.find(id)
      if (f) conversationEnded(memory, f.thread, this.courseOf(f.thread))
    }
    this.touched.clear()
  }

  // MARK: Lista y conversaciones

  threads(): AssistantThreadSummary[] {
    const out: AssistantThreadSummary[] = []
    const add = (t: AssistantThread, courseTitle?: string): void => {
      const run = this.runs.get(t.id)
      const shown = run?.thread ?? t
      const s: AssistantThreadSummary = { id: t.id, title: displayTitle(shown), preview: threadPreview(shown), updated: shown.updated, pinned: shown.pinned, busy: run?.busy ?? false }
      if (shown.courseID) { s.courseID = shown.courseID; if (courseTitle) s.courseTitle = courseTitle }
      out.push(s)
    }
    for (const t of this.global.summaries()) add(t)
    for (const cid of this.library.packIDs()) {
      const s = this.courseStore(cid)
      if (!s || !existsSync(s.threadsDirectory)) continue
      let title: string | undefined
      try { title = this.library.openPack(cid)?.loadPack().title } catch { title = undefined }
      for (const t of s.summaries()) { this.threadCourse.set(t.id, cid); add(t, title) }
    }
    // una conversación en marcha que aún no estaba en disco
    for (const run of this.runs.values()) if (!out.some((s) => s.id === run.thread.id) && run.thread.messages.length) add(run.thread)
    return out.sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || b.updated.localeCompare(a.updated))
  }

  /** La conversación entera (con la respuesta en vivo al final si está respondiendo). */
  thread(id: string): AssistantThread | null {
    const run = this.runs.get(id)
    if (run) return { ...run.thread, messages: [...run.thread.messages, ...(run.live ? [copyMessage(run.live)] : [])] }
    return this.find(id)?.thread ?? null
  }

  /** Conversación nueva (no se guarda hasta el primer mensaje). Con un curso en el contexto, es del tutor de ese curso. */
  newThread(context?: TutorContext): AssistantThread {
    const courseID = context?.courseID && this.library.openPack(context.courseID) ? context.courseID : undefined
    const t = newThread(courseID ? { courseID } : {})
    this.drafts.set(t.id, t)
    return t
  }

  /** La última conversación del tutor de un curso (o una nueva). */
  latestTutorThread(courseID: string): AssistantThread {
    const s = this.courseStore(courseID)
    const latest = s?.summaries()[0]
    return (latest ? this.thread(latest.id) : null) ?? this.newThread({ courseID })
  }

  rename(id: string, title: string): void {
    this.mutate(id, (t) => { t.title = oneLine(title, 120) })
  }

  pin(id: string, pinned: boolean): void {
    this.mutate(id, (t) => { t.pinned = pinned })
  }

  private mutate(id: string, fn: (t: AssistantThread) => void): void {
    const run = this.runs.get(id)
    if (run) {
      fn(run.thread)
      if (run.thread.messages.length) this.persist(run, false)
      this.sink?.threads()
      return
    }
    const f = this.find(id)
    if (!f) throw new AulaError('not_found', tr('No encuentro esa conversación.', "I can't find that conversation."))
    fn(f.thread)
    if (!f.draft) f.store.save(f.thread, false)
    this.sink?.threads()
  }

  /** Borra la conversación, sus adjuntos y su objetivo; la memoria no aprende de ella. */
  delete(id: string): void {
    const run = this.runs.get(id)
    if (run?.busy) this.halt(run, 'drop')
    const f = this.find(id)
    this.runs.delete(id)
    this.drafts.delete(id)
    this.touched.delete(id)
    if (!f) return
    if (!f.draft) f.store.delete(id)
    conversationDeleted(this.memory, id, this.courseOf(f.thread))
    try { new GoalStore(this.assistantRoot).remove(id, f.thread.courseID) } catch { /* sin objetivo */ }
    this.threadCourse.delete(id)
    this.sink?.threads()
  }

  // MARK: Enviar

  /** Un mensaje del estudiante. Si Aula está respondiendo: contesta a la tarjeta que espera (si la hay) o espera en cola
   * (`queued`; se envía solo cuando termina la respuesta y se puede quitar con `cancelQueued`). */
  send(args: { threadId: string; text: string; mentions?: unknown[]; attachments?: string[]; context?: unknown; messageId?: string }): { messageId: string; queued: boolean } {
    const id = safeID(args.threadId)
    if (!id) throw invalidArgs(tr('Conversación no válida', 'Invalid conversation'))
    const { text, redacted } = redactSecrets((args.text ?? '').trim())
    const run = this.runFor(id)
    const clientID = safeID(args.messageId)
    // contestar escribiendo a una pregunta o un permiso que espera
    const pendingCard = run.busy ? [...(run.live?.cards ?? [])].reverse().find((c) => isPendingCard(c) && (c.kind === 'question' || c.kind === 'approval') && run.broker.pendingIDs.includes(c.id)) : undefined
    if (pendingCard && text) {
      const replyID = clientID ?? IDs.short(8)
      run.composerReply = { id: replyID, emit: !!clientID }
      run.broker.resolve(pendingCard.id, Answer.typed(text, true))
      return { messageId: replyID, queued: false }
    }
    const context = decodeContext(args.context)
    const mentions = (args.mentions ?? []).slice(0, 12).flatMap((r) => { const x = decodeRef(r); return x ? [x] : [] })
    const attachments = (args.attachments ?? []).filter((p): p is string => typeof p === 'string' && p.length > 0 && p.length < 4096).slice(0, MAX_ATTACHMENTS).map((p) => {
      const a = pendingAttachment(p)
      run.paths.set(a.id, p)
      return a
    })
    if (!text && !attachments.length) throw invalidArgs(tr('El mensaje está vacío.', 'The message is empty.'))
    if (redacted) run.notices.push(tr('Quité una clave del mensaje: Aula nunca envía tus claves.', 'I removed a key from the message: Aula never sends your keys.'))
    // una conversación nueva del chat con un curso en el contexto pasa a ser del tutor de ese curso
    if (!run.thread.messages.length && !run.thread.courseID && context?.courseID && !existsSync(this.global.path(id)) && this.courseStore(context.courseID)) {
      run.thread.courseID = context.courseID
      run.store = this.storeFor(context.courseID)
      this.threadCourse.set(id, context.courseID)
    }
    const msg = newMessage('user', text, { ...(clientID ? { id: clientID } : {}), mentions, attachments, ...(context && !contextIsEmpty(context) ? { context } : {}) })
    if (clientID) run.clientIDs.add(clientID)
    const queued = run.busy
    this.submit(run, msg)
    return { messageId: msg.id, queued }
  }

  private submit(run: Run, msg: AssistantMessage): void {
    this.touched.add(run.thread.id)
    // si Aula está respondiendo, espera su turno; nunca se pierde
    if (run.busy) { this.enqueue(run, msg); return }
    run.thread.messages.push(msg)
    if (!run.thread.title.trim()) run.thread.title = titleFrom(msg.text || (msg.attachments[0]?.name ?? ''))
    this.persist(run)
    this.begin(run, msg)
  }

  private enqueue(run: Run, msg: AssistantMessage): void {
    run.turns.enqueue(msg)
    this.emitQueue(run)
  }

  private emitQueue(run: Run, sent?: AssistantMessage): void {
    this.sink?.queue?.(run.thread.id, run.turns.queued.map(copyMessage), sent ? copyMessage(sent) : undefined)
  }

  /** Lo que esperaba en cola se envía ahora, en un solo mensaje (como lo leería una persona). */
  private sendQueued(run: Run): boolean {
    const merged = run.turns.takeMerged()
    if (!merged) return false
    this.emitQueue(run, merged)
    this.submit(run, merged)
    return true
  }

  /** Quita un mensaje de la cola (el «×» de la burbuja que espera). false si ya no estaba (se envió). */
  cancelQueued(threadId: string, messageId: string): boolean {
    const run = this.runs.get(threadId)
    const m = run?.turns.remove(messageId)
    if (!run || !m) return false
    for (const a of m.attachments) run.paths.delete(a.id)
    run.clientIDs.delete(m.id)
    this.emitQueue(run)
    this.release(run)
    return true
  }

  /** Lo que solo vive en memoria (para la interfaz al abrir la conversación): si responde, qué hace y la cola. */
  runState(threadId: string): AssistantRunState | undefined {
    const run = this.runs.get(threadId)
    if (!run) return undefined
    return { busy: run.busy, ...(run.busy && run.status ? { label: run.status } : {}), queued: run.turns.queued.map(copyMessage) }
  }

  /** `liveId`: al reintentar solo, la respuesta en vivo sigue siendo la misma burbuja (antes salía una vacía por intento). */
  private begin(run: Run, message: AssistantMessage, autoRetried = false, liveId?: string): void {
    const turn = run.turns.begin()
    run.busy = true
    run.live = newMessage('assistant', '', { notices: run.notices.splice(0), ...(liveId ? { id: liveId } : {}) })
    run.controller = new AbortController()
    run.broker = new AssistantBroker()
    this.setStatus(run, tr('Pensando…', 'Thinking…'))
    this.emitLive(run, true)
    this.sink?.threads()
    run.done = this.turn(run, turn, message, autoRetried).catch((err) => { log.warn('Chat: el turno falló sin control', err) })
  }

  /** Para las pruebas: espera a que termine el turno en curso de una conversación. */
  async idle(threadId: string): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const run = this.runs.get(threadId)
      if (!run?.done) return
      const done = run.done
      await done
      if (this.runs.get(threadId)?.done === done) return
    }
  }

  private async turn(run: Run, turn: number, message: AssistantMessage, autoRetried: boolean): Promise<void> {
    const current = (): boolean => run.turns.isCurrent(turn)
    const signal = run.controller!.signal
    // adjuntos: se leen antes de responder
    const toRead = message.attachments.filter((a) => a.status === 'processing' && run.paths.has(a.id))
    if (toRead.length) {
      this.setStatus(run, tr('Leyendo lo que adjuntaste…', 'Reading what you attached…'))
      const files = run.store.files(run.thread.id)
      const settings = this.settings()
      const done = await Promise.all(message.attachments.map((a) => {
        const p = run.paths.get(a.id)
        return p && a.status === 'processing' ? processAttachment(p, a, files, { media: this.opts.media, language: settings.appLanguage, signal }) : Promise.resolve(a)
      }))
      for (const a of toRead) run.paths.delete(a.id)
      if (!current()) return
      message = { ...message, attachments: done }
      this.replaceMessage(run, message)
      this.setStatus(run, tr('Pensando…', 'Thinking…'))
    }
    let model: ChatModel | undefined
    try {
      model = await this.model()
      if (!current()) return
      const actor = changeActor(run.thread, message)
      const snapshot: AssistantThread = { ...run.thread, messages: [...run.thread.messages] }
      const deps = this.deps(run, model)
      const last = await ChangeContext.run(actor, () => withAIUse({ purpose: run.thread.courseID ? 'tutor' : 'chat', ...(run.thread.courseID ? { courseID: run.thread.courseID } : {}), label: actor.label },
        () => runTurn({ thread: snapshot, message, broker: run.broker, signal }, deps, this.events(run, turn, message.id))))
      if (!current()) return
      const final = this.settle(run, last, true)
      observeTurn(this.memory, run.thread, final, this.courseOf(run.thread))
    } catch (err) {
      if (!current() || signal.aborted) return
      const explained = explainError(err, run.live?.provider ?? model?.providerName)
      // un fallo pasajero antes de que llegara nada: se reintenta solo una vez (la red ya la reintentó la capa HTTP con espera)
      const httpRetried = err instanceof AIError && (err.kind === 'network' || err.kind === 'timeout')
      const empty = !!run.live && !hasContent(run.live) && !run.live.steps.length
      if (explained.transient && !httpRetried && !autoRetried && run.live && empty) {
        const liveId = run.live.id
        this.setStatus(run, tr('Reintentando…', 'Retrying…'))
        await delay(this.opts.retryDelayMs ?? 2000)
        if (!current()) return
        run.busy = false
        this.begin(run, message, true, liveId)
        return
      }
      log.info('Chat: el turno falló', explained.code, explained.message)
      // A3-P1-4: un corte a mitad (el wifi del campus) con texto o pasos ya llegados: la misma burbuja se queda como «Respuesta
      // interrumpida · Continuar», con el motivo dentro; no parece terminada ni sale otra burbuja que culpe a la conexión
      const partial = !!run.live && (!!run.live.text.trim() || run.live.steps.length > 0)
      if (run.live && partial && explained.transient) {
        run.live.notices.push(cutOffNotice(explained))
        this.keepLive(run, true)
        this.persist(run)
      } else {
        const provider = run.live?.provider
        // si no llegó nada, el error ocupa la misma burbuja: no queda una «Aula» vacía encima (J2-10)
        const reuse = empty && run.live ? { id: run.live.id } : {}
        // lo que ya había llegado (un error que no es de red, p. ej. la clave o el límite) también queda como interrumpido
        this.keepLive(run, true)
        const failed = newMessage('assistant', explained.message, { failed: true, ...reuse, ...(provider ? { provider } : {}) })
        run.thread.messages.push(failed)
        this.persist(run)
        this.sink?.message(run.thread.id, failed)
      }
    }
    this.finish(run)
  }

  private deps(run: Run, model: ChatModel): TurnDeps {
    const s = this.settings()
    const thread = run.thread
    return {
      library: this.library, store: run.store, model, validator: this.validator, appLanguage: s.appLanguage, dailyMinutes: s.dailyMinutes, allowWeb: s.allowWeb,
      interactive: this.opts.interactive ?? true,
      ...(this.opts.visionHelpers ? { visionHelpers: this.opts.visionHelpers } : {}),
      ...(this.opts.calendar?.() ? { calendar: this.opts.calendar()! } : {}),
      control: this.opts.control?.() ?? this.defaultControl(model),
      ...(this.opts.team?.() ? { team: this.opts.team()! } : {}),
      ...(this.memory ? { memory: this.memory } : {}),
      ...(this.opts.platform?.() ? { platform: this.opts.platform()! } : {}),
      ...(this.opts.vectors ? { vectors: this.opts.vectors } : {}),
      ...(s.allowWeb ? { web: this.opts.web ? this.opts.web() : (this.liveWeb ??= new LiveWebAccess()) } : {}),
      navigate: (target) => this.sink?.navigate?.(thread.id, target),
      courseChanged: () => this.invalidateCatalog(),
      studySetOverride: (id) => run.live?.cards.find((c) => c.studySet?.id === id)?.studySet
    }
  }

  private defaultControl(model: ChatModel): AssistantAppControl {
    return {
      appInfo: async (): Promise<AssistantAppInfo> => {
        const s = this.settings()
        let accounts: Array<{ label: string; baseURL: string; calendarSecretRef?: string; tokenSecretRef?: string }> = []
        try { accounts = getSettings().platforms.accounts } catch { accounts = [] }
        const host = (u: string): string => { try { return new URL(u).hostname } catch { return u } }
        return {
          platforms: accounts.map((a) => `${a.label} · ${host(a.baseURL)}`), computerUseEnabled: !!this.opts.platform?.()?.ready(),
          platformDatesConnected: accounts.some((a) => !!a.calendarSecretRef || !!a.tokenSecretRef), dailyMinutes: s.dailyMinutes, courseLanguage: s.appLanguage,
          provider: model.providerName, webSearch: s.allowWeb
        }
      }
    }
  }

  // MARK: Lo que va llegando

  private events(run: Run, turn: number, userMessageID: string): TurnEvents {
    const live = (): AssistantMessage | undefined => (run.turns.isCurrent(turn) ? run.live : undefined)
    return {
      status: (label) => { if (run.turns.isCurrent(turn)) this.setStatus(run, label) },
      step: (s) => {
        const l = live()
        if (!l) return
        const i = l.steps.findIndex((x) => x.id === s.id)
        if (i >= 0) l.steps[i] = s
        else l.steps.push(s)
        this.changed(run)
      },
      text: (all) => {
        const l = live()
        if (!l) return
        l.text = all
        this.changed(run)
      },
      card: (c) => {
        const l = live()
        if (!l) return
        upsertCard(l, c)
        this.changed(run, true)
        if (c.kind === 'course') this.invalidateCatalog()
      },
      notice: (n) => {
        const l = live()
        if (!l || l.notices.includes(n)) return
        l.notices.push(n)
        this.changed(run)
      },
      provider: (p) => { const l = live(); if (l) l.provider = p },
      attachments: (list) => {
        if (!run.turns.isCurrent(turn)) return
        const m = run.thread.messages.find((x) => x.id === userMessageID)
        if (m) this.replaceMessage(run, { ...m, attachments: list })
      },
      segmentBreak: (closed, reply, fromComposer) => {
        const l = live()
        if (!l) return
        this.flushEmit(run)
        const c = settled(closed, l)
        if (hasContent(c)) {
          run.thread.messages.push(c)
          this.sink?.message(run.thread.id, c)
        }
        let emitReply = !fromComposer
        if (fromComposer && run.composerReply) {
          reply.id = run.composerReply.id
          emitReply = run.composerReply.emit
          run.composerReply = undefined
        }
        run.thread.messages.push(reply)
        if (emitReply) this.sink?.message(run.thread.id, reply)
        run.live = newMessage('assistant', '', { ...(l.provider ? { provider: l.provider } : {}) })
        this.persist(run)
        run.store.clearPartial(run.thread.id)
        this.emitLive(run, true)
      }
    }
  }

  private replaceMessage(run: Run, m: AssistantMessage): void {
    const i = run.thread.messages.findIndex((x) => x.id === m.id)
    if (i < 0) return
    run.thread.messages[i] = m
    this.persist(run, false)
    if (run.clientIDs.has(m.id)) this.sink?.message(run.thread.id, m)
  }

  private setStatus(run: Run, label: string | undefined): void {
    run.status = label
    this.sink?.status(run.thread.id, run.busy, label)
  }

  private changed(run: Run, now = false): void {
    this.emitLive(run, now)
    this.schedulePartial(run)
  }

  /** La respuesta en vivo, entera, como mucho cada `throttleMs`. */
  private emitLive(run: Run, now = false): void {
    if (now) {
      this.flushEmit(run)
      if (run.live) this.sink?.message(run.thread.id, copyMessage(run.live))
      return
    }
    if (run.emitTimer) return
    run.emitTimer = setTimeout(() => {
      run.emitTimer = undefined
      if (run.live) this.sink?.message(run.thread.id, copyMessage(run.live))
    }, this.opts.throttleMs ?? 60)
  }

  private flushEmit(run: Run): void {
    if (run.emitTimer) { clearTimeout(run.emitTimer); run.emitTimer = undefined }
  }

  /** Guarda lo que ya llegó como mucho cada `partialMs` (si la app se cierra a mitad, no se pierde). */
  private schedulePartial(run: Run): void {
    if (run.partialTimer) return
    run.partialTimer = setTimeout(() => {
      run.partialTimer = undefined
      const after = run.thread.messages.at(-1)?.id
      if (run.busy && run.live && hasContent(run.live) && after) run.store.savePartial(run.thread.id, after, run.live)
    }, this.opts.partialMs ?? 1200)
    run.partialTimer.unref?.()
  }

  private clearPartial(run: Run): void {
    if (run.partialTimer) { clearTimeout(run.partialTimer); run.partialTimer = undefined }
    run.store.clearPartial(run.thread.id)
  }

  /** El último trozo de la respuesta pasa a la conversación. */
  private settle(run: Run, last: AssistantMessage, final: boolean): AssistantMessage {
    this.flushEmit(run)
    const f = settled(last, run.live)
    if (final && f.text) {
      const cites = this.citationsFor(f.text, run.thread)
      if (cites.length) f.citations = cites
    }
    if (hasContent(f)) {
      run.thread.messages.push(f)
      this.sink?.message(run.thread.id, f)
    }
    run.live = undefined
    this.persist(run)
    this.clearPartial(run)
    return f
  }

  /** Lo que ya había llegado de la respuesta (al detenerla o si falla) no se pierde. `interrupted`: se cortó a mitad (Detener o
   * cerrar la app) y se queda como «Respuesta interrumpida», con «Continuar». */
  private keepLive(run: Run, interrupted = false): void {
    this.flushEmit(run)
    const l = run.live
    run.live = undefined
    if (!l) return
    expirePending(l)
    if (interrupted && (l.text.trim() || l.steps.length)) l.interrupted = true
    if (hasContent(l)) {
      run.thread.messages.push(l)
      this.sink?.message(run.thread.id, l)
    }
  }

  private finish(run: Run): void {
    run.busy = false
    run.controller = undefined
    if (run.live) { this.keepLive(run); this.persist(run) }
    this.clearPartial(run)
    this.flushDeliveries(run)
    this.setStatus(run, undefined)
    this.sink?.threads()
    // lo que se escribió mientras respondía va junto, en un solo mensaje (como lo leería una persona)
    if (!this.sendQueued(run)) this.release(run)
  }

  /** «Detener»: para SOLO la respuesta en curso (lo que ya llegó se queda, con las tarjetas que esperaban caducadas); lo que
   * esperaba en cola se envía a continuación. */
  stop(threadId: string): void {
    const run = this.runs.get(threadId)
    if (run?.busy) this.halt(run, 'send')
  }

  /** Corta el turno. Lo que esperaba en cola: se envía ('send'), se queda en la conversación sin respuesta ('keep', al cerrar la
   * app: no se pierde lo que escribiste) o se descarta ('drop', al borrar la conversación). */
  private halt(run: Run, queued: 'send' | 'keep' | 'drop'): void {
    run.turns.invalidate()
    run.broker.resolveAll(Answer.expired)
    run.controller?.abort()
    this.keepLive(run, queued !== 'drop')
    const waiting = queued === 'send' ? [] : run.turns.drain()
    if (queued === 'keep') {
      for (const m of waiting) {
        run.thread.messages.push(m)
        this.sink?.message(run.thread.id, m)
      }
    }
    if (waiting.length) this.emitQueue(run)
    this.persist(run)
    this.clearPartial(run)
    run.busy = false
    run.controller = undefined
    this.flushDeliveries(run)
    this.setStatus(run, undefined)
    this.sink?.threads()
    if (queued !== 'send' || !this.sendQueued(run)) this.release(run)
  }

  /** «Respuesta interrumpida» → «Continuar»: Aula sigue donde se cortó (ve lo que ya había escrito). */
  continue(threadId: string, messageId: string): void {
    const run = this.runFor(threadId)
    if (run.busy) return
    const m = run.thread.messages.find((x) => x.id === messageId)
    if (m?.interrupted) {
      m.interrupted = false
      this.sink?.message(run.thread.id, m)
    }
    const msg = newMessage('user', tr('Sigue donde lo dejaste.', 'Continue where you left off.'))
    this.sink?.message(run.thread.id, msg)
    this.submit(run, msg)
  }

  // MARK: Tarjetas

  /** Respuesta a una tarjeta: pregunta (optionId o answer), permiso (approve), cuestionario o tarjetas (answer = JSON con
   * `results`, `inputs` y, para guardarlo en un curso, `save: { courseID, skillID }`). */
  answerCard(args: { threadId: string; messageId: string; cardId: string; optionId?: string; answer?: string; approve?: boolean }): void {
    const run = this.runs.get(args.threadId)
    const inLive = run?.live?.cards.find((c) => c.id === args.cardId)
    const located = inLive ? undefined : this.locateCard(args.threadId, args.messageId, args.cardId)
    const card = inLive ?? located?.card
    if (!card) throw new AulaError('not_found', tr('Esa tarjeta ya no está.', 'That card is no longer there.'))
    if (card.kind === 'quiz' || card.kind === 'flashcards') {
      this.answerStudySet(args, card, run, located)
      return
    }
    // una tarjeta que espera en el turno en curso
    if (run?.busy && run.broker.pendingIDs.includes(card.id)) {
      run.broker.resolve(card.id, toAnswer(card, args))
      return
    }
    if (inLive && run?.busy) { run.broker.resolve(card.id, toAnswer(card, args)); return }
    if (!located) return
    // tarjeta de una respuesta que ya terminó (o de antes de cerrar la app)
    const { thread, message } = located
    if (card.kind === 'actions' || card.kind === 'automation') {
      const action = card.actions.find((a) => a.id === args.optionId)
      card.state = 'done'
      if (action) card.answer = action.label
    } else if (card.kind === 'question' && isPendingCard(card)) {
      const label = args.optionId ? card.options.find((o) => o.id === args.optionId)?.label : args.answer?.trim()
      if (!label) return
      card.state = 'answered'
      card.answer = label
      this.saveLocated(located)
      this.sink?.message(thread.id, message)
      // la pregunta caducó: lo que contestó va como mensaje nuevo
      const ref = args.optionId ? card.options.find((o) => o.id === args.optionId)?.ref : undefined
      const reply = newMessage('user', redactSecrets(label).text, { mentions: ref ? [ref] : [] })
      const r = this.runFor(thread.id)
      if (r.busy) { this.enqueue(r, reply); return }
      this.sink?.message(thread.id, reply)
      this.submit(r, reply)
      return
    } else if (isPendingCard(card)) {
      card.state = 'expired'
    }
    this.saveLocated(located)
    this.sink?.message(thread.id, message)
  }

  private locateCard(threadId: string, messageId: string, cardId: string): { thread: AssistantThread; store: AssistantStore; message: AssistantMessage; card: AssistantCard; draft?: boolean } | undefined {
    const f = this.find(threadId)
    if (!f) return undefined
    const message = f.thread.messages.find((m) => m.id === messageId) ?? f.thread.messages.find((m) => m.cards.some((c) => c.id === cardId))
    const card = message?.cards.find((c) => c.id === cardId)
    return message && card ? { ...f, message, card } : undefined
  }

  private saveLocated(l: { thread: AssistantThread; store: AssistantStore; draft?: boolean }): void {
    const run = this.runs.get(l.thread.id)
    if (run) { this.persist(run, false); return }
    if (!l.draft) l.store.save(l.thread, false)
  }

  private answerStudySet(args: { threadId: string; messageId: string; cardId: string; answer?: string }, card: AssistantCard, run: Run | undefined, located: ReturnType<AssistantService['locateCard']>): void {
    const set = card.studySet
    if (!set) return
    let raw: Record<string, unknown> = {}
    try {
      const v: unknown = args.answer ? JSON.parse(args.answer) : {}
      if (v && typeof v === 'object' && !Array.isArray(v)) raw = v as Record<string, unknown>
    } catch {
      throw invalidArgs(tr('Respuesta del cuestionario no válida', 'Invalid quiz answer'))
    }
    const next: AssistantStudySet = { ...set, results: { ...set.results }, inputs: { ...set.inputs } }
    if (raw.results && typeof raw.results === 'object') {
      for (const [k, v] of Object.entries(raw.results as Record<string, unknown>)) if (typeof v === 'boolean' && k.length <= 200) next.results[k] = v
    }
    if (raw.inputs && typeof raw.inputs === 'object') {
      for (const [k, v] of Object.entries(raw.inputs as Record<string, unknown>)) if (typeof v === 'string' && k.length <= 200) next.inputs[k] = v.slice(0, 4000)
    }
    const save = (raw.save ?? raw.saveTo) as Record<string, unknown> | undefined
    if (save && typeof save.courseID === 'string' && typeof save.skillID === 'string') {
      // la pulsación del estudiante es el permiso; se apunta en el historial como del chat
      const thread = run?.thread ?? located?.thread
      const actor = ChangeContext.newActor(thread?.courseID ? 'tutor' : 'chat', tr(`Guardar «${set.title}»`, `Save “${set.title}”`), save.courseID)
      const saved = ChangeContext.run(actor, () => saveStudySet(next, this.library, save.courseID as string, save.skillID as string, this.validator))
      next.savedTo = saved.label
      next.courseID = saved.courseID
      next.skillID = saved.skillID
    }
    card.studySet = next
    if (run?.live?.cards.includes(card)) { this.emitLive(run, true); return }
    if (located) {
      this.saveLocated(located)
      this.sink?.message(located.thread.id, located.message)
    }
  }

  // MARK: Mensajes automáticos (rutinas, automatizaciones, seguimientos)

  /** Deja un mensaje de Aula en su conversación: la que se pide si existe; si no, «Novedades de Aula» (fijada arriba, se crea si
   * hace falta). Mientras esa conversación responde, el mensaje espera al final de la respuesta. Devuelve el id del mensaje. */
  postSystemMessage(threadId: string | undefined, message: AssistantMessage): string {
    const msg: AssistantMessage = { ...message, role: 'assistant', id: safeID(message.id) ?? IDs.short(8) }
    const wanted = threadId && threadId !== UPDATES_THREAD && safeID(threadId) && (this.runs.has(threadId) || this.find(threadId)) ? threadId : UPDATES_THREAD
    const run = this.runs.get(wanted)
    if (run?.busy) { run.deliveries.push(msg); return msg.id }
    if (run) {
      this.appendDelivery(run.thread, msg)
      this.persist(run)
    } else {
      const f = this.find(wanted)
      const thread = f?.thread ?? newThread({ id: UPDATES_THREAD })
      this.appendDelivery(thread, msg)
      thread.updated = new Date().toISOString()
      this.drafts.delete(wanted)
      ;(f && !f.draft ? f.store : this.storeFor(thread.courseID)).save(thread, false)
    }
    this.sink?.message(wanted, msg)
    this.sink?.threads()
    return msg.id
  }

  private appendDelivery(thread: AssistantThread, msg: AssistantMessage): void {
    thread.messages.push(msg)
    if (thread.id === UPDATES_THREAD) {
      thread.title = tr('Novedades de Aula', 'Aula updates')
      thread.pinned = true
      if (thread.messages.length > UPDATES_CAP) thread.messages.splice(0, thread.messages.length - UPDATES_CAP)
    }
  }

  private flushDeliveries(run: Run): void {
    if (!run.deliveries.length) return
    for (const m of run.deliveries.splice(0)) {
      this.appendDelivery(run.thread, m)
      this.sink?.message(run.thread.id, m)
    }
    this.persist(run)
  }

  // MARK: Sugerencias, menciones y citas

  /** Para empezar, según dónde está el estudiante (port de AssistantModel.suggestions y TutorPanel.suggestions). */
  suggestions(context?: TutorContext): string[] {
    const course = context?.courseID ? this.library.openPack(context.courseID) : undefined
    if (course) {
      if (context?.exerciseID) {
        return [tr('Dame una pista sin darme la respuesta', "Give me a hint without the answer"), tr('Explícame mi error', 'Explain my mistake'),
          tr('Explícame el concepto de otra forma', 'Explain the concept another way'), tr('Ponme un ejercicio parecido aquí', 'Give me a similar exercise here')]
      }
      let skill: string | undefined
      try { skill = context?.skillID ? course.loadPack().skills.find((s) => s.id === context.skillID)?.title : undefined } catch { skill = undefined }
      if (skill) {
        const t = skill.includes('$') ? readable(skill) : skill
        return [tr(`Explícame «${t}» como si fuera nuevo para mí`, `Explain “${t}” as if it were new to me`), tr('¿Cuáles son los errores más comunes aquí?', 'What are the most common mistakes here?'),
          tr('Ponme un test rápido de esta lección', 'Give me a quick quiz on this lesson')]
      }
      return [tr('¿Qué debería repasar hoy?', 'What should I review today?'), tr('¿Cómo voy para el examen?', 'How am I doing for the exam?'),
        tr('Ponme un test rápido de lo que más me cuesta', 'Give me a quick quiz on what I find hardest'), tr('Resúmeme los temas más importantes en diapositivas', 'Summarize the most important topics in slides')]
    }
    const packs = this.library.listPacks()
    if (!packs.length) {
      return [tr('El lunes tengo una prueba: ayúdame a prepararla', 'I have a test on Monday: help me prepare'), tr('Créame un curso a partir de mis apuntes', 'Create a course from my notes'),
        tr('Explícame un tema con un ejemplo y una gráfica', 'Explain a topic with an example and a graph'), tr('¿Qué puedes hacer por mí?', 'What can you do for me?')]
    }
    const now = Date.now()
    const future = packs.filter((p) => p.examDate && Date.parse(p.examDate) > now).sort((a, b) => Date.parse(a.examDate!) - Date.parse(b.examDate!))
    const soon = future[0] ?? packs[0]
    return [tr('¿Qué estudio hoy?', 'What should I study today?'), tr(`¿Cómo voy en «${soon.title}»?`, `How am I doing in “${soon.title}”?`),
      tr(`Ponme un test rápido de «${soon.title}»`, `Give me a quick quiz on “${soon.title}”`), tr('El lunes tengo una prueba: ayúdame a prepararla', 'I have a test on Monday: help me prepare')]
  }

  invalidateCatalog(): void {
    this.catalog = undefined
  }

  /** Para «@»: cursos, lecciones, ejercicios, materiales y eventos que coinciden. */
  async mentionSearch(query: string): Promise<AssistantRef[]> {
    if (!this.catalog || Date.now() - this.catalog.at > 30_000) {
      let events: Awaited<ReturnType<AssistantCalendar['events']>> = []
      const cal = this.opts.calendar?.()
      if (cal) {
        try { events = await cal.events(new Date(Date.now() - 30 * 86_400_000), new Date(Date.now() + 180 * 86_400_000)) } catch { events = [] }
      }
      this.catalog = { at: Date.now(), catalog: buildCatalog(catalogCourses({ library: this.library }, true), catalogEvents(events)) }
    }
    return this.catalog.catalog.search(query.slice(0, 200), { limit: 12 })
  }

  /** Dónde buscar el material de una cita: el curso del tutor primero, después el resto y los adjuntos de la conversación. */
  private citableStores(thread: AssistantThread | undefined): Array<{ store: PackStore; courseID?: string; sources: Array<{ id: string; title: string }> }> {
    const out: Array<{ store: PackStore; courseID?: string; sources: Array<{ id: string; title: string }> }> = []
    const add = (store: PackStore | undefined, course: boolean): void => {
      if (!store) return
      try {
        const pack = store.loadPack()
        out.push({ store, ...(course ? { courseID: pack.id } : {}), sources: pack.sources.map((s) => ({ id: s.id, title: s.title })) })
      } catch { /* sin pack */ }
    }
    if (thread?.courseID) add(this.library.openPack(thread.courseID), true)
    for (const id of this.library.packIDs()) if (id !== thread?.courseID) add(this.library.openPack(id), true)
    if (thread && this.global.hasFiles(thread.id)) add(this.global.filesHandle(thread.id), false)
    return out
  }

  resolveCitation(args: { threadId?: string; title: string; page?: number }): AssistantCitation | null {
    const thread = args.threadId ? this.find(args.threadId)?.thread : undefined
    const hit = bestCitationMatch(args.title, this.citableStores(thread))
    if (!hit) return null
    return { title: args.title, ...(args.page !== undefined ? { page: args.page } : {}), ...(hit.store.courseID ? { courseID: hit.store.courseID } : {}), sourceID: hit.source.id }
  }

  private citationsFor(text: string, thread: AssistantThread): AssistantCitation[] {
    const found = extractCitations(text)
    if (!found.length) return []
    const stores = this.citableStores(thread)
    return found.slice(0, 20).map((c) => {
      const hit = bestCitationMatch(c.title, stores)
      return { title: c.title, ...(c.page !== undefined ? { page: c.page } : {}), ...(hit?.store.courseID ? { courseID: hit.store.courseID } : {}), ...(hit ? { sourceID: hit.source.id } : {}) }
    })
  }

  /** ¿Está respondiendo? */
  isBusy(threadId: string): boolean {
    return this.runs.get(threadId)?.busy ?? false
  }
}

/** La respuesta de la interfaz a una tarjeta que espera, en el idioma del broker. */
export function toAnswer(card: AssistantCard, args: { optionId?: string; answer?: string; approve?: boolean }): AssistantAnswer {
  if (args.approve !== undefined) return args.approve ? Answer.approved : Answer.denied
  if (args.optionId) {
    const i = card.options.findIndex((o) => o.id === args.optionId)
    if (i >= 0) return Answer.option(i)
  }
  const text = args.answer?.trim()
  if (text) return Answer.typed(redactSecrets(text).text)
  return Answer.expired
}
