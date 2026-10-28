// Archivos que el estudiante dio de verdad: los que soltó en la ventana o eligió con el selector de archivos. La interfaz
// manda rutas (chat.send, create.addFiles, documents.import, courses.import) y solo se aceptan las apuntadas aquí. Las apunta
// el preload, por un canal propio que solo escucha a la ventana de la app, al sacar la ruta de un `File` con
// `webUtils.getPathForFile`: esa función solo da rutas de archivos de verdad (soltados o elegidos), nunca una inventada.
// Así una interfaz comprometida no puede pedir ~/.ssh/id_rsa ni lo interno de la carpeta de datos (secrets.enc, las cookies
// de Browser Data, la cuenta de Codex en tools/…). Además, aunque se suelten, nunca: lo interno de la carpeta de datos (solo
// Packs/ y Documents/) ni las carpetas del sistema o de credenciales. Sin Electron.
import { realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { AulaError } from './errors'
import { dataRoot } from './paths'
import { tr } from '@shared/ai/i18n'

/** Carpetas de la carpeta de datos de donde sí se puede soltar algo (materiales de los cursos y documentos). */
const DATA_FOLDERS_ALLOWED = ['Packs', 'Documents']
/** Con forma de clave o credencial. */
const SECRET_NAME = /^(secrets?(\..*)?|auth\.json|.*\.(pem|key|p12|pfx|enc|keychain|keychain-db))$/i

function systemFolders(): string[] {
  if (process.platform === 'win32') {
    const win = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
    return [win, process.env.ProgramData || 'C:\\ProgramData']
  }
  // (no /run ni /var: ahí están las unidades de red montadas y las carpetas temporales de macOS)
  return ['/etc', '/proc', '/sys', '/dev', '/boot', '/private/etc', '/System', '/Library/Keychains']
}

function credentialFolders(): string[] {
  let home = ''
  try { home = homedir() } catch { return [] }
  if (!home) return []
  return ['.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.config/gcloud', '.codex', '.claude', 'Library/Keychains', 'AppData/Roaming/Microsoft/Credentials']
    .map((p) => join(home, ...p.split('/')))
}

const norm = (p: string): string => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p)

function inside(child: string, parent: string): boolean {
  const rel = relative(norm(parent), norm(child))
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

/** Por qué no se puede usar esta ruta aunque la haya dado el estudiante (o `null` si se puede). `root`: la carpeta de datos. */
export function forbiddenUserPath(path: string, root: string | null): string | null {
  let real: string
  try {
    real = realpathSync(path)
  } catch {
    return 'no existe'
  }
  for (const p of [resolve(path), real]) {
    const name = p.split(sep).pop() ?? ''
    if (SECRET_NAME.test(name)) return 'tiene forma de clave'
    if (root) {
      const data = (() => { try { return realpathSync(root) } catch { return resolve(root) } })()
      for (const r of [resolve(root), data]) {
        if (!inside(p, r)) continue
        const first = relative(r, p).split(sep)[0]
        if (!DATA_FOLDERS_ALLOWED.some((f) => norm(f) === norm(first))) return 'es de las carpetas internas de Aula'
      }
    }
    if (systemFolders().some((f) => inside(p, f))) return 'es de una carpeta del sistema'
    if (credentialFolders().some((f) => inside(p, f))) return 'es de una carpeta de credenciales'
  }
  return null
}

export interface UserFileGrantsOptions {
  /** La carpeta de datos (o `null` si aún no hay). */
  root?: () => string | null
  /** Cuántas rutas se recuerdan como mucho (las más antiguas se olvidan). */
  max?: number
}

export class UserFileGrants {
  private readonly granted = new Set<string>()

  constructor(private readonly opts: UserFileGrantsOptions = {}) {}

  private root(): string | null {
    if (this.opts.root) return this.opts.root()
    try { return dataRoot() } catch { return null }
  }

  /** Apunta una ruta que salió de un archivo soltado o elegido. false si no es absoluta, no existe o es de las prohibidas. */
  grant(path: unknown): boolean {
    if (typeof path !== 'string' || !path || path.length > 4096 || path.includes('\0') || !isAbsolute(path)) return false
    try { statSync(path) } catch { return false }
    if (forbiddenUserPath(path, this.root())) return false
    const key = norm(resolve(path))
    this.granted.delete(key)
    this.granted.add(key)
    const max = this.opts.max ?? 2000
    while (this.granted.size > max) this.granted.delete(this.granted.values().next().value as string)
    return true
  }

  /** ¿La dio el estudiante (y sigue sin ser de las prohibidas)? */
  allows(path: string): boolean {
    if (!path || !isAbsolute(path) || !this.granted.has(norm(resolve(path)))) return false
    return forbiddenUserPath(path, this.root()) === null
  }

  /** Las rutas tal cual si todas las dio el estudiante; si no, `file_not_allowed` (con el nombre del archivo). */
  check(paths: string[]): string[] {
    for (const p of paths) {
      if (!this.allows(p)) {
        const name = p.split(/[\\/]/).pop() || p
        throw new AulaError('file_not_allowed', tr(`Aula no puede abrir «${name}»: solo los archivos que sueltes en la ventana o elijas tú (y nunca los internos de Aula ni los del sistema).`, `Aula can’t open “${name}”: only files you drop on the window or choose yourself (never Aula’s internal files or system files).`))
      }
    }
    return paths
  }

  /** Para las pruebas. */
  clear(): void {
    this.granted.clear()
  }
}

/** Las rutas que dio el estudiante en esta sesión (una para todo el proceso). */
export const userFiles = new UserFileGrants()
