import { describe, expect, it } from 'vitest'
import { accountJitter, afterResume, applyCheckResult, keepAliveInterval, nextCheckAt, planKeepAlive, snapshotDue, type KeepAliveAccountState } from './keepalive'

const MIN = 60_000
const T0 = 1_800_000_000_000
const st = (o: Partial<KeepAliveAccountState> & { id: string }): KeepAliveAccountState => ({ status: 'signedIn', lastCheckedAt: T0, failures: 0, inFlight: false, ...o })

describe('mantener la sesión: decisiones', () => {
  it('intervalo por defecto 25 min, limitado a 5…120', () => {
    expect(keepAliveInterval()).toBe(25 * MIN)
    expect(keepAliveInterval({ intervalMinutes: 1 })).toBe(5 * MIN)
    expect(keepAliveInterval({ intervalMinutes: 999 })).toBe(120 * MIN)
  })

  it('desfase estable por cuenta y como mucho el 10 % del intervalo', () => {
    const i = 25 * MIN
    expect(accountJitter('abc', i)).toBe(accountJitter('abc', i))
    for (const id of ['a', 'b', 'cuenta-1', 'f00d']) {
      const j = accountJitter(id, i)
      expect(j).toBeGreaterThanOrEqual(0)
      expect(j).toBeLessThanOrEqual(i * 0.1)
    }
  })

  it('nunca comprobada → ya; comprobada → tras el intervalo (+ desfase)', () => {
    expect(nextCheckAt(st({ id: 'a', lastCheckedAt: null }), T0)).toBe(T0)
    const at = nextCheckAt(st({ id: 'a' }), T0)!
    expect(at).toBeGreaterThanOrEqual(T0 + 25 * MIN)
    expect(at).toBeLessThanOrEqual(T0 + 27.5 * MIN)
  })

  it('no se comprueba: apagado, sesión cerrada, ventana de acceso abierta o comprobación en marcha', () => {
    expect(nextCheckAt(st({ id: 'a' }), T0, { enabled: false })).toBeNull()
    expect(nextCheckAt(st({ id: 'a', status: 'needsSignIn' }), T0)).toBeNull()
    expect(nextCheckAt(st({ id: 'a', signingIn: true }), T0)).toBeNull()
    expect(nextCheckAt(st({ id: 'a', inFlight: true }), T0)).toBeNull()
  })

  it('tras fallos de red: reintento con retroceso 1, 2, 4… min, nunca más que el intervalo', () => {
    expect(nextCheckAt(st({ id: 'a', failures: 1 }), T0)).toBe(T0 + MIN)
    expect(nextCheckAt(st({ id: 'a', failures: 3 }), T0)).toBe(T0 + 4 * MIN)
    expect(nextCheckAt(st({ id: 'a', failures: 20 }), T0)).toBe(T0 + 25 * MIN)
  })

  it('plan: quién toca ya y cuándo despertar', () => {
    const plan = planKeepAlive([
      st({ id: 'due', lastCheckedAt: T0 - 30 * MIN }),
      st({ id: 'later', lastCheckedAt: T0 - 10 * MIN }),
      st({ id: 'closed', status: 'needsSignIn', lastCheckedAt: null })
    ], T0)
    expect(plan.due).toEqual(['due'])
    expect(plan.nextWakeAt).toBeGreaterThan(T0)
    expect(plan.nextWakeAt).toBeLessThanOrEqual(T0 + 18 * MIN)
    expect(planKeepAlive([st({ id: 'x', status: 'needsSignIn' })], T0)).toEqual({ due: [], nextWakeAt: null })
  })

  it('resultado de una comprobación', () => {
    const a = st({ id: 'a', failures: 2, inFlight: true })
    expect(applyCheckResult(a, 'signedIn', T0 + 1)).toMatchObject({ status: 'signedIn', failures: 0, inFlight: false, lastCheckedAt: T0 + 1 })
    expect(applyCheckResult(a, 'signedOut', T0 + 1)).toMatchObject({ status: 'needsSignIn', failures: 0 })
    // un fallo de red nunca marca la sesión como cerrada
    expect(applyCheckResult(a, 'error', T0 + 1)).toMatchObject({ status: 'signedIn', failures: 3 })
    expect(applyCheckResult(a, 'unknown', T0 + 1)).toMatchObject({ status: 'signedIn', failures: 3 })
  })

  it('al volver de la suspensión se comprueba lo atrasado', () => {
    const out = afterResume([
      st({ id: 'old', lastCheckedAt: T0 - 60 * MIN }), st({ id: 'recent', lastCheckedAt: T0 - MIN }), st({ id: 'failing', failures: 2, lastCheckedAt: T0 - MIN }),
      st({ id: 'closed', status: 'needsSignIn', lastCheckedAt: T0 - 60 * MIN })
    ], T0)
    expect(out.map((s) => [s.id, s.lastCheckedAt])).toEqual([['old', null], ['recent', T0 - MIN], ['failing', null], ['closed', T0 - 60 * MIN]])
  })

  it('¿toca copiar las cookies?', () => {
    expect(snapshotDue(null, T0, false)).toBe(true)
    expect(snapshotDue(T0 - MIN, T0, false)).toBe(false)
    expect(snapshotDue(T0 - 5 * MIN, T0, false)).toBe(true)
    expect(snapshotDue(T0 - 31_000, T0, true)).toBe(true)
    expect(snapshotDue(T0 - 10_000, T0, true)).toBe(false)
  })
})
