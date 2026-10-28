// Cómo se escriben los números que ve el estudiante (separador decimal), compartido por todos los módulos (port de
// BaseKit/NumberStyle.swift). Solo para textos visibles: nunca para LaTeX, datos guardados ni textos para la IA.

let forcedComma: boolean | null = null
let localeOverride: string | null = null

/** Separador decimal del idioma/región (`Intl`). */
function localeUsesComma(locale?: string): boolean {
  try {
    const parts = new Intl.NumberFormat(locale ?? undefined).formatToParts(1.5)
    return parts.find((p) => p.type === 'decimal')?.value === ','
  } catch {
    return false
  }
}

/** Redondeo al más cercano con los empates lejos de cero (como `.rounded()` de Swift). */
function roundHalfAway(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x))
}

export const NumberStyle = {
  /** `true` si el separador decimal visible es la coma. */
  get decimalComma(): boolean {
    return forcedComma ?? localeUsesComma(localeOverride ?? undefined)
  },
  /** Separador decimal visible («,» o «.»). */
  get decimalSeparator(): string {
    return NumberStyle.decimalComma ? ',' : '.'
  },
  /** `true` si la app fuerza un separador (ajuste «comma» o «point»). */
  get isForced(): boolean {
    return forcedComma !== null
  },
  /** Ajuste de la app: "comma", "point" o cualquier otro valor (automático: el de la región). */
  apply(setting: string): void {
    forcedComma = setting === 'comma' ? true : setting === 'point' ? false : null
  },
  /** Región que usa el modo automático (por defecto, la del sistema). */
  setLocale(locale: string | null): void {
    localeOverride = locale
  },
  /**
   * Número con hasta `maxFractionDigits` decimales, sin ceros sobrantes ni separador de miles y con el separador visible:
   * `decimal(1.5)` → «1,5» o «1.5»; `decimal(2.0)` → «2»; `decimal(12.04)` → «12».
   */
  decimal(x: number, maxFractionDigits = 1): string {
    if (!Number.isFinite(x)) return Number.isNaN(x) ? '—' : x > 0 ? '∞' : '−∞'
    const digits = Math.min(Math.max(0, Math.trunc(maxFractionDigits)), 15)
    const scale = 10 ** digits
    let rounded = roundHalfAway(x * scale) / scale
    if (rounded === 0) rounded = 0 // sin «-0»
    let text = rounded.toFixed(digits)
    if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '')
    return NumberStyle.decimalComma ? text.replace('.', ',') : text
  },
  /** Convierte el separador decimal de un número ya escrito con punto («3.14» → «3,14» si toca). Solo para mostrar. */
  localize(plain: string): string {
    return NumberStyle.decimalComma ? plain.replace(/\./g, ',') : plain
  }
}
