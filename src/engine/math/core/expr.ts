import { Fraction } from '../numbers/fraction'
import { INTEGER_ARGUMENT_FUNCTIONS } from '../eval/stat-tables'
import { StackGuard } from './stack-guard'
import type { BinaryOp, MathConstant, UnaryOp } from './types'

/**
 * Árbol de una expresión matemática.
 *
 * - `number`: racional exacto (`3`, `0.75` = `3/4`).
 * - `real`: número real aproximado (p. ej. un literal que no cabe en `Fraction`).
 * - `variable`: nombre de variable (`x`, `θ`, `v_0`).
 * - `constant`: `pi`, `e`, `tau`, `inf`.
 * - `unary` / `binary`: operadores.
 * - `call`: llamada a función con nombre canónico (`sin`, `sqrt`, `log`…) y argumentos.
 */
export type Expr =
  | { readonly type: 'number'; readonly value: Fraction }
  | { readonly type: 'real'; readonly value: number }
  | { readonly type: 'variable'; readonly name: string }
  | { readonly type: 'constant'; readonly name: MathConstant }
  | { readonly type: 'unary'; readonly op: UnaryOp; readonly arg: Expr }
  | { readonly type: 'binary'; readonly op: BinaryOp; readonly left: Expr; readonly right: Expr }
  | { readonly type: 'call'; readonly name: string; readonly args: readonly Expr[] }

// MARK: - Constructores de comodidad

/** Constructores de `Expr`. */
export const E = {
  num(f: Fraction): Expr {
    return { type: 'number', value: f }
  },
  /** Entero exacto. */
  int(n: number | bigint): Expr {
    return { type: 'number', value: Fraction.int(n) }
  },
  real(d: number): Expr {
    return { type: 'real', value: d }
  },
  variable(name: string): Expr {
    return { type: 'variable', name }
  },
  constant(name: MathConstant): Expr {
    return { type: 'constant', name }
  },
  unary(op: UnaryOp, arg: Expr): Expr {
    return { type: 'unary', op, arg }
  },
  binary(op: BinaryOp, left: Expr, right: Expr): Expr {
    return { type: 'binary', op, left, right }
  },
  call(name: string, args: readonly Expr[]): Expr {
    return { type: 'call', name, args }
  },
  add(a: Expr, b: Expr): Expr {
    return E.binary('add', a, b)
  },
  sub(a: Expr, b: Expr): Expr {
    return E.binary('sub', a, b)
  },
  mul(a: Expr, b: Expr): Expr {
    return E.binary('mul', a, b)
  },
  div(a: Expr, b: Expr): Expr {
    return E.binary('div', a, b)
  },
  pow(a: Expr, b: Expr): Expr {
    return E.binary('pow', a, b)
  },
  neg(a: Expr): Expr {
    return E.unary('neg', a)
  },
  fn(name: string, ...args: Expr[]): Expr {
    return E.call(name, args)
  },
  get zero(): Expr {
    return ZERO
  },
  get one(): Expr {
    return ONE
  },
} as const

const ZERO: Expr = { type: 'number', value: Fraction.ZERO }
const ONE: Expr = { type: 'number', value: Fraction.ONE }

// MARK: - Consultas estructurales (iterativas: seguras con árboles muy profundos)

/** Hijos directos del nodo. */
export function children(e: Expr): readonly Expr[] {
  switch (e.type) {
    case 'unary':
      return [e.arg]
    case 'binary':
      return [e.left, e.right]
    case 'call':
      return e.args
    default:
      return []
  }
}

/** Variables libres (no incluye constantes como `pi` o `e`). */
export function freeVariables(e: Expr): Set<string> {
  const result = new Set<string>()
  const stack: Expr[] = [e]
  while (stack.length > 0) {
    const node = stack.pop() as Expr
    if (node.type === 'variable') result.add(node.name)
    stack.push(...children(node))
  }
  return result
}

/** Número de nodos del árbol. */
export function nodeCount(e: Expr): number {
  let count = 0
  const stack: Expr[] = [e]
  while (stack.length > 0) {
    const node = stack.pop() as Expr
    count += 1
    stack.push(...children(node))
  }
  return count
}

/** Profundidad máxima del árbol (una hoja = 1). */
export function treeDepth(e: Expr): number {
  let best = 0
  const stack: Array<[Expr, number]> = [[e, 1]]
  while (stack.length > 0) {
    const [node, d] = stack.pop() as [Expr, number]
    if (d > best) best = d
    for (const c of children(node)) stack.push([c, d + 1])
  }
  return best
}

/** Nombres de todas las funciones usadas (canónicos). */
export function functionNames(e: Expr): Set<string> {
  const result = new Set<string>()
  const stack: Expr[] = [e]
  while (stack.length > 0) {
    const node = stack.pop() as Expr
    if (node.type === 'call') result.add(node.name)
    stack.push(...children(node))
  }
  return result
}

/** ¿Aparece algún nodo que cumpla el predicado? */
export function containsNode(e: Expr, predicate: (node: Expr) => boolean): boolean {
  const stack: Expr[] = [e]
  while (stack.length > 0) {
    const node = stack.pop() as Expr
    if (predicate(node)) return true
    stack.push(...children(node))
  }
  return false
}

/** `true` si no tiene variables libres. */
export function isConstantExpr(e: Expr): boolean {
  return !containsNode(e, (n) => n.type === 'variable')
}

const INTEGER_ONLY = new Set(['fact', 'nCr', 'nPr', 'gcd', 'lcm'])

/** ¿Usa funciones que solo tienen sentido con enteros (factorial, combinatoria, mcd…)? */
export function usesIntegerOnlyFunctions(e: Expr): boolean {
  return containsNode(e, (n) => {
    if (n.type === 'unary' && n.op === 'factorial') return true
    if (n.type === 'call') return INTEGER_ONLY.has(n.name) || INTEGER_ARGUMENT_FUNCTIONS.has(n.name)
    return false
  })
}

/** Reemplaza todas las apariciones de una variable por otra expresión. */
export function substitute(e: Expr, name: string, replacement: Expr): Expr {
  return substituteAt(e, name, replacement, 0)
}

function substituteAt(e: Expr, name: string, replacement: Expr, depth: number): Expr {
  if (StackGuard.exhausted(depth)) return e
  switch (e.type) {
    case 'number':
    case 'real':
    case 'constant':
      return e
    case 'variable':
      return e.name === name ? replacement : e
    case 'unary':
      return E.unary(e.op, substituteAt(e.arg, name, replacement, depth + 1))
    case 'binary':
      return E.binary(e.op, substituteAt(e.left, name, replacement, depth + 1), substituteAt(e.right, name, replacement, depth + 1))
    case 'call':
      return E.call(e.name, e.args.map((a) => substituteAt(a, name, replacement, depth + 1)))
  }
}

// MARK: - Igualdad y clave (como `Hashable` en Swift)

/** Igualdad estructural (los reales se comparan con `==`: 0 = −0, NaN ≠ NaN). */
export function exprEquals(a: Expr, b: Expr): boolean {
  if (a === b) return true
  const stack: Array<[Expr, Expr]> = [[a, b]]
  while (stack.length > 0) {
    const [x, y] = stack.pop() as [Expr, Expr]
    if (x === y) continue
    if (x.type !== y.type) return false
    switch (x.type) {
      case 'number':
        if (!x.value.equals((y as typeof x).value)) return false
        break
      case 'real':
        if (x.value !== (y as typeof x).value) return false
        break
      case 'variable':
      case 'constant':
        if (x.name !== (y as typeof x).name) return false
        break
      case 'unary': {
        const yy = y as typeof x
        if (x.op !== yy.op) return false
        stack.push([x.arg, yy.arg])
        break
      }
      case 'binary': {
        const yy = y as typeof x
        if (x.op !== yy.op) return false
        stack.push([x.left, yy.left], [x.right, yy.right])
        break
      }
      case 'call': {
        const yy = y as typeof x
        if (x.name !== yy.name || x.args.length !== yy.args.length) return false
        for (let i = 0; i < x.args.length; i++) stack.push([x.args[i], yy.args[i]])
        break
      }
    }
  }
  return true
}

/** Clave textual única de la estructura (para usar expresiones como claves de `Map`/`Set`). */
export function exprKey(e: Expr): string {
  const parts: string[] = []
  const stack: Array<Expr | string> = [e]
  while (stack.length > 0) {
    const item = stack.pop() as Expr | string
    if (typeof item === 'string') {
      parts.push(item)
      continue
    }
    switch (item.type) {
      case 'number':
        parts.push(`n${item.value.key};`)
        break
      case 'real':
        parts.push(`r${item.value === 0 ? '0' : String(item.value)};`)
        break
      case 'variable':
        parts.push(`v${item.name.length}:${item.name};`)
        break
      case 'constant':
        parts.push(`k${item.name};`)
        break
      case 'unary':
        parts.push(`u${item.op}(`)
        stack.push(')', item.arg)
        break
      case 'binary':
        parts.push(`b${item.op}(`)
        stack.push(')', item.right, ',', item.left)
        break
      case 'call': {
        parts.push(`c${item.name.length}:${item.name}(`)
        stack.push(')')
        for (let i = item.args.length - 1; i >= 0; i--) {
          stack.push(item.args[i])
          if (i > 0) stack.push(',')
        }
        break
      }
    }
  }
  return parts.join('')
}
