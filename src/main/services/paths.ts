// Carpeta de datos de Aula. La fija el proceso principal al arrancar (o $AULA_HOME en pruebas y desarrollo).
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { chmodSync, mkdirSync, statSync } from 'node:fs'

let root: string | null = process.env.AULA_HOME || null

/**
 * Fija la carpeta de datos y la deja solo para este usuario (0700): chats, memoria y cursos no los leen otros usuarios del
 * equipo (en Linux, ~/.config puede ser legible por todos). En Windows los permisos son otros (ACL del perfil).
 */
export function setDataRoot(path: string): void {
  root = path
  mkdirSync(path, { recursive: true, mode: 0o700 })
  restrictToOwner(path)
}

export function restrictToOwner(path: string): void {
  if (process.platform === 'win32') return
  try {
    const st = statSync(path)
    // nunca una carpeta compartida por error en AULA_HOME (/tmp, la carpeta personal…): solo una propia y sin «sticky»
    const shared = (st.mode & 0o1000) !== 0 || resolve(path) === resolve(homedir()) || resolve(path) === '/'
    const mine = typeof process.getuid !== 'function' || st.uid === process.getuid()
    if (!shared && mine && (st.mode & 0o077) !== 0) chmodSync(path, 0o700)
  } catch {
    /* sin permiso para cambiarlo: sigue igual */
  }
}

export function dataRoot(): string {
  if (!root) throw new Error('La carpeta de datos aún no está configurada')
  return root
}

export const paths = {
  root: () => dataRoot(),
  settings: () => join(dataRoot(), 'settings.json'),
  secrets: () => join(dataRoot(), 'secrets.enc'),
  packs: () => join(dataRoot(), 'Packs'),
  pack: (id: string) => join(dataRoot(), 'Packs', id),
  assistant: () => join(dataRoot(), 'Assistant'),
  memory: () => join(dataRoot(), 'Memory'),
  automations: () => join(dataRoot(), 'Automations'),
  calendar: () => join(dataRoot(), 'calendar.json'),
  browserData: () => join(dataRoot(), 'Browser Data'),
  models: () => join(dataRoot(), 'Models'),
  documents: () => join(dataRoot(), 'Documents'),
  logs: () => join(dataRoot(), 'Logs'),
  cache: () => join(dataRoot(), 'Cache')
}
