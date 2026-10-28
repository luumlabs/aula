// Opciones locales que viajan dentro de las cabeceras extra del proveedor sin llegar nunca a la red (port de LocalFlags).
// Reservadas (sin distinguir mayúsculas): `useMaxCompletionTokens` y todo lo que empiece por `x-aula-`. Las que guardaron
// versiones anteriores con el prefijo `x-mimir-` se leen como `x-aula-…` y tampoco salen a la red.
export const LEGACY_FLAG_PREFIX = 'x-mimir-'

export class LocalFlags {
  readonly values: Record<string, string> = {}
  readonly httpHeaders: Record<string, string> = {}

  constructor(headers: Record<string, string> | undefined) {
    for (const [k, v] of Object.entries(headers ?? {})) {
      const raw = k.trim().toLowerCase()
      const legacy = raw.startsWith(LEGACY_FLAG_PREFIX)
      const key = legacy ? 'x-aula-' + raw.slice(LEGACY_FLAG_PREFIX.length) : raw
      if (key === 'usemaxcompletiontokens' || key.startsWith('x-aula-')) {
        // con las dos formas, manda la nueva
        if (!legacy || this.values[key] === undefined) this.values[key] = v.trim()
      } else this.httpHeaders[k] = v
    }
  }

  /** Valor booleano (`true/1/yes/sí/on` o `false/0/no/off`); `undefined` si no está o no se entiende. */
  bool(key: string): boolean | undefined {
    const v = this.values[key.toLowerCase()]?.toLowerCase()
    if (v === undefined) return undefined
    if (['true', '1', 'yes', 'si', 'sí', 'on'].includes(v)) return true
    if (['false', '0', 'no', 'off'].includes(v)) return false
    return undefined
  }

  string(key: string): string | undefined {
    return this.values[key.toLowerCase()]
  }

  number(key: string): number | undefined {
    const v = this.values[key.toLowerCase()]
    if (v === undefined || v === '') return undefined
    const n = Number(v)
    return Number.isNaN(n) ? undefined : n
  }
}

/** Cabeceras HTTP válidas de las extra (descarta las opciones locales y cualquier cabecera con saltos de línea). */
export function sanitizedExtraHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(new LocalFlags(headers).httpHeaders)) {
    if (!k || /[\r\n: ]/.test(k) || /[\r\n]/.test(v)) continue
    out[k] = v
  }
  return out
}
