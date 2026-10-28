// Memoria del estudiante · tipos (port de StudyEngine/Memory/MemoryModels.swift, adaptado de Luna). Mismas claves que la app
// Swift en `<datos>/Memory/memories.json`, para abrir la memoria que ya existe. Lectura tolerante: un archivo viejo o tocado a
// mano no hace perder la memoria entera.
import { IDs } from '@engine/base/ids'
import { foldPlain } from '@engine/assistant/fold'
import { fold } from '@engine/assistant/fold'
import { secretReason } from '@engine/assistant/privacy'
import { tr } from '@shared/ai/i18n'
import type { MemoryKindName, MemoryRecordView, MemorySourceName } from '@shared/ipc/memory'

export type MemoryKind = MemoryKindName
export type MemorySource = MemorySourceName

export const MEMORY_KINDS: readonly MemoryKind[] = ['identity', 'studies', 'subject', 'exam', 'learning', 'preference', 'difficulty', 'mistake', 'strength', 'goal', 'schedule', 'platform', 'other']
export const MEMORY_SOURCES: readonly MemorySource[] = ['student', 'tutor', 'assistant', 'practice', 'course']

export type MemoryGroup = MemoryRecordView['group']

/** Nombre en el panel «Memoria». */
export function kindTitle(k: MemoryKind): string {
  switch (k) {
    case 'identity': return tr('Sobre ti', 'About you')
    case 'studies': return tr('Dónde estudias', 'Where you study')
    case 'subject': return tr('Asignaturas', 'Subjects')
    case 'exam': return tr('Exámenes y fechas', 'Exams and dates')
    case 'learning': return tr('Cómo aprendes mejor', 'How you learn best')
    case 'preference': return tr('Preferencias', 'Preferences')
    case 'difficulty': return tr('Lo que te cuesta', 'What you find hard')
    case 'mistake': return tr('Errores frecuentes', 'Frequent mistakes')
    case 'strength': return tr('Lo que dominas', 'What you master')
    case 'goal': return tr('Objetivos', 'Goals')
    case 'schedule': return tr('Horarios', 'Schedule')
    case 'platform': return tr('Plataforma de estudio', 'Study platform')
    case 'other': return tr('Otros', 'Other')
  }
}

export function sourceTitle(s: MemorySource): string {
  switch (s) {
    case 'student': return tr('Lo escribiste tú', 'You wrote it')
    case 'tutor': return tr('Del tutor', 'From the tutor')
    case 'assistant': return tr('Del chat con Aula', 'From the chat with Aula')
    case 'practice': return tr('De tu práctica', 'From your practice')
    case 'course': return tr('Al crear un curso', 'When creating a course')
  }
}

/** Nombre corto para el modelo (en inglés, como el resto de los prompts). */
export function kindPromptLabel(k: MemoryKind): string {
  switch (k) {
    case 'identity': return 'about'
    case 'studies': return 'studies'
    case 'subject': return 'subject'
    case 'exam': return 'exam'
    case 'learning': return 'learns best'
    case 'preference': return 'preference'
    case 'difficulty': return 'finds hard'
    case 'mistake': return 'repeated mistake'
    case 'strength': return 'masters'
    case 'goal': return 'goal'
    case 'schedule': return 'schedule'
    case 'platform': return 'platform'
    case 'other': return 'note'
  }
}

/** Tipos en los que pueden ser verdad varias cosas a la vez: solo la polaridad contraria corrige. */
export const isMultiValued = (k: MemoryKind): boolean => ['subject', 'difficulty', 'mistake', 'strength', 'learning', 'other'].includes(k)
/** Lo que conviene que la IA sepa siempre (cómo hablarle y explicarle). */
export const isCoreKind = (k: MemoryKind): boolean => k === 'identity' || k === 'studies' || k === 'learning' || k === 'preference'

export function kindGroup(k: MemoryKind): MemoryGroup {
  switch (k) {
    case 'identity': case 'studies': case 'subject': case 'platform': return 'about'
    case 'learning': case 'preference': case 'goal': case 'schedule': return 'learning'
    case 'exam': return 'exams'
    case 'difficulty': case 'mistake': case 'strength': return 'progress'
    case 'other': return 'other'
  }
}

const KIND_TABLE: Array<[string, MemoryKind]> = [
  ['ident', 'identity'], ['about', 'identity'], ['name', 'identity'], ['person', 'identity'], ['sobre', 'identity'],
  ['studi', 'studies'], ['school', 'studies'], ['univers', 'studies'], ['estudi', 'studies'], ['program', 'studies'],
  ['subject', 'subject'], ['course', 'subject'], ['asignatura', 'subject'], ['materia', 'subject'],
  ['exam', 'exam'], ['test', 'exam'], ['quiz', 'exam'], ['deadline', 'exam'], ['prueba', 'exam'], ['fecha', 'exam'],
  ['learn', 'learning'], ['aprend', 'learning'], ['style', 'learning'],
  ['pref', 'preference'], ['language', 'preference'], ['idioma', 'preference'], ['explan', 'preference'],
  ['difficult', 'difficulty'], ['dificul', 'difficulty'], ['hard', 'difficulty'], ['struggl', 'difficulty'], ['weak', 'difficulty'], ['cuesta', 'difficulty'],
  ['mistake', 'mistake'], ['error', 'mistake'],
  ['strength', 'strength'], ['master', 'strength'], ['domina', 'strength'],
  ['goal', 'goal'], ['objetiv', 'goal'], ['target', 'goal'], ['meta', 'goal'],
  ['schedul', 'schedule'], ['time', 'schedule'], ['horario', 'schedule'], ['availab', 'schedule'],
  ['platform', 'platform'], ['lms', 'platform'], ['canvas', 'platform'], ['moodle', 'platform'], ['plataforma', 'platform']
]

/** Acepta el nombre del modelo aunque venga con otra forma («learning style», «exams», «dificultad»…). */
export function parseKind(raw: unknown): MemoryKind {
  if (typeof raw !== 'string') return 'other'
  const s = foldPlain(raw).trim()
  if ((MEMORY_KINDS as readonly string[]).includes(s)) return s as MemoryKind
  return KIND_TABLE.find(([k]) => s.startsWith(k) || s.includes(k))?.[1] ?? 'other'
}

/** Un recuerdo: una frase corta sobre el estudiante, con su origen, confianza, fechas y caducidad. Fechas en ISO 8601. */
export interface MemoryRecord {
  id: string
  kind: MemoryKind
  /** La frase, en el idioma del estudiante. */
  text: string
  /** Clave estable del hecho («exam:quimica-parcial-2»): lo nuevo con la misma clave sustituye a lo viejo. */
  key?: string
  source: MemorySource
  courseID?: string
  courseTitle?: string
  conversationID?: string
  /** 0…1: 0,9 dicho por el estudiante; 0,6 deducido. */
  confidence: number
  createdAt: string
  updatedAt: string
  /** Deja de valer (fecha de un examen pasado, «esta semana»…). */
  expiresAt?: string
  /** Última vez que llegó a la IA. */
  lastUsedAt?: string
  uses: number
  /** Veces que se volvió a decir lo mismo. */
  confirmations: number
  /** Dato delicado que el estudiante confirmó guardar. */
  sensitive: boolean
  /** El estudiante lo escribió o lo corrigió: lo automático nunca lo pisa. */
  editedByStudent: boolean
  /** Lo sustituyó otro recuerdo (una corrección): se conserva unos días por si hay que restaurarlo. */
  supersededBy?: string
  supersededAt?: string
}

export type MemoryStatusName = 'active' | 'expired' | 'superseded'

const time = (iso: string | undefined): number => (iso ? Date.parse(iso) : NaN)

export function recordStatus(r: MemoryRecord, now: Date = new Date()): MemoryStatusName {
  if (r.supersededBy !== undefined) return 'superseded'
  const e = time(r.expiresAt)
  if (Number.isFinite(e) && e <= now.getTime()) return 'expired'
  return 'active'
}

export const isActive = (r: MemoryRecord, now: Date = new Date()): boolean => recordStatus(r, now) === 'active'

/** ¿Puede llegar a la IA? Ni con forma de clave ni de documento, aunque se guardara antes de que existiera la puerta (como
 *  `_model_safe_row` de Luna): esos se ven y se corrigen en el panel, pero nunca salen hacia el modelo. */
export const modelSafe = (r: MemoryRecord): boolean => secretReason(r.text) === undefined

export function newRecordID(): string {
  return 'm-' + IDs.short(8)
}

const optStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const optDate = (v: unknown): string | undefined => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : undefined)
const optNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Lee un recuerdo (undefined si no tiene texto). */
export function decodeRecord(raw: unknown): MemoryRecord | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const text = optStr(o.text)
  if (!text || !text.trim()) return undefined
  const createdAt = optDate(o.createdAt) ?? new Date().toISOString()
  const r: MemoryRecord = {
    id: optStr(o.id) ?? newRecordID(),
    kind: parseKind(o.kind),
    text,
    source: (MEMORY_SOURCES as readonly string[]).includes(o.source as string) ? (o.source as MemorySource) : 'student',
    confidence: Math.min(1, Math.max(0, optNum(o.confidence) ?? 0.8)),
    createdAt,
    updatedAt: optDate(o.updatedAt) ?? createdAt,
    uses: Math.max(0, Math.trunc(optNum(o.uses) ?? 0)),
    confirmations: Math.max(0, Math.trunc(optNum(o.confirmations) ?? 0)),
    sensitive: o.sensitive === true,
    editedByStudent: o.editedByStudent === true
  }
  const key = optStr(o.key)
  if (key) r.key = key
  for (const k of ['courseID', 'courseTitle', 'conversationID', 'supersededBy'] as const) {
    const v = optStr(o[k])
    if (v !== undefined) r[k] = v
  }
  for (const k of ['expiresAt', 'lastUsedAt', 'supersededAt'] as const) {
    const v = optDate(o[k])
    if (v !== undefined) r[k] = v
  }
  return r
}

/** Como lo escribe la app Swift (sin los campos vacíos). */
export function encodeRecord(r: MemoryRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const keys: (keyof MemoryRecord)[] = ['id', 'kind', 'text', 'key', 'source', 'courseID', 'courseTitle', 'conversationID', 'confidence', 'createdAt', 'updatedAt',
    'expiresAt', 'lastUsedAt', 'uses', 'confirmations', 'sensitive', 'editedByStudent', 'supersededBy', 'supersededAt']
  for (const k of keys) if (r[k] !== undefined) out[k] = r[k]
  return out
}

/** ¿Coincide con lo escrito en el buscador del panel? (todas las palabras, sin acentos ni mayúsculas) */
export function matchesSearch(r: MemoryRecord, query: string): boolean {
  const words = fold(query).split(' ').filter((w) => w)
  if (!words.length) return true
  const hay = fold([r.text, r.courseTitle ?? '', kindTitle(r.kind), sourceTitle(r.source)].join(' '))
  return words.every((w) => hay.includes(w))
}

export function recordView(r: MemoryRecord, now: Date = new Date()): MemoryRecordView {
  const v: MemoryRecordView = {
    id: r.id, kind: r.kind, group: kindGroup(r.kind), text: r.text, source: r.source, confidence: r.confidence, createdAt: r.createdAt, updatedAt: r.updatedAt,
    status: recordStatus(r, now), sensitive: r.sensitive, editedByStudent: r.editedByStudent, uses: r.uses
  }
  if (r.courseID) v.courseID = r.courseID
  if (r.courseTitle) v.courseTitle = r.courseTitle
  if (r.expiresAt) v.expiresAt = r.expiresAt
  return v
}

/** Lo que se quiere recordar (antes de deduplicar y guardar). */
export interface MemoryDraft {
  kind: MemoryKind
  text: string
  key?: string
  source: MemorySource
  courseID?: string
  courseTitle?: string
  conversationID?: string
  confidence?: number
  expiresAt?: string
  /** Marcado como delicado por quien lo propone (el clasificador también lo comprueba). */
  sensitive?: boolean
  /** El estudiante aceptó guardarlo (lo escribió él o dijo «sí» a la tarjeta de confirmación). */
  confirmedByStudent?: boolean
}

export type MemoryWriteStatus = 'created' | 'updated' | 'merged' | 'reinforced' | 'rejectedSecret' | 'rejectedSensitive' | 'rejectedEmpty' | 'disabled' | 'cancelled' | 'failed' | 'paused'

export interface MemoryWriteResult {
  status: MemoryWriteStatus
  record?: MemoryRecord
  /** Recuerdos que este sustituyó (correcciones). */
  replaced: MemoryRecord[]
  message: string
}

export const isSaved = (r: MemoryWriteResult): boolean => r.status === 'created' || r.status === 'updated' || r.status === 'merged' || r.status === 'reinforced'

export interface MemoryHit {
  record: MemoryRecord
  score: number
  /** Coseno con la consulta (undefined sin vectores). */
  semantic?: number
  lexical: number
}

/** Para quién se prepara el contexto (cambia qué se prioriza). */
export type MemoryPurpose =
  | { kind: 'tutor'; courseID?: string; courseTitle?: string }
  | { kind: 'assistant' }
  | { kind: 'courseCreation'; courseID?: string }

export const purposeCourse = (p: MemoryPurpose): string | undefined => (p.kind === 'assistant' ? undefined : p.courseID)

/** Una conversación para que Aula aprenda de ella (tutor o chat). */
export interface MemoryConversation {
  /** «tutor:<curso>:<conversación>», «chat:<conversación>». */
  id: string
  source: MemorySource
  courseID?: string
  courseTitle?: string
  turns: Array<{ speaker: 'student' | 'aula'; text: string; date?: string }>
}

/** Lo que hay que preguntar al estudiante antes de tocar su memoria. */
export interface MemoryConfirmation {
  action: 'rememberSensitive' | 'forgetMany' | 'rememberAfterReading' | 'forgetAfterReading'
  title: string
  items: string[]
}

/** Pregunta al estudiante (true = sí). Sin ella, lo delicado no se hace. */
export type MemoryConfirmer = (c: MemoryConfirmation) => Promise<boolean>
