// Firma propia de las actualizaciones (Ed25519, solo node:crypto). Sin ella, quien consiguiera el token o la cuenta de
// GitHub del proyecto podía instalar código en todas las copias: el SHA-512 del latest-*.yml viene del mismo sitio que el
// instalador, la firma ad hoc de macOS la puede hacer cualquiera y en Windows no hay Authenticode (J3-4).
//
// Cómo funciona:
//   - scripts/release-sign.mjs firma, con la clave PRIVADA (fuera del repositorio: ~/.aula-signing/update-ed25519.key),
//     cada archivo de cada latest-*.yml: el mensaje `aula-update-v1\n<archivo>\n<versión>\n<sha512>` y escribe la firma en
//     su entrada (`aulaSignature`).
//   - La app lleva aquí las claves PÚBLICAS (la principal y la de reserva, A1-P1-2). Antes de instalar, calcula el SHA-512
//     del archivo descargado y exige una firma válida de cualquiera de ellas para (nombre, versión, ese SHA-512). Sin firma
//     o con firma mala, no se instala (código 'signature').
//   - Las notas de la versión (`releaseNotes` del .yml, que se pintan dentro de Aula) van firmadas aparte
//     (`aulaNotesSignature`, A1-P1-6): sin esa firma no se enseñan.
// Ver docs/PUBLISHING.md («Update signatures»).
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { basename } from 'node:path'

/**
 * Claves públicas Ed25519 (SPKI DER en base64) de las actualizaciones. Vale la firma de CUALQUIERA:
 *   0 · la principal (~/.aula-signing/update-ed25519.key): con ella se firma siempre;
 *   1 · la de reserva (update-ed25519-backup.key), guardada SOLO fuera de línea. Si la principal se pierde, se firma con
 *       esta; si se filtra, una versión firmada con la de reserva la quita de la lista (y trae una reserva nueva).
 * Quitarlas o cambiarlas todas deja huérfanas a las copias ya instaladas (tendrían que instalar a mano).
 */
export const UPDATE_PUBLIC_KEYS: readonly string[] = [
  'MCowBQYDK2VwAyEATb7ooai9PeLuWpRmtNnfTuaBplk3qbJU3R3qBxcDyLQ=',
  'MCowBQYDK2VwAyEAVy9VyEyhjbZOFueeQ5f79mVXJAePnLodoH8r4WGlKs8='
]

/** La principal. */
export const UPDATE_PUBLIC_KEY = UPDATE_PUBLIC_KEYS[0]

/** Campo de cada archivo de latest-*.yml con su firma (base64). */
export const SIGNATURE_FIELD = 'aulaSignature'
/** Campo de latest-*.yml con la firma de sus notas (`releaseNotes`). */
export const NOTES_SIGNATURE_FIELD = 'aulaNotesSignature'

export class UpdateSignatureError extends Error {
  /** Mismo código que usa electron-updater para una firma no válida (lo entiende classifyUpdateError). */
  readonly code = 'ERR_UPDATER_INVALID_SIGNATURE'
  constructor(message: string) {
    super(message)
    this.name = 'UpdateSignatureError'
  }
}

/** Lo que se firma de cada archivo. */
export function signedMessage(fileName: string, version: string, sha512: string): Buffer {
  return Buffer.from(`aula-update-v1\n${fileName}\n${version}\n${sha512}`, 'utf8')
}

/** Lo que se firma de las notas: su SHA-512 tal cual vienen en latest-*.yml. */
export function signedNotesMessage(version: string, notes: string): Buffer {
  const sha512 = createHash('sha512').update(notes, 'utf8').digest('base64')
  return Buffer.from(`aula-notes-v1\n${version}\n${sha512}`, 'utf8')
}

export function publicKeyFrom(spkiBase64: string = UPDATE_PUBLIC_KEY): KeyObject {
  return createPublicKey({ key: Buffer.from(spkiBase64, 'base64'), format: 'der', type: 'spki' })
}

/** Las claves públicas de la app. */
export function appPublicKeys(): KeyObject[] {
  return UPDATE_PUBLIC_KEYS.map((k) => publicKeyFrom(k))
}

/** ¿Firma válida de alguna de las claves? */
export function signatureIsValid(message: Buffer, signatureBase64: unknown, keys: KeyObject | readonly KeyObject[] = appPublicKeys()): boolean {
  if (typeof signatureBase64 !== 'string' || !/^[A-Za-z0-9+/]{80,90}={0,2}$/.test(signatureBase64)) return false
  const signature = Buffer.from(signatureBase64, 'base64')
  return (Array.isArray(keys) ? keys : [keys as KeyObject]).some((key) => {
    try {
      return verify(null, message, key, signature)
    } catch {
      return false
    }
  })
}

/** Las notas de una versión (el `releaseNotes` crudo de latest-*.yml) solo si llevan la firma de Aula; si no, undefined. */
export function signedReleaseNotes(info: { version?: unknown; releaseNotes?: unknown; [NOTES_SIGNATURE_FIELD]?: unknown }, keys?: KeyObject | readonly KeyObject[]): string | undefined {
  if (typeof info.releaseNotes !== 'string' || typeof info.version !== 'string') return undefined
  return signatureIsValid(signedNotesMessage(info.version, info.releaseNotes), info[NOTES_SIGNATURE_FIELD], keys) ? info.releaseNotes : undefined
}

/** Una entrada de `files` de latest-*.yml (lo que importa aquí). */
export interface SignedFileEntry {
  url: string
  sha512?: string
  [SIGNATURE_FIELD]?: unknown
}

/** La entrada de `files` que corresponde al archivo descargado (por su nombre). */
export function entryForFile(files: unknown, downloadedFile: string): SignedFileEntry | null {
  if (!Array.isArray(files)) return null
  const name = basename(downloadedFile)
  for (const f of files) {
    if (f && typeof f === 'object' && typeof (f as { url?: unknown }).url === 'string') {
      const e = f as SignedFileEntry
      if (fileNameOf(e.url) === name) return e
    }
  }
  return null
}

/** «https://…/download/v0.1.0/Aula-0.1.0-mac.zip» o «Aula-0.1.0-mac.zip» → «Aula-0.1.0-mac.zip». */
export function fileNameOf(url: string): string {
  const clean = url.split(/[?#]/)[0]
  let name = clean.slice(clean.lastIndexOf('/') + 1)
  try {
    name = decodeURIComponent(name)
  } catch { /* tal cual */ }
  return name
}

export function sha512OfFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha512')
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('base64')))
  })
}

export interface VerifyOptions {
  file: string
  entry: SignedFileEntry | null
  version: string
  /** Claves públicas (las pruebas usan las suyas; si no, las de la app). */
  publicKey?: KeyObject | readonly KeyObject[]
  /** SHA-512 ya calculado (si no, se calcula). */
  sha512?: string
}

/** Comprueba el archivo descargado antes de instalarlo. Lanza UpdateSignatureError si no está firmado por Aula. */
export async function verifyDownloadedUpdate(o: VerifyOptions): Promise<void> {
  if (!o.entry) throw new UpdateSignatureError(`latest.yml no describe ${basename(o.file)}`)
  const sha512 = o.sha512 ?? (await sha512OfFile(o.file))
  if (o.entry.sha512 && o.entry.sha512 !== sha512) throw new UpdateSignatureError('el SHA-512 del archivo no coincide con latest.yml')
  if (o.entry[SIGNATURE_FIELD] === undefined) throw new UpdateSignatureError('la versión nueva no tiene la firma de Aula')
  const message = signedMessage(fileNameOf(o.entry.url), o.version, sha512)
  if (!signatureIsValid(message, o.entry[SIGNATURE_FIELD], o.publicKey ?? appPublicKeys())) {
    throw new UpdateSignatureError('la firma de la versión nueva no es de Aula')
  }
}
