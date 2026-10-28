// Con el llavero cerrado (almacén bloqueado), falta de clave ≠ «falta»: se dice que no se pudo leer (J3-1).
import { describe, expect, it } from 'vitest'
import { resolveKey } from './keys'
import { MemorySecretStore, type SecretStore } from '../../secrets'
import type { ProviderConfig } from './config'

const config = { id: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1', secretRef: 'ai.key.openai' } as ProviderConfig

describe('resolveKey', () => {
  it('sin clave guardada: falta', () => {
    expect(() => resolveKey(config, new MemorySecretStore())).toThrowError(/Missing|Falta/)
  })
  it('almacén bloqueado: no pude leer el almacén (no pide volver a pegarla)', () => {
    const locked: SecretStore = { get: () => null, set: () => {}, delete: () => {}, keys: () => [], locked: () => true }
    expect(() => resolveKey(config, locked)).toThrowError(/key store|almacén de claves/)
  })
  it('servidor local sin clave: sigue sin pedirla aunque esté bloqueado', () => {
    const locked: SecretStore = { get: () => null, set: () => {}, delete: () => {}, keys: () => [], locked: () => true }
    expect(resolveKey({ ...config, baseURL: 'http://127.0.0.1:1234/v1' }, locked)).toBeNull()
  })
})
