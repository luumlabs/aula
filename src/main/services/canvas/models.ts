// Modelos de Canvas con decodificación tolerante (port de CanvasKit/REST/CanvasModels*.swift y Support/Lenient.swift): un campo
// raro se omite y un elemento defectuoso se salta sin tirar la lista. Ids como texto (Canvas puede pasar de 2^53).
import { tr } from '@shared/ai/i18n'
import { htmlToMarkdown } from './text/markdown'

type Obj = Record<string, unknown>

export const asObj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null)
export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined)
export const text = (v: unknown): string | undefined => {
  const s = str(v)?.trim()
  return s ? s : undefined
}
export const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  return undefined
}
export const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : undefined)
/** Id: número o cadena de dígitos → cadena. */
export const id = (v: unknown): string | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v))
  if (typeof v === 'string' && /^\d{1,20}$/.test(v.trim())) return v.trim()
  return undefined
}
/** Fecha ISO normalizada (o undefined si no es una fecha). */
export const date = (v: unknown): string | undefined => {
  if (typeof v !== 'string' || !v) return undefined
  const t = Date.parse(v)
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined
}

export interface CanvasProfile {
  id: string
  name: string
  shortName?: string
  primaryEmail?: string
  timeZone?: string
  locale?: string
}

export interface CanvasTerm { id?: string; name?: string; startAt?: string; endAt?: string }

export interface CanvasCourse {
  id: string
  name: string
  courseCode?: string
  workflowState?: string
  startAt?: string
  endAt?: string
  term?: CanvasTerm
  accessRestrictedByDate: boolean
  url: string
}

export interface CanvasModuleItem {
  id: string
  moduleId?: string
  position?: number
  title: string
  indent: number
  /** File, Page, Discussion, Assignment, Quiz, SubHeader, ExternalUrl, ExternalTool. */
  type: string
  contentId?: string
  htmlURL?: string
  apiURL?: string
  pageURL?: string
  externalURL?: string
  published?: boolean
  dueAt?: string
  pointsPossible?: number
  lockedForUser: boolean
}

export interface CanvasModule {
  id: string
  name: string
  position?: number
  state?: string
  unlockAt?: string
  itemsCount?: number
  published?: boolean
  items: CanvasModuleItem[]
}

export interface CanvasPageInfo {
  pageId?: string
  /** Identificador de la página en la dirección (slug). */
  url: string
  title: string
  updatedAt?: string
  published?: boolean
  frontPage: boolean
  lockedForUser: boolean
}

export interface CanvasPage extends CanvasPageInfo {
  bodyHTML: string
  markdown: string
}

export interface CanvasFile {
  id: string
  folderId?: string
  displayName: string
  filename?: string
  contentType?: string
  /** Descarga firmada que da Canvas (con `verifier`). */
  url?: string
  size?: number
  updatedAt?: string
  locked: boolean
  hidden: boolean
  lockedForUser: boolean
  mimeClass?: string
}

export interface CanvasSubmissionSummary {
  workflowState?: string
  submittedAt?: string
  score?: number
  grade?: string
  missing: boolean
  late: boolean
  excused: boolean
}

export interface CanvasAssignment {
  id: string
  courseId?: string
  name: string
  /** Descripción en Markdown. */
  description: string
  dueAt?: string
  unlockAt?: string
  lockAt?: string
  pointsPossible?: number
  submissionTypes: string[]
  htmlURL?: string
  published?: boolean
  quizId?: string
  isQuizLTI: boolean
  lockedForUser: boolean
  submission?: CanvasSubmissionSummary
}

/** Solo la información del cuestionario (nunca se abre ni se empieza). */
export interface CanvasQuiz {
  id: string
  title: string
  htmlURL?: string
  description: string
  quizType?: string
  assignmentId?: string
  timeLimitMinutes?: number
  allowedAttempts?: number
  questionCount?: number
  pointsPossible?: number
  dueAt?: string
  unlockAt?: string
  lockAt?: string
  published?: boolean
  lockedForUser: boolean
}

export interface CanvasAnnouncement {
  id: string
  courseId?: string
  title: string
  /** Mensaje en Markdown. */
  message: string
  postedAt?: string
  authorName?: string
  htmlURL?: string
}

export interface CanvasCalendarEvent {
  id: string
  type: 'event' | 'assignment'
  title: string
  startAt?: string
  endAt?: string
  allDay: boolean
  allDayDate?: string
  description: string
  locationName?: string
  contextCode?: string
  courseId?: string
  htmlURL?: string
}

export interface CanvasPlannerItem {
  plannableId: string
  plannableType: string
  title: string
  date?: string
  courseId?: string
  contextName?: string
  htmlURL?: string
  completed: boolean
  submitted: boolean
}

// MARK: Decodificadores (null = elemento defectuoso: se salta)

export function decodeProfile(v: unknown): CanvasProfile | null {
  const o = asObj(v)
  const pid = id(o?.id)
  if (!o || !pid) return null
  return {
    id: pid, name: text(o.name) ?? text(o.short_name) ?? '',
    ...(text(o.short_name) ? { shortName: text(o.short_name) } : {}),
    ...(text(o.primary_email) ? { primaryEmail: text(o.primary_email) } : {}),
    ...(text(o.time_zone) ? { timeZone: text(o.time_zone) } : {}),
    ...(text(o.locale) ? { locale: text(o.locale) } : {})
  }
}

/** El enlace privado del calendario del perfil (`calendar.ics`). Es un secreto: solo va al almacén cifrado. */
export function profileCalendarFeed(v: unknown): string | null {
  const o = asObj(v)
  const cal = asObj(o?.calendar)
  return text(cal?.ics) ?? null
}

export function decodeCourse(v: unknown, baseURL: string): CanvasCourse | null {
  const o = asObj(v)
  const cid = id(o?.id)
  if (!o || !cid) return null
  const termObj = asObj(o.term)
  const term = termObj ? { id: id(termObj.id), name: text(termObj.name), startAt: date(termObj.start_at), endAt: date(termObj.end_at) } : undefined
  return {
    id: cid,
    name: text(o.name) ?? text(o.course_code) ?? `${tr('Curso', 'Course')} ${cid}`,
    ...(text(o.course_code) ? { courseCode: text(o.course_code) } : {}),
    ...(text(o.workflow_state) ? { workflowState: text(o.workflow_state) } : {}),
    ...(date(o.start_at) ? { startAt: date(o.start_at) } : {}),
    ...(date(o.end_at) ? { endAt: date(o.end_at) } : {}),
    ...(term ? { term } : {}),
    accessRestrictedByDate: bool(o.access_restricted_by_date) ?? false,
    url: `${baseURL.replace(/\/+$/, '')}/courses/${cid}`
  }
}

export function decodeModuleItem(v: unknown): CanvasModuleItem | null {
  const o = asObj(v)
  const iid = id(o?.id)
  if (!o || !iid) return null
  const details = asObj(o.content_details)
  return {
    id: iid,
    ...(id(o.module_id) ? { moduleId: id(o.module_id) } : {}),
    ...(num(o.position) != null ? { position: num(o.position) } : {}),
    title: text(o.title) ?? '',
    indent: num(o.indent) ?? 0,
    type: text(o.type) ?? 'Unknown',
    ...(id(o.content_id) ? { contentId: id(o.content_id) } : {}),
    ...(text(o.html_url) ? { htmlURL: text(o.html_url) } : {}),
    ...(text(o.url) ? { apiURL: text(o.url) } : {}),
    ...(text(o.page_url) ? { pageURL: text(o.page_url) } : {}),
    ...(text(o.external_url) ? { externalURL: text(o.external_url) } : {}),
    ...(bool(o.published) != null ? { published: bool(o.published) } : {}),
    ...(date(details?.due_at) ? { dueAt: date(details?.due_at) } : {}),
    ...(num(details?.points_possible) != null ? { pointsPossible: num(details?.points_possible) } : {}),
    lockedForUser: bool(details?.locked_for_user) ?? false
  }
}

export function decodeModule(v: unknown): CanvasModule | null {
  const o = asObj(v)
  const mid = id(o?.id)
  if (!o || !mid) return null
  const items = (Array.isArray(o.items) ? o.items : []).map(decodeModuleItem).filter((x): x is CanvasModuleItem => x !== null)
  return {
    id: mid,
    name: text(o.name) ?? `${tr('Módulo', 'Module')} ${mid}`,
    ...(num(o.position) != null ? { position: num(o.position) } : {}),
    ...(text(o.state) ? { state: text(o.state) } : {}),
    ...(date(o.unlock_at) ? { unlockAt: date(o.unlock_at) } : {}),
    ...(num(o.items_count) != null ? { itemsCount: num(o.items_count) } : {}),
    ...(bool(o.published) != null ? { published: bool(o.published) } : {}),
    items
  }
}

export function decodePageInfo(v: unknown): CanvasPageInfo | null {
  const o = asObj(v)
  const slug = text(o?.url)
  if (!o || !slug) return null
  return {
    ...(id(o.page_id) ? { pageId: id(o.page_id) } : {}),
    url: slug,
    title: text(o.title) ?? slug,
    ...(date(o.updated_at) ? { updatedAt: date(o.updated_at) } : {}),
    ...(bool(o.published) != null ? { published: bool(o.published) } : {}),
    frontPage: bool(o.front_page) ?? false,
    lockedForUser: bool(o.locked_for_user) ?? false
  }
}

export function decodePage(v: unknown, baseURL: string): CanvasPage | null {
  const info = decodePageInfo(v)
  if (!info) return null
  const o = asObj(v) ?? {}
  const body = str(o.body) ?? ''
  return { ...info, bodyHTML: body, markdown: htmlToMarkdown(body, baseURL) }
}

export function decodeFile(v: unknown): CanvasFile | null {
  const o = asObj(v)
  const fid = id(o?.id)
  if (!o || !fid) return null
  return {
    id: fid,
    ...(id(o.folder_id) ? { folderId: id(o.folder_id) } : {}),
    displayName: text(o.display_name) ?? text(o.filename) ?? `archivo-${fid}`,
    ...(text(o.filename) ? { filename: text(o.filename) } : {}),
    ...(text(o['content-type']) ?? text(o.content_type) ? { contentType: text(o['content-type']) ?? text(o.content_type) } : {}),
    ...(text(o.url) ? { url: text(o.url) } : {}),
    ...(num(o.size) != null ? { size: num(o.size) } : {}),
    ...(date(o.updated_at) ? { updatedAt: date(o.updated_at) } : {}),
    locked: bool(o.locked) ?? false,
    hidden: bool(o.hidden) ?? false,
    lockedForUser: bool(o.locked_for_user) ?? false,
    ...(text(o.mime_class) ? { mimeClass: text(o.mime_class) } : {})
  }
}

export function decodeAssignment(v: unknown, baseURL?: string): CanvasAssignment | null {
  const o = asObj(v)
  const aid = id(o?.id)
  if (!o || !aid) return null
  const sub = asObj(o.submission)
  return {
    id: aid,
    ...(id(o.course_id) ? { courseId: id(o.course_id) } : {}),
    name: text(o.name) ?? `${tr('Tarea', 'Assignment')} ${aid}`,
    description: htmlToMarkdown(str(o.description) ?? '', baseURL),
    ...(date(o.due_at) ? { dueAt: date(o.due_at) } : {}),
    ...(date(o.unlock_at) ? { unlockAt: date(o.unlock_at) } : {}),
    ...(date(o.lock_at) ? { lockAt: date(o.lock_at) } : {}),
    ...(num(o.points_possible) != null ? { pointsPossible: num(o.points_possible) } : {}),
    submissionTypes: Array.isArray(o.submission_types) ? o.submission_types.filter((x): x is string => typeof x === 'string') : [],
    ...(text(o.html_url) ? { htmlURL: text(o.html_url) } : {}),
    ...(bool(o.published) != null ? { published: bool(o.published) } : {}),
    ...(id(o.quiz_id) ? { quizId: id(o.quiz_id) } : {}),
    isQuizLTI: bool(o.is_quiz_lti_assignment) ?? false,
    lockedForUser: bool(o.locked_for_user) ?? false,
    ...(sub ? {
      submission: {
        ...(text(sub.workflow_state) ? { workflowState: text(sub.workflow_state) } : {}),
        ...(date(sub.submitted_at) ? { submittedAt: date(sub.submitted_at) } : {}),
        ...(num(sub.score) != null ? { score: num(sub.score) } : {}),
        ...(text(sub.grade) ? { grade: text(sub.grade) } : {}),
        missing: bool(sub.missing) ?? false,
        late: bool(sub.late) ?? false,
        excused: bool(sub.excused) ?? false
      }
    } : {})
  }
}

export function decodeQuiz(v: unknown, baseURL?: string): CanvasQuiz | null {
  const o = asObj(v)
  const qid = id(o?.id)
  if (!o || !qid) return null
  return {
    id: qid,
    title: text(o.title) ?? `Cuestionario ${qid}`,
    ...(text(o.html_url) ? { htmlURL: text(o.html_url) } : {}),
    description: htmlToMarkdown(str(o.description) ?? '', baseURL),
    ...(text(o.quiz_type) ? { quizType: text(o.quiz_type) } : {}),
    ...(id(o.assignment_id) ? { assignmentId: id(o.assignment_id) } : {}),
    ...(num(o.time_limit) != null ? { timeLimitMinutes: num(o.time_limit) } : {}),
    ...(num(o.allowed_attempts) != null ? { allowedAttempts: num(o.allowed_attempts) } : {}),
    ...(num(o.question_count) != null ? { questionCount: num(o.question_count) } : {}),
    ...(num(o.points_possible) != null ? { pointsPossible: num(o.points_possible) } : {}),
    ...(date(o.due_at) ? { dueAt: date(o.due_at) } : {}),
    ...(date(o.unlock_at) ? { unlockAt: date(o.unlock_at) } : {}),
    ...(date(o.lock_at) ? { lockAt: date(o.lock_at) } : {}),
    ...(bool(o.published) != null ? { published: bool(o.published) } : {}),
    lockedForUser: bool(o.locked_for_user) ?? false
  }
}

function courseIdFromContext(code: string | undefined): string | undefined {
  const m = /^course_(\d+)$/.exec(code ?? '')
  return m ? m[1] : undefined
}

export function decodeAnnouncement(v: unknown, baseURL?: string): CanvasAnnouncement | null {
  const o = asObj(v)
  const aid = id(o?.id)
  if (!o || !aid) return null
  const author = asObj(o.author)
  const courseId = courseIdFromContext(text(o.context_code))
  return {
    id: aid,
    ...(courseId ? { courseId } : {}),
    title: text(o.title) ?? '',
    message: htmlToMarkdown(str(o.message) ?? '', baseURL),
    ...(date(o.posted_at) ?? date(o.created_at) ? { postedAt: date(o.posted_at) ?? date(o.created_at) } : {}),
    ...(text(author?.display_name) ?? text(o.user_name) ? { authorName: text(author?.display_name) ?? text(o.user_name) } : {}),
    ...(text(o.html_url) ? { htmlURL: text(o.html_url) } : {})
  }
}

export function decodeCalendarEvent(v: unknown, baseURL?: string): CanvasCalendarEvent | null {
  const o = asObj(v)
  const eid = text(o?.id)
  if (!o || !eid) return null
  const assignment = asObj(o.assignment)
  const isAssignment = text(o.type) === 'assignment' || eid.startsWith('assignment_') || !!assignment
  const contextCode = text(o.context_code)
  const courseId = courseIdFromContext(contextCode)
  return {
    id: eid,
    type: isAssignment ? 'assignment' : 'event',
    title: text(o.title) ?? '',
    ...(date(o.start_at) ? { startAt: date(o.start_at) } : {}),
    ...(date(o.end_at) ? { endAt: date(o.end_at) } : {}),
    allDay: bool(o.all_day) ?? false,
    ...(text(o.all_day_date) ? { allDayDate: text(o.all_day_date) } : {}),
    description: htmlToMarkdown(str(o.description) ?? str(assignment?.description) ?? '', baseURL),
    ...(text(o.location_name) ? { locationName: text(o.location_name) } : {}),
    ...(contextCode ? { contextCode } : {}),
    ...(courseId ? { courseId } : {}),
    ...(text(o.html_url) ? { htmlURL: text(o.html_url) } : {})
  }
}

export function decodePlannerItem(v: unknown, baseURL?: string): CanvasPlannerItem | null {
  const o = asObj(v)
  const pid = id(o?.plannable_id)
  if (!o || !pid) return null
  const plannable = asObj(o.plannable)
  const sub = o.submissions
  const subObj = asObj(sub)
  const override = asObj(o.planner_override)
  let html = text(o.html_url)
  if (html && baseURL && html.startsWith('/')) html = baseURL.replace(/\/+$/, '') + html
  return {
    plannableId: pid,
    plannableType: text(o.plannable_type) ?? 'unknown',
    title: text(plannable?.title) ?? text(plannable?.name) ?? '',
    ...(date(o.plannable_date) ? { date: date(o.plannable_date) } : {}),
    ...(id(o.course_id) ? { courseId: id(o.course_id) } : {}),
    ...(text(o.context_name) ? { contextName: text(o.context_name) } : {}),
    ...(html ? { htmlURL: html } : {}),
    completed: bool(override?.marked_complete) ?? false,
    submitted: subObj ? (bool(subObj.submitted) ?? false) || (bool(subObj.graded) ?? false) || (bool(subObj.excused) ?? false) : false
  }
}
