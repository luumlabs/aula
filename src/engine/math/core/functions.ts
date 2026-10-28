import { STAT_ARITIES } from '../eval/stat-tables'
import { chars, compareStrings, editDistance, foldedLower } from './text'

/** Descripción de una función reconocida. */
export interface FunctionSpec {
  readonly name: string
  readonly minArgs: number
  /** `null` = número variable de argumentos. */
  readonly maxArgs: number | null
}

/** ¿La función admite `n` argumentos? */
export function specAccepts(s: FunctionSpec, n: number): boolean {
  return n >= s.minArgs && (s.maxArgs === null || n <= s.maxArgs)
}

/** ¿Admite más de un argumento? */
export function specAllowsMultipleArgs(s: FunctionSpec): boolean {
  return s.maxArgs === null || s.maxArgs > 1
}

const specs = new Map<string, FunctionSpec>()
function add(name: string, lo: number, hi: number | null): void {
  specs.set(name, { name, minArgs: lo, maxArgs: hi })
}
for (const n of [
  'sqrt', 'cbrt', 'abs', 'exp', 'ln', 'log2', 'log10',
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'asin', 'acos', 'atan', 'asec', 'acsc', 'acot',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'floor', 'ceil', 'trunc', 'sign', 'fact', 'rad', 'deg',
]) add(n, 1, 1)
add('log', 1, 2)
add('root', 2, 2)
add('atan2', 2, 2)
add('round', 1, 2)
add('min', 1, null)
add('max', 1, null)
add('gcd', 2, null)
add('lcm', 2, null)
add('nCr', 2, 2)
add('nPr', 2, 2)
add('mod', 2, 2)
add('pow', 2, 2)
// estadística (nombres de las calculadoras TI)
for (const [name, arity] of STAT_ARITIES) add(name, arity[0], arity[1])

const aliases = new Map<string, string>()
for (const name of specs.keys()) aliases.set(name.toLowerCase(), name)
const EXTRA_ALIASES: Record<string, string> = {
  // trigonometría (inglés y español)
  sen: 'sin', seno: 'sin', sine: 'sin',
  coseno: 'cos', cosine: 'cos',
  tg: 'tan', tang: 'tan', tangente: 'tan', tangent: 'tan',
  ctg: 'cot', cotg: 'cot', cotan: 'cot', cotangente: 'cot', cotangent: 'cot',
  secante: 'sec', secant: 'sec',
  cosec: 'csc', cosecante: 'csc', cosecant: 'csc',
  arcsin: 'asin', arcsen: 'asin', asen: 'asin', arcsine: 'asin', arcoseno: 'asin',
  arccos: 'acos', arcos: 'acos', arccosine: 'acos', arcocoseno: 'acos',
  arctan: 'atan', arctg: 'atan', atg: 'atan', arctang: 'atan', arcotangente: 'atan',
  arctan2: 'atan2', atan2: 'atan2',
  arcsec: 'asec', arccsc: 'acsc', arccosec: 'acsc',
  arccot: 'acot', arcctg: 'acot', arccotan: 'acot',
  senh: 'sinh', tgh: 'tanh',
  arcsinh: 'asinh', arccosh: 'acosh', arctanh: 'atanh',
  // raíces y otras
  raiz: 'sqrt', squareroot: 'sqrt', cuberoot: 'cbrt',
  ceiling: 'ceil', truncate: 'trunc', sgn: 'sign', signum: 'sign',
  // nombres en español (solo como palabra completa o seguidos de paréntesis)
  techo: 'ceil', suelo: 'floor', signo: 'sign', maximo: 'max', minimo: 'min',
  redondeo: 'round', redondear: 'round', truncar: 'trunc',
  factorial: 'fact',
  ncr: 'nCr', binom: 'nCr', choose: 'nCr', comb: 'nCr',
  npr: 'nPr', perm: 'nPr',
  mcd: 'gcd', gcf: 'gcd', mcm: 'lcm',
  ln: 'ln', lg: 'log10',
  // estadística (español, inglés, hojas de cálculo)
  average: 'mean', media: 'mean', promedio: 'mean', mediana: 'median', moda: 'mode',
  variance: 'var', varianza: 'var', stddev: 'stdev', desvest: 'stdev',
  varp: 'pvar', pvariance: 'pvar', stdevp: 'pstdev', pstddev: 'pstdev', desvestp: 'pstdev',
  suma: 'sum', norminv: 'invnorm', invnormal: 'invnorm', qnorm: 'invnorm',
  normpdf: 'normalpdf', dnorm: 'normalpdf', tinv: 'invt', chisqcdf: 'chi2cdf', chisqpdf: 'chi2pdf',
}
for (const [k, v] of Object.entries(EXTRA_ALIASES)) aliases.set(k, v)

const popular = ['sin', 'cos', 'tan', 'ln', 'log', 'sqrt', 'exp', 'abs', 'sec', 'csc', 'cot',
  'asin', 'acos', 'atan', 'floor', 'ceil', 'round', 'min', 'max', 'sign']

const suggestionPool: string[] = (() => {
  const names = new Set<string>(specs.keys())
  for (const n of ['sen', 'tg', 'ln', 'raiz', 'arcsin', 'arccos', 'arctan']) names.add(n)
  return [...names].filter((n) => n.length >= 2).sort(compareStrings)
})()

/** Catálogo de funciones: nombres canónicos, aridad y alias (inglés / español). */
export const FunctionTable = {
  specs: specs as ReadonlyMap<string, FunctionSpec>,

  /** Nombres de función que llevan cifras (el analizador los lee como una sola palabra): `chi2cdf(…)`. */
  digitNames: new Set(['chi2cdf', 'chi2pdf']) as ReadonlySet<string>,

  /** Alias en minúsculas y sin acentos → nombre canónico. */
  aliases: aliases as ReadonlyMap<string, string>,

  /** Nombres ordenados de mayor a menor longitud (para el corte voraz de palabras pegadas). */
  namesLongestFirst: [...aliases.keys()].sort((a, b) => (a.length !== b.length ? b.length - a.length : compareStrings(a, b))) as readonly string[],

  /** Nombre canónico de una palabra (sin distinguir mayúsculas ni acentos). */
  canonical(word: string): string | undefined {
    return aliases.get(foldedLower(word))
  },

  /**
   * Funciones que pueden ir «pegadas» a otras letras (`sinx`, `lnx`, `sqrtx`); el resto (`rad`, `max`, `abs`…) solo se
   * reconocen si son la palabra completa o van directamente seguidas de `(`, para no romper productos de variables.
   */
  glueable: new Set([
    'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan', 'asec', 'acsc', 'acot',
    'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'ln', 'log', 'sqrt', 'cbrt', 'exp',
  ]) as ReadonlySet<string>,

  /** Funciones que aceptan la notación `f^-1` como función inversa. */
  invertible: new Map([
    ['sin', 'asin'], ['cos', 'acos'], ['tan', 'atan'], ['sec', 'asec'], ['csc', 'acsc'], ['cot', 'acot'],
    ['sinh', 'asinh'], ['cosh', 'acosh'], ['tanh', 'atanh'],
  ]) as ReadonlyMap<string, string>,

  /** Funciones cuyo argumento sin paréntesis es «ajustado» (solo el siguiente factor con su potencia): `sqrt 2 x` = √2·x. */
  tightArgument: new Set(['sqrt', 'cbrt']) as ReadonlySet<string>,

  /** Sugerencia por cercanía de escritura (`sinn` → `sin`), o `undefined`. */
  suggestion(word: string): string | undefined {
    const w = chars(foldedLower(word))
    const limit = w.length >= 6 ? 2 : 1
    let best: { name: string; distance: number; rank: number } | undefined
    for (const cand of suggestionPool) {
      if (Math.abs(cand.length - w.length) > limit) continue
      const d = editDistance(w, chars(foldedLower(cand)), limit)
      if (d > limit) continue
      const idx = popular.indexOf(cand)
      const rank = idx >= 0 ? idx : popular.length
      if (best) {
        if (d < best.distance || (d === best.distance && rank < best.rank)) best = { name: cand, distance: d, rank }
      } else {
        best = { name: cand, distance: d, rank }
      }
    }
    return best?.name
  },
}
