// Conversaciones con el tutor (port de StudyModel/Chat.swift); se guardan en `chats/<id>.json` del curso.
import { tr } from '../ai/i18n'
import { IDs } from '@engine/base/ids'
import type { JSONObject } from '@engine/base/json'
import { bool, date, flexStr, isObj, list, nested, nowISO, pickKeys, prune, strings, vInt, vStr, SchemaError, type ISODate, type ItemID, type Obj } from './coding'

/** Lo que el tutor sabe de dónde está el estudiante en este momento. */
export interface TutorContext {
  skillID?: ItemID
  exerciseID?: ItemID
  /** Lo que escribió el estudiante en el ejercicio (si ya respondió). */
  lastInput?: string
  /** Resumen del resultado: «incorrecto: olvidó el signo». */
  lastResult?: string
  /** Bloque de la lección que está leyendo (índice). */
  lessonBlock?: number
  /** Texto libre que describe la pantalla («Simulacro, pregunta 3 de 10»). */
  screen?: string
}

export const TUTOR_ROLES = ['student', 'tutor'] as const
export type TutorRole = (typeof TUTOR_ROLES)[number]

export interface TutorMessage {
  id: string
  role: TutorRole
  /** Markdown con matemáticas; puede incluir bloques ```aula-block {json} ``` que la interfaz dibuja. */
  text: string
  date: ISODate
  context?: TutorContext
  /** Fuentes consultadas (títulos), para mostrar «Basado en…». */
  sources: string[]
  failed: boolean
}

export interface ChatThread {
  id: string
  title: string
  created: ISODate
  updated: ISODate
  messages: TutorMessage[]
}

/** Decodificación estricta (sin `init(from:)` propio en Swift): un campo con el tipo equivocado invalida el contexto. */
export function decodeTutorContext(raw: unknown): TutorContext | undefined {
  if (!isObj(raw)) return undefined
  const out: TutorContext = {}
  for (const k of ['skillID', 'exerciseID', 'lastInput', 'lastResult', 'screen'] as const) {
    const v = raw[k]
    if (v === undefined || v === null) continue
    const s = vStr(v)
    if (s === undefined) return undefined
    out[k] = s
  }
  if (raw.lessonBlock !== undefined && raw.lessonBlock !== null) {
    const n = vInt(raw.lessonBlock)
    if (n === undefined) return undefined
    out.lessonBlock = n
  }
  return out
}

export const tutorContextIsEmpty = (c: TutorContext): boolean => c.skillID === undefined && c.exerciseID === undefined && c.screen === undefined

export function decodeTutorMessage(raw: unknown, d = 0): TutorMessage | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  const role: TutorRole = c.role === 'student' || c.role === 'tutor' ? c.role : 'tutor'
  return prune({
    id: flexStr(c, 'id') ?? IDs.short(8), role, text: flexStr(c, 'text') ?? '', date: date(c, 'date') ?? nowISO(),
    context: nested(c, 'context', decodeTutorContext, d), sources: strings(c, 'sources'), failed: bool(c, 'failed') ?? false
  })
}

export function decodeChatThread(raw: unknown, d = 0): ChatThread {
  if (!isObj(raw)) throw new SchemaError('La conversación no es un objeto JSON')
  const c: Obj = raw
  return {
    id: flexStr(c, 'id') ?? IDs.short(8), title: flexStr(c, 'title') ?? tr('Conversación', 'Conversation'), created: date(c, 'created') ?? nowISO(),
    updated: date(c, 'updated') ?? nowISO(), messages: list(c, 'messages', decodeTutorMessage, d)
  }
}

export function encodeTutorMessage(m: TutorMessage): JSONObject {
  const out = pickKeys(m, ['id', 'role', 'text', 'date', 'sources', 'failed'])
  if (m.context) out.context = pickKeys(m.context, ['skillID', 'exerciseID', 'lastInput', 'lastResult', 'lessonBlock', 'screen'])
  return out
}

export function encodeChatThread(t: ChatThread): JSONObject {
  const out = pickKeys(t, ['id', 'title', 'created', 'updated'])
  out.messages = t.messages.map(encodeTutorMessage)
  return out
}

export function makeChatThread(title = tr('Nueva conversación', 'New conversation')): ChatThread {
  const now = nowISO()
  return { id: IDs.short(8), title, created: now, updated: now, messages: [] }
}
