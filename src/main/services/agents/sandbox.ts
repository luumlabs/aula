// Carpeta temporal privada de una ejecución: configuración efímera (MCP, prompt de sistema, imágenes) y el directorio de
// trabajo vacío del agente. Se borra al terminar (port de `AgentKit/CLI/AgentSandbox.swift`).
//
// El directorio de trabajo por defecto es el MISMO para todas las ejecuciones (`<tmp>/aula-agent-work`, vacío y 0700): las CLIs
// lo anuncian al principio de la conversación y uno distinto en cada ejecución impedía compartir la caché de prompts.
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tr } from '@shared/ai/i18n'
import { AgentError } from './errors'
import type { ImagePart } from './types'

const isWindows = process.platform === 'win32'

export const SHARED_WORK_NAME = 'aula-agent-work'

function realPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

export class AgentSandbox {
  /** Carpeta raíz (0700) con los archivos de la ejecución. */
  readonly root: string
  /** Directorio donde corre la CLI. */
  readonly workingDirectory: string
  private cleaned = false

  constructor(requested?: string, sharedWork = true) {
    this.root = realPath(mkdtempSync(join(tmpdir(), 'aula-agent-')))
    try {
      chmodSync(this.root, 0o700)
    } catch {
      /* Windows */
    }
    if (requested) {
      let ok = false
      try {
        ok = statSync(requested).isDirectory()
      } catch {
        ok = false
      }
      if (!ok) {
        this.cleanup()
        throw new AgentError('other', tr(`La carpeta de trabajo «${requested}» no existe.`, `The working folder “${requested}” doesn’t exist.`))
      }
      this.workingDirectory = realPath(requested)
    } else {
      const shared = sharedWork ? sharedEmptyWorkDirectory() : undefined
      if (shared) {
        this.workingDirectory = shared
      } else {
        const work = join(this.root, 'work')
        mkdirSync(work, { recursive: true, mode: 0o700 })
        this.workingDirectory = work
      }
    }
  }

  /** Escribe un archivo (0600: puede llevar credenciales de servidores MCP) y devuelve su ruta. */
  write(data: string | Uint8Array, name: string): string {
    const path = join(this.root, name)
    writeFileSync(path, data, { mode: 0o600 })
    try {
      chmodSync(path, 0o600)
    } catch {
      /* Windows */
    }
    return path
  }

  /** Escribe las imágenes de la tarea como archivos (para CLIs que las reciben por ruta). */
  writeImages(images: ImagePart[]): string[] {
    return images.map((image, index) => {
      const clean = image.base64.replace(/\s+/g, '')
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) {
        throw new AgentError('other', tr(`La imagen ${index + 1} adjunta no es una imagen válida (base64 incorrecto).`, `Attached image ${index + 1} isn’t a valid image (bad base64).`))
      }
      const type = image.mediaType.toLowerCase()
      const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg'
      return this.write(Buffer.from(clean, 'base64'), `imagen-${index + 1}.${ext}`)
    })
  }

  cleanup(): void {
    if (this.cleaned) return
    this.cleaned = true
    try {
      rmSync(this.root, { recursive: true, force: true })
    } catch {
      /* nada */
    }
  }
}

/** `<tmp>/aula-agent-work` si es una carpeta (no un enlace) nuestra, privada y vacía; la crea si falta. `undefined` si no. */
export function sharedEmptyWorkDirectory(base = tmpdir()): string | undefined {
  const path = join(base, SHARED_WORK_NAME)
  try {
    let st
    try {
      st = lstatSync(path)
    } catch {
      mkdirSync(path, { recursive: true, mode: 0o700 })
      st = lstatSync(path)
    }
    if (st.isSymbolicLink() || !st.isDirectory()) return undefined
    if (!isWindows) {
      if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return undefined
      if ((st.mode & 0o077) !== 0) return undefined
    }
    if (readdirSync(path).length > 0) return undefined
    return realPath(path)
  } catch {
    return undefined
  }
}
