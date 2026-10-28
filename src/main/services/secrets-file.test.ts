// J3-1 (P0): si el llavero no deja descifrar secrets.enc una vez, NO se pierde nada (antes la siguiente escritura —las
// cookies, cada 5 minutos— sobrescribía el archivo con solo la clave nueva).
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileSecretStore, MAGIC_ENC, unreadableCopyPath, type SecretCipher, type SecretsStatus } from './secrets-file'
import { AulaError } from './errors'
import { backupPath } from './fs'

/** Cifrado de juguete que se puede «cerrar» (como un llavero denegado o bloqueado). */
function fakeCipher(): SecretCipher & { open: boolean } {
  const c = {
    open: true,
    protection: () => 'os' as const,
    encrypt: (text: string) => Buffer.from(Buffer.from(text, 'utf8').toString('base64'), 'utf8'),
    decrypt: (data: Buffer) => {
      if (!c.open) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
      return Buffer.from(data.toString('utf8'), 'base64').toString('utf8')
    }
  }
  return c
}

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aula-secrets-'))
  file = join(dir, 'secrets.enc')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function seed(cipher: SecretCipher, data: Record<string, string>): Buffer {
  const bytes = Buffer.concat([Buffer.from(MAGIC_ENC), cipher.encrypt(JSON.stringify(data))])
  writeFileSync(file, bytes)
  return bytes
}

const ORIGINAL = { 'ai.key.openai': 'sk-1', 'ai.key.anthropic': 'sk-2', 'platform.cookies.canvas': '{"v":1}' }

describe('FileSecretStore', () => {
  it('sin archivo: empieza vacío, escribe cifrado y lo vuelve a leer', () => {
    const c = fakeCipher()
    const s = new FileSecretStore(() => file, c)
    expect(s.keys()).toEqual([])
    s.set('a', '1')
    expect(readFileSync(file).subarray(0, MAGIC_ENC.length).toString()).toBe(MAGIC_ENC)
    expect(new FileSecretStore(() => file, c).get('a')).toBe('1')
    expect(s.status()).toEqual({ locked: false })
  })

  it('PoC de J3: con el llavero cerrado, la siguiente escritura NO sobrescribe el archivo (antes se perdía todo)', () => {
    const c = fakeCipher()
    const before = seed(c, ORIGINAL)
    c.open = false
    const changes: SecretsStatus[] = []
    const s = new FileSecretStore(() => file, c, { onChange: (st) => changes.push(st) })
    expect(s.keys()).toEqual([])
    expect(s.get('ai.key.openai')).toBeNull()
    expect(s.locked()).toBe(true)
    // lo que hacía saveCookieSnapshot a los 5 minutos
    expect(() => s.set('platform.cookies.acc1', '{"v":1,"cookies":[]}')).toThrowError(AulaError)
    try { s.set('x', 'y') } catch (e) { expect((e as AulaError).code).toBe('secrets_locked') }
    expect(() => s.delete('ai.key.openai')).toThrowError(/llavero|keychain/)
    expect(readFileSync(file).equals(before)).toBe(true)
    expect(s.status()).toMatchObject({ locked: true, reason: 'decrypt' })
    expect(changes).toEqual([expect.objectContaining({ locked: true, reason: 'decrypt' })])
  })

  it('«Reintentar» con el llavero ya abierto: vuelven todas las claves y las escrituras las conservan', () => {
    const c = fakeCipher()
    seed(c, ORIGINAL)
    c.open = false
    const changes: SecretsStatus[] = []
    const s = new FileSecretStore(() => file, c, { onChange: (st) => changes.push(st) })
    expect(s.locked()).toBe(true)
    c.open = true
    // sin reintento explícito no vuelve a preguntar al llavero en cada acceso
    expect(s.locked()).toBe(true)
    expect(s.retry()).toEqual({ locked: false })
    expect(s.get('ai.key.anthropic')).toBe('sk-2')
    s.set('platform.cookies.acc1', 'nuevo')
    const again = new FileSecretStore(() => file, c)
    expect(again.keys().sort()).toEqual([...Object.keys(ORIGINAL), 'platform.cookies.acc1'].sort())
    expect(changes.map((x) => x.locked)).toEqual([true, false])
  })

  it('reintenta solo, como mucho cada `retryEveryMs`', () => {
    const c = fakeCipher()
    seed(c, ORIGINAL)
    c.open = false
    let now = 1_000_000
    const s = new FileSecretStore(() => file, c, { retryEveryMs: 60_000, now: () => now })
    expect(s.locked()).toBe(true)
    c.open = true
    now += 30_000
    expect(s.locked()).toBe(true)
    now += 31_000
    expect(s.locked()).toBe(false)
    expect(s.get('ai.key.openai')).toBe('sk-1')
  })

  it('«Empezar de cero» aparta el archivo (no lo borra) y deja escribir', () => {
    const c = fakeCipher()
    const before = seed(c, ORIGINAL)
    c.open = false
    const s = new FileSecretStore(() => file, c, { now: () => Date.parse('2026-10-27T09:30:00Z') })
    expect(s.locked()).toBe(true)
    const r = s.reset()
    expect(r.status).toEqual({ locked: false })
    expect(r.movedTo).toBe(join(dir, 'secrets.unreadable-2026-10-27T09-30-00.enc'))
    expect(readFileSync(r.movedTo!).equals(before)).toBe(true)
    expect(existsSync(file)).toBe(false)
    s.set('ai.key.openai', 'sk-nueva')
    expect(s.keys()).toEqual(['ai.key.openai'])
    // y si el llavero vuelve, la copia apartada se puede recuperar
    c.open = true
    const copy = new FileSecretStore(() => r.movedTo!, c)
    expect(copy.get('ai.key.anthropic')).toBe('sk-2')
  })

  it('«Empezar de cero» no hace nada si ya se puede leer', () => {
    const c = fakeCipher()
    seed(c, ORIGINAL)
    const s = new FileSecretStore(() => file, c)
    expect(s.reset()).toEqual({ status: { locked: false } })
    expect(s.get('ai.key.openai')).toBe('sk-1')
    expect(readdirSync(dir)).toEqual(['secrets.enc'])
  })

  it('archivo dañado: usa la copia anterior si la hay; si no, se bloquea (corrupt) sin tocar nada', () => {
    const c = fakeCipher()
    const s1 = new FileSecretStore(() => file, c)
    s1.set('a', '1')
    s1.set('b', '2') // deja .secrets.enc.bak con {a}
    expect(existsSync(backupPath(file))).toBe(true)
    writeFileSync(file, 'basura')
    expect(new FileSecretStore(() => file, c).get('a')).toBe('1')
    rmSync(backupPath(file))
    const s3 = new FileSecretStore(() => file, c)
    expect(s3.status()).toMatchObject({ locked: true, reason: 'corrupt' })
    expect(readFileSync(file, 'utf8')).toBe('basura')
  })

  it('nombre de la copia apartada', () => {
    expect(unreadableCopyPath('/d/secrets.enc', new Date('2026-01-02T03:04:05.678Z'))).toBe(join('/d', 'secrets.unreadable-2026-01-02T03-04-05.enc'))
  })
})
