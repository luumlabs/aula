import { describe, expect, it } from 'vitest'
import { SettingsPatchError, sanitizeSettingsPatch } from './patch'

describe('sanitizeSettingsPatch', () => {
  it('deja pasar lo que cambia la interfaz', () => {
    expect(sanitizeSettingsPatch({ general: { theme: 'dark', textScale: 1.1, name: 'Boris' }, onboarded: true })).toEqual({ general: { theme: 'dark', textScale: 1.1, name: 'Boris' }, onboarded: true })
    expect(sanitizeSettingsPatch({ persistent: { enabled: true, quietHours: { from: '22:00', to: '08:00' } } })).toEqual({ persistent: { enabled: true, quietHours: { from: '22:00', to: '08:00' } } })
    expect(sanitizeSettingsPatch({ platforms: { keepSignedIn: false } })).toEqual({ platforms: { keepSignedIn: false } })
  })
  it('deja poner y quitar el tope de gasto diario (0 = sin tope)', () => {
    expect(sanitizeSettingsPatch({ ai: { dailyBudgetUSD: 2.5 } })).toEqual({ ai: { dailyBudgetUSD: 2.5 } })
    expect(sanitizeSettingsPatch({ ai: { dailyBudgetUSD: 0 } })).toEqual({ ai: { dailyBudgetUSD: 0 } })
    expect(() => sanitizeSettingsPatch({ ai: { dailyBudgetUSD: -1 } })).toThrow(SettingsPatchError)
    expect(() => sanitizeSettingsPatch({ ai: { dailyBudgetUSD: 20_000 } })).toThrow(SettingsPatchError)
    expect(() => sanitizeSettingsPatch({ ai: { dailyBudgetUSD: '5' } })).toThrow(SettingsPatchError)
    expect(() => sanitizeSettingsPatch({ ai: { dailyBudgetUSD: Number.NaN } })).toThrow(SettingsPatchError)
  })
  it('ignora los interruptores retirados (búsqueda por significado, sonidos)', () => {
    expect(sanitizeSettingsPatch({ data: { semanticSearch: false, memory: false }, general: { sounds: false } })).toEqual({ data: { memory: false } })
  })
  it('nunca acepta programas, referencias de secretos ni cuentas', () => {
    const p = sanitizeSettingsPatch({
      ai: { providers: [{ id: 'x', kind: 'claude-cli', executable: '/bin/sh', secretRef: 'platform.cookies.a' }], activeProvider: 'x', maxParallel: 3 },
      platforms: { accounts: [{ id: 'a', baseURL: 'https://evil.example', tokenSecretRef: 'ai.key.openai' }] },
      version: 1
    })
    expect(p).toEqual({ ai: { maxParallel: 3 } })
  })
  it('rechaza tipos y rangos imposibles', () => {
    expect(() => sanitizeSettingsPatch({ general: { theme: 'neon' } })).toThrow(SettingsPatchError)
    expect(() => sanitizeSettingsPatch({ general: { textScale: 9 } })).toThrow(SettingsPatchError)
    expect(() => sanitizeSettingsPatch({ general: { reminderTime: '25:00' } })).toThrow(SettingsPatchError)
    expect(() => sanitizeSettingsPatch({ data: { memory: 'yes' } })).toThrow(SettingsPatchError)
    expect(() => sanitizeSettingsPatch('x')).toThrow(SettingsPatchError)
  })
})
