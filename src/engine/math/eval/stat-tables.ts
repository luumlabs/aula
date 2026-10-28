// Tablas de la estadística (sin dependencias: las usan el catálogo de funciones, el analizador y los evaluadores).

/** Funciones de estadística y su aridad (mínimo, máximo; `null` = sin límite). */
export const STAT_ARITIES: ReadonlyMap<string, readonly [number, number | null]> = new Map<string, readonly [number, number | null]>([
  ['sum', [1, null]], ['mean', [1, null]], ['median', [1, null]], ['mode', [1, null]],
  ['var', [1, null]], ['stdev', [1, null]], ['pvar', [1, null]], ['pstdev', [1, null]], // var(5): error claro al evaluar
  ['normalcdf', [2, 4]], ['normalpdf', [1, 3]], ['invnorm', [1, 3]], ['zscore', [3, 3]],
  ['binompdf', [3, 3]], ['binomcdf', [3, 3]], ['poissonpdf', [2, 2]], ['poissoncdf', [2, 2]],
  ['tcdf', [3, 3]], ['invt', [2, 2]], ['chi2cdf', [3, 3]], ['chi2pdf', [2, 2]],
])

/** Funciones que aceptan una lista de datos (`mean({1,2,3})`). */
export const LIST_FUNCTIONS: ReadonlySet<string> = new Set(['sum', 'mean', 'median', 'mode', 'var', 'stdev', 'pvar', 'pstdev', 'min', 'max'])

/** Funciones cuyo argumento k es un entero (para muestrear enteros al comparar expresiones). */
export const INTEGER_ARGUMENT_FUNCTIONS: ReadonlySet<string> = new Set(['binompdf', 'binomcdf', 'poissonpdf', 'poissoncdf'])

/** ¿Es una función de estadística? */
export function isStatistical(name: string): boolean {
  return STAT_ARITIES.has(name)
}
