// Utilidades internas de LearnKit: acotado numérico, redondeo como Swift y formato de números y textos (es / en).

/** Idiomas en los que el motor escribe sus frases (el resto de la interfaz va con i18n). */
export type Lang = 'es' | 'en'

/** Opciones de texto: idioma y separador decimal visible (por defecto, coma en español y punto en inglés). */
export interface TextOptions {
  lang?: Lang
  decimalSeparator?: ',' | '.'
}

export function resolveText(o?: TextOptions): { lang: Lang; comma: boolean } {
  const lang = o?.lang === 'en' ? 'en' : 'es'
  const comma = o?.decimalSeparator ? o.decimalSeparator === ',' : lang === 'es'
  return { lang, comma }
}

/** Entero máximo representable sin pérdida (hace de `Int.max` de Swift). */
export const INT_MAX = Number.MAX_SAFE_INTEGER
export const INT_MIN = Number.MIN_SAFE_INTEGER

/** Acota `x` a [lo, hi]; NaN → lo (igual que la versión Swift). */
export function clamp(x: number, lo: number, hi: number): number {
  if (Number.isNaN(x)) return lo
  return Math.min(Math.max(x, lo), hi)
}

/** `x` si es finito; si no, `fallback`. */
export function finiteOr(x: number, fallback: number): number {
  return Number.isFinite(x) ? x : fallback
}

/** Suma 1 sin desbordar. */
export function incremented(n: number): number {
  return n < INT_MAX ? n + 1 : n
}

/** `Double.rounded()` de Swift: al más cercano, los empates lejos de cero (2,5 → 3; −2,5 → −3). */
export function roundHalfAway(x: number): number {
  if (!Number.isFinite(x)) return x
  return x < 0 ? -Math.round(-x) : Math.round(x)
}

/** `Int(x)` de Swift sobre un valor ya acotado: trunca hacia cero. */
export function truncInt(x: number): number {
  return Math.trunc(x)
}

/** Número con hasta `maxFractionDigits` decimales, sin ceros sobrantes: 1.5 → «1,5»; 2.0 → «2»; 12.04 → «12». */
export function decimal(x: number, maxFractionDigits = 1, comma = true): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? '—' : x > 0 ? '∞' : '−∞'
  const digits = Math.min(Math.max(0, maxFractionDigits), 15)
  const scale = 10 ** digits
  let rounded = roundHalfAway(x * scale) / scale
  if (rounded === 0) rounded = 0
  let text = rounded.toFixed(digits)
  if (text.includes('.')) {
    text = text.replace(/0+$/, '')
    if (text.endsWith('.')) text = text.slice(0, -1)
  }
  return comma ? text.replace('.', ',') : text
}

/** Une elementos con la conjunción del idioma: [«A», «B»] → «A y B» / «A and B». */
export function listJoin(items: readonly string[], lang: Lang = 'es'): string {
  try {
    return new Intl.ListFormat(lang, { type: 'conjunction' }).format(items)
  } catch {
    if (items.length <= 1) return items.join('')
    const and = lang === 'en' ? ' and ' : ' y '
    return items.slice(0, -1).join(', ') + and + items[items.length - 1]
  }
}

/** Ayudas de formato en español (las mismas que `Spanish` en Swift). */
export const Spanish = {
  /** «1 día» / «3 días». */
  plural(n: number, one: string, many: string): string {
    return n === 1 ? `${n} ${one}` : `${n} ${many}`
  },
  /** Con a lo sumo un decimal y coma: 1.0 → «1», 1.5 → «1,5», 12.04 → «12». */
  oneDecimal(x: number): string {
    if (!Number.isFinite(x)) return '0'
    const tenths = Math.trunc(roundHalfAway(x * 10))
    const whole = Math.trunc(tenths / 10)
    const frac = Math.abs(tenths % 10)
    return frac === 0 ? `${whole}` : `${whole},${frac}`
  },
  /** Porcentaje entero para mostrar: 0.354 → «35 %». Acota a 0…100. */
  percent(x: number): string {
    return `${Spanish.percentValue(x)} %`
  },
  percentValue(x: number): number {
    return Math.trunc(roundHalfAway(clamp(finiteOr(x, 0), 0, 1) * 100))
  },
  /** Puntos con el redondeo adecuado: 12.3 → «12», 7.5 → «7,5», 0.04 → «0». */
  points(x: number): string {
    if (!Number.isFinite(x)) return '0'
    const v = Math.abs(x) >= 10 ? roundHalfAway(x) : roundHalfAway(x * 10) / 10
    return Spanish.oneDecimal(v)
  }
}

/** Compara textos como `<` de Swift sobre `String` (para identificadores: orden por unidades de código). */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
