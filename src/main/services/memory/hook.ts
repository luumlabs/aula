// Memoria · enganche con el chat con Aula y con el tutor (port de MemoryAssistantHook.swift y AssistantMemory.swift): lo que una
// conversación necesita de la memoria, en un sitio. El chat global usa la conversación «chat:<id>» y el origen «assistant»; el
// tutor de un curso, «tutor:<curso>:<id>», el origen «tutor» y lo que Aula recuerda de ese curso primero.
import { plainText } from '@engine/assistant'
import type { AssistantMessage, AssistantThread } from '@shared/assistant/types'
import type { AgentTool } from '../ai/model'
import type { MemoryConfirmer, MemoryConversation } from './models'
import { MEMORY_TOOL_GUIDE } from './prompts'
import type { MemoryService } from './service'
import { memoryTools } from './tools'

export interface MemoryCourse { id: string; title: string }

export function memoryConversationID(threadID: string, course?: MemoryCourse): string {
  return course ? `tutor:${course.id}:${threadID}` : `chat:${threadID}`
}

/** `memory_remember` / `memory_search` / `memory_forget` para el chat o el tutor ([] con la memoria apagada). */
export function conversationMemoryTools(memory: MemoryService | undefined, threadID: string, confirm: MemoryConfirmer | undefined, course?: MemoryCourse, untrusted?: () => boolean): AgentTool[] {
  if (!memory || !memory.isEnabled) return []
  const origin = course
    ? { source: 'tutor' as const, courseID: course.id, courseTitle: course.title, conversationID: memoryConversationID(threadID, course) }
    : { source: 'assistant' as const, conversationID: memoryConversationID(threadID) }
  return memoryTools(memory, origin, confirm, untrusted)
}

/** Bloque «What Aula remembers about the student» para el mensaje del turno ("" si no hay nada o está apagada). */
export async function memoryContext(memory: MemoryService | undefined, message: string, course?: MemoryCourse): Promise<string> {
  if (!memory || !memory.isEnabled) return ''
  const block = course
    ? await memory.context(message + ' ' + course.title, { kind: 'tutor', courseID: course.id, courseTitle: course.title }, 1200)
    : await memory.context(message, { kind: 'assistant' }, 1400)
  return block ? block + '\n' : ''
}

/** Reglas para el prompt de sistema (solo si la IA tiene las herramientas). */
export function memorySystemGuide(tools: AgentTool[]): string {
  return tools.length ? '\n\n' + MEMORY_TOOL_GUIDE : ''
}

/** La conversación tal como la lee la memoria. */
export function memoryConversation(thread: AssistantThread, extra: AssistantMessage[] = [], course?: MemoryCourse): MemoryConversation {
  const msgs = [...thread.messages]
  for (const m of extra) if (!msgs.some((x) => x.id === m.id)) msgs.push(m)
  const conv: MemoryConversation = {
    id: memoryConversationID(thread.id, course), source: course ? 'tutor' : 'assistant',
    turns: msgs.filter((m) => !m.failed && m.text.trim() !== '' && !m.origin).map((m) => ({ speaker: m.role === 'user' ? 'student' : 'aula', text: m.role === 'user' ? m.text : plainText(m.text), date: m.date }))
  }
  if (course) { conv.courseID = course.id; conv.courseTitle = course.title }
  return conv
}

/** Después de cada respuesta: Aula aprende cuando la conversación queda en silencio unos minutos. */
export function observeTurn(memory: MemoryService | undefined, thread: AssistantThread, reply: AssistantMessage | undefined, course?: MemoryCourse): void {
  if (!memory || !memory.isLearning) return
  memory.observe(memoryConversation(thread, reply ? [reply] : [], course), false)
}

/** Nueva conversación o cambio de hilo: Aula aprende ya de la anterior. */
export function conversationEnded(memory: MemoryService | undefined, thread: AssistantThread, course?: MemoryCourse): void {
  if (!memory || !memory.isLearning || !thread.messages.some((m) => m.role === 'user')) return
  memory.observe(memoryConversation(thread, [], course), true)
}

/** Se borró una conversación: no se aprende de ella. */
export function conversationDeleted(memory: MemoryService | undefined, threadID: string, course?: MemoryCourse): void {
  memory?.discardConversation(memoryConversationID(threadID, course))
}
