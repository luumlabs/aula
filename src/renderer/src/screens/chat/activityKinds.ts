// Lo que hace Aula mientras responde, para enseñarlo: cada herramienta pertenece a una clase (buscar en tus materiales, leer una
// web, crear tarjetas, apuntar en el calendario…) con su icono y su animación; al terminar, los pasos se pliegan en un resumen
// («Consultó 3 materiales · creó 5 tarjetas»). Aquí solo la lógica (sin React ni textos): los textos están en chat.json.
import type { AssistantStep } from '@shared/assistant/types'

export type ActivityKind =
  | 'materials' | 'search' | 'web' | 'page' | 'courses' | 'calendar' | 'calendarEdit' | 'cards' | 'quiz' | 'course'
  | 'calc' | 'chart' | 'image' | 'memory' | 'platform' | 'files' | 'save' | 'ui' | 'other'

const BY_TOOL: Record<string, ActivityKind> = {
  list_sources: 'materials', search_sources: 'materials', read_source: 'materials', view_source_page: 'materials',
  search_course_materials: 'materials', read_course_material: 'materials', list_attachments: 'materials', search_attachments: 'materials',
  read_attachment: 'materials', view_attachment_page: 'materials', list_documents: 'materials', read_document: 'materials', summarize_document: 'materials',
  find_items: 'search',
  web_search: 'web', WebSearch: 'web',
  fetch_url: 'page', WebFetch: 'page',
  list_courses: 'courses', get_course: 'courses', get_lesson: 'courses', get_skill: 'courses', get_exercise: 'courses', study_overview: 'courses',
  student_status: 'courses', goal_set: 'courses', goal_status: 'courses', goal_complete: 'courses',
  calendar_events: 'calendar', upcoming_dates: 'calendar', canvas_upcoming: 'calendar',
  add_calendar_event: 'calendarEdit', update_calendar_event: 'calendarEdit', delete_calendar_event: 'calendarEdit', complete_task: 'calendarEdit', set_exam_date: 'calendarEdit',
  make_flashcards: 'cards', add_flashcard: 'cards',
  make_quiz: 'quiz',
  create_course: 'course', extend_course: 'course',
  calculate: 'calc', chemistry: 'calc', convert_units: 'calc',
  graph_function: 'chart', block_reference: 'chart',
  find_image: 'image', add_image: 'image', add_model: 'image',
  canvas_courses: 'platform', canvas_course_outline: 'platform', canvas_read_page: 'platform',
  Read: 'files', Grep: 'files', Glob: 'files',
  save_study_set: 'save',
  ask_user: 'ui', show_items: 'ui', open_screen: 'ui'
}

/** La clase de una herramienta (por su nombre sin prefijo de servidor MCP). */
export function activityKind(tool: string): ActivityKind {
  const name = tool.replace(/^mcp__.+?__/, '')
  const k = BY_TOOL[name]
  if (k) return k
  if (name.startsWith('memory_')) return 'memory'
  if (name.startsWith('platform_')) return 'platform'
  return 'other'
}

/** Cómo se anima el icono de un paso en curso (cada clase hace lo suyo). */
export type ActivityMotion = 'scan' | 'seek' | 'stamp' | 'deal' | 'draw' | 'tick' | 'pulse'

export const ACTIVITY_MOTION: Record<ActivityKind, ActivityMotion> = {
  materials: 'scan', page: 'scan', platform: 'scan', files: 'scan', courses: 'scan',
  search: 'seek', web: 'seek', image: 'seek', memory: 'seek',
  calendar: 'stamp', calendarEdit: 'stamp', save: 'stamp',
  cards: 'deal', quiz: 'deal', course: 'deal',
  chart: 'draw',
  calc: 'tick',
  ui: 'pulse', other: 'pulse'
}

/** Una parte del resumen: la clave de chat.json (`activity.done.<kind>`) y su cuenta. */
export interface SummaryPart {
  kind: ActivityKind
  count: number
}

/** Lo que cuenta cada clase en el resumen: lo creado (tarjetas, preguntas) si se sabe; si no, cuántas veces se hizo. */
function partCount(kind: ActivityKind, steps: readonly AssistantStep[]): number {
  if (kind === 'cards') {
    const made = steps.reduce((n, s) => n + (s.tool === 'add_flashcard' ? 1 : s.count ?? 0), 0)
    return made || steps.length
  }
  if (kind === 'materials' || kind === 'page' || kind === 'files') {
    // la misma búsqueda o el mismo material dos veces cuenta una
    const seen = new Set(steps.map((s) => s.detail ?? s.id))
    return seen.size
  }
  return steps.length
}

/** El resumen de unos pasos, en el orden en que empezó cada clase (lo de la interfaz, como preguntar, no cuenta; lo que el
 * estudiante rechazó, tampoco: A3-P2-6). */
export function summarize(steps: readonly AssistantStep[]): { parts: SummaryPart[]; failed: number } {
  const groups = new Map<ActivityKind, AssistantStep[]>()
  for (const s of steps) {
    const k = activityKind(s.tool)
    if (k === 'ui' || s.declined) continue
    const g = groups.get(k)
    if (g) g.push(s)
    else groups.set(k, [s])
  }
  const parts = [...groups].map(([kind, list]) => ({ kind, count: partCount(kind, list.filter((s) => s.ok !== false)) })).filter((p) => p.count > 0)
  return { parts, failed: steps.filter((s) => s.ok === false && !s.declined).length }
}

/** Un cuestionario: el resumen dice cuántas preguntas tiene (si hay uno solo y se sabe). */
export function quizQuestions(steps: readonly AssistantStep[]): number | undefined {
  const quizzes = steps.filter((s) => activityKind(s.tool) === 'quiz' && s.ok !== false && !s.declined)
  return quizzes.length === 1 ? quizzes[0].count : undefined
}

/** En qué está Aula en una respuesta: pensando (aún nada), usando herramientas, escribiendo o ya terminó. */
export type ReplyPhase = 'thinking' | 'tools' | 'writing' | 'done'

export function replyPhase(steps: readonly AssistantStep[], hasText: boolean, streaming: boolean): ReplyPhase {
  if (!streaming) return 'done'
  if (steps.some((s) => s.ok === undefined && !s.declined)) return 'tools'
  if (hasText) return 'writing'
  return steps.length ? 'tools' : 'thinking'
}

/** La frase de «pensando» según el tiempo que lleva (sin una más concreta del proceso principal). */
export type ThinkingKey = 'reading' | 'thinking' | 'deeper' | 'long' | 'composing'

export function thinkingKey(elapsedMs: number, afterTools: boolean): ThinkingKey {
  if (afterTools) return elapsedMs > 20_000 ? 'long' : 'composing'
  if (elapsedMs < 1400) return 'reading'
  if (elapsedMs < 7000) return 'thinking'
  if (elapsedMs < 20_000) return 'deeper'
  return 'long'
}

/** El estado del proceso principal que solo dice «Pensando…» (no aporta: se usa la frase por fases). */
export function isGenericStatus(label: string | undefined): boolean {
  return !label || /^(pensando|thinking)\s*(…|\.\.\.)?$/i.test(label.trim())
}
