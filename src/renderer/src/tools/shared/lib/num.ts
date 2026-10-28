// Números de las herramientas: formato con el separador del idioma (coma en español), notación científica bonita y
// lectura tolerante de lo que escribe el estudiante («1,5», «2.5e-3», «3,2 × 10^-8», «3/4»). Puro: sin DOM ni i18n.

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '+': '⁺' }

/** «-12» → «⁻¹²». */
export function superscript(s: string): string {
  return Array.from(s)
    .map((c) => SUP[c] ?? c)
    .join('')
}

/** Signo menos tipográfico (U+2212). */
export function typographicMinus(s: string): string {
  return s.replace(/-/g, '−')
}

export interface NumberStyle {
  /** Coma decimal (español). */
  comma?: boolean
  /** Cifras significativas (por defecto 6). */
  sig?: number
  /** Decimales como máximo (por defecto 10). */
  maxDecimals?: number
  /** Agrupar miles («12 345»). Por defecto sí, solo a partir de 5 cifras. */
  group?: boolean
}

/** Decimales a mostrar para `sig` cifras significativas de |x|. */
function decimalsFor(x: number, sig: number, maxDecimals: number): number {
  const a = Math.abs(x)
  if (a === 0) return 0
  const mag = Math.floor(Math.log10(a))
  return Math.max(0, Math.min(maxDecimals, sig - 1 - mag))
}

/** Agrupa miles con un espacio fino (solo si la parte entera tiene 5 cifras o más, como en los libros). */
function groupThousands(int: string, group: boolean): string {
  if (!group || int.length < 5) return int
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** Partes de la notación científica: mantisa (texto con separador) y exponente. */
export function scientificParts(x: number, sig = 4, comma = false): { mantissa: string; exponent: number } {
  if (x === 0 || !Number.isFinite(x)) return { mantissa: '0', exponent: 0 }
  let exponent = Math.floor(Math.log10(Math.abs(x)))
  let m = x / Math.pow(10, exponent)
  // 9,9996 con 4 cifras redondea a 10,00: se corrige el exponente
  const rounded = Number(m.toFixed(Math.max(0, sig - 1)))
  if (Math.abs(rounded) >= 10) {
    exponent += 1
    m = x / Math.pow(10, exponent)
  }
  let mantissa = m.toFixed(Math.max(0, sig - 1))
  if (mantissa.includes('.')) mantissa = mantissa.replace(/0+$/, '').replace(/\.$/, '')
  if (comma) mantissa = mantissa.replace('.', ',')
  return { mantissa, exponent }
}

/** Signo de porcentaje tras una cifra ya formateada: « %» (espacio sin salto) con coma decimal (español), «%» si no. */
export const percentSign = (comma: boolean): string => (comma ? '\u00A0%' : '%')

/** Número limpio para la interfaz: «1 234,57», «0,000123» o «1,23 × 10⁻⁸» si es enorme o diminuto. */
export function formatNumber(x: number, style: NumberStyle = {}): string {
  if (Number.isNaN(x)) return '—'
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞'
  const sig = style.sig ?? 6
  const comma = style.comma ?? false
  const a = Math.abs(x)
  if (a !== 0 && (a >= 1e12 || a < 1e-5)) {
    const { mantissa, exponent } = scientificParts(x, Math.min(sig, 6), comma)
    return typographicMinus(mantissa) + ' × 10' + superscript(String(exponent))
  }
  const dec = decimalsFor(x, sig, style.maxDecimals ?? 10)
  let s = Math.abs(x).toFixed(dec)
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  const [int, frac] = s.split('.')
  const body = groupThousands(int, style.group ?? true) + (frac ? (comma ? ',' : '.') + frac : '')
  const negative = x < 0 && /[1-9]/.test(body)
  return (negative ? '−' : '') + body
}

/** Número con decimales fijos («3,50»). */
export function formatFixed(x: number, decimals: number, comma = false): string {
  if (!Number.isFinite(x)) return formatNumber(x)
  const s = x.toFixed(Math.max(0, decimals))
  return typographicMinus(comma ? s.replace('.', ',') : s)
}

/** El mismo número en LaTeX: «1{,}5», «1{,}23\times10^{-8}». */
export function texNumber(x: number, style: NumberStyle = {}): string {
  if (Number.isNaN(x)) return '\\text{—}'
  if (!Number.isFinite(x)) return x > 0 ? '\\infty' : '-\\infty'
  const sig = style.sig ?? 6
  const comma = style.comma ?? false
  const a = Math.abs(x)
  if (a !== 0 && (a >= 1e12 || a < 1e-5)) {
    const { mantissa, exponent } = scientificParts(x, Math.min(sig, 6), false)
    return `${comma ? mantissa.replace('.', '{,}') : mantissa}\\times10^{${exponent}}`
  }
  const plain = formatNumber(x, { ...style, group: false }).replace('−', '-')
  return comma ? plain.replace(',', '{,}') : plain
}

/** Cambia los puntos decimales de un LaTeX por la coma del español («3.5» → «3{,}5»). */
export function localizeTex(tex: string, comma: boolean): string {
  return comma ? tex.replace(/(\d)\.(\d)/g, '$1{,}$2') : tex
}

/**
 * Lee un número escrito a mano. Acepta coma o punto decimal («1,5» y «1.5»), miles («1.234,5», «1,234.5»), exponentes
 * («2e-3», «3,2 × 10^-8», «3.2·10⁻⁸»), fracciones («3/4», «-1/2») y el signo menos tipográfico. `null` si no lo es.
 */
export function parseNumber(raw: string): number | null {
  let s = raw.trim().replace(/[−–]/g, '-').replace(/\s+/g, '')
  if (!s) return null
  // superíndices («10⁻⁸») → «10^-8»
  const SUPERS: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' }
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (m) => '^' + Array.from(m).map((c) => SUPERS[c]).join(''))
  // fracción a/b
  const frac = /^([+-]?[\d.,]+)\/([\d.,]+)$/.exec(s)
  if (frac) {
    const n = parseNumber(frac[1])
    const d = parseNumber(frac[2])
    return n !== null && d !== null && d !== 0 ? n / d : null
  }
  // mantisa × 10^e
  const sci = /^([+-]?[\d.,]+)(?:[x×*·]10\^?([+-]?\d+)|[eE]([+-]?\d+))$/.exec(s)
  if (sci) {
    const m = parseDecimal(sci[1])
    const e = Number(sci[2] ?? sci[3])
    return m === null || !Number.isFinite(e) ? null : m * Math.pow(10, e)
  }
  const pow = /^10\^([+-]?\d+)$/.exec(s)
  if (pow) return Math.pow(10, Number(pow[1]))
  return parseDecimal(s)
}

/** Decimal con coma o punto, con o sin miles. */
function parseDecimal(s: string): number | null {
  if (!/^[+-]?(\d|[.,]\d)/.test(s) || !/^[+-]?[\d.,]+$/.test(s)) return null
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  let normalized: string
  if (lastDot >= 0 && lastComma >= 0) {
    // el último separador es el decimal; el otro, de miles
    const dec = lastDot > lastComma ? '.' : ','
    const thou = dec === '.' ? ',' : '.'
    normalized = s.split(thou).join('').replace(dec, '.')
  } else if (lastComma >= 0) {
    const parts = s.split(',')
    // «1,234,567» son miles; «1,5» o «12,25» es decimal
    normalized = parts.length > 2 && parts.slice(1).every((p) => p.length === 3) ? parts.join('') : parts.length === 2 ? s.replace(',', '.') : ''
  } else {
    const parts = s.split('.')
    normalized = parts.length > 2 ? (parts.slice(1).every((p) => p.length === 3) ? parts.join('') : '') : s
  }
  if (!normalized) return null
  const v = Number(normalized)
  return Number.isFinite(v) ? v : null
}

/** Redondea a `sig` cifras significativas (para comparar o mostrar valores calculados). */
export function roundSig(x: number, sig: number): number {
  if (x === 0 || !Number.isFinite(x)) return x
  const d = Math.ceil(Math.log10(Math.abs(x)))
  const p = Math.pow(10, sig - d)
  return Math.round(x * p) / p
}

/** Paso «bonito» de una escala (1, 2, 5 × 10ⁿ) para unas `target` divisiones en `span`. */
export function niceStep(span: number, target = 8): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1
  const raw = span / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / mag
  const f = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10
  return f * mag
}

/** Marcas de una escala entre `lo` y `hi` con el paso bonito. */
export function niceTicks(lo: number, hi: number, target = 8): number[] {
  const step = niceStep(hi - lo, target)
  const out: number[] = []
  const start = Math.ceil(lo / step) * step
  for (let v = start; v <= hi + step * 1e-9 && out.length < 200; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return out
}
