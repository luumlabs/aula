// Conversaciones con Aula en disco (port de AssistantModels.swift): mismas claves que la app Swift en `<datos>/Assistant/threads/`
// y en `Packs/<curso>/chats/`, para abrir las conversaciones que ya existen. Todo es tolerante al leer: una conversación de una
// versión anterior (o con un campo roto) se abre igual. Una pregunta o un permiso que quedó a medias al cerrar la app ya no espera.
import { IDs } from '@engine/base/ids'
import type {
  AssistantAttachment, AssistantCard, AssistantCardAction, AssistantCardActionKind, AssistantCardKind, AssistantCardState, AssistantCitation, AssistantFact, AssistantMessage,
  AssistantOption, AssistantRef, AssistantRefKind, AssistantStep, AssistantStudySet, AssistantThread, TutorContext
} from '@shared/assistant/types'
import { decodeExercise, encodeExercise, type Exercise } from '@shared/schema/exercises'
import { decodeFlashcard, encodeFlashcard, type Flashcard } from '@shared/schema/cards'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const s = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const b = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)
const date = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined
  const t = Date.parse(v)
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined
}
const arr = <T>(v: unknown, f: (x: unknown) => T | undefined): T[] => (Array.isArray(v) ? v.flatMap((x) => { const d = f(x); return d === undefined ? [] : [d] }) : [])
const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | undefined => (typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : undefined)
/** Quita las claves sin valor (como `encodeIfPresent` de Swift). */
function prune<T extends Obj>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]
  return o
}

export const REF_KIND_VALUES: readonly AssistantRefKind[] = ['course', 'lesson', 'exercise', 'material', 'event']
export const CARD_KINDS: readonly AssistantCardKind[] = ['question', 'approval', 'items', 'course', 'actions', 'automation', 'quiz', 'flashcards']
export const CARD_STATES: readonly AssistantCardState[] = ['pending', 'answered', 'approved', 'denied', 'expired', 'done']
export const ACTION_KINDS: readonly AssistantCardActionKind[] = ['ask', 'open', 'openURL', 'prepareCourse', 'adjustCourse', 'extendCourse', 'signIn', 'runAutomation', 'openAutomation',
  'pauseAutomation', 'cancelAutomation', 'openToday', 'openCalendar', 'openSettings', 'dismiss', 'neverForEvent']

/** Espera una respuesta del estudiante dentro del turno (pregunta o permiso). Un cuestionario o unas tarjetas nunca bloquean. */
export function isPendingCard(c: AssistantCard): boolean {
  return c.state === 'pending' && c.kind !== 'quiz' && c.kind !== 'flashcards' && c.kind !== 'actions' && c.kind !== 'automation'
}

/** Una respuesta que se corta (Detener, cerrar la app): lo que esperaba respuesta caduca y, si esperaba un permiso, los pasos
 * que no terminaron quedan como no hechos (A3-P2-6: el resumen no dice «cambió tu calendario» si no se cambió). */
export function expirePending(m: AssistantMessage): void {
  const waitedApproval = m.cards.some((c) => isPendingCard(c) && c.kind === 'approval')
  m.cards = m.cards.map((c) => (isPendingCard(c) ? { ...c, state: 'expired' } : c))
  if (waitedApproval) m.steps = m.steps.map((s) => (s.ok === undefined ? { ...s, declined: true } : s))
}

// MARK: Leer

export function decodeRef(raw: unknown): AssistantRef | undefined {
  if (!isObj(raw)) return undefined
  return prune({
    kind: oneOf(raw.kind, REF_KIND_VALUES) ?? 'course', courseID: s(raw.courseID), itemID: s(raw.itemID), skillID: s(raw.skillID), title: s(raw.title) ?? '',
    subtitle: s(raw.subtitle), icon: s(raw.icon), hue: n(raw.hue), date: date(raw.date)
  })
}

export function decodeAttachment(raw: unknown): AssistantAttachment | undefined {
  if (!isObj(raw)) return undefined
  return prune({
    id: s(raw.id) ?? IDs.short(8), kind: oneOf(raw.kind, ['document', 'image', 'video', 'audio', 'other'] as const) ?? 'other', name: s(raw.name) ?? '',
    bytes: n(raw.bytes) ?? 0, status: oneOf(raw.status, ['processing', 'ready', 'failed'] as const) ?? 'ready', sourceID: s(raw.sourceID), pages: n(raw.pages) ?? 0,
    characters: n(raw.characters) ?? 0, imageAssets: arr(raw.imageAssets, s), thumbnail: s(raw.thumbnail), transcript: s(raw.transcript), duration: n(raw.duration),
    visionNote: s(raw.visionNote), note: s(raw.note)
  })
}

function decodeOption(raw: unknown): AssistantOption | undefined {
  if (!isObj(raw)) return undefined
  return prune({ id: s(raw.id) ?? IDs.short(5), label: s(raw.label) ?? '', detail: s(raw.detail), ref: decodeRef(raw.ref) })
}

function decodeFact(raw: unknown): AssistantFact | undefined {
  if (!isObj(raw)) return undefined
  return { label: s(raw.label) ?? '', value: s(raw.value) ?? '' }
}

function decodeAction(raw: unknown): AssistantCardAction | undefined {
  if (!isObj(raw)) return undefined
  return prune({
    id: s(raw.id) ?? IDs.short(6), kind: oneOf(raw.kind, ACTION_KINDS) ?? 'dismiss', label: s(raw.label) ?? '', symbol: s(raw.symbol), prominent: b(raw.prominent) ?? false,
    value: s(raw.value), courseID: s(raw.courseID), ref: decodeRef(raw.ref)
  })
}

const boolMap = (v: unknown): Record<string, boolean> => (isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'boolean')) as Record<string, boolean> : {})
const strMap = (v: unknown): Record<string, string> => (isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string')) as Record<string, string> : {})

export function decodeStudySet(raw: unknown): AssistantStudySet | undefined {
  if (!isObj(raw)) return undefined
  return prune({
    id: s(raw.id) ?? IDs.short(8), title: s(raw.title) ?? '', exercises: arr<Exercise>(raw.exercises, (x) => decodeExercise(x)), cards: arr<Flashcard>(raw.cards, (x) => decodeFlashcard(x)),
    courseID: s(raw.courseID), skillID: s(raw.skillID), results: boolMap(raw.results), inputs: strMap(raw.inputs), savedTo: s(raw.savedTo)
  })
}

export function decodeCard(raw: unknown): AssistantCard | undefined {
  if (!isObj(raw)) return undefined
  const kind = oneOf(raw.kind, CARD_KINDS) ?? 'items'
  const st = oneOf(raw.state, CARD_STATES) ?? 'done'
  const card: AssistantCard = prune({
    id: s(raw.id) ?? IDs.short(8), kind, title: s(raw.title) ?? '', detail: s(raw.detail), options: arr(raw.options, decodeOption), allowsOther: b(raw.allowsOther) ?? true,
    items: arr(raw.items, decodeRef), facts: arr(raw.facts, decodeFact), actionLabel: s(raw.actionLabel), icon: s(raw.icon), state: st, answer: s(raw.answer),
    packID: s(raw.packID), actions: arr(raw.actions, decodeAction), automationID: s(raw.automationID), studySet: decodeStudySet(raw.studySet)
  })
  // una pregunta o un permiso que quedó a medias al cerrar la app ya no espera a nadie (los botones de un mensaje automático sí)
  if (isPendingCard(card)) card.state = 'expired'
  return card
}

function decodeStep(raw: unknown): AssistantStep | undefined {
  if (!isObj(raw)) return undefined
  return prune({ id: s(raw.id) ?? IDs.short(6), tool: s(raw.tool) ?? '', label: s(raw.label) ?? '', ok: b(raw.ok), detail: s(raw.detail), count: n(raw.count), declined: b(raw.declined) || undefined })
}

/** El contexto del tutor: las claves de la app Swift (`skillID`, `exerciseID`, `lastInput`, `lastResult`, `lessonBlock`, `screen`) y las nuevas. */
export function decodeContext(raw: unknown): TutorContext | undefined {
  if (!isObj(raw)) return undefined
  const c: TutorContext = prune({
    courseID: s(raw.courseID), skillID: s(raw.skillID), exerciseID: s(raw.exerciseID), blockID: s(raw.blockID), screen: s(raw.screen), selection: s(raw.selection),
    lastInput: s(raw.lastInput), lastResult: s(raw.lastResult), lessonBlock: n(raw.lessonBlock) !== undefined ? Math.trunc(n(raw.lessonBlock)!) : undefined
  })
  return Object.keys(c).length ? c : undefined
}

export function contextIsEmpty(c: TutorContext | undefined): boolean {
  return !c || (c.skillID === undefined && c.exerciseID === undefined && c.screen === undefined && c.selection === undefined && c.lessonBlock === undefined)
}

function decodeOrigin(raw: unknown): AssistantMessage['origin'] {
  if (!isObj(raw)) return undefined
  return prune({
    kind: oneOf(raw.kind, ['routine', 'automation', 'followup', 'reminder', 'system'] as const) ?? 'system', title: s(raw.title) ?? '', automationID: s(raw.automationID),
    runID: s(raw.runID), symbol: s(raw.symbol)
  })
}

function decodeCitation(raw: unknown): AssistantCitation | undefined {
  if (!isObj(raw) || typeof raw.title !== 'string') return undefined
  return prune({ title: raw.title, page: n(raw.page), courseID: s(raw.courseID), sourceID: s(raw.sourceID) })
}

export function decodeMessage(raw: unknown): AssistantMessage | undefined {
  if (!isObj(raw)) return undefined
  const m: AssistantMessage = prune({
    id: s(raw.id) ?? IDs.short(8), role: oneOf(raw.role, ['user', 'assistant'] as const) ?? 'assistant', text: s(raw.text) ?? '', date: date(raw.date) ?? new Date().toISOString(),
    mentions: arr(raw.mentions, decodeRef), attachments: arr(raw.attachments, decodeAttachment), cards: arr(raw.cards, decodeCard), steps: arr(raw.steps, decodeStep),
    notices: arr(raw.notices, s), failed: b(raw.failed) ?? false, provider: s(raw.provider), origin: decodeOrigin(raw.origin), context: decodeContext(raw.context),
    interrupted: b(raw.interrupted) ?? false
  })
  const cites = arr(raw.citations, decodeCitation)
  if (cites.length) m.citations = cites
  return m
}

export function decodeThread(raw: unknown): AssistantThread {
  const o = isObj(raw) ? raw : {}
  const created = date(o.created) ?? new Date().toISOString()
  return prune({
    id: s(o.id) ?? IDs.short(10), title: s(o.title) ?? '', created, updated: date(o.updated) ?? created, messages: arr(o.messages, decodeMessage), pinned: b(o.pinned) ?? false,
    courseID: s(o.courseID)
  })
}

// MARK: Conversaciones del tutor de antes («student»/«tutor»)

/** ¿Es una conversación del tutor de antes? */
export function isLegacyTutor(raw: unknown): boolean {
  return isObj(raw) && Array.isArray(raw.messages) && raw.messages.some((m) => isObj(m) && (m.role === 'student' || m.role === 'tutor'))
}

/** Conversación del tutor de antes → la del chat (mismo id: al guardarse sustituye al archivo viejo). «Basado en» se conserva. */
export function convertLegacyTutor(raw: Obj, courseID?: string, basedOn = 'Basado en'): AssistantThread {
  const created = date(raw.created) ?? new Date().toISOString()
  const messages: AssistantMessage[] = arr(raw.messages, (m): AssistantMessage | undefined => {
    if (!isObj(m)) return undefined
    const tutor = m.role !== 'student'
    let text = s(m.text) ?? (typeof m.text === 'number' ? String(m.text) : '')
    const sources = arr(m.sources, s)
    if (tutor && sources.length) text += `\n\n_${basedOn}: ` + sources.slice(0, 4).join(' · ') + '_'
    return prune({
      id: s(m.id) ?? IDs.short(8), role: tutor ? 'assistant' : 'user', text, date: date(m.date) ?? created, mentions: [], attachments: [], cards: [], steps: [], notices: [],
      failed: b(m.failed) ?? false, context: decodeContext(m.context), interrupted: false
    }) as AssistantMessage
  })
  return prune({ id: s(raw.id) ?? IDs.short(10), title: s(raw.title) ?? '', created, updated: date(raw.updated) ?? created, messages, pinned: false, courseID })
}

// MARK: Escribir (las claves de Swift)

function encodeRef(r: AssistantRef): Obj {
  return prune({ kind: r.kind, courseID: r.courseID, itemID: r.itemID, skillID: r.skillID, title: r.title, subtitle: r.subtitle, icon: r.icon, hue: r.hue, date: r.date })
}

function encodeStudySet(st: AssistantStudySet): Obj {
  return prune({
    id: st.id, title: st.title, exercises: st.exercises.map((e) => encodeExercise(e)), cards: st.cards.map((c) => encodeFlashcard(c)), courseID: st.courseID, skillID: st.skillID,
    results: st.results, inputs: st.inputs, savedTo: st.savedTo
  })
}

export function encodeCard(c: AssistantCard): Obj {
  return prune({
    id: c.id, kind: c.kind, title: c.title, detail: c.detail, options: c.options.map((o) => prune({ id: o.id, label: o.label, detail: o.detail, ref: o.ref ? encodeRef(o.ref) : undefined })),
    allowsOther: c.allowsOther, items: c.items.map(encodeRef), facts: c.facts.map((f) => ({ label: f.label, value: f.value })), actionLabel: c.actionLabel, icon: c.icon, state: c.state,
    answer: c.answer, packID: c.packID,
    actions: c.actions.map((a) => prune({ id: a.id, kind: a.kind, label: a.label, symbol: a.symbol, prominent: a.prominent, value: a.value, courseID: a.courseID, ref: a.ref ? encodeRef(a.ref) : undefined })),
    automationID: c.automationID, studySet: c.studySet ? encodeStudySet(c.studySet) : undefined
  })
}

export function encodeMessage(m: AssistantMessage): Obj {
  return prune({
    id: m.id, role: m.role, text: m.text, date: m.date, mentions: m.mentions.map(encodeRef),
    attachments: m.attachments.map((a) => prune({ ...a } as unknown as Obj)), cards: m.cards.map(encodeCard), steps: m.steps.map((x) => prune({ id: x.id, tool: x.tool, label: x.label, ok: x.ok, detail: x.detail, count: x.count, declined: x.declined || undefined })),
    notices: m.notices, failed: m.failed, provider: m.provider, origin: m.origin ? prune({ ...m.origin } as Obj) : undefined, context: m.context ? prune({ ...m.context } as Obj) : undefined,
    interrupted: m.interrupted, citations: m.citations?.length ? m.citations.map((c) => prune({ ...c } as Obj)) : undefined
  })
}

export function encodeThread(t: AssistantThread): Obj {
  return prune({ id: t.id, title: t.title, created: t.created, updated: t.updated, messages: t.messages.map(encodeMessage), pinned: t.pinned, courseID: t.courseID })
}

// MARK: Crear

export function newMessage(role: AssistantMessage['role'], text: string, more: Partial<AssistantMessage> = {}): AssistantMessage {
  return { id: IDs.short(8), role, text, date: new Date().toISOString(), mentions: [], attachments: [], cards: [], steps: [], notices: [], failed: false, interrupted: false, ...more }
}

export function newThread(more: Partial<AssistantThread> = {}): AssistantThread {
  const now = new Date().toISOString()
  return { id: IDs.short(10), title: '', created: now, updated: now, messages: [], pinned: false, ...more }
}

export function newCard(kind: AssistantCardKind, title: string, more: Partial<AssistantCard> = {}): AssistantCard {
  return { id: IDs.short(8), kind, title, options: [], allowsOther: true, items: [], facts: [], state: 'pending', actions: [], ...more }
}

export function newStudySet(title: string, more: Partial<AssistantStudySet> = {}): AssistantStudySet {
  return { id: IDs.short(8), title, exercises: [], cards: [], results: {}, inputs: {}, ...more }
}

/** Tipo de un adjunto según la extensión del archivo. */
export function attachmentKind(ext: string): AssistantAttachment['kind'] {
  const e = ext.toLowerCase().replace(/^\./, '')
  if (['png', 'jpg', 'jpeg', 'heic', 'heif', 'gif', 'webp', 'tif', 'tiff', 'bmp'].includes(e)) return 'image'
  if (['mov', 'mp4', 'm4v', 'avi', 'mkv', 'webm', '3gp'].includes(e)) return 'video'
  if (['m4a', 'mp3', 'wav', 'aiff', 'aif', 'caf', 'aac', 'flac', 'ogg', 'opus'].includes(e)) return 'audio'
  if (['pdf', 'doc', 'docx', 'ppt', 'pptx', 'key', 'pages', 'xls', 'xlsx', 'csv', 'txt', 'md', 'markdown', 'rtf', 'html', 'htm', 'epub', 'tex', 'json', 'numbers'].includes(e)) return 'document'
  return 'other'
}

/** «3 de 5 bien a la primera» (para la IA en los turnos siguientes). */
export function studySetResultSummary(set: AssistantStudySet): string | undefined {
  const answered = Object.keys(set.results).length
  if (!set.exercises.length || !answered) return undefined
  const right = Object.values(set.results).filter((x) => x).length
  let out = `${right}/${set.exercises.length} right at the first try (answered ${answered})`
  const wrong = set.exercises.map((e, i) => ({ e, i })).filter(({ e }) => set.results[e.id] === false)
  if (wrong.length) {
    out += '; wrong: ' + wrong.slice(0, 6).map(({ e, i }) => `q${i + 1} (${e.id})` + (set.inputs[e.id] !== undefined ? ` typed «${Array.from(set.inputs[e.id]).slice(0, 80).join('')}»` : '')).join(', ')
  }
  return out
}
