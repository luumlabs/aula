import { afterEach, describe, expect, it } from 'vitest'
import { aiClient, aiSelectMethod } from './aiClient'

describe('aiSelectMethod', () => {
  it('la ventana y el propietario de un servidor configuran; los demás dispositivos eligen entre lo listo', () => {
    expect(aiSelectMethod('window')).toBe('ai.configure')
    expect(aiSelectMethod('owner')).toBe('ai.configure')
    expect(aiSelectMethod('macDevice')).toBe('ai.choose')
    expect(aiSelectMethod('serverDevice')).toBe('ai.choose')
  })
})

describe('aiClient.select', () => {
  const g = globalThis as { window?: unknown }
  afterEach(() => {
    delete g.window
  })

  /** Un puente de dispositivo falso que apunta los métodos que se llaman. */
  function device(flags: { owner?: boolean; server?: boolean }): string[] {
    const calls: string[] = []
    g.window = {
      aula: {
        remote: true,
        ...flags,
        platform: 'web',
        invoke: async (method: string) => {
          calls.push(method)
          return { ok: true, value: {} }
        },
        on: () => () => undefined
      }
    }
    return calls
  }

  it('el propietario de un servidor cambia el razonamiento con ai.configure (no exige que el proveedor esté listo)', async () => {
    const calls = device({ owner: true, server: true })
    await aiClient.select({ providerId: 'claude-cli', reasoning: 'high' })
    expect(calls).toEqual(['ai.configure'])
  })

  it('un dispositivo no propietario sigue usando ai.choose', async () => {
    const calls = device({ server: true })
    await aiClient.select({ providerId: 'claude-cli', reasoning: 'high' })
    const mac = device({})
    await aiClient.select({ providerId: 'claude-cli', model: 'x' })
    expect(calls).toEqual(['ai.choose'])
    expect(mac).toEqual(['ai.choose'])
  })
})
