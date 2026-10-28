// Lo que la IA leyó en un turno y de dónde salen las direcciones (inyección de instrucciones, AI-02; port de AssistantTrust.swift):
// el texto de webs, PDF, plataformas y servidores MCP es DATO, nunca orden. Con este estado:
//   - `fetch_url` abre sin tarjeta solo lo que dio el estudiante o salió de `web_search` en este turno;
//   - `memory_remember`, `memory_forget` y `goal_set` piden confirmación si la IA ya leyó contenido ajeno en el turno;
//   - `run_automation_now` se lanza como mucho una vez por turno.
import { foldPlain } from './fold'

/** Nombre base de una herramienta: sin el prefijo de los agentes CLI (`mcp__aula__list_courses` → `list_courses`). */
export function toolBaseName(name: string): string {
  const m = /^mcp__[^_]+(?:_[^_]+)*?__(.+)$/.exec(name)
  if (m) return m[1]
  const dot = name.lastIndexOf('.')
  if (name.startsWith('aula.') && dot > 0) return name.slice(dot + 1)
  return name
}

/** Datos de Aula; los handlers de calendario y find_items marcan los resultados externos que devuelven. Todo lo demás (web,
 * materiales, adjuntos, documentos, plataforma, servidores MCP, `WebFetch` de los agentes CLI) es contenido ajeno. */
export const OWN_DATA_TOOLS: ReadonlySet<string> = new Set([
  'list_courses', 'find_items', 'get_course', 'get_lesson', 'get_skill', 'get_exercise', 'study_overview', 'student_status', 'calendar_events',
  'list_sources', 'list_attachments', 'list_documents', 'ask_user', 'show_items', 'open_screen', 'create_course', 'extend_course', 'add_calendar_event',
  'update_calendar_event', 'delete_calendar_event', 'set_exam_date', 'add_flashcard', 'save_study_set', 'make_quiz', 'make_flashcards', 'calculate',
  'graph_function', 'convert_units', 'chemistry', 'block_reference', 'memory_remember', 'memory_search', 'memory_forget', 'create_automation',
  'list_automations', 'update_automation', 'pause_automation', 'delete_automation', 'run_automation_now', 'schedule_followup', 'create_document', 'open_document',
  'annotate_document', 'goal_set', 'goal_status', 'goal_complete', 'complete_task'
])

/** Clave para comparar direcciones: esquema y servidor en minúsculas, sin fragmento ni barra final, http = https. */
export function urlKey(raw: string): string {
  try {
    const u = new URL(raw)
    u.hash = ''
    let s = u.toString()
    if (s.startsWith('http://')) s = 'https://' + s.slice(7)
    if (s.endsWith('/') && u.search === '') s = s.slice(0, -1)
    return s
  } catch {
    return raw
  }
}

/** Las direcciones http(s) de un texto. */
export function urlsIn(text: string): string[] {
  if (!text.includes('http')) return []
  const out: string[] = []
  const re = /\bhttps?:\/\/[^\s<>"'«»()[\]{}]+/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    let u = m[0]
    while (u.length && '.,;:!?'.includes(u[u.length - 1])) u = u.slice(0, -1)
    try {
      new URL(u)
      out.push(u)
    } catch {
      /* no es una dirección */
    }
  }
  return out
}

export class AssistantTurnTrust {
  private readonly trustedURLs = new Set<string>()
  private studentText: string
  private untrusted: boolean
  private automationRuns = 0

  /** `studentText`: lo que escribió el estudiante en esta conversación. `untrustedFromStart`: el mensaje ya trae texto ajeno. */
  constructor(studentText: string[] = [], untrustedFromStart = false) {
    this.studentText = studentText.at(-1) ?? ''
    this.untrusted = untrustedFromStart
    for (const t of studentText) for (const u of urlsIn(t)) this.trustedURLs.add(urlKey(u))
  }

  /** Lo que el estudiante escribe a mitad de turno (respuesta a una pregunta) también cuenta como suyo. */
  noteStudent(text: string): void {
    this.studentText += '\n' + text
    for (const u of urlsIn(text)) this.trustedURLs.add(urlKey(u))
  }

  /** Direcciones que devolvió `web_search` en este turno. */
  noteSearchResults(urls: string[]): void {
    for (const u of urls) this.trustedURLs.add(urlKey(u))
  }

  /** Una herramienta va a ejecutarse: si no es de las que solo leen datos propios de Aula, el turno ya tiene texto ajeno. */
  noteTool(name: string): void {
    if (OWN_DATA_TOOLS.has(toolBaseName(name))) return
    this.noteExternalContent()
  }

  /** Un resultado mixto trae contenido externo aunque la herramienta también pueda devolver datos propios. */
  noteExternalContent(): void {
    this.untrusted = true
  }

  /** ¿La IA ya leyó en este turno algo que no escribió el estudiante ni Aula? */
  get sawUntrusted(): boolean {
    return this.untrusted
  }

  /** ¿La dirección la dio el estudiante o salió de `web_search` en este turno? */
  isTrusted(url: string): boolean {
    return this.trustedURLs.has(urlKey(url))
  }

  /** El mensaje del estudiante pide expresamente revisar o ejecutar algo ahora («revisa Canvas ahora», «ejecútala ya»). */
  get studentAskedToRunNow(): boolean {
    const t = ' ' + foldPlain(this.studentText) + ' '
    const verbs = ['revis', 'ejecut', 'corre ', 'lanza', 'comprueb', 'mira ', 'run', 'check', 'verifi', 'execut', 'lanc', 'pruebal']
    const now = [' ahora', ' ya ', ' ya.', ' ya!', ' ya,', 'ahorita', 'en este momento', ' now', 'right away', 'immediately', 'inmediatamente', 'agora', 'maintenant', ' jetzt']
    return verbs.some((v) => t.includes(v)) && now.some((n) => t.includes(n))
  }

  /** Reserva la única ejecución de `run_automation_now` del turno (false = ya se usó). */
  claimAutomationRun(): boolean {
    if (this.automationRuns > 0) return false
    this.automationRuns++
    return true
  }
}
