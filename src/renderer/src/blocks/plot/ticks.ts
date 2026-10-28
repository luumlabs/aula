// Marcas de los ejes y números de las gráficas (port de PlotCompiler.swift): pasos «bonitos», múltiplos de π y el formato de
// los números con el separador del idioma del contenido. Lógica pura (se prueba aparte).

/** Paso «bonito» (1, 2, 5 × 10^k) para tener unas `target` marcas en `span`. */
export function niceStep(span: number, target: number): number {
  if (!(span > 0) || !(target > 0) || !Number.isFinite(span)) return 1
  const raw = span / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / mag
  const nice = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10
  return nice * mag
}

/** Múltiplos de `step` dentro de [a, b] (como mucho 400), redondeados para no arrastrar 0.30000000000000004. */
export function ticks(a: number, b: number, step: number): number[] {
  if (!(step > 0) || !(b > a) || !Number.isFinite(a) || !Number.isFinite(b)) return []
  const out: number[] = []
  let k = Math.ceil(a / step - 1e-9)
  while (k * step <= b + 1e-9 && out.length < 400) {
    const v = Math.round(k * step * 1e9) / 1e9
    out.push(Object.is(v, -0) ? 0 : v)
    k++
  }
  return out
}

/** Paso n·π/d de las marcas en múltiplos de π (π/12, π/6, π/4, π/2, π, 2π, 4π, 8π): sin tercios, que no casan con las asíntotas. */
export function piStep(span: number, target: number): { numerator: number; denominator: number } {
  const candidates: Array<[number, number]> = [[1, 12], [1, 6], [1, 4], [1, 2], [1, 1], [2, 1], [4, 1], [8, 1]]
  for (const [n, d] of candidates) if (span / ((n * Math.PI) / d) <= target) return { numerator: n, denominator: d }
  return { numerator: 8, denominator: 1 }
}

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b))

/** LaTeX de k·π/d simplificado: `\frac{3\pi}{2}`, `-\pi`, `0`. */
export function piLabel(k: number, d: number): string {
  if (k === 0) return '0'
  const g = gcd(k, d)
  const num = k / g
  const den = d / g
  const sign = num < 0 ? '-' : ''
  const a = Math.abs(num)
  const top = a === 1 ? '\\pi' : `${a}\\pi`
  return den === 1 ? `${sign}${top}` : `${sign}\\frac{${top}}{${den}}`
}

/** El mismo múltiplo de π en texto plano para el lienzo: «3π/2», «−π», «0». */
export function piText(k: number, d: number): string {
  if (k === 0) return '0'
  const g = gcd(k, d)
  const num = k / g
  const den = d / g
  const sign = num < 0 ? '−' : ''
  const a = Math.abs(num)
  const top = a === 1 ? 'π' : `${a}π`
  return den === 1 ? `${sign}${top}` : `${sign}${top}/${den}`
}

export interface Tick {
  value: number
  label: string
}

/** Marcas en múltiplos de π dentro de [lo, hi] para unas `target` marcas. */
export function piTicks(lo: number, hi: number, target: number): Tick[] {
  const st = piStep(hi - lo, Math.max(2, target))
  const step = (st.numerator * Math.PI) / st.denominator
  const k0 = Math.ceil(lo / step - 1e-9)
  const k1 = Math.floor(hi / step + 1e-9)
  if (!Number.isFinite(k0) || !Number.isFinite(k1) || k1 < k0 || k1 - k0 > 80) return []
  const out: Tick[] = []
  for (let k = k0; k <= k1; k++) out.push({ value: k * step, label: piText(k * st.numerator, st.denominator) })
  return out
}

/** Marcas numéricas: el paso propio si es razonable (como mucho 60 marcas) o uno automático. */
export function numberTicks(lo: number, hi: number, target: number, lang: string, step?: number): Tick[] {
  const span = hi - lo
  const s = step !== undefined && step > 0 && span / step <= 60 ? step : niceStep(span, Math.max(2, target))
  return ticks(lo, hi, s).map((v) => ({ value: v, label: formatNumber(v, lang) }))
}

const formatters = new Map<string, Intl.NumberFormat>()
function formatter(lang: string, digits: number): Intl.NumberFormat {
  const key = `${lang}|${digits}`
  let f = formatters.get(key)
  if (!f) {
    try {
      f = new Intl.NumberFormat(lang || 'en', { maximumFractionDigits: digits, useGrouping: true })
    } catch {
      f = new Intl.NumberFormat('en', { maximumFractionDigits: digits, useGrouping: true })
    }
    formatters.set(key, f)
  }
  return f
}

/**
 * Número de un eje, una lectura o un deslizador con el separador del idioma («0,5» en español) y el signo menos tipográfico.
 * Notación científica solo para |v| ≥ 10⁹ o < 10⁻⁶; en medio, los decimales justos (más si el número es pequeño).
 */
export function formatNumber(v: number, lang = 'es', maxDigits?: number): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? '—' : v > 0 ? '∞' : '−∞'
  const a = Math.abs(v)
  if (a < 1e-12) return '0'
  if (a >= 1e9 || a < 1e-6) {
    const [m, e] = v.toExponential(3).split('e')
    const mant = formatter(lang, 3).format(Number(m)).replace('-', '−')
    return `${mant}·10${superscript(Number(e))}`
  }
  const places = maxDigits ?? Math.min(12, Math.max(4, 3 - Math.floor(Math.log10(a))))
  return formatter(lang, places).format(v).replace('-', '−')
}

function superscript(n: number): string {
  const map: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }
  return String(n).split('').map((c) => map[c] ?? c).join('')
}

/**
 * Intervalo seguro para dibujar: finito, acotado a ±1e12 y con un ancho que no sea cero ni se pierda en el redondeo.
 */
export function sane(lo: number, hi: number, fallback: [number, number]): [number, number] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return fallback
  const limit = 1e12
  let a = Math.min(Math.max(lo, -limit), limit)
  let b = Math.min(Math.max(hi, -limit), limit)
  if (b <= a) b = a + 1
  const minSpan = Math.max(Math.abs(a), Math.abs(b)) * 1e-9
  if (b - a < minSpan) {
    const c = a / 2 + b / 2
    a = c - minSpan
    b = c + minSpan
  }
  return [a, b]
}
