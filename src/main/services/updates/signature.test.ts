// J3-4: las actualizaciones solo se instalan con la firma propia de Aula (Ed25519). Se prueba el guion que firma
// (scripts/release-sign.mjs) contra la comprobación de la app, con una clave de usar y tirar.
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { classifyUpdateError } from './errors'
import {
  NOTES_SIGNATURE_FIELD, SIGNATURE_FIELD, UPDATE_PUBLIC_KEY, UPDATE_PUBLIC_KEYS, UpdateSignatureError, appPublicKeys, entryForFile, fileNameOf, publicKeyFrom,
  sha512OfFile, signatureIsValid, signedMessage, signedNotesMessage, signedReleaseNotes, verifyDownloadedUpdate
} from './signature'

const yaml = createRequire(import.meta.url)('js-yaml') as { load(s: string): unknown; dump(v: unknown): string }
const SCRIPT = join(__dirname, '../../../../scripts/release-sign.mjs')

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'aula-sig-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function keys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { publicKey, privateKey, pubB64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }
}

async function release(version = '0.1.1') {
  const file = join(dir, `Aula-${version}-mac.zip`)
  writeFileSync(file, `zip de la ${version}`)
  const sha512 = await sha512OfFile(file)
  const yml = join(dir, 'latest-mac.yml')
  writeFileSync(yml, yaml.dump({ version, files: [{ url: `Aula-${version}-mac.zip`, sha512, size: 14 }], path: `Aula-${version}-mac.zip`, sha512, releaseDate: '2026-10-27T10:00:00.000Z', releaseNotes: '<!-- lang:en -->\nHola' }))
  return { file, sha512, yml, version }
}

describe('firma de las actualizaciones', () => {
  it('la clave pública embebida es Ed25519 válida', () => {
    expect(publicKeyFrom(UPDATE_PUBLIC_KEY).asymmetricKeyType).toBe('ed25519')
  })

  it('el guion firma cada latest*.yml y la app lo acepta', async () => {
    const k = keys()
    const r = await release()
    execFileSync(process.execPath, [SCRIPT, dir, '--public', k.pubB64], { env: { ...process.env, AULA_UPDATE_SIGNING_KEY: k.pem }, stdio: 'pipe' })
    const info = yaml.load(readFileSync(r.yml, 'utf8')) as { version: string; files: { url: string }[]; releaseNotes: string }
    expect(info.releaseNotes).toContain('lang:en')
    const entry = entryForFile(info.files, r.file)
    expect(entry?.[SIGNATURE_FIELD]).toMatch(/^[A-Za-z0-9+/]{86}==$/)
    await expect(verifyDownloadedUpdate({ file: r.file, entry, version: info.version, publicKey: k.publicKey })).resolves.toBeUndefined()
    // --verify (sin la privada) también lo da por bueno
    expect(spawnSync(process.execPath, [SCRIPT, '--verify', dir, '--public', k.pubB64]).status).toBe(0)
  })

  it('rechaza: sin firma, firma de otra clave, otro archivo, otra versión o un archivo cambiado', async () => {
    const k = keys()
    const other = keys()
    const r = await release()
    const msg = signedMessage(fileNameOf(`https://github.com/luumlabs/aula/releases/download/v${r.version}/Aula-${r.version}-mac.zip`), r.version, r.sha512)
    const good = sign(null, msg, k.privateKey).toString('base64')
    const entry = { url: `Aula-${r.version}-mac.zip`, sha512: r.sha512, [SIGNATURE_FIELD]: good }
    await expect(verifyDownloadedUpdate({ file: r.file, entry, version: r.version, publicKey: k.publicKey })).resolves.toBeUndefined()
    const cases: [string, Parameters<typeof verifyDownloadedUpdate>[0]][] = [
      ['sin firma', { file: r.file, entry: { url: entry.url, sha512: r.sha512 }, version: r.version, publicKey: k.publicKey }],
      ['otra clave', { file: r.file, entry: { ...entry, [SIGNATURE_FIELD]: sign(null, msg, other.privateKey).toString('base64') }, version: r.version, publicKey: k.publicKey }],
      ['otra versión (reutilizar una firma vieja)', { file: r.file, entry, version: '0.1.2', publicKey: k.publicKey }],
      ['otro nombre', { file: r.file, entry: { ...entry, url: 'Aula-0.1.1-win.exe' }, version: r.version, publicKey: k.publicKey }],
      ['sin entrada', { file: r.file, entry: null, version: r.version, publicKey: k.publicKey }],
      ['basura', { file: r.file, entry: { ...entry, [SIGNATURE_FIELD]: 'no' }, version: r.version, publicKey: k.publicKey }]
    ]
    for (const [name, o] of cases) await expect(verifyDownloadedUpdate(o), name).rejects.toBeInstanceOf(UpdateSignatureError)
    // el archivo cambió después de firmar (aunque alguien reescriba el sha512 del .yml)
    writeFileSync(r.file, 'zip malicioso')
    await expect(verifyDownloadedUpdate({ file: r.file, entry: { ...entry, sha512: await sha512OfFile(r.file) }, version: r.version, publicKey: k.publicKey })).rejects.toBeInstanceOf(UpdateSignatureError)
  })

  it('un fallo de firma se explica como «signature» (y no se reintenta solo)', () => {
    expect(classifyUpdateError(new UpdateSignatureError('x'))).toBe('signature')
  })

  it('el guion se niega con una privada que no es la pareja de la pública, con permisos abiertos o con un archivo cambiado', async () => {
    const k = keys()
    const other = keys()
    await release()
    const run = (args: string[], env: Record<string, string> = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' })
    expect(run([dir, '--public', k.pubB64], { AULA_UPDATE_SIGNING_KEY: other.pem }).stderr).toMatch(/no corresponde/)
    const keyFile = join(dir, 'k.key')
    writeFileSync(keyFile, k.pem)
    chmodSync(keyFile, 0o644)
    if (process.platform !== 'win32') expect(run([dir, '--key', keyFile, '--public', k.pubB64]).stderr).toMatch(/chmod 600/)
    // sin firmar: --verify falla
    expect(run(['--verify', dir, '--public', k.pubB64]).status).toBe(1)
    writeFileSync(join(dir, 'Aula-0.1.1-mac.zip'), 'cambiado')
    expect(run([dir, '--public', k.pubB64], { AULA_UPDATE_SIGNING_KEY: k.pem }).stderr).toMatch(/SHA-512/)
  })

  it('A1-P1-2 · la app lleva dos claves públicas (principal y reserva) y vale la firma de cualquiera', async () => {
    expect(UPDATE_PUBLIC_KEYS).toHaveLength(2)
    expect(new Set(UPDATE_PUBLIC_KEYS).size).toBe(2)
    expect(UPDATE_PUBLIC_KEY).toBe(UPDATE_PUBLIC_KEYS[0])
    expect(appPublicKeys().every((k) => k.asymmetricKeyType === 'ed25519')).toBe(true)
    const main = keys()
    const backup = keys()
    const stranger = keys()
    const r = await release()
    const msg = signedMessage(`Aula-${r.version}-mac.zip`, r.version, r.sha512)
    const by = (k: ReturnType<typeof keys>) => sign(null, msg, k.privateKey).toString('base64')
    const both = [main.publicKey, backup.publicKey]
    expect(signatureIsValid(msg, by(main), both)).toBe(true)
    expect(signatureIsValid(msg, by(backup), both)).toBe(true)
    expect(signatureIsValid(msg, by(stranger), both)).toBe(false)
    const entry = { url: `Aula-${r.version}-mac.zip`, sha512: r.sha512, [SIGNATURE_FIELD]: by(backup) }
    await expect(verifyDownloadedUpdate({ file: r.file, entry, version: r.version, publicKey: both })).resolves.toBeUndefined()
  })

  it('A1-P1-2 · el guion firma con la privada de reserva y la reconoce; sin --public lee las dos claves de signature.ts', async () => {
    const main = keys()
    const backup = keys()
    const r = await release()
    const pubs = `${main.pubB64},${backup.pubB64}`
    const run = (args: string[], env: Record<string, string> = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' })
    const check = run(['--check-key', '--public', pubs], { AULA_UPDATE_SIGNING_KEY: backup.pem })
    expect(check.status).toBe(0)
    expect(check.stdout).toMatch(/reserva/)
    expect(run([dir, '--public', pubs], { AULA_UPDATE_SIGNING_KEY: backup.pem }).status).toBe(0)
    const info = yaml.load(readFileSync(r.yml, 'utf8')) as { version: string; files: { url: string }[] }
    await expect(verifyDownloadedUpdate({ file: r.file, entry: entryForFile(info.files, r.file), version: info.version, publicKey: [main.publicKey, backup.publicKey] })).resolves.toBeUndefined()
    // con las claves de la app (las de signature.ts), una firma de usar y tirar no vale (y el guion sí encuentra la lista)
    const embedded = run(['--verify', dir])
    expect(embedded.status).toBe(1)
    expect(embedded.stderr).toMatch(/sin firma válida/)
    expect(embedded.stderr).not.toMatch(/No encuentro/)
  })

  it('A1-P1-6 · las notas solo se enseñan con su firma: el guion las firma y cambiar una letra las invalida', async () => {
    const k = keys()
    const other = keys()
    const r = await release()
    execFileSync(process.execPath, [SCRIPT, dir, '--public', k.pubB64], { env: { ...process.env, AULA_UPDATE_SIGNING_KEY: k.pem }, stdio: 'pipe' })
    const info = yaml.load(readFileSync(r.yml, 'utf8')) as { version: string; releaseNotes: string; [NOTES_SIGNATURE_FIELD]: string }
    expect(info[NOTES_SIGNATURE_FIELD]).toMatch(/^[A-Za-z0-9+/]{86}==$/)
    expect(signedReleaseNotes(info, k.publicKey)).toBe(info.releaseNotes)
    expect(signedReleaseNotes({ ...info, releaseNotes: info.releaseNotes + ' [phishing](https://example.org)' }, k.publicKey)).toBeUndefined()
    expect(signedReleaseNotes({ ...info, version: '0.1.2' }, k.publicKey)).toBeUndefined()
    expect(signedReleaseNotes({ version: info.version, releaseNotes: info.releaseNotes }, k.publicKey)).toBeUndefined()
    expect(signedReleaseNotes({ ...info, [NOTES_SIGNATURE_FIELD]: sign(null, signedNotesMessage(info.version, info.releaseNotes), other.privateKey).toString('base64') }, k.publicKey)).toBeUndefined()
    // notas que no son texto (el feed de GitHub, listas por versión): nunca
    expect(signedReleaseNotes({ version: info.version, releaseNotes: [{ version: '0.1.1', note: 'x' }] }, k.publicKey)).toBeUndefined()
    // --verify exige también la firma de las notas
    const y = readFileSync(r.yml, 'utf8').replace(/aulaNotesSignature: .*\n/, '')
    writeFileSync(r.yml, y)
    expect(spawnSync(process.execPath, [SCRIPT, '--verify', dir, '--public', k.pubB64], { encoding: 'utf8' }).stderr).toMatch(/notas/)
  })
})
