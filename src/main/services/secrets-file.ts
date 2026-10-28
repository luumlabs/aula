// Almacén de secretos en un archivo (`secrets.enc`) con un cifrado que se inyecta (safeStorage en la app, uno falso en las
// pruebas). Lo importante: si el archivo existe pero NO se puede leer (el estudiante pulsó «Denegar» en el aviso del
// llavero, el llavero está bloqueado, en Linux aún no se abrió o la clave cambió), el almacén queda BLOQUEADO:
//   - las lecturas devuelven «no hay» (nada se rompe), pero NO se escribe nada: `set`/`delete` lanzan `secrets_locked`;
//   - el archivo original se conserva intacto, y se reintenta leerlo (al pedirlo el estudiante o, solo, cada pocos minutos);
//   - «Empezar de cero» lo aparta como `secrets.unreadable-<fecha>.enc` (nunca se borra) y deja el almacén vacío.
// Antes, un solo fallo dejaba la caché en `{}` y la siguiente escritura (las cookies, cada 5 minutos) sobrescribía el
// archivo: se perdían para siempre todas las claves de API y las sesiones de las plataformas.
import { existsSync, readFileSync, renameSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { backupPath, writeFileAtomic } from './fs'
import { AulaError } from './errors'
import { log } from './log'
import { tr } from '@shared/ai/i18n'
import type { SecretStore } from './secrets'

export const MAGIC_ENC = 'AULA-SEC1:'
export const MAGIC_PLAIN = 'AULA-PLN1:'

/** Cómo se cifra: 'os' = cifrado del sistema; 'basic' = sin cifrado real (se guarda en claro con permisos 0600). */
export interface SecretCipher {
  protection(): 'os' | 'basic'
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

export type SecretsLockReason = 'decrypt' | 'corrupt' | 'io'

/** Estado del almacén (lo ve la interfaz). */
export interface SecretsStatus {
  locked: boolean
  reason?: SecretsLockReason
  /** Cuándo se intentó leer por última vez (ISO). */
  checkedAt?: string
}

export interface FileSecretStoreOptions {
  /** Cada cuánto se reintenta solo al acceder mientras está bloqueado (por defecto, 5 minutos: cada intento puede
   *  volver a mostrar el aviso del llavero). */
  retryEveryMs?: number
  now?: () => number
  /** Cambió el estado (bloqueado ↔ abierto). */
  onChange?: (status: SecretsStatus) => void
}

export function secretsLockedError(): AulaError {
  return new AulaError(
    'secrets_locked',
    tr(
      'Aula no puede abrir el llavero del sistema, así que por ahora no guarda ni borra claves ni sesiones (las que tenías siguen a salvo). Reinténtalo desde el aviso de la barra lateral.',
      "Aula can't open the system keychain, so for now it won't save or remove keys or sessions (the ones you had are safe). Try again from the notice in the sidebar."
    ),
    { aiReason: "Aula can't open the system keychain right now, so it can't save or remove keys or sessions (the existing ones are safe)." }
  )
}

/** «secrets.enc» → «secrets.unreadable-2026-10-27T09-30-00.enc» (en la misma carpeta). */
export function unreadableCopyPath(file: string, date: Date): string {
  const stamp = date.toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '-')
  const name = basename(file)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  return join(dirname(file), `${stem}.unreadable-${stamp}${ext}`)
}

class Unreadable extends Error {
  constructor(readonly reason: SecretsLockReason, message: string) {
    super(message)
  }
}

export class FileSecretStore implements SecretStore {
  private cache: Record<string, string> | null = null
  private lock: { reason: SecretsLockReason; at: number } | null = null
  private readonly retryEveryMs: number
  private readonly now: () => number

  constructor(private readonly file: () => string, private readonly cipher: SecretCipher, private readonly opts: FileSecretStoreOptions = {}) {
    this.retryEveryMs = opts.retryEveryMs ?? 5 * 60_000
    this.now = opts.now ?? Date.now
  }

  // MARK: SecretStore

  get(key: string): string | null {
    return this.load()?.[key] ?? null
  }

  set(key: string, value: string): void {
    const m = this.writable()
    m[key] = value
    this.save(m)
  }

  delete(key: string): void {
    const m = this.writable()
    if (!(key in m)) return
    delete m[key]
    this.save(m)
  }

  keys(): string[] {
    return Object.keys(this.load() ?? {})
  }

  locked(): boolean {
    return this.load() === null
  }

  // MARK: Estado y salidas

  status(): SecretsStatus {
    this.load()
    return this.lock ? { locked: true, reason: this.lock.reason, checkedAt: new Date(this.lock.at).toISOString() } : { locked: false }
  }

  /** Vuelve a intentar leer el archivo ahora mismo (botón «Reintentar»). */
  retry(): SecretsStatus {
    if (this.lock) this.lock.at = -Infinity
    return this.status()
  }

  /**
   * «Empezar de cero»: aparta el archivo que no se puede leer (no se borra: si el llavero vuelve, se puede recuperar) y
   * deja el almacén vacío y abierto. Si ya se puede leer, no hace nada.
   */
  reset(): { status: SecretsStatus; movedTo?: string } {
    if (this.retry().locked === false) return { status: this.status() }
    const file = this.file()
    let movedTo: string | undefined
    if (existsSync(file)) {
      movedTo = unreadableCopyPath(file, new Date(this.now()))
      renameSync(file, movedTo)
      log.warn(`[secretos] el archivo que no se podía leer queda apartado en ${basename(movedTo)}`)
    }
    this.cache = {}
    this.setLock(null)
    return { status: this.status(), ...(movedTo ? { movedTo } : {}) }
  }

  // MARK: Lectura y escritura

  /** Los secretos, o null si el archivo existe y no se puede leer (bloqueado). */
  private load(): Record<string, string> | null {
    if (this.cache) return this.cache
    if (this.lock && this.now() - this.lock.at < this.retryEveryMs) return null
    const file = this.file()
    if (!existsSync(file)) {
      this.cache = {}
      this.setLock(null)
      return this.cache
    }
    try {
      this.cache = this.readFile(file)
    } catch (err) {
      // el principal no se lee: la copia anterior (solo ayuda si el archivo quedó dañado; con el llavero cerrado, tampoco)
      const bak = backupPath(file)
      if (existsSync(bak)) {
        try {
          this.cache = this.readFile(bak)
          log.warn('[secretos] secrets.enc estaba dañado: se usa la copia anterior')
        } catch { /* abajo */ }
      }
      if (!this.cache) {
        const reason = err instanceof Unreadable ? err.reason : 'io'
        log.error(`[secretos] no se pudo leer secrets.enc (${reason}): el almacén queda bloqueado y el archivo intacto`, err instanceof Error ? err.message : String(err))
        this.setLock({ reason, at: this.now() })
        return null
      }
    }
    this.setLock(null)
    return this.cache
  }

  private readFile(file: string): Record<string, string> {
    let raw: Buffer
    try {
      raw = readFileSync(file)
    } catch (err) {
      throw new Unreadable('io', err instanceof Error ? err.message : String(err))
    }
    const head = raw.subarray(0, MAGIC_ENC.length).toString('utf8')
    let json: string
    if (head === MAGIC_ENC) {
      try {
        json = this.cipher.decrypt(raw.subarray(MAGIC_ENC.length))
      } catch (err) {
        throw new Unreadable('decrypt', err instanceof Error ? err.message : String(err))
      }
    } else if (head === MAGIC_PLAIN) {
      json = raw.subarray(MAGIC_PLAIN.length).toString('utf8')
    } else {
      throw new Unreadable('corrupt', 'cabecera desconocida')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch {
      throw new Unreadable('corrupt', 'JSON ilegible')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Unreadable('corrupt', 'no es un objeto')
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === 'string') out[k] = v
    return out
  }

  private writable(): Record<string, string> {
    const m = this.load()
    if (!m) throw secretsLockedError()
    return m
  }

  private save(m: Record<string, string>): void {
    const json = JSON.stringify(m)
    if (this.cipher.protection() === 'os') {
      const enc = this.cipher.encrypt(json)
      writeFileAtomic(this.file(), Buffer.concat([Buffer.from(MAGIC_ENC, 'utf8'), enc]), { mode: 0o600, backup: true })
    } else {
      log.warn('El sistema no ofrece cifrado: los secretos se guardan con permisos 0600 sin cifrar')
      writeFileAtomic(this.file(), Buffer.from(MAGIC_PLAIN + json, 'utf8'), { mode: 0o600, backup: true })
    }
  }

  private setLock(next: { reason: SecretsLockReason; at: number } | null): void {
    const was = this.lock !== null
    this.lock = next
    if (was !== (next !== null)) this.opts.onChange?.(next ? { locked: true, reason: next.reason, checkedAt: new Date(next.at).toISOString() } : { locked: false })
  }
}
