// Lectura tolerante de los JSON de `<datos>/Automations/` (los `init(from:)` de AutomationModels.swift): un campo roto toma su
// valor por defecto y una entrada rota de una lista no se lleva a las demás. Las fechas se aceptan como ISO o como segundos
// desde 2001 (Foundation) y se normalizan a ISO; las horas, como «HH:mm», «8pm» o minutos.
import { decodeSwiftDate } from '@engine/calendar/time'
import { IDs } from '@engine/base/ids'
import { CALENDAR_EVENT_KINDS, type CalendarEventKind } from '@shared/calendar'
import {
  AUTOMATION_CAPABILITIES, INBOX_KINDS, NOTIFY_POLICIES, PROACTIVE_ROUTINES, SCHEDULE_KINDS, applyStyle, defaultProactiveSettings, defaultSchedule,
  emptyAutomationState, parseTime, type Automation, type AutomationBook, type AutomationFinding, type AutomationNotice, type AutomationPriority,
  type AutomationRun, type AutomationSchedule, type AutomationSeenItem, type AutomationState, type InboxEntry, type ISODate, type NoticeLedger,
  type ProactiveSettings, type ProactiveStyle, type QuietHours
} from '@shared/automations'
import type { AssistantMessage } from '@shared/assistant/types'

type Obj = Record<string, unknown>

export function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) ? v : undefined)
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Fecha ISO normalizada (o `undefined`). */
export function date(v: unknown): ISODate | undefined {
  const d = decodeSwiftDate(v)
  return d ? d.toISOString() : undefined
}

function oneOf<T extends string>(v: unknown, values: readonly T[]): T | undefined {
  return typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : undefined
}

function strings(v: unknown): string[] {
  return arr(v).filter((x): x is string => typeof x === 'string')
}

function nums(v: unknown): number[] {
  return arr(v).filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
}

function numRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (isObj(v)) for (const [k, x] of Object.entries(v)) if (typeof x === 'number' && Number.isFinite(x)) out[k] = x
  return out
}

function dateRecord(v: unknown): Record<string, ISODate> {
  const out: Record<string, ISODate> = {}
  if (isObj(v)) for (const [k, x] of Object.entries(v)) { const d = date(x); if (d) out[k] = d }
  return out
}

/** Quita las claves `undefined` (como `encodeIfPresent`). */
export function compact<T extends object>(o: T): T {
  const out = {} as T
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Obj)[k] = v
  return out
}

// MARK: Horario y automatización

export function decodeSchedule(v: unknown): AutomationSchedule {
  const def = defaultSchedule('daily')
  if (!isObj(v)) return def
  const kind = oneOf(v.kind, SCHEDULE_KINDS) ?? 'daily'
  return compact({
    kind,
    times: arr(v.times).map(parseTime).filter((t): t is string => t !== null),
    weekdays: arr(v.weekdays).filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 7),
    everyHours: num(v.everyHours) ?? 8,
    windowStart: parseTime(v.windowStart) ?? '08:00',
    windowEnd: parseTime(v.windowEnd) ?? '22:00',
    date: date(v.date),
    hoursBefore: nums(v.hoursBefore),
    eventKinds: arr(v.eventKinds).filter((k): k is CalendarEventKind => typeof k === 'string' && (CALENDAR_EVENT_KINDS as readonly string[]).includes(k))
  })
}

export function decodeAutomation(v: unknown, now: Date = new Date()): Automation | null {
  if (!isObj(v)) return null
  const created = date(v.created) ?? now.toISOString()
  return compact({
    id: str(v.id) || 'auto-' + IDs.short(8),
    title: str(v.title) ?? '',
    instruction: str(v.instruction) ?? '',
    schedule: isObj(v.schedule) ? decodeSchedule(v.schedule) : { ...defaultSchedule('daily'), times: ['08:00'] },
    capabilities: arr(v.capabilities).map((c) => oneOf(c, AUTOMATION_CAPABILITIES)).filter((c): c is NonNullable<typeof c> => !!c),
    notify: oneOf(v.notify, NOTIFY_POLICIES) ?? 'news',
    untilFound: bool(v.untilFound) ?? false,
    maxRuns: int(v.maxRuns),
    expiresAt: date(v.expiresAt),
    enabled: bool(v.enabled) ?? true,
    origin: oneOf(v.origin, ['student', 'aula', 'routine'] as const) ?? 'student',
    routine: oneOf(v.routine, PROACTIVE_ROUTINES),
    courseID: str(v.courseID),
    threadID: str(v.threadID),
    context: str(v.context),
    platformIDs: strings(v.platformIDs),
    created,
    updated: date(v.updated) ?? created
  })
}

// MARK: Lo encontrado, lo visto y el estado

export function decodeFinding(v: unknown): AutomationFinding | null {
  if (!isObj(v)) return null
  return compact({
    key: str(v.key) ?? '',
    title: str(v.title) ?? '',
    kind: str(v.kind) ?? 'other',
    url: str(v.url),
    course: str(v.course),
    due: date(v.due),
    detail: str(v.detail),
    fresh: bool(v.fresh) ?? false
  })
}

function decodeSeen(v: unknown): AutomationSeenItem | null {
  if (!isObj(v)) return null
  const identity = str(v.identity), firstSeen = date(v.firstSeen), lastSeen = date(v.lastSeen)
  if (!identity || !firstSeen || !lastSeen) return null
  return compact({ identity, title: str(v.title) ?? '', kind: str(v.kind) ?? 'other', due: date(v.due), firstSeen, lastSeen })
}

const OUTCOMES = ['nothingNew', 'news', 'conditionMet', 'done', 'needsSignIn', 'failed', 'budget', 'missed', 'skipped'] as const
const TRIGGERS = ['scheduled', 'catchUp', 'manual', 'retry'] as const

export function decodeState(v: unknown): AutomationState | null {
  if (!isObj(v)) return null
  const def = emptyAutomationState()
  return compact({
    lastChecked: date(v.lastChecked),
    lastRun: date(v.lastRun),
    lastOutcome: oneOf(v.lastOutcome, OUTCOMES),
    lastSummary: str(v.lastSummary),
    runCount: int(v.runCount) ?? def.runCount,
    consecutiveFailures: int(v.consecutiveFailures) ?? 0,
    retryAt: date(v.retryAt),
    retries: int(v.retries) ?? 0,
    deferredUntil: date(v.deferredUntil),
    deferredSlot: date(v.deferredSlot),
    seen: arr(v.seen).map(decodeSeen).filter((s): s is AutomationSeenItem => !!s),
    baselineDone: bool(v.baselineDone) ?? false,
    firedKeys: strings(v.firedKeys),
    completed: bool(v.completed) ?? false,
    signInNotifiedDay: str(v.signInNotifiedDay),
    failureNotified: bool(v.failureNotified) ?? false
  })
}

export function decodeRun(v: unknown): AutomationRun | null {
  if (!isObj(v)) return null
  const findings = (x: unknown) => arr(x).map(decodeFinding).filter((f): f is AutomationFinding => !!f)
  return compact({
    id: str(v.id) || 'run-' + IDs.short(8),
    automationID: str(v.automationID) ?? '',
    title: str(v.title) ?? '',
    trigger: oneOf(v.trigger, TRIGGERS) ?? 'scheduled',
    slot: date(v.slot),
    started: date(v.started) ?? new Date().toISOString(),
    finished: date(v.finished),
    outcome: oneOf(v.outcome, OUTCOMES) ?? 'done',
    summary: str(v.summary) ?? '',
    newItems: findings(v.newItems),
    changedItems: findings(v.changedItems),
    knownCount: int(v.knownCount) ?? 0,
    tokens: int(v.tokens) ?? 0,
    tokensEstimated: bool(v.tokensEstimated) ?? false,
    error: str(v.error),
    notified: bool(v.notified) ?? false,
    threadID: str(v.threadID),
    messageID: str(v.messageID),
    created: strings(v.created),
    skippedActions: strings(v.skippedActions),
    signIn: str(v.signIn),
    provider: str(v.provider)
  })
}

// MARK: «Aula siempre activa»

function decodeQuiet(v: unknown, def: QuietHours): QuietHours {
  if (!isObj(v)) return def
  return { enabled: bool(v.enabled) ?? true, from: parseTime(v.from) ?? '22:30', to: parseTime(v.to) ?? '07:30' }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function decodeProactive(v: unknown): ProactiveSettings {
  const def = defaultProactiveSettings()
  if (!isObj(v)) return def
  const maxF = int(v.maxFollowupsPerDay)
  const limit = int(v.dailyTokenLimit)
  let p: ProactiveSettings = compact({
    enabled: bool(v.enabled) ?? def.enabled,
    activatedAt: date(v.activatedAt),
    pausedUntil: date(v.pausedUntil),
    morningBrief: bool(v.morningBrief) ?? def.morningBrief,
    morningTime: parseTime(v.morningTime) ?? def.morningTime,
    platformCheck: bool(v.platformCheck) ?? def.platformCheck,
    platformCheckTime: parseTime(v.platformCheckTime) ?? def.platformCheckTime,
    platformCheckDays: (Array.isArray(v.platformCheckDays) ? nums(v.platformCheckDays) : def.platformCheckDays).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7),
    deadlineReminders: bool(v.deadlineReminders) ?? def.deadlineReminders,
    reminderHours: (Array.isArray(v.reminderHours) ? nums(v.reminderHours) : def.reminderHours).filter((h) => h > 0),
    examOffers: bool(v.examOffers) ?? def.examOffers,
    examOfferDays: clamp(int(v.examOfferDays) ?? def.examOfferDays, 3, 60),
    weeklySummary: bool(v.weeklySummary) ?? def.weeklySummary,
    weeklyDay: clamp(int(v.weeklyDay) ?? def.weeklyDay, 1, 7),
    weeklyTime: parseTime(v.weeklyTime) ?? def.weeklyTime,
    followups: bool(v.followups) ?? def.followups,
    maxFollowupsPerDay: clamp(maxF ?? def.maxFollowupsPerDay, 0, 20),
    quiet: decodeQuiet(v.quiet, def.quiet),
    dailyTokenLimit: Math.max(10_000, limit ?? def.dailyTokenLimit),
    noticesPerHour: clamp(int(v.noticesPerHour) ?? def.noticesPerHour, 1, 20),
    style: def.style,
    notifications: bool(v.notifications) ?? def.notifications,
    dockBadge: bool(v.dockBadge) ?? def.dockBadge
  })
  const style = oneOf(v.style, ['discreet', 'balanced', 'attentive', 'custom'] as const)
  if (style) p.style = style
  // ajustes de la v1 sin tocar → «Equilibrada» (con su techo nuevo de seguimientos); con números propios, «Personalizada»
  else if ((limit ?? 150_000) === 150_000 && (maxF ?? 3) === 3) p = applyStyle(p, 'balanced')
  else p.style = 'custom' as ProactiveStyle
  return p
}

// MARK: Avisos, bandeja y libro

const LEVELS = ['passive', 'active', 'timeSensitive'] as const

function priority(v: unknown): AutomationPriority {
  return v === 0 || v === 1 || v === 2 ? v : 1
}

export function decodeNotice(v: unknown): AutomationNotice | null {
  if (!isObj(v)) return null
  const automationID = str(v.automationID) ?? ''
  const kind = oneOf(v.kind, INBOX_KINDS) ?? 'automation'
  const level = oneOf(v.level, LEVELS) ?? 'active'
  return compact({
    title: str(v.title) ?? '',
    subtitle: str(v.subtitle),
    body: str(v.body) ?? '',
    automationID,
    kind,
    level,
    priority: priority(v.priority),
    sound: bool(v.sound) ?? level !== 'passive',
    group: str(v.group) ?? kind,
    summaryArgument: str(v.summaryArgument),
    relevance: num(v.relevance) ?? 0.5,
    entryID: str(v.entryID),
    entryIDs: strings(v.entryIDs),
    dedupeKey: str(v.dedupeKey) ?? '',
    routine: bool(v.routine) ?? automationID.startsWith('routine-')
  })
}

/** El mensaje guardado en una entrada (lo escribe esta versión; se valida lo justo para dibujarlo). */
function decodeMessage(v: unknown): AssistantMessage | undefined {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.text !== 'string') return undefined
  return {
    id: v.id, role: 'assistant', text: v.text, date: date(v.date) ?? new Date().toISOString(),
    mentions: [], attachments: [], cards: Array.isArray(v.cards) ? (v.cards.filter(isObj) as unknown as AssistantMessage['cards']) : [],
    steps: [], notices: strings(v.notices), failed: bool(v.failed) ?? false, interrupted: false,
    ...(typeof v.provider === 'string' ? { provider: v.provider } : {}),
    ...(isObj(v.origin) ? { origin: v.origin as unknown as NonNullable<AssistantMessage['origin']> } : {})
  }
}

export function decodeInboxEntry(v: unknown): InboxEntry | null {
  if (!isObj(v) || typeof v.id !== 'string' || !v.id) return null
  return compact({
    id: v.id,
    threadID: str(v.threadID) ?? 'aula-novedades',
    automationID: str(v.automationID),
    runID: str(v.runID),
    kind: oneOf(v.kind, INBOX_KINDS) ?? 'system',
    priority: priority(v.priority),
    title: str(v.title) ?? '',
    preview: str(v.preview) ?? '',
    course: str(v.course),
    source: str(v.source) ?? '',
    symbol: str(v.symbol),
    date: date(v.date) ?? new Date().toISOString(),
    read: bool(v.read) ?? false,
    archived: bool(v.archived) ?? false,
    snoozedUntil: date(v.snoozedUntil),
    resurfaced: bool(v.resurfaced) ?? false,
    dedupeKey: str(v.dedupeKey) ?? '',
    notified: bool(v.notified) ?? false,
    notice: decodeNotice(v.notice) ?? undefined,
    message: decodeMessage(v.message)
  })
}

function decodeLedger(v: unknown): NoticeLedger {
  if (!isObj(v)) return { sent: [], held: [] }
  const sent = arr(v.sent).flatMap((s) => {
    if (!isObj(s)) return []
    const d = date(s.date)
    return d && typeof s.key === 'string' ? [{ date: d, key: s.key, counted: bool(s.counted) ?? false }] : []
  })
  const held = arr(v.held).flatMap((h) => {
    if (!isObj(h)) return []
    const n = decodeNotice(h.notice), until = date(h.until)
    return n && until ? [{ notice: n, until }] : []
  })
  return { sent, held }
}

export function emptyBook(): AutomationBook {
  return { states: {}, usage: {}, followups: {}, offeredEvents: [], notices: { sent: [], held: [] }, recentCosts: [], announced: {}, signInNeeded: {}, aiFailureStreak: 0, aiPauseLevel: 0 }
}

export function decodeBook(v: unknown): AutomationBook {
  const b = emptyBook()
  if (!isObj(v)) return b
  if (isObj(v.states)) for (const [k, s] of Object.entries(v.states)) { const st = decodeState(s); if (st) b.states[k] = st }
  return compact({
    ...b,
    usage: numRecord(v.usage),
    followups: numRecord(v.followups),
    offeredEvents: strings(v.offeredEvents),
    readUpdatesAt: date(v.readUpdatesAt),
    budgetNotifiedDay: str(v.budgetNotifiedDay),
    lastTick: date(v.lastTick),
    notices: decodeLedger(v.notices),
    recentCosts: nums(v.recentCosts).map(Math.trunc),
    announced: dateRecord(v.announced),
    signInNeeded: dateRecord(v.signInNeeded),
    aiPausedUntil: date(v.aiPausedUntil),
    aiPauseReason: str(v.aiPauseReason),
    aiFailureStreak: int(v.aiFailureStreak) ?? 0,
    aiPauseLevel: int(v.aiPauseLevel) ?? 0,
    spendingCapDay: str(v.spendingCapDay)
  })
}
