// A2-P2-6 / A5-P2-7: la app instalada no abre la depuración remota (CDP); desarrollo y compilaciones de auditoría, sí.
import { describe, expect, it } from 'vitest'
import { isAuditBuild, refusedDebugSwitch } from './debug-guard'

const switches = (...on: string[]) => (name: string) => on.includes(name)

describe('depuración remota', () => {
  it('la app empaquetada rechaza --remote-debugging-port y --remote-debugging-pipe', () => {
    expect(refusedDebugSwitch(true, switches('remote-debugging-port'), false)).toBe('remote-debugging-port')
    expect(refusedDebugSwitch(true, switches('remote-debugging-pipe'), false)).toBe('remote-debugging-pipe')
    expect(refusedDebugSwitch(true, switches('lang', 'use-mock-keychain', 'host-resolver-rules'), false)).toBeNull()
  })
  it('en desarrollo (Playwright) y en una compilación de auditoría, se deja', () => {
    expect(refusedDebugSwitch(false, switches('remote-debugging-port'), false)).toBeNull()
    expect(refusedDebugSwitch(true, switches('remote-debugging-port'), true)).toBeNull()
  })
  it('las pruebas nunca son una compilación de auditoría (la constante solo existe al compilar)', () => {
    expect(isAuditBuild()).toBe(false)
  })
})
