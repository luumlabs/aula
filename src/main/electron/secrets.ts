// Secretos cifrados con safeStorage (Llavero en macOS, DPAPI en Windows, libsecret/kwallet en Linux) en secrets.enc.
// Si el sistema no ofrece cifrado (Linux sin llavero), se guardan en claro con permisos 0600 y se avisa en Ajustes.
// La lógica (y lo que pasa si el llavero no deja leer el archivo: bloqueo sin perder nada) está en services/secrets-file.ts.
import { safeStorage } from 'electron'
import { paths } from '@main/services/paths'
import { FileSecretStore, type SecretCipher, type SecretsStatus } from '@main/services/secrets-file'

const cipher: SecretCipher = {
  protection: () => secretProtection(),
  encrypt: (text) => safeStorage.encryptString(text),
  decrypt: (data) => safeStorage.decryptString(data)
}

export class SafeStorageSecretStore extends FileSecretStore {
  constructor(onChange?: (status: SecretsStatus) => void) {
    super(() => paths.secrets(), cipher, { onChange })
  }
}

/**
 * ¿Cómo se protegen los secretos? 'os' = cifrado del sistema; 'basic' = Linux sin llavero (safeStorage usa una clave fija:
 * eso no protege nada, así que se trata como sin cifrar y se avisa en Ajustes).
 */
export function secretProtection(): 'os' | 'basic' {
  if (!safeStorage.isEncryptionAvailable()) return 'basic'
  if (process.platform === 'linux') {
    try {
      const backend = safeStorage.getSelectedStorageBackend()
      if (backend === 'basic_text' || backend === 'unknown') return 'basic'
    } catch {
      return 'basic'
    }
  }
  return 'os'
}
