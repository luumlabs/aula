// Enteros con la semántica de `Int` (64 bits) de Swift: el motor exacto detecta los desbordamientos igual que la app Swift.

export const INT_MAX = (1n << 63n) - 1n
export const INT_MIN = -(1n << 63n)
export const UINT_MAX = (1n << 64n) - 1n

/** ¿Cabe en un `Int` de 64 bits? */
export function fitsInt(x: bigint): boolean {
  return x >= INT_MIN && x <= INT_MAX
}

/** Valor absoluto. */
export function absBig(x: bigint): bigint {
  return x < 0n ? -x : x
}

/** Máximo común divisor de los valores absolutos (Euclides). */
export function gcdBig(a: bigint, b: bigint): bigint {
  let x = absBig(a)
  let y = absBig(b)
  while (y !== 0n) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

/** Producto con detección de desbordamiento (`nil` en Swift). */
export function mulInt(a: bigint, b: bigint): bigint | null {
  const r = a * b
  return fitsInt(r) ? r : null
}

/** Suma con detección de desbordamiento. */
export function addInt(a: bigint, b: bigint): bigint | null {
  const r = a + b
  return fitsInt(r) ? r : null
}

/** Mínimo de dos `bigint`. */
export function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b
}

/** Entero de un `Double` entero y finito (el llamador garantiza que lo es). */
export function bigOf(x: number): bigint {
  return BigInt(Math.trunc(x))
}
