// Automatizaciones, «Aula siempre activa» y la bandeja «Novedades» (port de StudyEngine/Automation/AutomationModels.swift,
// AutomationInbox.swift y AutomationAttention.swift). Las formas son EXACTAMENTE las de los JSON de la app Swift en
// `<datos>/Automations/` (mismas claves; fechas en ISO 8601; horas «HH:mm»; prioridad como número 0/1/2), para abrir los datos
// que ya existen. Lo que añade la versión Electron va marcado («Electron:») y la app Swift lo ignora al leer.
import type { CalendarEventKind } from '../calendar'
import type { AssistantMessage } from '../assistant/types'

/** Fecha ISO 8601 («2026-10-12T08:00:00.000Z»). */
export type ISODate = string
/** Hora del día «HH:mm» («08:00»). */
export type TimeText = string

// MARK: Horario

export const SCHEDULE_KINDS = ['daily', 'interval', 'once', 'beforeEvents'] as const
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number]

/** Cuándo se hace una automatización (estructura plana, como en Swift). */
export interface AutomationSchedule {
  kind: ScheduleKind
  /** `daily`: horas del día. */
  times: TimeText[]
  /** `daily`/`interval`: días (1 = domingo … 7 = sábado); vacío = todos. */
  weekdays: number[]
  /** `interval`: cada cuántas horas (≥ 1). */
  everyHours: number
  windowStart: TimeText
  windowEnd: TimeText
  /** `once`. */
  date?: ISODate
  /** `beforeEvents`: horas antes (p. ej. [24, 2]). */
  hoursBefore: number[]
  /** `beforeEvents`: de qué eventos (vacío = entregas, exámenes y pruebas). */
  eventKinds: CalendarEventKind[]
}

export const AUTOMATION_CAPABILITIES = ['platform', 'calendar', 'courses', 'web', 'study'] as const
/** Lo que una automatización puede mirar o hacer (siempre en SOLO LECTURA fuera de Aula). */
export type AutomationCapability = (typeof AUTOMATION_CAPABILITIES)[number]
export const DEFAULT_CAPABILITIES: AutomationCapability[] = ['platform', 'calendar', 'courses']

export const NOTIFY_POLICIES = ['news', 'always', 'chatOnly'] as const
/** Cuándo avisa: solo si hay algo nuevo, siempre, o solo en el chat. */
export type AutomationNotifyPolicy = (typeof NOTIFY_POLICIES)[number]

/** Quién la creó: el estudiante, la IA (seguimiento) o una rutina de «Aula siempre activa». */
export type AutomationOrigin = 'student' | 'aula' | 'routine'

export const PROACTIVE_ROUTINES = ['morningBrief', 'platformCheck', 'deadlineReminders', 'examOffers', 'weeklySummary'] as const
export type ProactiveRoutine = (typeof PROACTIVE_ROUTINES)[number]

/** Rutinas sin IA (no gastan nada): funcionan con la app abierta aunque «Aula siempre activa» esté apagada. */
export const LIGHT_ROUTINES: readonly ProactiveRoutine[] = ['deadlineReminders', 'examOffers']
/** ¿Necesita la IA? (las demás son deterministas). */
export function routineUsesAI(r: ProactiveRoutine): boolean {
  return r === 'morningBrief' || r === 'platformCheck' || r === 'weeklySummary'
}

/** Una tarea automática. */
export interface Automation {
  id: string
  title: string
  /** Lo que pidió el estudiante, con sus palabras. */
  instruction: string
  schedule: AutomationSchedule
  capabilities: AutomationCapability[]
  notify: AutomationNotifyPolicy
  /** «Avísame cuando…»: al cumplirse, avisa y se para. */
  untilFound: boolean
  maxRuns?: number
  expiresAt?: ISODate
  enabled: boolean
  origin: AutomationOrigin
  routine?: ProactiveRoutine
  courseID?: string
  /** Conversación donde se creó (los seguimientos responden allí). */
  threadID?: string
  /** Para los seguimientos de la IA: qué prometió y por qué. */
  context?: string
  /** Plataformas a revisar (ids de cuenta; vacío = todas). */
  platformIDs: string[]
  created: ISODate
  updated: ISODate
}

// MARK: Lo encontrado y lo ya visto

/** Algo que encontró una revisión (una asignación, un anuncio, un material, una nota…). */
export interface AutomationFinding {
  key: string
  title: string
  /** assignment · announcement · material · grade · exam · class · message · other */
  kind: string
  url?: string
  course?: string
  due?: ISODate
  detail?: string
  fresh: boolean
}

export interface AutomationSeenItem {
  identity: string
  title: string
  kind: string
  due?: ISODate
  firstSeen: ISODate
  lastSeen: ISODate
}

// MARK: Ejecuciones

export type AutomationTrigger = 'scheduled' | 'catchUp' | 'manual' | 'retry'
export type AutomationOutcome = 'nothingNew' | 'news' | 'conditionMet' | 'done' | 'needsSignIn' | 'failed' | 'budget' | 'missed' | 'skipped'

/** Una ejecución (el historial, `runs/<id>.json`). */
export interface AutomationRun {
  id: string
  automationID: string
  title: string
  trigger: AutomationTrigger
  slot?: ISODate
  started: ISODate
  finished?: ISODate
  outcome: AutomationOutcome
  /** Resumen para el estudiante (Markdown). */
  summary: string
  newItems: AutomationFinding[]
  changedItems: AutomationFinding[]
  knownCount: number
  tokens: number
  tokensEstimated: boolean
  error?: string
  notified: boolean
  threadID?: string
  messageID?: string
  created: string[]
  skippedActions: string[]
  signIn?: string
  provider?: string
}

/** Estado de una automatización entre ejecuciones (`state.json` → `states`). */
export interface AutomationState {
  lastChecked?: ISODate
  lastRun?: ISODate
  lastOutcome?: AutomationOutcome
  lastSummary?: string
  runCount: number
  consecutiveFailures: number
  retryAt?: ISODate
  retries: number
  deferredUntil?: ISODate
  deferredSlot?: ISODate
  seen: AutomationSeenItem[]
  baselineDone: boolean
  firedKeys: string[]
  completed: boolean
  signInNotifiedDay?: string
  failureNotified: boolean
}

// MARK: «Aula siempre activa»

export interface QuietHours {
  enabled: boolean
  from: TimeText
  to: TimeText
}

export type ProactiveStyle = 'discreet' | 'balanced' | 'attentive' | 'custom'
export const PROACTIVE_STYLE_PRESETS: readonly ProactiveStyle[] = ['discreet', 'balanced', 'attentive']

/** `Automations/proactive.json`. */
export interface ProactiveSettings {
  enabled: boolean
  activatedAt?: ISODate
  pausedUntil?: ISODate
  morningBrief: boolean
  morningTime: TimeText
  platformCheck: boolean
  platformCheckTime: TimeText
  platformCheckDays: number[]
  deadlineReminders: boolean
  reminderHours: number[]
  examOffers: boolean
  examOfferDays: number
  weeklySummary: boolean
  weeklyDay: number
  weeklyTime: TimeText
  followups: boolean
  maxFollowupsPerDay: number
  quiet: QuietHours
  dailyTokenLimit: number
  noticesPerHour: number
  style: ProactiveStyle
  notifications: boolean
  dockBadge: boolean
}

/** Lo que cambia con el estilo. */
export interface AttentionLimits {
  dailyTokens: number
  noticesPerHour: number
  followupsPerDay: number
  morningInterrupts: boolean
  summariesInterrupt: boolean
  normalSound: boolean
}

// MARK: Avisos y bandeja

/** Prioridad (en JSON, el número de Swift: 0 baja, 1 normal, 2 urgente). */
export type AutomationPriority = 0 | 1 | 2
export const Priority = { low: 0, normal: 1, critical: 2 } as const

/** Cuánto interrumpe una notificación. */
export type NoticeLevel = 'passive' | 'active' | 'timeSensitive'

export const INBOX_KINDS = ['platform', 'reminder', 'summary', 'offer', 'followup', 'automation', 'system', 'problem', 'digest'] as const
/** Tipo de novedad (filtros de la bandeja y grupos de las notificaciones). */
export type InboxKind = (typeof INBOX_KINDS)[number]

/** Una notificación (la decide el motor; el proceso principal solo la publica). */
export interface AutomationNotice {
  title: string
  subtitle?: string
  body: string
  automationID: string
  kind: InboxKind
  level: NoticeLevel
  priority: AutomationPriority
  sound: boolean
  /** Grupo («platform.math112», «reminder», «summary»). */
  group: string
  summaryArgument?: string
  relevance: number
  /** Entrada de la bandeja (si se lee o se archiva, la notificación se quita). */
  entryID?: string
  /** Las entradas que junta un resumen. */
  entryIDs: string[]
  dedupeKey: string
  /** Es de una rutina de «Aula siempre activa». */
  routine: boolean
}

/** Una entrada de la bandeja «Novedades» (`inbox.json`). */
export interface InboxEntry {
  /** El id del mensaje del chat. */
  id: string
  /** La conversación del mensaje («aula-novedades» o la del seguimiento). */
  threadID: string
  automationID?: string
  runID?: string
  kind: InboxKind
  priority: AutomationPriority
  title: string
  /** La primera línea del mensaje, sin marcas. */
  preview: string
  course?: string
  /** De dónde viene («Rutina de la mañana», «Automatización: Revisar Canvas»). */
  source: string
  symbol?: string
  date: ISODate
  read: boolean
  archived: boolean
  snoozedUntil?: ISODate
  resurfaced: boolean
  dedupeKey: string
  notified: boolean
  notice?: AutomationNotice
  /** Electron: el mensaje entero (texto, tarjetas y avisos), para verlo aunque el chat no lo tenga. */
  message?: AssistantMessage
}

/** Lo enviado en las últimas 48 h y lo que espera a un resumen (`state.json` → `notices`). */
export interface NoticeLedger {
  sent: { date: ISODate; key: string; counted: boolean }[]
  held: { notice: AutomationNotice; until: ISODate }[]
}

/** Todo lo que cambia mientras funcionan las automatizaciones (`state.json`). */
export interface AutomationBook {
  states: Record<string, AutomationState>
  usage: Record<string, number>
  followups: Record<string, number>
  offeredEvents: string[]
  readUpdatesAt?: ISODate
  budgetNotifiedDay?: string
  lastTick?: ISODate
  notices: NoticeLedger
  recentCosts: number[]
  announced: Record<string, ISODate>
  signInNeeded: Record<string, ISODate>
  aiPausedUntil?: ISODate
  aiPauseReason?: string
  aiFailureStreak: number
  aiPauseLevel: number
  spendingCapDay?: string
}

/** Id de la conversación «Novedades de Aula». */
export const UPDATES_THREAD = 'aula-novedades'

/** Id de una rutina («routine-morningBrief»). */
export function routineID(r: ProactiveRoutine): string {
  return `routine-${r}`
}

// MARK: Vistas para la interfaz

/** Una automatización con su estado resumido (sin la memoria de lo visto). */
export interface AutomationItemView {
  automation: Automation
  nextRun?: ISODate
  running: boolean
  lastRun?: ISODate
  lastOutcome?: AutomationOutcome
  lastSummary?: string
  runCount: number
  consecutiveFailures: number
  completed: boolean
  retryAt?: ISODate
  deferredUntil?: ISODate
}

/** Lo que necesita al estudiante ahora (lo más importante primero). */
export type AutomationHealthIssue =
  | { kind: 'paused'; until?: ISODate }
  | { kind: 'noAI' }
  | { kind: 'signIn'; site: string; since: ISODate }
  | { kind: 'aiUnavailable'; until: ISODate; reason: string }
  | { kind: 'budget'; resumes: ISODate }
  | { kind: 'failing'; id: string; title: string; message: string }

export interface AutomationBudgetView {
  limit: number
  used: number
  estimate: number
  runsLeft: number
  exhausted: boolean
}

/** Algo que harán pronto las rutinas (para explicarlo antes de encender el modo). */
export interface AutomationPreviewItem {
  date: ISODate
  routine: ProactiveRoutine
  detail: string
}

/** Todo lo que enseña la interfaz de una vez. */
export interface AutomationsSnapshot {
  items: AutomationItemView[]
  proactive: ProactiveSettings
  /** «Aula siempre activa» encendida y sin pausa. */
  active: boolean
  running: string[]
  unread: number
  usageToday: number
  budget: AutomationBudgetView
  followupsLeft: number
  health: AutomationHealthIssue[]
  /** Lo próximo que hará. */
  nextUp?: { id: string; title: string; routine?: ProactiveRoutine; at: ISODate }
  preview: AutomationPreviewItem[]
  /** Las novedades también están en el chat (si no, solo aquí). */
  chatLinked: boolean
  /** Hay una IA lista (si no, las revisiones con IA no pueden hacerse). */
  aiReady: boolean
  timeZone: string
}

/** Lo que manda el editor (lo demás lo completa el proceso principal). */
export interface AutomationDraft {
  id?: string
  title: string
  instruction: string
  schedule: AutomationSchedule
  capabilities: AutomationCapability[]
  notify: AutomationNotifyPolicy
  untilFound: boolean
  maxRuns?: number | null
  expiresAt?: ISODate | null
  enabled?: boolean
  courseID?: string | null
  platformIDs?: string[]
}
