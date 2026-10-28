// Memoria del estudiante (port de StudyEngine/Memory): API pública. Aula recuerda cosas del estudiante para estudiar mejor con
// él —quién es, qué estudia, sus exámenes, cómo aprende, cómo quiere las explicaciones, lo que le cuesta, sus objetivos— y lo
// guarda solo en `<datos>/Memory/` (0700/0600). Nunca contraseñas, claves ni números de documentos; lo delicado, solo con su
// confirmación. Uso:
//
//     const block = await memoryContext(memoryService(), mensaje, curso)            // antes de un turno
//     tools.push(...conversationMemoryTools(memoryService(), hilo.id, confirmar))   // recordar, buscar, olvidar
//     observeTurn(memoryService(), hilo, respuesta)                                 // aprende cuando la conversación calla
import { join } from 'node:path'
import { resolveActiveModel } from '../ai/registry'
import type { ChatModel } from '../ai/model'
import type { Embedder } from '../search/hybrid'
import { getSettings } from '../settings'
import { getLibrary } from '../store'
import { dataRoot } from '../paths'
import { log } from '../log'
import { MemoryService } from './service'

export * from './models'
export * from './service'
export * from './tools'
export * from './hook'
export * from './prompts'
export { rankMemories, recency } from './ranker'
export { parseExtraction, extractorPrompt, extractorSystem, parseDay, type ExtractedMemories, type PendingConversation } from './extractor'
export { deriveInsights, insightsForPack, scheduleInsight, PRACTICE_KEY_PREFIX } from './practice'
export { MemoryDisk } from './disk'

let shared: { root: string; service: MemoryService } | null = null
let embedderSource: (() => Embedder | undefined) | undefined
let modelOverride: (() => Promise<ChatModel | undefined>) | undefined

/** Enchufa un modelo de vectores (EmbeddingGemma…) cuando exista; sin él, la memoria busca por palabras. */
export function setMemoryEmbedder(fn: (() => Embedder | undefined) | undefined): void {
  embedderSource = fn
}

/** Otra IA para aprender de las conversaciones (pruebas); por defecto, la activa. */
export function setMemoryModel(fn: (() => Promise<ChatModel | undefined>) | undefined): void {
  modelOverride = fn
}

async function defaultModel(): Promise<ChatModel | undefined> {
  if (modelOverride) return modelOverride()
  try {
    return await resolveActiveModel()
  } catch (err) {
    log.debug('Memoria: sin IA para aprender', err instanceof Error ? err.message : String(err))
    return undefined
  }
}

/** La memoria de la carpeta de datos (una por carpeta; se rehace si cambia, p. ej. en pruebas). */
export function memoryService(): MemoryService {
  const root = dataRoot()
  if (!shared || shared.root !== root) {
    const library = getLibrary()
    const service = new MemoryService({
      folder: join(root, 'Memory'), library, history: library.history, model: defaultModel, embedder: () => embedderSource?.()
    })
    // el interruptor de Ajustes manda (la app Swift lo guardaba en state.json)
    try { service.setEnabled(getSettings().data.memory) } catch { /* ajustes aún sin cargar */ }
    shared = { root, service }
  }
  return shared.service
}

/** Lo que la memoria aporta al crear o ampliar un curso (para quien planifica, escribe o reúne materiales; nunca para quien
 * verifica respuestas, que debe ser independiente). "" si no hay memoria o nada útil. */
export function courseBrief(role: 'planner' | 'author' | 'extender' | 'gatherer' | 'crossCutting' | 'verifier' | 'adjudicator' | 'reader' | 'tutor',
  request: { packID?: string; title?: string; subject?: string; goal?: string; topics?: string; instruction?: string }, budget = 900, memory: MemoryService | undefined = memoryService()): string {
  if (!memory || !memory.isEnabled) return ''
  if (!['planner', 'author', 'extender', 'gatherer', 'crossCutting'].includes(role)) return ''
  const query = [request.title, request.subject, request.goal, request.topics, request.instruction].filter((x): x is string => !!x).join(' ')
  const brief = memory.briefing(query, { kind: 'courseCreation', courseID: request.packID }, budget)
  return brief ? '\n\n' + brief : ''
}
