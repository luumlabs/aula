// El chat con Aula y el tutor (sin `electron`). La capa de Electron monta lo suyo con `configureAssistant` (a dónde van los
// avisos, el navegador de la plataforma, el equipo que crea cursos, imágenes y voz) y usa `assistantService()`:
//
//     configureAssistant({ sink, platform, team, media, control })
//     const chat = assistantService(); chat.recoverInterrupted()
//     chat.send({ threadId, text }) … 'chat.message' / 'chat.status' / 'chat.threads' por el sink
//     postSystemMessage('aula-novedades', mensaje)   // automatizaciones, rutinas y seguimientos
import type { AssistantMessage } from '@shared/assistant/types'
import { calendarService } from '../calendar'
import { memoryService } from '../memory'
import { dataRoot } from '../paths'
import { getLibrary, onCourseChanged } from '../store'
import type { AttachmentMedia } from './attachments'
import type { AssistantAppControl, CourseTeam, PlatformReader } from './host'
import type { ChatModel } from '../ai/model'
import { AssistantService, type AssistantSink } from './service'

export * from './service'
export * from './host'
export * from './models'
export * from './broker'
export { AssistantStore, displayTitle, threadPreview, orderThreads } from './store'
export { runTurn, Segment, cardTimeoutMs, canSee, describeAttachments, describeMentions, type TurnDeps, type TurnEvents, type TurnInput } from './session'
export { processAttachment, pendingAttachment, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, type AttachmentMedia } from './attachments'
export { explainError, type ExplainedError } from './errors'
export { toolLabel, registerToolLabels } from './labels'
export { systemPrompt, turnPrompt, budgetForWindow, type AssistantAppInfo, type AssistantRunInfo, type PromptBudget } from './prompts'
export { GoalStore, goalTools, goalReport, type AssistantGoal, type GoalTarget } from './goals'
export { registerAssistantTools, registeredToolAreas, assistantTools, ownTools, guarded, saveStudySet, EXERCISE_CHEAT_SHEET, type AssistantToolProvider } from './tools'
export { streamingFake, isFakeModel, fakeAnswer } from './fake'

/** Lo que pone el proceso principal de Electron. Todo opcional: sin ello el chat funciona (sin plataforma, sin crear cursos…). */
export interface AssistantHooks {
  sink?: AssistantSink
  platform?: () => PlatformReader | undefined
  team?: () => CourseTeam | undefined
  control?: () => AssistantAppControl | undefined
  media?: AttachmentMedia
  /** Otras IA con visión para leer imágenes cuando la principal no puede. */
  visionHelpers?: () => Promise<ChatModel[]>
}

let hooks: AssistantHooks = {}
let shared: { root: string; service: AssistantService } | null = null
let unsubscribe: (() => void) | null = null

export function configureAssistant(h: AssistantHooks): void {
  hooks = { ...hooks, ...h }
}

const sink: AssistantSink = {
  message: (threadId, message) => hooks.sink?.message(threadId, message),
  threads: () => hooks.sink?.threads(),
  status: (threadId, busy, label) => hooks.sink?.status(threadId, busy, label),
  navigate: (threadId, target) => hooks.sink?.navigate?.(threadId, target),
  queue: (threadId, queued, sent) => hooks.sink?.queue?.(threadId, queued, sent)
}

/** Pausa entre trozos de la IA simulada (`AULA_FAKE_AI_DELAY_MS`, para las pruebas que escriben mientras Aula responde). */
function fakeDelayMs(): number | undefined {
  const n = Number(process.env.AULA_FAKE_AI_DELAY_MS)
  return Number.isFinite(n) && n > 0 && n <= 2000 ? n : undefined
}

const media: AttachmentMedia = {
  jpeg: (path, side) => hooks.media?.jpeg?.(path, side) ?? Promise.resolve(undefined),
  thumbnail: (path) => hooks.media?.thumbnail?.(path) ?? Promise.resolve(undefined),
  frames: (path) => hooks.media?.frames?.(path) ?? Promise.resolve(undefined),
  transcribe: (path, language) => hooks.media?.transcribe?.(path, language) ?? Promise.resolve(undefined)
}

/** El chat de la carpeta de datos (uno por carpeta; se rehace si cambia, p. ej. en pruebas). */
export function assistantService(): AssistantService {
  const root = dataRoot()
  if (!shared || shared.root !== root) {
    shared?.service.shutdown()
    const service = new AssistantService({
      root, library: getLibrary, sink, media,
      calendar: () => { try { return calendarService().forAssistant() } catch { return undefined } },
      memory: () => memoryService(),
      platform: () => hooks.platform?.(), team: () => hooks.team?.(), control: () => hooks.control?.(),
      visionHelpers: () => hooks.visionHelpers?.() ?? Promise.resolve([]),
      ...(fakeDelayMs() ? { fakeDelayMs: fakeDelayMs() } : {})
    })
    shared = { root, service }
    unsubscribe?.()
    unsubscribe = onCourseChanged(() => shared?.service.invalidateCatalog())
  }
  return shared.service
}

/** Deja un mensaje de Aula en una conversación (o en «Novedades de Aula», `'aula-novedades'`, si no existe). Devuelve su id. */
export function postSystemMessage(threadId: string | undefined, message: AssistantMessage): string {
  return assistantService().postSystemMessage(threadId, message)
}

/** Para las pruebas: olvida el chat compartido. */
export function resetAssistantService(): void {
  shared?.service.shutdown()
  shared = null
  unsubscribe?.()
  unsubscribe = null
}
