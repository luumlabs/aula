// Un turno con Aula —en el chat global o en el tutor de un curso— (port de AssistantSession.swift): arma el contexto (menciones,
// adjuntos, conversación, memoria, objetivo), elige quién ve las imágenes, ofrece las herramientas (en el proceso o, con un agente
// CLI, por el relevo MCP que monta el propio modelo) y entrega la respuesta mientras llega. Las tarjetas que esperan al
// estudiante se responden con el `broker`; al contestar a mitad de turno, el trozo en curso se cierra y su respuesta aparece como
// mensaje del estudiante (`segmentBreak`).
import { readFileSync } from 'node:fs'
import { AssistantTurnTrust, clip, extractCitations, isoLocal, oneLine, textOfBlocks } from '@engine/assistant'
import type { AssistantCalendar } from '@engine/calendar'
import type { ContentValidator } from '@engine/content/validator'
import { tr } from '@shared/ai/i18n'
import { settingsPath } from '@shared/settings/sections'
import type { ImagePart } from '@shared/ai/types'
import type { AssistantAttachment, AssistantCard, AssistantCitation, AssistantMessage, AssistantRef, AssistantStep, AssistantStudySet, AssistantThread } from '@shared/assistant/types'
import type { Pack } from '@shared/schema'
import { AIError } from '../ai/errors'
import { completeText } from '../ai/helpers'
import type { ChatModel } from '../ai/model'
import { runToolLoop } from '../ai/loop/toolLoop'
import type { MemoryService } from '../memory/service'
import type { MemoryConfirmer } from '../memory/models'
import { conversationMemoryTools, memoryContext, memorySystemGuide, type MemoryCourse } from '../memory/hook'
import type { VectorSearcher } from '../search/hybrid'
import type { Library } from '../store/library'
import type { PackStore } from '../store/packStore'
import { AssistantBroker, type AssistantAnswer } from './broker'
import { GoalStore, goalPromptBlock } from './goals'
import type { AssistantAppControl, AssistantTarget, CourseTeam, PlatformReader, ToolEnv, TurnIO } from './host'
import { toolLabel } from './labels'
import { stepDetail } from './stepDetail'
import { newCard, newMessage } from './models'
import { budgetForWindow, systemPrompt, turnPrompt, VISION_SYSTEM, type AssistantAppInfo } from './prompts'
import type { AssistantStore } from './store'
import type { WebAccess } from '../tools/context'
import { assistantTools } from './tools'
import { fact } from './tools/common'
import { toolBaseName } from '@engine/assistant'

/** Lo que va pasando en un turno. */
export interface TurnEvents {
  /** Lo que hace ahora («Buscando en tu Aula…»); undefined = nada en particular. */
  status(label: string | undefined): void
  /** Una herramienta empezó o terminó (mismo id). */
  step(step: AssistantStep): void
  /** Texto del trozo en curso, acumulado. */
  text(all: string): void
  /** Tarjeta nueva o actualizada en el trozo en curso. */
  card(card: AssistantCard): void
  notice(text: string): void
  provider(name: string): void
  /** Los adjuntos del mensaje cambiaron (p. ej. ya tienen lo que vio otra IA). */
  attachments(list: AssistantAttachment[]): void
  /** El estudiante contestó a mitad de turno: se cierra el trozo en curso y se pone su respuesta. */
  segmentBreak(closed: AssistantMessage, reply: AssistantMessage, fromComposer: boolean): void
}

export interface TurnDeps {
  library: Library
  /** El almacén de `<datos>/Assistant` (adjuntos y objetivos). */
  store: AssistantStore
  model: ChatModel
  /** Otras IA con visión, por orden de preferencia (para leer las imágenes si la principal no puede). */
  visionHelpers?: () => Promise<ChatModel[]>
  calendar?: AssistantCalendar
  control?: AssistantAppControl
  team?: CourseTeam
  memory?: MemoryService
  platform?: PlatformReader
  validator: ContentValidator
  appLanguage: string
  dailyMinutes: number
  allowWeb: boolean
  web?: WebAccess
  /** false = nadie puede contestar tarjetas (adaptadores sin interfaz): las preguntas caducan y los permisos se deniegan al momento. */
  interactive: boolean
  vectors?: (packDir: string) => VectorSearcher | undefined
  navigate?: (target: AssistantTarget) => void
  courseChanged?: (courseID: string) => void
  /** Cuestionarios y tarjetas que la interfaz ya actualizó (respuestas, guardados), por id. */
  studySetOverride?: (id: string) => AssistantStudySet | undefined
}

/** Cuánto puede esperar una tarjeta: con un agente CLI la llamada a la herramienta tiene su propio plazo y la tarjeta caduca antes. */
export function cardTimeoutMs(model: ChatModel): number {
  if (!model.runAgent) return 600_000
  if (model.kind === 'codex-cli') return 270_000
  if (model.kind === 'opencode-cli') return 540_000
  return 600_000
}

/** ¿Este proveedor ve imágenes? (los agentes CLI de Claude y Codex usan modelos que sí) */
export function canSee(model: ChatModel | undefined): boolean {
  return !!model && (model.capabilities.vision || model.kind === 'claude-cli' || model.kind === 'codex-cli')
}

/** Estado del trozo de respuesta en curso (lo tocan el bucle y las herramientas a la vez). */
export class Segment {
  private text = ''
  private cards: AssistantCard[] = []
  private steps: AssistantStep[] = []
  private breakBefore = false
  private _hadBreaks = false
  provider?: string
  /** Cuestionarios y tarjetas enseñados en este turno (también de trozos ya cerrados). */
  private readonly sets: AssistantStudySet[] = []

  get hadBreaks(): boolean { return this._hadBreaks }
  get currentText(): string { return this.text }

  append(t: string): string {
    if (this.breakBefore && this.text && !t.startsWith('\n')) this.text += '\n\n'
    this.breakBefore = false
    this.text += t
    return this.text
  }

  markToolBoundary(): void { this.breakBefore = true }

  upsertCard(c: AssistantCard): void {
    const i = this.cards.findIndex((x) => x.id === c.id)
    if (i >= 0) this.cards[i] = c
    else this.cards.push(c)
    if (c.studySet && !this.sets.some((s) => s.id === c.studySet!.id)) this.sets.push(c.studySet)
  }

  studySet(id: string): AssistantStudySet | undefined { return this.sets.find((s) => s.id === id) }

  /** Añade o actualiza un paso; `onlyIfPresent`: solo si es de este trozo. */
  upsertStep(s: AssistantStep, onlyIfPresent = false): boolean {
    const i = this.steps.findIndex((x) => x.id === s.id)
    if (i >= 0) { this.steps[i] = s; return true }
    if (onlyIfPresent) return false
    this.steps.push(s)
    return true
  }

  /** Cierra el trozo en curso y empieza otro. */
  cut(): AssistantMessage {
    const m = newMessage('assistant', this.text.trim(), { cards: this.cards, steps: this.steps, ...(this.provider ? { provider: this.provider } : {}) })
    this.text = ''
    this.cards = []
    this.steps = []
    this.breakBefore = false
    this._hadBreaks = true
    return m
  }

  snapshot(fallbackText?: string): AssistantMessage {
    let t = this.text.trim()
    if (!t && !this._hadBreaks && fallbackText) t = fallbackText.trim()
    return newMessage('assistant', t, { cards: [...this.cards], steps: [...this.steps], ...(this.provider ? { provider: this.provider } : {}) })
  }
}

// MARK: Contexto en texto

/** Lo que la IA necesita saber de cada cosa mencionada con «@». */
export function describeMentions(mentions: readonly AssistantRef[], library: Library): string {
  const lines: string[] = []
  for (const r of mentions.slice(0, 8)) {
    const store = r.courseID ? library.openPack(r.courseID) : undefined
    let pack: Pack | undefined
    try { pack = store?.loadPack() } catch { pack = undefined }
    switch (r.kind) {
      case 'course': {
        if (!pack) { lines.push(`- course «${r.title}» (course_id=${r.courseID ?? '?'}) — not found any more`); break }
        let l = `- course «${pack.title}» (course_id=${pack.id}): ${pack.skills.length} lessons`
        if (pack.exam?.date) l += `, exam ${isoLocal(new Date(pack.exam.date))}`
        l += '. Lessons: ' + [...pack.skills].sort((a, b) => a.order - b.order).slice(0, 14).map((s) => `${s.title} [${s.id}]`).join('; ')
        lines.push(l)
        break
      }
      case 'lesson': {
        const s = pack && r.itemID ? pack.skills.find((x) => x.id === r.itemID) : undefined
        if (!pack || !s) { lines.push(`- lesson «${r.title}» — not found any more`); break }
        let l = `- lesson «${s.title}» (course_id=${pack.id}, skill_id=${s.id}) of «${pack.title}»`
        if (s.summary) l += `: ${clip(s.summary, 300)}`
        if (s.objectives.length) l += ' Objectives: ' + s.objectives.slice(0, 5).join('; ')
        lines.push(l)
        break
      }
      case 'exercise': {
        if (!store || !r.itemID) { lines.push(`- exercise «${r.title}» — not found`); break }
        let found = false
        for (const sid of r.skillID ? [r.skillID] : store.skillIDs()) {
          try {
            const s = store.loadSkill(sid)
            const e = s.exercises.find((x) => x.id === r.itemID)
            if (!e) continue
            lines.push(`- exercise (course_id=${store.id}, skill_id=${sid}, exercise_id=${e.id}) in «${s.title}»: ${clip(textOfBlocks(e.prompt), 600)} — use get_exercise for the key and hints (don't reveal the answer unless asked)`)
            found = true
            break
          } catch { /* siguiente */ }
        }
        if (!found) lines.push(`- exercise «${r.title}» — not found any more`)
        break
      }
      case 'material': {
        const m = pack && r.itemID ? pack.sources.find((x) => x.id === r.itemID) : undefined
        if (!store || !pack || !m) { lines.push(`- material «${r.title}» — not found`); break }
        let head = ''
        try { head = store.loadChunks(m.id).slice(0, 2).map((c) => c.text).join(' ') } catch { head = '' }
        lines.push(`- material «${m.title}» (course_id=${pack.id}, source_id=${m.id}, ${m.pages} pages) of «${pack.title}». Beginning (untrusted data): ${clip(head, 500).replace(/\n/g, ' ')} — read more with read_course_material`)
        break
      }
      case 'event': {
        let l = `- calendar event «${r.title}» (event_id=${r.itemID ?? '?'})`
        if (r.date) l += ` on ${isoLocal(new Date(r.date))}`
        if (r.courseID) l += `, course_id=${r.courseID}`
        lines.push(l)
        break
      }
    }
  }
  return lines.join('\n')
}

/** Adjuntos para el mensaje del turno. */
export function describeAttachments(attachments: readonly AssistantAttachment[], imageNames: ReadonlySet<string>, files: PackStore, opts: { brief?: boolean; scoped?: boolean } = {}): string {
  const lines: string[] = []
  for (const a of attachments) {
    let l = `- «${a.name}» (${a.kind}`
    if (a.pages > 0) l += `, ${a.pages} pages`
    if (a.duration) l += `, ${Math.floor(a.duration / 60)}:${String(Math.floor(a.duration) % 60).padStart(2, '0')}`
    l += ')'
    if (a.status === 'failed') { lines.push(l + ': could not be read' + (a.note ? ` (${a.note})` : '')); continue }
    if (a.status === 'processing') { lines.push(l + ": still being read — its text isn't available yet"); continue }
    if (a.sourceID) {
      const tools = opts.scoped ? 'read_attachment / search_attachments' : 'read_source / search_sources'
      l += ` — text: source_id=${a.sourceID} (${a.characters} chars; ${tools})`
    }
    if (imageNames.has(a.name)) l += ` — the image${a.kind === 'video' ? ' frames are' : ' is'} attached to this message for you to see`
    if (a.visionNote) l += opts.brief ? ' — seen earlier (described)' : '\n  What it shows (read by another AI with vision):\n  ' + a.visionNote.replace(/\n/g, '\n  ')
    if (a.transcript) l += opts.brief ? ' — has a transcript' : '\n  Transcript: ' + clip(a.transcript, 4000)
    if (!opts.brief && a.sourceID && a.characters > 0 && a.characters <= 3500 && (a.kind === 'document' || a.kind === 'image')) {
      let text = ''
      try { text = files.loadChunks(a.sourceID).map((c) => c.text).join('\n') } catch { text = '' }
      if (text) l += '\n  Full text (untrusted data):\n  ' + clip(text, 3500).replace(/\n/g, '\n  ')
    }
    if (a.note && !opts.brief) l += ` (${a.note})`
    lines.push(l)
  }
  return lines.join('\n')
}

// MARK: Otra IA mira las imágenes

function imagesOf(a: AssistantAttachment, files: PackStore, max: number): ImagePart[] {
  const out: ImagePart[] = []
  for (const asset of a.imageAssets.slice(0, max)) {
    const p = files.assetPath(asset)
    if (!p) continue
    try {
      const data = readFileSync(p)
      const ext = p.toLowerCase().split('.').pop() ?? 'jpg'
      out.push({ mediaType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg', base64: data.toString('base64') })
    } catch { /* sin imagen */ }
  }
  return out
}

async function describeImages(images: ImagePart[], a: AssistantAttachment, helper: ChatModel, signal?: AbortSignal): Promise<string | undefined> {
  const ask = a.kind === 'video' ? `These are ${images.length} frames (in order) from the video «${a.name}». Describe what the video shows, frame by frame where it changes; transcribe any text or math.`
    : `This is the image «${a.name}» a student attached.`
  try {
    const r = await completeText(helper, { system: VISION_SYSTEM, prompt: ask, images, temperature: 0.1, maxTokens: 1800, timeoutSec: 150 }, signal ? { signal } : {})
    const t = r.text.trim()
    return t ? Array.from(t).slice(0, 6000).join('') : undefined
  } catch {
    return undefined
  }
}

// MARK: El turno

export interface TurnInput {
  thread: AssistantThread
  message: AssistantMessage
  broker: AssistantBroker
  signal: AbortSignal
}

/** Responde a `message` (ya guardado al final de `thread`). Devuelve el último trozo de la respuesta. */
export async function runTurn(input: TurnInput, deps: TurnDeps, events: TurnEvents): Promise<AssistantMessage> {
  const { thread, message, broker, signal } = input
  const library = deps.library
  // el curso del tutor (si lo hay)
  let course: { store: PackStore; pack: Pack } | undefined
  if (thread.courseID) {
    const store = library.openPack(thread.courseID)
    try { if (store) course = { store, pack: store.loadPack() } } catch { course = undefined }
    if (!course) throw new AIError('other', tr('No encuentro este curso: puede que se haya borrado.', "I can't find this course: it may have been deleted."))
  }
  const memoryCourse: MemoryCourse | undefined = course ? { id: course.pack.id, title: course.pack.title } : undefined
  const model = deps.model
  const timeout = cardTimeoutMs(model)
  const seg = new Segment()
  // qué es del estudiante y qué es ajeno en este turno (AI-02): sus mensajes son suyos; los adjuntos y los materiales o eventos
  // mencionados ya traen texto de otros
  const ownTexts = [...thread.messages.filter((m) => m.role === 'user' && m.id !== message.id && !m.origin).map((m) => m.text), message.text]
  const trust = new AssistantTurnTrust(ownTexts, message.attachments.length > 0 || message.mentions.some((r) => r.kind === 'material' || r.kind === 'event'))
  // pasos cuyo permiso se rechazó o caducó: no se hicieron (A3-P2-6)
  const declined = new Set<string>()
  // respuestas escritas en la caja de escribir (no en la tarjeta): la interfaz ya enseña ese mensaje
  const io: TurnIO = {
    ask: async (card) => {
      seg.upsertCard(card)
      events.card(card)
      events.status(undefined)
      const answer: AssistantAnswer = deps.interactive ? await broker.wait(card.id, timeout, signal) : card.kind === 'approval' ? { kind: 'denied' } : { kind: 'expired' }
      const done: AssistantCard = { ...card }
      let reply: string | undefined
      let mentions: AssistantRef[] = []
      switch (answer.kind) {
        case 'option':
          if (card.kind === 'approval') done.state = answer.index === 0 ? 'approved' : 'denied'
          else {
            done.state = 'answered'
            const o = card.options[answer.index]
            if (o) { done.answer = o.label; reply = o.label; if (o.ref) mentions = [o.ref] }
          }
          break
        case 'approved': done.state = 'approved'; break
        case 'denied': done.state = 'denied'; break
        case 'typed': done.state = card.kind === 'approval' ? 'denied' : 'answered'; done.answer = answer.text; reply = answer.text; break
        case 'expired': done.state = 'expired'; break
      }
      if (reply !== undefined) trust.noteStudent(reply)
      // el permiso lo pide la herramienta en curso (también la de un agente CLI, por el relevo): esa no hizo nada
      if (card.kind === 'approval' && (done.state === 'denied' || done.state === 'expired')) {
        for (const [id, s] of running) if (s.ok === undefined) declined.add(id)
      }
      seg.upsertCard(done)
      events.card(done)
      // lo escrito (o la opción elegida) aparece como mensaje del estudiante y la respuesta sigue debajo
      if (reply !== undefined) {
        const closed = seg.cut()
        events.segmentBreak(closed, newMessage('user', reply, { mentions }), answer.kind === 'typed' && answer.fromComposer === true)
      }
      return answer
    },
    show: (card) => {
      seg.upsertCard(card)
      events.card(card)
    }
  }
  const anyFiles = message.attachments.length > 0 || thread.messages.some((m) => m.attachments.length > 0)
  const goals = new GoalStore(deps.store.root)
  const earlierSets = thread.messages.flatMap((m) => m.cards).flatMap((c) => (c.studySet ? [c.studySet] : []))
  const env: ToolEnv = {
    library, files: () => deps.store.files(thread.id), filesHandle: () => (!course || anyFiles ? deps.store.files(thread.id) : deps.store.filesHandle(thread.id)), io, control: deps.control, team: deps.team,
    calendar: deps.calendar, validator: deps.validator, dailyMinutes: deps.dailyMinutes, allowWeb: deps.allowWeb, web: deps.web, threadID: thread.id, goals, defaultCourseID: course?.pack.id,
    studySets: (id) => deps.studySetOverride?.(id) ?? seg.studySet(id) ?? [...earlierSets].reverse().find((s) => s.id === id), platform: deps.platform, trust, vectors: deps.vectors,
    navigate: deps.navigate, courseChanged: deps.courseChanged, signal
  }
  // objetivo de la sesión: se mide con el progreso real; si ya se cumplió, se marca hecho solo
  let goalContext = ''
  const g = goals.refresh(thread.id, course?.pack.id, library)
  if (g) {
    goalContext = g.justCompleted
      ? `\n## Session goal just met\nMeasured from the student's progress, the goal «${clip(g.goal.objective, 300)}» is complete. Congratulate them in one short line and suggest what could come next (no new goal unless they ask).\n`
      : goalPromptBlock(g.goal, g.report)
  }

  // --- adjuntos: imágenes para la IA (o lo que vio otra IA con visión)
  const filesStore = env.filesHandle()
  let attachments = [...message.attachments]
  const images: ImagePart[] = []
  const imageNames = new Set<string>()
  const pictures = attachments.filter((a) => a.imageAssets.length > 0)
  if (pictures.length) {
    if (canSee(model)) {
      for (const a of pictures) {
        for (const img of imagesOf(a, filesStore, a.kind === 'video' ? 6 : 1)) {
          if (images.length >= 10) break
          images.push(img)
          imageNames.add(a.name)
        }
      }
    } else {
      const helpers = (await deps.visionHelpers?.().catch(() => [])) ?? []
      let used: ChatModel | undefined
      for (const helper of helpers) {
        events.status(tr(`Mirando las imágenes con ${helper.providerName}…`, `Looking at the images with ${helper.providerName}…`))
        let failedHere = false
        attachments = await Promise.all(attachments.map(async (a) => {
          if (failedHere || !a.imageAssets.length || a.visionNote) return a
          const parts = imagesOf(a, filesStore, a.kind === 'video' ? 6 : 1)
          if (!parts.length) return a
          const note = await describeImages(parts, a, helper, signal)
          if (!note) { failedHere = true; return a }
          used = helper
          return { ...a, visionNote: note }
        }))
        if (!failedHere) break
      }
      const left = attachments.some((a) => a.imageAssets.length > 0 && !a.visionNote)
      if (used) {
        events.attachments(attachments)
        events.notice(tr(`${model.providerName} no ve imágenes: las ha mirado ${(used as ChatModel).providerName}.`, `${model.providerName} can't see images: ${(used as ChatModel).providerName} looked at them.`))
      }
      if (left) {
        events.notice(helpers.length
          ? tr(`No pude mirar las imágenes con ${helpers.map((h) => h.providerName).join(', ')}; uso el texto que se reconoce en ellas.`, `I couldn't look at the images with ${helpers.map((h) => h.providerName).join(', ')}; I'm using the text recognized in them.`)
          : tr(`${model.providerName} no puede ver imágenes y no tienes otro proveedor configurado que pueda. Añade uno con visión en ${settingsPath('ai', 'es')}. Mientras, Aula usa el texto que se reconoce en ellas.`,
            `${model.providerName} can’t see images and you have no other provider that can. Add one with vision in ${settingsPath('ai', 'en')}. Meanwhile Aula uses the text recognized in them.`))
      }
    }
  }
  if (signal.aborted) throw new AIError('cancelled', 'Cancelado.', { code: 'cancelled' })

  // --- contexto del turno
  const info: AssistantAppInfo = (await deps.control?.appInfo().catch(() => undefined)) ?? {
    platforms: [], computerUseEnabled: false, platformDatesConnected: false, dailyMinutes: deps.dailyMinutes, courseLanguage: deps.appLanguage, provider: '', webSearch: deps.allowWeb
  }
  const runs = (await deps.control?.runs?.().catch(() => [])) ?? []
  const mentions = describeMentions(message.mentions, library)
  const attachText = describeAttachments(attachments, imageNames, filesStore, { scoped: !!course })
  const earlierAtt = thread.messages.filter((m) => m.role === 'user' && m.id !== message.id).flatMap((m) => m.attachments).slice(-12)
  const earlier = describeAttachments(earlierAtt, new Set(), filesStore, { brief: true, scoped: !!course })
  const history = thread.messages.slice(0, Math.max(0, thread.messages.findIndex((m) => m.id === message.id)))
  const budget = budgetForWindow(model.capabilities.contextWindow)
  // memoria del estudiante: lo que Aula recuerda que viene al caso, delante del contexto del turno
  const memoryBlock = await memoryContext(deps.memory, message.text, memoryCourse).catch(() => '')
  const prompt = turnPrompt({
    message: { ...message, attachments }, history, info, courses: library.listPacks(), runs, mentions, attachments: attachText, earlierFiles: earlier, extra: goalContext, memory: memoryBlock,
    course: course?.pack, budget, platformReader: !!deps.platform?.ready()
  })

  // --- herramientas
  const providerName = [model.providerName, model.model].filter((x) => x).join(' · ')
  seg.provider = providerName
  events.provider(providerName)
  const confirm: MemoryConfirmer = async (c) => {
    const forgetting = c.action === 'forgetMany' || c.action === 'forgetAfterReading'
    const label = forgetting ? tr('Recuerdo', 'Memory') : tr('Aula recordará', 'Aula will remember')
    const detail = c.action === 'rememberSensitive' ? tr(`Es un dato delicado. Se guarda solo en este equipo y puedes borrarlo cuando quieras en ${settingsPath('memory', 'es')}.`, `It is sensitive. It is kept only on this computer and you can delete it anytime in ${settingsPath('memory', 'en')}.`)
      : c.action === 'forgetMany' ? tr('Se borrarán de este equipo.', 'They will be deleted from this computer.')
        : c.action === 'rememberAfterReading' ? tr('En esta respuesta Aula leyó páginas o archivos de otros: confirma que esto lo quieres tú. Se guarda solo en este equipo.', 'In this reply Aula read pages or files written by others: confirm you want this. It is kept only on this computer.')
          : tr('En esta respuesta Aula leyó páginas o archivos de otros: confirma que quieres olvidarlo.', 'In this reply Aula read pages or files written by others: confirm you want to forget it.')
    const ans = await io.ask(newCard('approval', c.title, { detail, facts: c.items.slice(0, 6).map((x) => fact(label, x)), actionLabel: forgetting ? tr('Olvidar', 'Forget') : tr('Recordar', 'Remember'), icon: forgetting ? 'trash' : 'person.text.rectangle' }))
    return ans.kind === 'approved' || (ans.kind === 'option' && ans.index === 0)
  }
  const memoryTools = conversationMemoryTools(deps.memory, thread.id, confirm, memoryCourse, () => trust.sawUntrusted)
  const tools = [...assistantTools(env), ...memoryTools]
  const available = new Set(tools.map((t) => t.name))
  let system = systemPrompt({ appLanguage: deps.appLanguage, course: course?.pack, available, compact: budget.compact })
  system += memorySystemGuide(memoryTools)

  events.status(tr('Pensando…', 'Thinking…'))
  const running = new Map<string, AssistantStep>()
  const inCourse = !!course
  // lo que buscó o crea cada paso (sus argumentos) llega al paso en curso nada más empezar
  const detailed = tools.map((t) => ({
    ...t,
    run: (args: Parameters<typeof t.run>[0], ctx: Parameters<typeof t.run>[1]) => {
      const step = running.get(ctx.callId)
      const more = step && step.ok === undefined ? stepDetail(args) : {}
      if (step && (more.detail || more.count)) {
        const next = { ...step, ...more }
        running.set(ctx.callId, next)
        if (seg.upsertStep(next, true)) events.step(next)
      }
      return t.run(args, ctx)
    }
  }))
  const result = await runToolLoop({
    model, system, prompt, images, tools: detailed, maxSteps: 30, timeoutSec: 1800, temperature: course ? 0.3 : 0.4, maxOutputTokens: 4000, signal,
    onEvent: (ev) => {
      switch (ev.type) {
        case 'text': {
          const all = seg.append(ev.text)
          events.text(all)
          events.status(undefined)
          break
        }
        case 'toolStarted': {
          trust.noteTool(ev.name) // también las del ayudante MCP y `WebFetch` de los agentes CLI
          seg.markToolBoundary()
          const step: AssistantStep = { id: ev.id, tool: toolBaseName(ev.name), label: toolLabel(ev.name, inCourse) }
          running.set(ev.id, step)
          seg.upsertStep(step)
          events.step(step)
          events.status(step.label)
          break
        }
        case 'toolFinished': {
          const step: AssistantStep = { ...(running.get(ev.id) ?? { id: ev.id, tool: toolBaseName(ev.name), label: toolLabel(ev.name, inCourse) }), ok: ev.ok }
          if (declined.has(ev.id)) step.declined = true
          running.set(ev.id, step)
          if (seg.upsertStep(step, true)) events.step(step)
          break
        }
        case 'notice': events.status(oneLine(ev.text, 120)); break
        default: break
      }
    }
  })
  if (signal.aborted || result.stopReason === 'cancelled') throw new AIError('cancelled', 'Cancelado.', { code: 'cancelled' })
  const last = seg.snapshot(result.text)
  if (!last.text && !last.cards.length && !seg.hadBreaks) {
    throw new AIError('badResponse', tr(`Aula no respondió. Prueba otra vez o elige otro proveedor en ${settingsPath('ai', 'es')}.`, `Aula didn’t answer. Try again or pick another provider in ${settingsPath('ai', 'en')}.`))
  }
  return last
}

/** Las citas de una respuesta, buscadas en los materiales (el curso del tutor primero, después los demás y los adjuntos). */
export function resolveCitations(text: string, find: (title: string) => AssistantCitation | undefined): AssistantCitation[] {
  return extractCitations(text).map((c) => find(c.title) ? { ...find(c.title)!, ...(c.page !== undefined ? { page: c.page } : {}), title: c.title } : { title: c.title, ...(c.page !== undefined ? { page: c.page } : {}) })
}
