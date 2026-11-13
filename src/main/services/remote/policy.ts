// Qué puede pedir un dispositivo a distancia. Lista cerrada: lo que no está aquí se niega (un método nuevo no queda
// abierto por descuido). Fuera quedan las claves y los secretos, lo que abre ventanas o diálogos en el Mac, lo que toca
// archivos del Mac por su ruta (un dispositivo solo puede dar los que él mismo sube: remote/uploads.ts), las actualizaciones, los ejecutables y borrar o exportar todo.
// De los ajustes pasa solo lo de uso diario, campo a campo (`remoteSettingsPatch`); de la IA, elegir entre las que ya están
// listas en el Mac (`ai.choose`: ni claves, ni direcciones, ni servicios nuevos); de la memoria, añadir, corregir, pausar y
// olvidar de uno en uno. Las plataformas, los dispositivos y los datos se llevan desde el Mac.
// Un PROPIETARIO (solo en Aula como servidor, remote/devices.ts) hace de ventana: puede pedir todo lo que pide la ventana
// menos lo que necesita la pantalla del equipo donde corre Aula o deja sin acceso a todos (`OWNER_DENIED`).
import type { SettingsPatch } from '@shared/settings'
import { settingsPatchChecks } from '@shared/settings/patch'

// («live»: el navegador de Aula en vivo, para iniciar sesión o hacer una tarea desde el dispositivo)
const DOMAINS_OPEN: ReadonlySet<string> = new Set(['achievements', 'automations', 'chat', 'course', 'generation', 'history', 'home', 'live', 'progress', 'search', 'stats', 'study'])

const METHODS_OPEN: ReadonlySet<string> = new Set([
  'ai.status', 'ai.costs', 'ai.cancel', 'ai.choices', 'ai.models',
  'app.info',
  'calendar.add', 'calendar.delete', 'calendar.get', 'calendar.link', 'calendar.list', 'calendar.quickAdd', 'calendar.refreshFeeds', 'calendar.reminders',
  'calendar.search', 'calendar.snapshot', 'calendar.subscriptions', 'calendar.toggleTask', 'calendar.upcomingExams', 'calendar.update',
  'courses.get', 'courses.getSkill', 'courses.getSkills', 'courses.list', 'courses.update',
  'create.addFiles', 'create.addText', 'create.addURL', 'create.attachToCourse', 'create.discardDraft', 'create.draft', 'create.removeMaterial', 'create.start',
  'documents.aiCancel', 'documents.aiStart', 'documents.aiStatus', 'documents.annotate', 'documents.annotations', 'documents.cardTargets', 'documents.fileData',
  'documents.find', 'documents.import', 'documents.kinds', 'documents.library', 'documents.open', 'documents.saveCards', 'documents.search', 'documents.setPage', 'documents.unannotate',
  'memory.list', 'memory.status', 'memory.add', 'memory.edit', 'memory.pause',
  'platforms.list', 'platforms.courses', 'platforms.check',
  'settings.get'
])

/** Métodos de la ventana del Mac que en un dispositivo no hacen nada (el marco de la ventana con el tema, sus avisos…). */
const METHODS_LOCAL_NOOP: ReadonlySet<string> = new Set(['app.setTheme', 'app.notify', 'app.powerState', 'updates.state', 'secrets.status'])

export type RemoteVerdict = 'allow' | 'noop' | 'deny'

/**
 * Lo que ni un propietario puede pedir: lo que abre un diálogo, una carpeta o la ventana en el equipo donde corre Aula (en un
 * servidor nadie los vería y la llamada se quedaría esperando), las actualizaciones (un servidor se actualiza con su imagen),
 * apagar el acceso o cerrar la sesión de Tailscale del servidor (dejaría fuera a todos sus dispositivos: se hace en su
 * consola) y borrar o exportar todo (se hace con su carpeta de datos). ChatGPT, solo con código (`ownerCodexLogin`): su
 * página normal vuelve a una dirección del propio servidor que el dispositivo no ve.
 */
const OWNER_DENIED: ReadonlySet<string> = new Set([
  'app.showItemInFolder', 'app.openLicenses', 'app.focus', 'app.command',
  'calendar.exportICS', 'calendar.importICS',
  'courses.export', 'courses.import',
  'documents.pick', 'documents.reveal', 'documents.save', 'documents.revealSaved',
  'data.exportAll', 'data.deleteAll', 'memory.export',
  'updates.check', 'updates.install', 'updates.openDownloadPage',
  'remote.setEnabled', 'remote.tailnetLogin', 'remote.tailnetLogout'
])

/** Conectar ChatGPT desde un propietario: solo con el código de un solo uso, que se escribe en cualquier navegador. */
export function ownerCodexLogin(args: unknown): { deviceAuth: true } | null {
  return typeof args === 'object' && args !== null && (args as { deviceAuth?: unknown }).deviceAuth === true && Object.keys(args).length === 1 ? { deviceAuth: true } : null
}

/** Lo que en un propietario no hace nada: el marco de la ventana y sus avisos (los del dispositivo los da su app). */
const OWNER_NOOP: ReadonlySet<string> = new Set(['app.setTheme', 'app.notify', 'app.powerState', 'updates.state'])

/** El veredicto para un propietario: lo de la ventana, menos `OWNER_DENIED`. */
export function ownerVerdict(method: string): RemoteVerdict {
  if (method.indexOf('.') <= 0) return 'deny'
  if (OWNER_NOOP.has(method)) return 'noop'
  return OWNER_DENIED.has(method) ? 'deny' : 'allow'
}

export function remoteVerdict(method: string): RemoteVerdict {
  const dot = method.indexOf('.')
  if (dot <= 0) return 'deny'
  if (METHODS_LOCAL_NOOP.has(method)) return 'noop'
  if (METHODS_OPEN.has(method) || DOMAINS_OPEN.has(method.slice(0, dot))) return 'allow'
  return 'deny'
}

type Obj = Record<string, unknown>
type Check = (v: unknown, k: string) => unknown
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const { bool, oneOf, num, text, time } = settingsPatchChecks

/** Horas de silencio: `null` (sin ellas) o exactamente `{ from, to }` en HH:mm. */
const quietHours: Check = (v, k) => {
  if (v === null) return null
  if (!isObj(v) || Object.keys(v).some((x) => x !== 'from' && x !== 'to')) throw new Error(k)
  return { from: time(v.from, `${k}.from`), to: time(v.to, `${k}.to`) }
}

/**
 * Los ajustes que un dispositivo puede cambiar: los de uso diario, campo a campo, cada uno con su tipo y su rango. Lo demás
 * es del Mac: la IA y sus claves, las plataformas, los datos, las actualizaciones, «abrir al iniciar sesión» y el cursor
 * (un dispositivo táctil no tiene, así que tampoco lo cambia).
 */
const SETTINGS_OPEN: ReadonlyMap<string, ReadonlyMap<string, Check>> = new Map([
  ['general', new Map<string, Check>([
    ['theme', (v, k) => oneOf(v, k, ['system', 'light', 'dark'] as const)],
    ['textScale', (v, k) => num(v, k, 0.85, 1.3)],
    ['motion', (v, k) => oneOf(v, k, ['system', 'full', 'reduced'] as const)],
    ['name', (v, k) => text(v, k, 80)],
    ['language', (v, k) => oneOf(v, k, ['system', 'es', 'en'] as const)],
    ['reminders', bool],
    ['reminderTime', time]
  ])],
  ['persistent', new Map<string, Check>([
    ['enabled', bool],
    ['quietHours', quietHours]
  ])]
])

/**
 * El cambio de ajustes que pide un dispositivo, ya comprobado; `null` si trae CUALQUIER cosa fuera de la lista (otra sección,
 * otro campo, un tipo o un rango que no vale): un campo malo anula el cambio entero, no se aplica «lo que sí vale».
 */
export function remoteSettingsPatch(args: unknown): SettingsPatch | null {
  if (!isObj(args)) return null
  const out: Record<string, Obj> = {}
  try {
    for (const [section, value] of Object.entries(args)) {
      const fields = SETTINGS_OPEN.get(section)
      if (!fields || !isObj(value)) return null
      const clean: Obj = {}
      for (const [k, v] of Object.entries(value)) {
        const check = fields.get(k)
        if (!check) return null
        clean[k] = check(v, `${section}.${k}`)
      }
      if (!Object.keys(clean).length) return null
      out[section] = clean
    }
  } catch {
    return null
  }
  return Object.keys(out).length ? (out as SettingsPatch) : null
}

const shortText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max

/** Olvidar un recuerdo, de uno en uno: una lista entera sería «eliminar todo», que solo se hace en el Mac. */
export function remoteForget(args: unknown): { ids: [string] } | null {
  if (!isObj(args) || Object.keys(args).length !== 1 || !Array.isArray(args.ids) || args.ids.length !== 1) return null
  const id: unknown = args.ids[0]
  return shortText(id, 100) ? { ids: [id] } : null
}

/**
 * Elegir una IA de las que ya están listas en el Mac: solo qué proveedor y, si acaso, su modelo y su razonamiento. Con
 * cualquier otro campo (una dirección, una clave, un nombre…) se niega entero. Que el proveedor esté de verdad listo y que
 * el modelo sea de los suyos lo comprueba `chooseAI` (services/ai/service.ts), que es quien conoce el estado.
 */
export function remoteAIChoice(args: unknown): { providerId: string; model?: string; reasoning?: string; activate?: boolean } | null {
  if (!isObj(args) || !shortText(args.providerId, 100)) return null
  const out: { providerId: string; model?: string; reasoning?: string; activate?: boolean } = { providerId: args.providerId }
  for (const [k, v] of Object.entries(args)) {
    if (k === 'providerId') continue
    if (k === 'model' && typeof v === 'string' && v.length <= 500) out.model = v
    else if (k === 'reasoning' && typeof v === 'string' && v.length <= 20) out.reasoning = v
    else if (k === 'activate' && typeof v === 'boolean') out.activate = v
    else return null
  }
  return out
}

/** Métodos que un dispositivo solo puede pedir con argumentos acotados: cada uno devuelve lo que deja pasar, o `null`. */
const METHODS_NARROWED: ReadonlyMap<string, (args: unknown) => unknown | null> = new Map<string, (args: unknown) => unknown | null>([
  ['settings.update', remoteSettingsPatch],
  ['memory.forget', remoteForget],
  ['ai.choose', remoteAIChoice]
])

/** El veredicto de una llamada con sus argumentos: los métodos acotados pasan solo con lo que su comprobación deja pasar. Un
 *  propietario pasa como la ventana (sin acotar), salvo lo de `OWNER_DENIED`. */
export function remoteCall(method: string, args: unknown, opts: { owner?: boolean } = {}): { verdict: RemoteVerdict; args: unknown } {
  if (opts.owner) {
    if (method === 'agents.codexLogin') {
      const clean = ownerCodexLogin(args)
      return clean ? { verdict: 'allow', args: clean } : { verdict: 'deny', args: undefined }
    }
    return { verdict: ownerVerdict(method), args }
  }
  const narrow = METHODS_NARROWED.get(method)
  if (!narrow) return { verdict: remoteVerdict(method), args }
  const clean = narrow(args)
  return clean === null ? { verdict: 'deny', args: undefined } : { verdict: 'allow', args: clean }
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
