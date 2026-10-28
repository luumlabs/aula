// Almacén de secretos (claves de API, tokens, enlaces privados de calendario, cookies de sesión guardadas).
// El proceso principal instala la implementación cifrada (safeStorage); en pruebas se usa la de memoria.
export interface SecretStore {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
  keys(): string[]
  /** true = el archivo existe pero no se puede leer (llavero cerrado o denegado): nada se escribe hasta poder leerlo. */
  locked?(): boolean
}

export class MemorySecretStore implements SecretStore {
  private map = new Map<string, string>()
  get(key: string) { return this.map.get(key) ?? null }
  set(key: string, value: string) { this.map.set(key, value) }
  delete(key: string) { this.map.delete(key) }
  keys() { return [...this.map.keys()] }
}

let store: SecretStore = new MemorySecretStore()
export function setSecretStore(s: SecretStore): void { store = s }
export function secrets(): SecretStore { return store }
