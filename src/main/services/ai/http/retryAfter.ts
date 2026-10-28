// Cuánto hay que esperar tras un 429 (o un 503) según las cabeceras de cada proveedor (port de RetryAfter.swift).
// Preferencia: `retry-after-ms`, `retry-after` (segundos o fecha HTTP) y, si no hay, la menor de las de reinicio de límites
// (`x-ratelimit-reset-requests/-tokens` de OpenAI: «20s», «1m30s», «250ms»; `anthropic-ratelimit-*-reset`: RFC 3339;
// `x-ratelimit-reset` de OpenRouter: marca Unix en s o ms).

export type HeaderGetter = (name: string) => string | null

/** Nadie espera más de un día. */
export const MAX_WAIT_SEC = 86_400

/** `Number` estricto: sin cadenas vacías ni espacios (como `Double(String)` de Swift). */
function strictNumber(s: string): number | null {
  if (!s || /\s/.test(s)) return null
  const v = Number(s)
  return Number.isNaN(v) ? null : v
}

export function retryAfterSeconds(header: HeaderGetter, nowMs = Date.now()): number | undefined {
  const get = (name: string) => header(name)?.trim() ?? null
  const ms = get('retry-after-ms')
  if (ms) {
    const v = strictNumber(ms)
    if (v !== null && v >= 0 && Number.isFinite(v)) return Math.min(v / 1000, MAX_WAIT_SEC)
  }
  const ra = get('retry-after')
  if (ra) {
    const s = strictNumber(ra)
    if (s !== null && s >= 0 && Number.isFinite(s)) return Math.min(s, MAX_WAIT_SEC)
    const d = httpDate(ra)
    if (d !== null) return Math.min(Math.max(0, (d - nowMs) / 1000), MAX_WAIT_SEC)
  }
  const candidates: number[] = []
  for (const name of [
    'x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens', 'x-ratelimit-reset', 'ratelimit-reset',
    'anthropic-ratelimit-requests-reset', 'anthropic-ratelimit-tokens-reset',
    'anthropic-ratelimit-input-tokens-reset', 'anthropic-ratelimit-output-tokens-reset'
  ]) {
    const v = get(name)
    if (!v) continue
    const s = resetValue(v, nowMs)
    if (s !== null && s > 0) candidates.push(Math.min(s, MAX_WAIT_SEC))
  }
  return candidates.length ? Math.min(...candidates) : undefined
}

/** Valor de una cabecera de reinicio: duración («1m30s»), segundos, marca Unix (s o ms) o fecha ISO 8601. */
export function resetValue(raw: string, nowMs = Date.now()): number | null {
  const v = raw.trim()
  const d = durationSeconds(v)
  if (d !== null) return d
  const n = strictNumber(v)
  if (n !== null && Number.isFinite(n) && n >= 0) {
    if (n > 1e12) return Math.max(0, n / 1000 - nowMs / 1000) // epoch en milisegundos
    if (n > 1e9) return Math.max(0, n - nowMs / 1000) // epoch en segundos
    return n // segundos relativos
  }
  const date = isoDate(v)
  if (date !== null) return Math.max(0, (date - nowMs) / 1000)
  return null
}

/** «6m0s», «1.5s», «250ms», «2h», «1h30m» → segundos. */
export function durationSeconds(s: string): number | null {
  if (!s || s.endsWith('.')) return null
  let total = 0
  let number = ''
  let unit = ''
  let consumed = false
  const flush = (): boolean => {
    if (!number) return false
    const n = strictNumber(number)
    if (n === null) return false
    switch (unit) {
      case 'h':
        total += n * 3600
        break
      case 'm':
        total += n * 60
        break
      case 's':
        total += n
        break
      case 'ms':
        total += n / 1000
        break
      default:
        return false
    }
    number = ''
    unit = ''
    consumed = true
    return true
  }
  for (const ch of s) {
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      if (unit && !flush()) return null
      number += ch
    } else if (/\p{L}/u.test(ch)) {
      if (!number) return null
      unit += ch
    } else return null
  }
  if (!flush()) return null
  return consumed ? total : null
}

/** Fecha HTTP (RFC 1123, RFC 850 o asctime) en ms; `null` si no lo es. */
function httpDate(s: string): number | null {
  const rfc = /^[A-Za-z]{3,9},\s*\d{1,2}[ -][A-Za-z]{3}[ -]\d{2,4}\s+\d{1,2}:\d{2}:\d{2}\s*(?:[A-Za-z]{1,5}|[+-]\d{4})?$/
  const asctime = /^[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{1,2}:\d{2}:\d{2}\s+\d{4}$/
  if (rfc.test(s)) {
    const t = Date.parse(s)
    return Number.isNaN(t) ? null : t
  }
  if (asctime.test(s)) {
    const t = Date.parse(s + ' GMT')
    return Number.isNaN(t) ? null : t
  }
  return null
}

function isoDate(s: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}
