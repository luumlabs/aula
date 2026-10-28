// Nombres amigables de lo que hace la IA, para el monitor en vivo (port de StudyEngine/Pipeline/ToolLabels.swift y de
// `describe`/`briefResult` de GenerationPipeline.swift). En el idioma de la interfaz.
import { isJSONObject, type JSONObject } from '@engine/base/json'
import { JSONRepair } from '@engine/base/jsonRepair'
import { tr } from '@shared/ai/i18n'

/** Quita el prefijo que ponen los agentes CLI (`mcp__aula__herramienta`). */
export function toolBase(name: string): string {
  const i = name.lastIndexOf('__')
  return i >= 0 ? name.slice(i + 2) : name
}

const LABELS: Record<string, [string, string]> = {
  get_course: ['Revisando el curso', 'Reviewing the course'],
  list_sources: ['Mirando tus materiales', 'Looking at your materials'],
  search_sources: ['Buscando en tus materiales', 'Searching your materials'],
  read_source: ['Leyendo un material', 'Reading a material'],
  calculate: ['Calculando', 'Calculating'],
  web_search: ['Buscando en internet', 'Searching the web'],
  WebSearch: ['Buscando en internet', 'Searching the web'],
  fetch_url: ['Leyendo una página web', 'Reading a web page'],
  WebFetch: ['Leyendo una página web', 'Reading a web page'],
  search_wikipedia: ['Buscando en Wikipedia', 'Searching Wikipedia'],
  save_web_source: ['Guardando una fuente como material', 'Saving a source as material'],
  run_code: ['Ejecutando el código para comprobarlo', 'Running the code to check it'],
  set_course_plan: ['Guardando el plan del curso', 'Saving the course plan'],
  set_exam_blueprint: ['Definiendo el simulacro', 'Defining the mock exam'],
  get_skill: ['Revisando la habilidad', 'Reviewing the skill'],
  write_lesson: ['Escribiendo la lección', 'Writing the lesson'],
  add_exercises: ['Añadiendo ejercicios', 'Adding exercises'],
  add_templates: ['Creando plantillas de práctica', 'Creating practice templates'],
  add_cards: ['Creando tarjetas', 'Creating flashcards'],
  add_deck: ['Creando presentación', 'Creating a slide deck'],
  set_common_mistakes: ['Anotando errores comunes', 'Noting common mistakes'],
  validate_skill: ['Validando la habilidad', 'Validating the skill'],
  delete_items: ['Quitando elementos', 'Removing items'],
  set_glossary: ['Escribiendo el glosario', 'Writing the glossary'],
  set_formula_sheet: ['Armando la hoja de fórmulas', 'Building the formula sheet'],
  ask_user: ['Preguntándote algo', 'Asking you something'],
  note_progress: ['Avance', 'Progress'],
  finish: ['Terminando', 'Finishing'],
  list_exercises_to_solve: ['Leyendo ejercicios para resolver', 'Reading exercises to solve'],
  submit_solution: ['Registrando una solución', 'Recording a solution'],
  list_disagreements: ['Revisando discrepancias', 'Reviewing disagreements'],
  resolve_disagreement: ['Resolviendo una discrepancia', 'Resolving a disagreement'],
  view_source_page: ['Mirando una página de tus materiales', 'Looking at a page of your materials'],
  chemistry: ['Comprobando la química', 'Checking the chemistry'],
  find_image: ['Buscando una imagen', 'Looking for an image'],
  add_image: ['Añadiendo una imagen', 'Adding an image'],
  add_model: ['Añadiendo un modelo 3D', 'Adding a 3D model'],
  block_reference: ['Consultando cómo se hace un bloque', 'Checking how to build a block'],
  save_source_digest: ['Guardando la ficha de un material', 'Saving a material digest'],
  upcoming_dates: ['Mirando tus fechas de examen', 'Checking your exam dates'],
  canvas_upcoming: ['Mirando tus fechas de examen', 'Checking your exam dates'],
  platform_guide: ['Repasando cómo está organizada tu plataforma', 'Reviewing how your platform is organised'],
  canvas_courses: ['Mirando tus cursos de Canvas', 'Looking at your Canvas courses'],
  canvas_course_outline: ['Revisando el curso en Canvas', 'Reviewing the course in Canvas'],
  canvas_read_page: ['Leyendo una página de Canvas', 'Reading a Canvas page'],
  canvas_import_file: ['Trayendo un archivo de Canvas', 'Bringing a file from Canvas'],
  record_findings: ['Apuntando qué entra en el examen', 'Noting what the exam covers'],
  browser_open: ['Abriendo tu plataforma en el navegador de Aula', 'Opening your platform in Aula\'s browser'],
  browser_read: ['Leyendo la página', 'Reading the page'],
  browser_links: ['Mirando los enlaces de la página', 'Looking at the page\'s links'],
  browser_click: ['Abriendo un enlace', 'Opening a link'],
  browser_screenshot: ['Mirando la página', 'Looking at the page'],
  browser_download: ['Descargando un material', 'Downloading a material'],
  browser_save_page: ['Guardando la página como material', 'Saving the page as material'],
  browser_sign_in: ['Esperando a que inicies sesión', 'Waiting for you to sign in']
}

export function toolLabel(name: string): string {
  const b = toolBase(name)
  const l = LABELS[b]
  return l ? tr(l[0], l[1]) : b
}

/** El objeto JSON que empieza en la primera llave del texto (los resúmenes pueden llevar delante el nombre de la herramienta). */
export function jsonObjectIn(s: string): JSONObject | undefined {
  const start = s.indexOf('{')
  if (start < 0) return undefined
  // los resúmenes suelen venir recortados («…»): la reparación cierra comillas y llaves
  const text = s.slice(start)
  for (const candidate of [text, text.replace(/…/g, '')]) {
    try {
      const v = JSONRepair.parse(candidate)
      if (isJSONObject(v)) return v
    } catch { /* sigue */ }
  }
  return undefined
}

/** De un resumen como `{"message":"…"}` o `calculate {"expression":"…"}` saca el texto útil. */
export function extractValue(s: string): string {
  const o = jsonObjectIn(s)
  if (o) {
    for (const k of ['message', 'query', 'q', 'expression', 'expr', 'url']) if (typeof o[k] === 'string') return o[k] as string
    const first = Object.values(o).find((v): v is string => typeof v === 'string')
    if (first) return first
  }
  return s
}

/** Lo que está haciendo un agente («Buscando en tus materiales: ecuaciones cuadráticas»). */
export function describeTool(name: string, summary: string): string {
  const label = toolLabel(name)
  const s = summary.trim()
  const b = toolBase(name)
  if (['note_progress', 'search_sources', 'web_search', 'WebSearch', 'calculate'].includes(b)) return s ? `${label}: ${extractValue(s)}` : label
  return label
}

export function briefToolResult(name: string, ok: boolean, summary: string): string {
  const label = toolLabel(name)
  if (ok) return label
  let detail = summary.trim()
  const o = jsonObjectIn(detail)
  if (o && (typeof o.error === 'string' || typeof o.message === 'string')) detail = (typeof o.error === 'string' ? o.error : o.message) as string
  else if (detail.startsWith('Error:')) detail = detail.slice(6).trim()
  return tr(`${label}: hubo un problema (${Array.from(detail).slice(0, 160).join('')})`, `${label}: there was a problem (${Array.from(detail).slice(0, 160).join('')})`)
}
