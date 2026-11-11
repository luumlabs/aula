// Qué puede pedir un dispositivo a distancia. Lista cerrada: lo que no está aquí se niega (un método nuevo no queda
// abierto por descuido). Fuera quedan las claves y los secretos, lo que abre ventanas o diálogos en el Mac, lo que toca
// archivos del Mac por su ruta (un dispositivo solo puede dar los que él mismo sube: remote/uploads.ts), las actualizaciones, los ejecutables y borrar o exportar todo.

// («live»: el navegador de Aula en vivo, para iniciar sesión o hacer una tarea desde el dispositivo)
const DOMAINS_OPEN: ReadonlySet<string> = new Set(['achievements', 'automations', 'chat', 'course', 'generation', 'history', 'home', 'live', 'progress', 'search', 'stats', 'study'])

const METHODS_OPEN: ReadonlySet<string> = new Set([
  'ai.status', 'ai.costs', 'ai.cancel',
  'app.info',
  'calendar.add', 'calendar.delete', 'calendar.get', 'calendar.link', 'calendar.list', 'calendar.quickAdd', 'calendar.refreshFeeds', 'calendar.reminders',
  'calendar.search', 'calendar.snapshot', 'calendar.subscriptions', 'calendar.toggleTask', 'calendar.upcomingExams', 'calendar.update',
  'courses.get', 'courses.getSkill', 'courses.getSkills', 'courses.list', 'courses.update',
  'create.addFiles', 'create.addText', 'create.addURL', 'create.attachToCourse', 'create.discardDraft', 'create.draft', 'create.removeMaterial', 'create.start',
  'documents.aiCancel', 'documents.aiStart', 'documents.aiStatus', 'documents.annotate', 'documents.annotations', 'documents.cardTargets', 'documents.fileData',
  'documents.find', 'documents.import', 'documents.kinds', 'documents.library', 'documents.open', 'documents.saveCards', 'documents.search', 'documents.setPage', 'documents.unannotate',
  'memory.list', 'memory.status',
  'platforms.list', 'platforms.courses', 'platforms.check',
  'settings.get'
])

/** Métodos de la ventana del Mac que en un dispositivo no hacen nada (el dispositivo tiene su propio tema, sus avisos…). */
const METHODS_LOCAL_NOOP: ReadonlySet<string> = new Set(['app.setTheme', 'app.notify', 'app.powerState', 'updates.state', 'secrets.status'])

export type RemoteVerdict = 'allow' | 'noop' | 'deny'

export function remoteVerdict(method: string): RemoteVerdict {
  const dot = method.indexOf('.')
  if (dot <= 0) return 'deny'
  if (METHODS_LOCAL_NOOP.has(method)) return 'noop'
  if (METHODS_OPEN.has(method) || DOMAINS_OPEN.has(method.slice(0, dot))) return 'allow'
  return 'deny'
}

/** De los ajustes solo se puede cambiar a distancia el interruptor de «Aula siempre activa». */
export function remoteSettingsPatch(args: unknown): { persistent: { enabled: boolean } } | null {
  const p = (args as { persistent?: { enabled?: unknown } } | null)?.persistent
  return p && typeof p.enabled === 'boolean' && Object.keys(args as object).length === 1 && Object.keys(p).length === 1 ? { persistent: { enabled: p.enabled } } : null
}

/** Las direcciones `aula-asset://…` de una respuesta pasan a ser rutas del servidor (`/asset/…`). */
export function rewriteAssets(json: string): string {
  return json.replace(/aula-asset:\/\//g, '/asset/')
}

/** Valor para un método que no hace nada a distancia. */
export function noopValue(method: string): unknown {
  switch (method) {
    case 'updates.state': return { status: 'unsupported', blocked: 'dev' }
    case 'secrets.status': return { state: 'ok' }
    case 'app.powerState': return { window: 'active', locked: false, battery: false }
    default: return null
  }
}
