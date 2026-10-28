// IPC del chat con Aula y del tutor (chat.*) y de la memoria del estudiante (memory.*). La lógica vive en
// `@main/services/assistant` y `@main/services/memory`; aquí se validan los argumentos, se emiten los eventos a la interfaz y se pone
// lo que solo tiene Electron: el navegador de la plataforma (solo lectura), las imágenes (`nativeImage`), el equipo que crea cursos
// y la navegación. Las automatizaciones dejan sus mensajes en «Novedades de Aula» por `setInboxChatSink`.
import { app, nativeImage } from 'electron'
import { MAX_MESSAGE_CHARS, type AssistantMessage, type AssistantRef, type AssistantThread, type TutorContext } from '@shared/assistant/types'
import type { AssistantThreadView } from '@shared/ipc/assistant'
import type { MemoryKindName, MemoryStatus } from '@shared/ipc/memory'
import { tr } from '@shared/ai/i18n'
import {
  assistantService, configureAssistant, type AssistantAppControl, type AssistantCourseSpec, type AssistantRunInfo, type CourseTeam, type PlatformReader
} from '@main/services/assistant'
import { setInboxChatSink } from '@main/services/automations'
import { AulaError, invalidArgs } from '@main/services/errors'
import { importSourceIntoPack } from '@main/services/ingest'
import { log } from '@main/services/log'
import { MEMORY_KINDS, MemoryError, isSaved, memoryService, recordView, type MemoryKind } from '@main/services/memory'
import { getSettings, onSettingsChange } from '@main/services/settings'
import { getLibrary } from '@main/services/store'
import type { PackStore } from '@main/services/store'
import { userFiles } from '@main/services/userFiles'
import { platformBrowser } from '../browser'
import { emit, handle } from '../rpc'
import { generationService } from './generation'

type Obj = Record<string, unknown>

function obj(args: unknown): Obj {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw invalidArgs(tr('Argumentos no válidos', 'Invalid arguments'))
  return args as Obj
}

function optObj(args: unknown): Obj {
  return args === undefined || args === null ? {} : obj(args)
}

// los avisos de los argumentos, en el idioma de la interfaz (A3-P2-7: salía ««text» no es válido» con la interfaz en inglés)
function str(o: Obj, key: string, max: number, required = true): string | undefined {
  const v = o[key]
  if (v === undefined || v === null) {
    if (required) throw invalidArgs(tr(`Falta «${key}»`, `“${key}” is missing`))
    return undefined
  }
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) throw invalidArgs(tr(`«${key}» no es válido`, `“${key}” isn’t valid`))
  return v
}

function bool(o: Obj, key: string): boolean | undefined {
  const v = o[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'boolean') throw invalidArgs(tr(`«${key}» debe ser sí o no`, `“${key}” must be true or false`))
  return v
}

/** El texto de un mensaje: uno demasiado largo se explica (y la interfaz lo devuelve a la caja). */
function messageText(o: Obj): string {
  const v = o.text
  if (typeof v === 'string' && v.length > MAX_MESSAGE_CHARS) {
    throw new AulaError('too_long', tr(
      `Ese mensaje es demasiado largo (más de ${MAX_MESSAGE_CHARS.toLocaleString('es')} caracteres). Guárdalo en un archivo y adjúntalo.`,
      `That message is too long (over ${MAX_MESSAGE_CHARS.toLocaleString('en')} characters). Save it as a file and attach it.`
    ))
  }
  return str(o, 'text', MAX_MESSAGE_CHARS, false) ?? ''
}

function strings(o: Obj, key: string, maxItems: number, maxLen: number): string[] | undefined {
  const v = o[key]
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v) || v.length > maxItems || v.some((x) => typeof x !== 'string' || !x || x.length > maxLen)) throw invalidArgs(tr(`«${key}» no es válido`, `“${key}” isn’t valid`))
  return v as string[]
}

/** Contexto del tutor: solo campos conocidos, con su tipo y tamaño. */
function context(v: unknown): TutorContext | undefined {
  if (v === undefined || v === null) return undefined
  const o = obj(v)
  const c: TutorContext = {}
  for (const k of ['courseID', 'skillID', 'exerciseID', 'blockID', 'screen'] as const) { const s = str(o, k, 300, false); if (s) c[k] = s }
  for (const k of ['selection', 'lastInput', 'lastResult'] as const) { const s = str(o, k, 8000, false); if (s) c[k] = s }
  const step = o.lessonBlock
  if (step !== undefined && step !== null) {
    if (typeof step !== 'number' || !Number.isInteger(step) || step < 0 || step > 10_000) throw invalidArgs(tr('«lessonBlock» no es válido', '“lessonBlock” isn’t valid'))
    c.lessonBlock = step
  }
  return c
}

function mentions(v: unknown): AssistantRef[] | undefined {
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v) || v.length > 20) throw invalidArgs(tr('Menciones no válidas', 'Invalid mentions'))
  return v.filter((r): r is AssistantRef => !!r && typeof r === 'object' && !Array.isArray(r) && typeof (r as Obj).title === 'string' && typeof (r as Obj).kind === 'string')
}

/** La conversación con lo que solo vive en memoria si está respondiendo (si responde, qué hace y la cola). */
function withRun(thread: AssistantThread): AssistantThreadView {
  const run = assistantService().runState(thread.id)
  return run ? { ...thread, run } : thread
}

// MARK: Lo que pone Electron

/** La plataforma del estudiante en el navegador de Aula, en solo lectura (una pestaña para el chat). */
function platformReader(): PlatformReader | undefined {
  let browser: ReturnType<typeof platformBrowser>
  try { browser = platformBrowser() } catch { return undefined }
  const tab = 'aula-chat'
  const page = (p: { url: string; title: string; needsLogin: boolean }, summary = ''): { url: string; title: string; summary: string; needsLogin: boolean } => ({ url: p.url, title: p.title, summary, needsLogin: p.needsLogin })
  return {
    ready: () => { try { return browser.listAccounts().length > 0 } catch { return false } },
    siteName: (url) => {
      const acc = browser.accountForURL(url)
      if (acc) return acc.label
      try { return new URL(url).hostname } catch { return url }
    },
    accountFor: (url) => browser.accountForURL(url)?.id,
    // el chat ya pidió permiso por sitio con su tarjeta («Leer tu plataforma»): no se pregunta dos veces
    open: async (url, signal) => { const r = await browser.open(url, { tab, signal, preApproved: true }); return page(r, r.summary) },
    read: async (offset, signal) => {
      const r = await browser.read(null, { tab, offset, signal })
      return { page: page(r.page), text: r.fenced, ...(r.nextOffset !== null ? { nextOffset: r.nextOffset } : {}), ...(r.elementsFenced ? { elements: r.elementsFenced } : {}) }
    },
    links: async (_filter, signal) => {
      const r = await browser.links(null, { tab, signal })
      return { page: page(r.page), links: r.links.map((l) => ({ text: l.text, url: l.url })) }
    },
    click: async (ref, signal) => { const r = await browser.click(ref, { tab, signal }); return page(r.page, r.summary) },
    finish: () => { try { browser.closeTab({ accountId: null, tab }) } catch { /* ya cerrada */ } }
  }
}

/** JPEG con el lado mayor ≤ `maxSide` (Electron sabe leer PNG, JPEG, GIF, WebP, BMP y, en macOS, HEIC). */
async function jpeg(path: string, maxSide: number): Promise<Uint8Array | undefined> {
  const img = nativeImage.createFromPath(path)
  if (img.isEmpty()) return undefined
  const { width, height } = img.getSize()
  const scale = Math.min(1, maxSide / Math.max(width, height, 1))
  const out = scale < 1 ? img.resize(width >= height ? { width: Math.round(width * scale), quality: 'good' } : { height: Math.round(height * scale), quality: 'good' }) : img
  return out.toJPEG(85)
}

async function thumbnail(path: string): Promise<Uint8Array | undefined> {
  if (process.platform === 'linux') return undefined
  try {
    const img = await nativeImage.createThumbnailFromPath(path, { width: 360, height: 360 })
    return img.isEmpty() ? undefined : img.toJPEG(80)
  } catch {
    return undefined
  }
}

const runInfo = (courseID: string, title: string, isExtend: boolean, searchesPlatform = false): AssistantRunInfo => ({
  courseID, title, phase: 'running', fraction: 0, status: tr('Empezando', 'Starting'), searchesPlatform, isExtend
})

/** El equipo que crea y amplía cursos (la tubería), visto desde el chat. */
function courseTeam(): CourseTeam | undefined {
  const g = generationService()
  if (!g) return undefined
  const originals = (files: PackStore | undefined, ids: readonly string[]): string[] => {
    if (!files || !ids.length) return []
    let sources: ReturnType<PackStore['loadPack']>['sources'] = []
    try { sources = files.loadPack().sources } catch { return [] }
    return ids.flatMap((id) => {
      const meta = sources.find((s) => s.id === id)
      const p = meta ? files.originalPath(meta) : undefined
      return p ? [p] : []
    })
  }
  return {
    async create(spec: AssistantCourseSpec, attachments?: PackStore) {
      let draftId: string | undefined
      let materialIds: string[] = []
      const paths = originals(attachments, spec.attachmentSourceIDs)
      if (paths.length) {
        const r = g.drafts.addFiles(undefined, paths)
        draftId = r.draftId
        materialIds = r.materials.map((m) => m.id)
        await g.drafts.idle(draftId)
      }
      const account = spec.searchPlatform ? getSettings().platforms.accounts[0]?.id : undefined
      const request: Obj = {
        title: spec.title, subject: spec.subject, depth: spec.depth, goal: spec.goal, topics: spec.topics, userNotes: spec.notes, materialIds, allowWeb: getSettings().data.webSearch,
        ...(spec.examTitle ? { examNotes: spec.examTitle } : {}), ...(spec.examDate ? { examDate: spec.examDate } : {}), ...(spec.language ? { language: spec.language } : {}),
        ...(account ? { gather: { accountId: account, ...(spec.platformCourse ? { courseId: spec.platformCourse } : {}), ...(spec.focus ? { focus: spec.focus } : {}) } } : {})
      }
      const r = await g.start(draftId, request)
      return runInfo(r.packId, spec.title, false, !!account)
    },
    async extend(courseID, instruction, opts) {
      // lo que adjuntó en el chat pasa antes a los materiales del curso (la ampliación lo lee de ahí)
      const store = getLibrary().openPack(courseID)
      for (const p of originals(opts.attachments, opts.attachmentSourceIDs)) {
        try { if (store) await importSourceIntoPack(store.directory, { type: 'file', path: p }, { store, trust: 'notes' }) } catch (err) { log.warn('Chat: no pude pasar un adjunto al curso', err) }
      }
      await g.extend(courseID, instruction, opts.skillID)
      let title = courseID
      try { title = store?.loadPack().title ?? courseID } catch { /* sin título */ }
      return runInfo(courseID, title, true)
    }
  }
}

function appControl(): AssistantAppControl {
  return {
    appInfo: async () => {
      const s = getSettings()
      const host = (u: string): string => { try { return new URL(u).hostname } catch { return u } }
      let browserReady = false
      try { browserReady = platformBrowser().listAccounts().length > 0 } catch { browserReady = false }
      return {
        platforms: s.platforms.accounts.map((a) => `${a.label} · ${host(a.baseURL)}`), computerUseEnabled: browserReady,
        platformDatesConnected: s.platforms.accounts.some((a) => !!a.calendarSecretRef || !!a.tokenSecretRef), dailyMinutes: 30,
        courseLanguage: tr('es', 'en'), provider: '', webSearch: s.data.webSearch
      }
    },
    runs: async () => (generationService()?.runs(12) ?? []).map((r) => ({
      courseID: r.packId, title: r.title, phase: r.state === 'done' ? 'finished' : r.state === 'running' || r.state === 'waiting' ? 'running' : r.state, fraction: r.progress,
      status: r.stageLabel, searchesPlatform: false, isExtend: false
    }))
  }
}

// MARK: Memoria

function memoryStatus(): MemoryStatus {
  const m = memoryService()
  const all = m.records(true)
  const until = m.pausedUntil
  return { enabled: m.isEnabled, ...(until ? { pausedUntil: until.toISOString() } : {}), active: m.records(false).length, total: all.length }
}

function kindArg(o: Obj): MemoryKind | undefined {
  const k = str(o, 'kind', 40, false)
  if (k === undefined) return undefined
  if (!(MEMORY_KINDS as readonly string[]).includes(k)) throw invalidArgs(tr('Tipo de recuerdo no válido', 'Invalid memory type'))
  return k as MemoryKindName
}

function memoryError(err: unknown): never {
  if (err instanceof MemoryError) throw new AulaError(err.code === 'not_found' ? 'not_found' : 'invalid_args', err.message)
  throw err
}

export function register(): void {
  const chat = assistantService()
  configureAssistant({
    sink: {
      message: (threadId, message) => emit('chat.message', { threadId, message }),
      threads: () => emit('chat.threads', { changed: true }),
      status: (threadId, busy, label) => emit('chat.status', { threadId, busy, ...(label ? { label } : {}) }),
      navigate: (threadId, target) => emit('chat.navigate', { threadId, target }),
      queue: (threadId, queued, sent) => emit('chat.queue', { threadId, queued, ...(sent ? { sent } : {}) })
    },
    platform: platformReader,
    team: courseTeam,
    control: appControl,
    media: { jpeg, thumbnail }
  })
  // «Novedades de Aula»: las automatizaciones dejan aquí sus mensajes
  setInboxChatSink({ postSystemMessage: (threadId: string, message: AssistantMessage) => assistantService().postSystemMessage(threadId, message) })
  try { chat.recoverInterrupted() } catch (err) { log.warn('Chat: no pude recuperar respuestas interrumpidas', err) }
  // al salir: se detiene lo que esté en marcha (lo que llegó se guarda) y la memoria aprende de las conversaciones de hoy
  app.on('before-quit', () => { try { assistantService().shutdown() } catch { /* saliendo */ } })

  handle('chat.threads', () => assistantService().threads())
  handle('chat.thread', (args) => {
    const thread = assistantService().thread(str(obj(args), 'id', 100) as string)
    return thread ? withRun(thread) : null
  })
  handle('chat.newThread', (args) => assistantService().newThread(context(optObj(args).context)))
  handle('chat.tutorThread', (args) => {
    const id = str(obj(args), 'courseID', 200) as string
    if (!getLibrary().openPack(id)) throw new AulaError('not_found', tr('Ese curso no existe.', "That course doesn't exist."))
    return withRun(assistantService().latestTutorThread(id))
  })
  handle('chat.send', (args) => {
    const o = obj(args)
    return assistantService().send({
      threadId: str(o, 'threadId', 100) as string, text: messageText(o), mentions: mentions(o.mentions), attachments: userFiles.check(strings(o, 'attachments', 10, 4096) ?? []),
      context: context(o.context), messageId: str(o, 'messageId', 80, false)
    })
  })
  handle('chat.stop', (args) => { assistantService().stop(str(obj(args), 'threadId', 100) as string) })
  handle('chat.cancelQueued', (args) => {
    const o = obj(args)
    return { removed: assistantService().cancelQueued(str(o, 'threadId', 100) as string, str(o, 'messageId', 100) as string) }
  })
  handle('chat.continue', (args) => {
    const o = obj(args)
    assistantService().continue(str(o, 'threadId', 100) as string, str(o, 'messageId', 100) as string)
  })
  handle('chat.answerCard', (args) => {
    const o = obj(args)
    assistantService().answerCard({
      threadId: str(o, 'threadId', 100) as string, messageId: str(o, 'messageId', 100) as string, cardId: str(o, 'cardId', 100) as string,
      optionId: str(o, 'optionId', 100, false), answer: str(o, 'answer', 200_000, false), approve: bool(o, 'approve')
    })
  })
  handle('chat.renameThread', (args) => {
    const o = obj(args)
    assistantService().rename(str(o, 'id', 100) as string, str(o, 'title', 500, false) ?? '')
  })
  handle('chat.pinThread', (args) => {
    const o = obj(args)
    const pinned = bool(o, 'pinned')
    if (pinned === undefined) throw invalidArgs(tr('Falta «pinned»', '“pinned” is missing'))
    assistantService().pin(str(o, 'id', 100) as string, pinned)
  })
  handle('chat.deleteThread', (args) => { assistantService().delete(str(obj(args), 'id', 100) as string) })
  handle('chat.suggestions', (args) => assistantService().suggestions(context(optObj(args).context)))
  handle('chat.mentionSearch', (args) => assistantService().mentionSearch(str(obj(args), 'query', 200, false) ?? ''))
  handle('chat.resolveCitation', (args) => {
    const o = obj(args)
    const page = o.page
    if (page !== undefined && page !== null && (typeof page !== 'number' || !Number.isInteger(page) || page < 0 || page > 100_000)) throw invalidArgs(tr('«page» no es válido', '“page” isn’t valid'))
    return assistantService().resolveCitation({ threadId: str(o, 'threadId', 100, false), title: str(o, 'title', 500) as string, ...(typeof page === 'number' ? { page } : {}) })
  })

  // memoria: el interruptor de Ajustes manda
  const memory = memoryService()
  memory.onChange(() => emit('memory.changed', { changed: true }))
  onSettingsChange((next, prev) => {
    if (next.data.memory !== prev.data.memory) memoryService().setEnabled(next.data.memory)
  })
  try { memory.learnLeftovers() } catch (err) { log.debug('Memoria: no pude retomar lo pendiente', err) }

  handle('memory.status', () => memoryStatus())
  handle('memory.list', (args) => {
    const o = optObj(args)
    const m = memoryService()
    const q = str(o, 'query', 300, false)?.trim()
    const all = q ? m.filter(q, bool(o, 'includeInactive') ?? false) : m.records(bool(o, 'includeInactive') ?? false)
    return all.map((r) => recordView(r))
  })
  handle('memory.add', async (args) => {
    const o = obj(args)
    const r = await memoryService().remember({ kind: kindArg(o) ?? 'other', text: str(o, 'text', 2000) as string, source: 'student', confirmedByStudent: true })
    if (!isSaved(r) || !r.record) throw new AulaError(r.status === 'rejectedSecret' ? 'memory_secret' : 'memory_rejected', r.message)
    return recordView(r.record)
  })
  handle('memory.edit', async (args) => {
    const o = obj(args)
    try {
      return recordView(await memoryService().edit(str(o, 'id', 100) as string, str(o, 'text', 2000) as string, kindArg(o)))
    } catch (err) { return memoryError(err) }
  })
  handle('memory.restore', (args) => { memoryService().restore(str(obj(args), 'id', 100) as string) })
  handle('memory.forget', (args) => ({ forgotten: memoryService().forget(strings(obj(args), 'ids', 5000, 100) ?? []) }))
  handle('memory.clear', () => ({ forgotten: memoryService().forgetAll() }))
  handle('memory.pause', (args) => {
    const o = obj(args)
    const until = o.until
    if (until === null || until === undefined) memoryService().pause(undefined)
    else if (until === 'forever') memoryService().pause(new Date('9999-01-01T00:00:00.000Z'))
    else {
      const t = typeof until === 'string' && until.length <= 40 ? Date.parse(until) : NaN
      if (Number.isNaN(t)) throw invalidArgs(tr('Fecha no válida', 'Invalid date'))
      memoryService().pause(new Date(t))
    }
    return memoryStatus()
  })
  handle('memory.export', () => ({ fileName: `Aula-memoria-${new Date().toISOString().slice(0, 10)}.json`, json: memoryService().exportJSON() }))
}
