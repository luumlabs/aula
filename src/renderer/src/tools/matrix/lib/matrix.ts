// Matrices exactas (puro): fracciones con bigint (sin desbordamiento), determinante, inversa, traspuesta, producto,
// suma y reducción de Gauss-Jordan (forma escalonada reducida) con cada operación elemental registrada para animarla.

const absB = (x: bigint) => (x < 0n ? -x : x)
const gcdB = (a: bigint, b: bigint): bigint => {
  a = absB(a)
  b = absB(b)
  while (b) [a, b] = [b, a % b]
  return a || 1n
}

/** Fracción exacta n/d (d > 0, irreducible). */
export class Q {
  readonly n: bigint
  readonly d: bigint
  private constructor(n: bigint, d: bigint) {
    this.n = n
    this.d = d
  }
  static of(n: bigint | number, d: bigint | number = 1n): Q {
    let nb = BigInt(n)
    let db = BigInt(d)
    if (db === 0n) throw new RangeError('denominador 0')
    if (db < 0n) {
      nb = -nb
      db = -db
    }
    const g = gcdB(nb, db)
    return new Q(nb / g, db / g)
  }
  static readonly ZERO = Q.of(0)
  static readonly ONE = Q.of(1)

  /** Lee «3», «-1/2», «0,25», «2.5», «−3/4». `null` si no es un número racional escrito. */
  static parse(raw: string): Q | null {
    const s = raw.trim().replace(/[−–]/g, '-').replace(',', '.')
    if (!s) return null
    const frac = /^([+-]?\d+(?:\.\d+)?)\s*\/\s*([+-]?\d+(?:\.\d+)?)$/.exec(s)
    if (frac) {
      const a = Q.parse(frac[1])
      const b = Q.parse(frac[2])
      return a && b && !b.isZero ? a.div(b) : null
    }
    const dec = /^([+-]?)(\d*)(?:\.(\d+))?$/.exec(s)
    if (!dec || (!dec[2] && !dec[3])) return null
    const sign = dec[1] === '-' ? -1n : 1n
    const int = BigInt(dec[2] || '0')
    const frc = dec[3] ?? ''
    const den = 10n ** BigInt(frc.length)
    return Q.of(sign * (int * den + BigInt(frc || '0')), den)
  }

  get isZero(): boolean {
    return this.n === 0n
  }
  get isInt(): boolean {
    return this.d === 1n
  }
  add(o: Q): Q {
    return Q.of(this.n * o.d + o.n * this.d, this.d * o.d)
  }
  sub(o: Q): Q {
    return Q.of(this.n * o.d - o.n * this.d, this.d * o.d)
  }
  mul(o: Q): Q {
    return Q.of(this.n * o.n, this.d * o.d)
  }
  div(o: Q): Q {
    if (o.isZero) throw new RangeError('división entre 0')
    return Q.of(this.n * o.d, this.d * o.n)
  }
  neg(): Q {
    return Q.of(-this.n, this.d)
  }
  eq(o: Q): boolean {
    return this.n === o.n && this.d === o.d
  }
  toNumber(): number {
    return Number(this.n) / Number(this.d)
  }
  /** «-3/4». */
  toString(): string {
    return this.d === 1n ? String(this.n) : `${this.n}/${this.d}`
  }
  /** «-\frac{3}{4}». */
  toTex(): string {
    if (this.d === 1n) return String(this.n)
    return `${this.n < 0n ? '-' : ''}\\frac{${absB(this.n)}}{${this.d}}`
  }
}

export type Matrix = Q[][]

export const rows = (m: Matrix) => m.length
export const cols = (m: Matrix) => (m[0] ? m[0].length : 0)
export const clone = (m: Matrix): Matrix => m.map((r) => [...r])

export function identity(n: number): Matrix {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? Q.ONE : Q.ZERO)))
}

export function transpose(m: Matrix): Matrix {
  return Array.from({ length: cols(m) }, (_, j) => m.map((r) => r[j]))
}

export function add(a: Matrix, b: Matrix, sign: 1 | -1 = 1): Matrix | null {
  if (rows(a) !== rows(b) || cols(a) !== cols(b)) return null
  return a.map((r, i) => r.map((x, j) => (sign === 1 ? x.add(b[i][j]) : x.sub(b[i][j]))))
}

export function multiply(a: Matrix, b: Matrix): Matrix | null {
  if (cols(a) !== rows(b)) return null
  return a.map((r) => Array.from({ length: cols(b) }, (_, j) => r.reduce((acc, x, k) => acc.add(x.mul(b[k][j])), Q.ZERO)))
}

/** Operación elemental de filas (índices desde 0). */
export type RowOp =
  | { type: 'swap'; i: number; j: number }
  | { type: 'scale'; i: number; k: Q }
  | { type: 'add'; i: number; j: number; k: Q }

export interface Step {
  op: RowOp
  /** Matriz después de la operación. */
  matrix: Matrix
  /** Pivote en el que se trabaja [fila, columna]. */
  pivot: [number, number]
}

function apply(m: Matrix, op: RowOp): Matrix {
  const out = clone(m)
  if (op.type === 'swap') [out[op.i], out[op.j]] = [out[op.j], out[op.i]]
  else if (op.type === 'scale') out[op.i] = out[op.i].map((x) => x.mul(op.k))
  else out[op.i] = out[op.i].map((x, c) => x.add(op.k.mul(out[op.j][c])))
  return out
}

/**
 * Gauss-Jordan hasta la forma escalonada reducida, registrando cada operación. `limitCols` limita las columnas donde se
 * buscan pivotes (para [A | I] o [A | b]).
 */
export function rref(m: Matrix, limitCols = cols(m)): { result: Matrix; steps: Step[]; pivots: [number, number][]; swaps: number; scale: Q } {
  let cur = clone(m)
  const steps: Step[] = []
  const pivots: [number, number][] = []
  let r = 0
  let swaps = 0
  // producto de los factores por los que se multiplicaron filas (para el determinante)
  let scale = Q.ONE
  for (let c = 0; c < limitCols && r < rows(cur); c++) {
    // pivote: la primera fila no nula desde r (preferimos un 1 si lo hay, para cuentas más limpias)
    let p = -1
    for (let i = r; i < rows(cur); i++) if (cur[i][c].eq(Q.ONE)) { p = i; break }
    if (p < 0) for (let i = r; i < rows(cur); i++) if (!cur[i][c].isZero) { p = i; break }
    if (p < 0) continue
    if (p !== r) {
      const op: RowOp = { type: 'swap', i: r, j: p }
      cur = apply(cur, op)
      swaps++
      steps.push({ op, matrix: cur, pivot: [r, c] })
    }
    const pv = cur[r][c]
    if (!pv.eq(Q.ONE)) {
      const k = Q.ONE.div(pv)
      const op: RowOp = { type: 'scale', i: r, k }
      cur = apply(cur, op)
      scale = scale.mul(k)
      steps.push({ op, matrix: cur, pivot: [r, c] })
    }
    for (let i = 0; i < rows(cur); i++) {
      if (i === r || cur[i][c].isZero) continue
      const op: RowOp = { type: 'add', i, j: r, k: cur[i][c].neg() }
      cur = apply(cur, op)
      steps.push({ op, matrix: cur, pivot: [r, c] })
    }
    pivots.push([r, c])
    r++
  }
  return { result: cur, steps, pivots, swaps, scale }
}

/** Determinante exacto (por eliminación). `null` si no es cuadrada. */
export function determinant(m: Matrix): Q | null {
  const n = rows(m)
  if (n === 0 || n !== cols(m)) return null
  const { result, swaps, scale } = rref(m)
  // si la escalonada no es la identidad, el determinante es 0
  for (let i = 0; i < n; i++) if (!result[i][i].eq(Q.ONE)) return Q.ZERO
  const det = Q.ONE.div(scale)
  return swaps % 2 ? det.neg() : det
}

/** Inversa por Gauss-Jordan sobre [A | I]; `null` si no es cuadrada o es singular. */
export function inverse(m: Matrix): { inverse: Matrix | null; steps: Step[]; augmented: Matrix } {
  const n = rows(m)
  if (n === 0 || n !== cols(m)) return { inverse: null, steps: [], augmented: m }
  const aug = m.map((r, i) => [...r, ...identity(n)[i]])
  const { result, steps } = rref(aug, n)
  for (let i = 0; i < n; i++) if (!result[i][i].eq(Q.ONE)) return { inverse: null, steps, augmented: aug }
  return { inverse: result.map((r) => r.slice(n)), steps, augmented: aug }
}

export function rank(m: Matrix): number {
  return rref(m).pivots.length
}

/** LaTeX de una matriz (bmatrix). */
export function matrixTex(m: Matrix, augmentAt?: number): string {
  if (augmentAt !== undefined && augmentAt > 0 && augmentAt < cols(m)) {
    const spec = 'c'.repeat(augmentAt) + '|' + 'c'.repeat(cols(m) - augmentAt)
    return `\\left[\\begin{array}{${spec}}${m.map((r) => r.map((x) => x.toTex()).join(' & ')).join(' \\\\ ')}\\end{array}\\right]`
  }
  return `\\begin{bmatrix}${m.map((r) => r.map((x) => x.toTex()).join(' & ')).join(' \\\\ ')}\\end{bmatrix}`
}

/** Texto de la operación: «R₂ → R₂ − 3R₁», «R₁ ↔ R₃», «R₂ → ½·R₂» (en LaTeX). */
export function opTex(op: RowOp): string {
  const R = (i: number) => `R_{${i + 1}}`
  if (op.type === 'swap') return `${R(op.i)} \\leftrightarrow ${R(op.j)}`
  if (op.type === 'scale') return `${R(op.i)} \\to ${op.k.toTex()}\\,${R(op.i)}`
  const neg = op.k.n < 0n
  const k = neg ? op.k.neg() : op.k
  const coef = k.eq(Q.ONE) ? '' : `${k.toTex()}\\,`
  return `${R(op.i)} \\to ${R(op.i)} ${neg ? '-' : '+'} ${coef}${R(op.j)}`
}
