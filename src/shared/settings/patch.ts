// Lo que la interfaz puede cambiar de los ajustes con 'settings.update': solo campos sencillos y comprobados.
// Las IA (proveedores, ejecutables, referencias de claves) y las cuentas de plataformas se cambian con sus propios métodos
// (ai.*, platforms.*), que validan y nunca aceptan rutas de programas ni referencias de secretos desde la interfaz.
import type { SettingsPatch } from './index'

export class SettingsPatchError extends Error {}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

const bool = (v: unknown, k: string): boolean => {
  if (typeof v !== 'boolean') throw new SettingsPatchError(`«${k}» debe ser sí o no`)
  return v
}
const oneOf = <T extends string>(v: unknown, k: string, options: readonly T[]): T => {
  if (typeof v !== 'string' || !options.includes(v as T)) throw new SettingsPatchError(`«${k}» no es válido`)
  return v as T
}
const num = (v: unknown, k: string, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new SettingsPatchError(`«${k}» debe estar entre ${min} y ${max}`)
  return v
}
const text = (v: unknown, k: string, max: number): string => {
  if (typeof v !== 'string' || v.length > max) throw new SettingsPatchError(`«${k}» no es válido`)
  return v
}
const time = (v: unknown, k: string): string => {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new SettingsPatchError(`«${k}» debe ser una hora HH:mm`)
  return v
}

/** Para cada sección, los campos permitidos y cómo se comprueban. */
const SECTIONS: Record<string, Record<string, (v: unknown, k: string) => unknown>> = {
  general: {
    language: (v, k) => oneOf(v, k, ['system', 'es', 'en'] as const),
    theme: (v, k) => oneOf(v, k, ['system', 'light', 'dark'] as const),
    motion: (v, k) => oneOf(v, k, ['system', 'full', 'reduced'] as const),
    textScale: (v, k) => num(v, k, 0.85, 1.4),
    cursor: (v, k) => oneOf(v, k, ['sun', 'system'] as const),
    reminders: bool,
    reminderTime: time,
    name: (v, k) => text(v, k, 80)
  },
  data: { memory: bool, webSearch: bool, autoUpdate: bool },
  persistent: {
    enabled: bool,
    style: (v, k) => oneOf(v, k, ['quiet', 'balanced', 'attentive'] as const),
    openAtLogin: bool,
    quietHours: (v, k) => {
      if (v === null) return null
      if (!isObj(v)) throw new SettingsPatchError(`«${k}» no es válido`)
      return { from: time(v.from, `${k}.from`), to: time(v.to, `${k}.to`) }
    }
  },
  platforms: { keepSignedIn: bool, keepAliveMinutes: (v, k) => num(v, k, 10, 120), sessionCookieDays: (v, k) => num(v, k, 1, 90) },
  ai: {
    maxParallel: (v, k) => Math.round(num(v, k, 1, 8)),
    dailyBudgetUSD: (v, k) => num(v, k, 0, 10_000),
    warnFraction: (v, k) => num(v, k, 0.1, 1),
    blockUnknownPrices: bool
  }
}

/**
 * Comprueba un parche que llega de la interfaz y devuelve solo lo permitido. Los campos desconocidos se ignoran; un valor
 * de tipo o rango incorrecto lanza `SettingsPatchError`.
 */
export function sanitizeSettingsPatch(raw: unknown, extra: Partial<typeof SECTIONS> = {}): SettingsPatch {
  if (!isObj(raw)) throw new SettingsPatchError('Ajustes no válidos')
  const out: Obj = {}
  if (raw.onboarded !== undefined) out.onboarded = bool(raw.onboarded, 'onboarded')
  for (const [section, fields] of Object.entries({ ...SECTIONS, ...extra })) {
    const v = raw[section]
    if (v === undefined) continue
    if (!isObj(v)) throw new SettingsPatchError(`«${section}» no es válido`)
    const clean: Obj = {}
    for (const [k, check] of Object.entries(fields ?? {})) if (v[k] !== undefined) clean[k] = check(v[k], `${section}.${k}`)
    if (Object.keys(clean).length) out[section] = clean
  }
  return out as SettingsPatch
}

/** Para dominios que añaden campos sencillos a una sección (p. ej. automatizaciones en `persistent`). */
export const settingsPatchChecks = { bool, oneOf, num, text, time }
