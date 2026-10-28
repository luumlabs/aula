// «Exportar todo» y «Borrar todos los datos» de Ajustes → Privacidad y datos (sin Electron, con pruebas).
// Exportar: un ZIP SOLO con lo que es del estudiante (lista cerrada de lo que entra: cursos, chat, memoria, automatizaciones,
// documentos, calendario, ajustes, logros y gastos). Nunca claves (secrets.enc), el perfil del navegador (cookies de las
// plataformas), la cuenta de ChatGPT de Codex (tools/), modelos locales, cachés, registros, volcados ni papelera: lo que no está
// en la lista no sale, aunque aparezca algo nuevo en la carpeta (Chromium y los programas guardan ahí lo suyo).
// Borrar: se deja una marca (cuándo y de qué carpeta) y, al volver a abrir Aula y antes de leer nada, se borra lo de Aula de la
// carpeta (así no hay archivos abiertos ni procesos escribiendo mientras se borra): solo nombres conocidos, nunca en una
// carpeta personal o del sistema, y la marca se quita siempre.
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, parse, relative, resolve } from 'node:path'
import { zipDirectory } from '../store'

/** Carpetas que entran enteras en «Exportar todo» (primer nivel de la carpeta de datos). */
export const EXPORT_FOLDERS = [
  'Packs', // los cursos (con su progreso, fuentes, notas y registros de creación)
  'History', // el historial de cambios de los cursos («Deshacer»)
  'Assistant', // las conversaciones con Aula y sus objetivos
  'Memory',
  'Automations',
  'Documents',
  'Calendars' // la última copia leída de cada suscripción (.ics); el enlace va en el almacén cifrado, no aquí
] as const

/** Archivos sueltos del primer nivel que entran. */
export const EXPORT_FILES = [
  'settings.json', // sin claves: solo referencias al almacén cifrado
  'calendar.json',
  'calendar-subscriptions.json', // nombre, servidor y estado de cada suscripción (nunca el enlace)
  'achievements.json',
  'costs.json'
] as const

const WIPE_MARK = '.aula-wipe-pending'
/** Con forma de clave o de credencial, esté donde esté (también dentro de lo que sí entra). */
const SECRETISH = /^(secrets?(\..*)?|auth\.json|.*\.(pem|key|p12|pfx|enc))$/i

/** ¿Entra esta ruta (relativa a la carpeta de datos, con «/») en la copia? */
export function includedInExport(rel: string): boolean {
  const parts = rel.split('/')
  const name = parts[parts.length - 1]
  if (parts.some((p) => p === '' || p === '..')) return false
  const inFolder = (EXPORT_FOLDERS as readonly string[]).includes(parts[0])
  const looseFile = parts.length === 1 && (EXPORT_FILES as readonly string[]).includes(parts[0])
  if (!inFolder && !looseFile) return false
  // cerrojos, temporales y ocultos; cualquier cosa con forma de clave
  if (parts.some((p) => p.startsWith('.')) || name.endsWith('.tmp') || SECRETISH.test(name)) return false
  return true
}

/** Comprime la carpeta de datos en `destination` (un .zip con la carpeta como raíz). */
export async function exportAllData(root: string, destination: string): Promise<void> {
  await zipDirectory(root, destination, (rel) => includedInExport(rel))
}

// MARK: Borrar todo

/** Lo que es de Aula en la carpeta de datos (primer nivel): solo se borra esto; lo demás (algo que no es de Aula) se queda. */
export const WIPE_ENTRIES = [
  ...EXPORT_FOLDERS, ...EXPORT_FILES,
  'secrets.enc', 'secrets.json', 'Browser Data', 'Models', 'LocalAI', 'tools', 'Cache', 'Logs', 'Eliminados', 'Drafts', 'window.json', 'browser',
  'catalog-cache.json', 'state.json', 'Crashpad',
  // actualizaciones (install.json, failed.json, watchdog.sh, app-update.yml)
  'Updates',
  // lo que Chromium deja en la carpeta del perfil (userData es la carpeta de datos; Singleton* no: es el cerrojo de esta instancia)
  'Local State', 'DevToolsActivePort', 'GPUCache', 'GPUPersistentCache', 'Code Cache', 'Dictionaries', 'Local Storage', 'Session Storage', 'IndexedDB',
  'Network', 'Cookies', 'Cookies-journal', 'Preferences', 'Network Persistent State', 'TransportSecurity', 'Trust Tokens', 'Trust Tokens-journal',
  'Shared Dictionary', 'SharedStorage', 'blob_storage', 'Service Worker', 'WebStorage', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'GrShaderCache', 'GraphiteDawnCache', 'ShaderCache', 'DIPS', 'DIPS-journal', 'databases', 'Partitions', 'VideoDecodeStats', 'QuotaManager',
  'QuotaManager-journal', 'declarative_performance_observer.db',
  'declarative_performance_observer.db-journal', 'first_party_sets.db', 'first_party_sets.db-journal'
] as const
/** Ocultos de Aula: temporales de las escrituras atómicas («.settings.json.1a2b3c4d.tmp»), cerrojos y copias de la versión
 *  anterior («.settings.json.bak»). */
const WIPE_HIDDEN = /^\.(.+\.[0-9a-f]{6,8}\.tmp|[\w.-]*\.?(aula-)?lock|[\w.-]+\.bak)$/i
/** Copias de archivos dañados de Aula del primer nivel («settings.damaged-1a2b3c4d5e.json», «calendar.json.damaged-2026…»). */
const WIPE_DAMAGED = /^(settings|calendar|calendar-subscriptions|achievements|costs)(\.json)?\.damaged-[\w-]+(\.json)?$/i
/** Secretos que el llavero no dejaba leer y se apartaron al «Empezar de cero» («secrets.unreadable-2026-…enc»). */
const WIPE_UNREADABLE_SECRETS = /^secrets\.unreadable-[\w-]+\.enc$/i
/** Una marca más antigua no se aplica (el reinicio no llegó y desde entonces puede haber datos nuevos, p. ej. restaurados). */
export const WIPE_MARK_MAX_AGE_MS = 7 * 24 * 3_600_000

interface WipeMark {
  app: 'Aula'
  requestedAt: string
  root: string
}

const sameDir = (a: string, b: string): boolean => {
  const n = (p: string) => (process.platform === 'win32' || process.platform === 'darwin' ? resolve(p).toLowerCase() : resolve(p))
  return n(a) === n(b)
}

/** Por qué no se debe vaciar esta carpeta (o `null`): la raíz del disco, la carpeta personal (o una que la contiene), una
 *  del sistema o una carpeta que no parece de Aula (ni settings.json ni Packs/). */
export function unsafeWipeRoot(root: string): string | null {
  const r = resolve(root)
  if (r === parse(r).root) return 'es la raíz del disco'
  let home = ''
  try { home = homedir() } catch { /* sin carpeta personal */ }
  if (home) {
    const rel = relative(r, home)
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return 'es la carpeta personal o la contiene'
    const userFolders = ['Documents', 'Desktop', 'Downloads', 'Library', 'Library/Application Support', '.config', 'AppData', 'AppData/Roaming', 'AppData/Local']
    if (userFolders.some((f) => sameDir(r, join(home, ...f.split('/'))))) return 'es una carpeta personal'
  }
  const system = process.platform === 'win32'
    ? [process.env.SystemRoot || 'C:\\Windows', process.env.ProgramFiles || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', process.env.ProgramData || 'C:\\ProgramData', process.env.APPDATA || '', process.env.LOCALAPPDATA || '']
    : ['/bin', '/boot', '/dev', '/etc', '/lib', '/opt', '/proc', '/root', '/sbin', '/sys', '/usr', '/var', '/tmp', '/home', '/Users', '/System', '/Library', '/Applications', '/private', '/private/tmp', '/private/var']
  if (system.filter(Boolean).some((f) => sameDir(r, f))) return 'es una carpeta del sistema'
  const isDir = (p: string) => { try { return lstatSync(p).isDirectory() } catch { return false } }
  const isFile = (p: string) => { try { return lstatSync(p).isFile() } catch { return false } }
  if (!isFile(join(r, 'settings.json')) && !isDir(join(r, 'Packs'))) return 'no parece la carpeta de datos de Aula'
  return null
}

/** Deja pedido el borrado: se hace al arrancar la próxima vez (`applyPendingWipe`). La marca dice cuándo y de qué carpeta. */
export function scheduleDataWipe(root: string, now: Date = new Date()): void {
  const mark: WipeMark = { app: 'Aula', requestedAt: now.toISOString(), root: resolve(root) }
  writeFileSync(join(root, WIPE_MARK), JSON.stringify(mark))
}

/** La marca leída (la de antes era solo la fecha). `null` si no se entiende. */
function readMark(file: string): { requestedAt: number; root: string | null } | null {
  let text: string
  try { text = readFileSync(file, 'utf8').trim() } catch { return null }
  try {
    const m = JSON.parse(text) as Partial<WipeMark>
    if (m && typeof m === 'object' && m.app === 'Aula' && typeof m.requestedAt === 'string') {
      const t = Date.parse(m.requestedAt)
      return Number.isFinite(t) ? { requestedAt: t, root: typeof m.root === 'string' ? m.root : null } : null
    }
  } catch { /* la marca antigua: una fecha ISO */ }
  const t = Date.parse(text)
  return Number.isFinite(t) ? { requestedAt: t, root: null } : null
}

export interface WipeResult {
  /** ¿Se vació? */
  wiped: boolean
  /** Por qué no (marca rara o antigua, otra carpeta, carpeta peligrosa). */
  refused?: string
  /** Lo que no se pudo borrar o no era de Aula (se queda). */
  left: string[]
}

/** Si se pidió borrar todo, borra lo de Aula de la carpeta de datos (la carpeta queda). Solo los nombres conocidos de Aula,
 *  nunca en una carpeta que parezca personal o del sistema, y la marca se quita siempre (aunque algo no se pudiera borrar:
 *  así no se borra a la siguiente lo que se guarde después). Devuelve si borró. */
export function applyPendingWipe(root: string, opts: { now?: Date; onResult?: (r: WipeResult) => void; remove?: (path: string) => void } = {}): boolean {
  const markFile = join(root, WIPE_MARK)
  if (!existsSync(markFile)) return false
  const finish = (r: WipeResult): boolean => {
    try { rmSync(markFile, { force: true }) } catch { /* nada */ }
    opts.onResult?.(r)
    return r.wiped
  }
  const mark = readMark(markFile)
  const now = (opts.now ?? new Date()).getTime()
  if (!mark) return finish({ wiped: false, refused: 'la marca no se entiende', left: [] })
  if (mark.requestedAt > now + 86_400_000 || now - mark.requestedAt > WIPE_MARK_MAX_AGE_MS) return finish({ wiped: false, refused: 'la marca es de hace demasiado', left: [] })
  if (mark.root !== null && !sameDir(mark.root, root)) return finish({ wiped: false, refused: 'la marca es de otra carpeta', left: [] })
  const unsafe = unsafeWipeRoot(root)
  if (unsafe) return finish({ wiped: false, refused: unsafe, left: [] })
  let names: string[] = []
  try {
    names = readdirSync(root)
  } catch {
    return finish({ wiped: false, refused: 'no se puede leer la carpeta', left: [] })
  }
  const known = new Set<string>(WIPE_ENTRIES)
  const left: string[] = []
  for (const name of names) {
    if (name === WIPE_MARK) continue
    if (!known.has(name) && !WIPE_HIDDEN.test(name) && !WIPE_DAMAGED.test(name) && !WIPE_UNREADABLE_SECRETS.test(name)) { left.push(name); continue }
    try {
      // un enlace simbólico se quita él (no lo que hay al otro lado)
      const path = join(root, name)
      if (opts.remove) opts.remove(path)
      else rmSync(path, { recursive: true, force: true, maxRetries: 3 })
    } catch {
      left.push(name)
    }
  }
  return finish({ wiped: true, left })
}
