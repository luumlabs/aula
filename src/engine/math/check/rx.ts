// Utilidades de expresiones regulares y de coma flotante para los verificadores (equivalen al `Rx` de Swift).

/** ¿Hay alguna coincidencia? (la expresión no debe llevar la bandera `g`). */
export function rxMatches(re: RegExp, s: string): boolean {
  return re.test(s)
}

/** Primera coincidencia con sus grupos de captura (los que no participan quedan como `""`), o `null`. */
export function rxGroups(re: RegExp, s: string): string[] | null {
  const m = re.exec(s)
  if (!m) return null
  return Array.from(m, (g) => g ?? '')
}

/** Sustituye todas las coincidencias (la expresión debe llevar la bandera `g`). */
export function rxReplace(re: RegExp, s: string, replacement: string): string {
  return s.replace(re, replacement)
}

const F64 = new Float64Array(1)
const U64 = new BigUint64Array(F64.buffer)

/** `Double.ulp` de Swift: distancia de |x| al siguiente `Double` de mayor magnitud (NaN si no es finito). */
export function ulp(x: number): number {
  if (!Number.isFinite(x)) return NaN
  F64[0] = Math.abs(x)
  const exponent = Number((U64[0] >> 52n) & 0x7ffn)
  if (exponent === 0) return 5e-324 // subnormales y el cero
  return 2 ** (exponent - 1075)
}
