// Nombres amigables de lo que hace la IA en el chat y en el tutor (port de AssistantToolLabels y ToolLabels): los pasos que ve
// el estudiante («Mirando tus cursos», «Buscando en los materiales del curso»), en el idioma de la interfaz.
import { toolBaseName } from '@engine/assistant'
import { tr } from '@shared/ai/i18n'
import { memoryToolLabel } from '../memory/tools'

/** Etiquetas que otras áreas añaden (documentos, automatizaciones…). */
const extraLabels = new Map<string, (name: string) => string | undefined>()

export function registerToolLabels(area: string, fn: ((name: string) => string | undefined) | null): void {
  if (fn) extraLabels.set(area, fn)
  else extraLabels.delete(area)
}

function genericLabel(name: string): string {
  switch (name) {
    case 'list_sources': return tr('Mirando tus materiales', 'Looking at your materials')
    case 'search_sources': return tr('Buscando en tus materiales', 'Searching your materials')
    case 'read_source': return tr('Leyendo un material', 'Reading a material')
    case 'view_source_page': return tr('Mirando una página de tus materiales', 'Looking at a page of your materials')
    case 'calculate': return tr('Calculando', 'Calculating')
    case 'chemistry': return tr('Comprobando la química', 'Checking the chemistry')
    case 'web_search': case 'WebSearch': return tr('Buscando en internet', 'Searching the web')
    case 'fetch_url': case 'WebFetch': return tr('Leyendo una página web', 'Reading a web page')
    case 'find_image': return tr('Buscando una imagen', 'Looking for an image')
    case 'add_image': return tr('Añadiendo una imagen', 'Adding an image')
    case 'upcoming_dates': case 'canvas_upcoming': return tr('Mirando tus fechas de examen', 'Checking your exam dates')
    case 'canvas_courses': return tr('Mirando tus cursos de Canvas', 'Looking at your Canvas courses')
    case 'canvas_course_outline': return tr('Revisando el curso en Canvas', 'Checking the course on Canvas')
    case 'canvas_read_page': return tr('Leyendo una página de Canvas', 'Reading a Canvas page')
    case 'Read': case 'Grep': case 'Glob': return tr('Leyendo archivos', 'Reading files')
    default: return tr('Trabajando', 'Working')
  }
}

function studyLabel(name: string): string | undefined {
  switch (name) {
    case 'make_quiz': return tr('Preparando el cuestionario', 'Preparing the quiz')
    case 'make_flashcards': return tr('Preparando las tarjetas', 'Preparing the flashcards')
    case 'save_study_set': return tr('Guardando en tu curso', 'Saving to your course')
    case 'graph_function': return tr('Calculando la gráfica', 'Working out the graph')
    case 'block_reference': return tr('Preparando el visual', 'Preparing the visual')
    case 'add_model': return tr('Trayendo el modelo 3D', 'Fetching the 3D model')
    case 'convert_units': return tr('Convirtiendo unidades', 'Converting units')
    case 'platform_open': case 'platform_read': case 'platform_links': case 'platform_click': return tr('Leyendo tu plataforma', 'Reading your platform')
    case 'list_attachments': case 'search_attachments': case 'read_attachment': return tr('Leyendo lo que adjuntaste', 'Reading what you attached')
    case 'view_attachment_page': return tr('Mirando una página de lo que adjuntaste', 'Looking at a page you attached')
    default: return undefined
  }
}

/** Lo que enseña el paso de una herramienta. En el tutor, `list_sources` & co. son los materiales del curso. */
export function toolLabel(rawName: string, inCourse = false): string {
  const name = toolBaseName(rawName)
  if (inCourse) {
    switch (name) {
      case 'list_sources': case 'search_sources': case 'read_source': return tr('Buscando en los materiales del curso', 'Searching the course materials')
      case 'view_source_page': return tr('Mirando una página del material', 'Looking at a page of the material')
      default: break
    }
  }
  switch (name) {
    case 'goal_set': case 'goal_status': case 'goal_complete': return tr('Revisando el objetivo de la sesión', 'Checking the session goal')
    case 'list_courses': return tr('Mirando tus cursos', 'Looking at your courses')
    case 'find_items': return tr('Buscando en tu Aula', 'Searching your Aula')
    case 'get_course': return tr('Revisando el curso', 'Checking the course')
    case 'get_lesson': case 'get_skill': return tr('Leyendo la lección', 'Reading the lesson')
    case 'get_exercise': return tr('Leyendo el ejercicio', 'Reading the exercise')
    case 'study_overview': case 'student_status': return tr('Revisando cómo vas', 'Checking how you are doing')
    case 'search_course_materials': return tr('Buscando en los materiales del curso', 'Searching the course materials')
    case 'read_course_material': return tr('Leyendo un material del curso', 'Reading a course material')
    case 'list_sources': case 'search_sources': case 'read_source': return tr('Leyendo lo que adjuntaste', 'Reading what you attached')
    case 'view_source_page': return tr('Mirando una página de lo que adjuntaste', 'Looking at a page you attached')
    case 'calendar_events': return tr('Mirando tu calendario', 'Looking at your calendar')
    case 'add_calendar_event': return tr('Preparando el evento', 'Preparing the event')
    case 'update_calendar_event': return tr('Cambiando un evento', 'Changing an event')
    case 'delete_calendar_event': return tr('Quitando un evento', 'Removing an event')
    case 'complete_task': return tr('Marcando la tarea', 'Ticking off the task')
    case 'set_exam_date': return tr('Ajustando la fecha del examen', 'Setting the exam date')
    case 'ask_user': return tr('Esperando tu respuesta', 'Waiting for your answer')
    case 'show_items': return tr('Preparando la selección', 'Preparing the selection')
    case 'open_screen': return tr('Abriendo la pantalla', 'Opening the screen')
    case 'create_course': return tr('Preparando el curso', 'Preparing the course')
    case 'extend_course': return tr('Preparando el cambio', 'Preparing the change')
    case 'add_flashcard': return tr('Preparando la tarjeta', 'Preparing the flashcard')
    default: break
  }
  const study = studyLabel(name) ?? memoryToolLabel(name)
  if (study) return study
  for (const fn of extraLabels.values()) {
    const l = fn(name)
    if (l) return l
  }
  return genericLabel(name)
}
