// Motor de las simulaciones `simulation` (port de StudyEngine/Content/SimulationEngine.swift): compila las expresiones una vez
// (nombres de varias letras: v0, theta, Vmax) y calcula, para unos valores de los deslizadores y un instante, las magnitudes
// derivadas y los objetos que se dibujan. Lógica pura: la usan la interfaz (en cada fotograma), el validador y las pruebas.
import { MathError } from '@engine/math/core/types'
import { freeVariables, type Expr } from '@engine/math/core/expr'
import { MathParser } from '@engine/math/parse/parser'
import { tryEvaluateDouble } from '@engine/math/eval/evaluate'
import { hasOwnKey, ownValue, setOwn, SIM_OBJECT_KINDS, simObjectExpressions, type SimulationBlock } from '@shared/schema'

/** Un objeto ya calculado para dibujar. */
export type ResolvedSimObject =
  | { kind: 'point'; x: number; y: number; label?: string; color?: string }
  | { kind: 'segment'; x1: number; y1: number; x2: number; y2: number; color?: string; dashed: boolean; arrow: boolean; label?: string }
  | { kind: 'polyline'; points: number[][]; color?: string; dashed: boolean }
  | { kind: 'label'; x: number; y: number; text: string; color?: string }

export interface SimulationProblem { path: string; message: string; isError: boolean }

const RESERVED = new Set(['x', 'e', 'pi', 'inf', 'i'])

export class SimulationEngine {
  /** Opciones del analizador: palabras completas como variables (`v0` es una variable, no v·0). */
  static readonly parseOptions = { wordVariables: true }
  private readonly cache = new Map<string, Expr>()
  private readonly failures = new Map<string, string>()

  constructor(readonly block: SimulationBlock) {}

  /** Nombre canónico de una variable (theta → θ), el mismo que da el analizador. */
  static key(name: string): string {
    return MathParser.canonicalVariableName(name)
  }

  /** Expresión compilada o el error del analizador. */
  compile(text: string): { ok: true; expr: Expr } | { ok: false; message: string } {
    const hit = this.cache.get(text)
    if (hit) return { ok: true, expr: hit }
    const failed = this.failures.get(text)
    if (failed !== undefined) return { ok: false, message: failed }
    try {
      const e = MathParser.parse(text, SimulationEngine.parseOptions)
      this.cache.set(text, e)
      return { ok: true, expr: e }
    } catch (err) {
      const message = err instanceof MathError ? err.message : 'no se pudo interpretar'
      this.failures.set(text, message)
      return { ok: false, message }
    }
  }

  /** Valor de una expresión con unas variables (undefined si no se puede calcular o no es finito). */
  value(text: string | undefined, env: Readonly<Record<string, number>>): number | undefined {
    if (text === undefined || text.trim() === '') return undefined
    const c = this.compile(text)
    if (!c.ok) return undefined
    const v = tryEvaluateDouble(c.expr, env)
    return v !== null && Number.isFinite(v) ? v : undefined
  }

  /** Variables libres de una expresión (nombres canónicos). */
  freeVariables(text: string): Set<string> | undefined {
    const c = this.compile(text)
    return c.ok ? freeVariables(c.expr) : undefined
  }

  /** Valores iniciales de los deslizadores. */
  get initialParams(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const p of this.block.params) if (!hasOwnKey(out, p.name)) setOwn(out, p.name, p.value)
    return out
  }

  /** Entorno completo (claves canónicas): parámetros, constantes, reloj y magnitudes derivadas (en orden). */
  environment(params: Readonly<Record<string, number>>, time: number | undefined): Record<string, number> {
    const env = Object.create(null) as Record<string, number>
    for (const c of this.block.constants) if (Number.isFinite(c.value)) env[SimulationEngine.key(c.name)] = c.value
    for (const p of this.block.params) env[SimulationEngine.key(p.name)] = ownValue(params, p.name) ?? p.value
    const tm = this.block.time
    if (tm) env[SimulationEngine.key(tm.name)] = time ?? this.value(tm.min, env) ?? 0
    for (const d of this.block.derived) { const v = this.value(d.expr, env); if (v !== undefined) env[SimulationEngine.key(d.name)] = v }
    return env
  }

  /** Intervalo del reloj con estos parámetros (los extremos pueden depender de ellos: el tiempo de vuelo). */
  timeBounds(params: Readonly<Record<string, number>>): [number, number] | undefined {
    const tm = this.block.time
    if (!tm) return undefined
    const env = this.environment(params, undefined)
    const lo = this.value(tm.min, env) ?? 0
    const hi = this.value(tm.max, env) ?? lo + 10
    if (!(hi > lo) || !(hi - lo < 1e7)) return [lo, lo + 1]
    return [lo, hi]
  }

  /** Muestras de una curva (como mucho 240; se salta lo que no se puede calcular). */
  sample(fx: string | undefined, fy: string | undefined, variable: string, from: number, to: number, env: Readonly<Record<string, number>>, samples = 160): number[][] {
    if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from)) return []
    const n = Math.max(8, Math.min(240, samples))
    const k = SimulationEngine.key(variable)
    const out: number[][] = []
    for (let i = 0; i <= n; i++) {
      const e = { ...env, [k]: from + ((to - from) * i) / n }
      const x = this.value(fx, e), y = this.value(fy, e)
      if (x !== undefined && y !== undefined) out.push([x, y])
    }
    return out
  }

  /** Lo que se dibuja en este instante. */
  resolve(params: Readonly<Record<string, number>>, time: number | undefined): ResolvedSimObject[] {
    const env = this.environment(params, time)
    const out: ResolvedSimObject[] = []
    const opt = <T extends object>(o: T): T => { for (const k of Object.keys(o) as Array<keyof T>) if (o[k] === undefined) delete o[k]; return o }
    for (const o of this.block.objects) {
      switch (o.kind) {
        case 'point': {
          const x = this.value(o.x, env), y = this.value(o.y, env)
          if (x === undefined || y === undefined) continue
          const tm = this.block.time
          if (o.trail && tm && time !== undefined) {
            const t0 = this.value(tm.min, env)
            if (t0 !== undefined && time > t0) {
              const trail = this.sample(o.x, o.y, tm.name, t0, time, env, 120)
              if (trail.length >= 2) out.push(opt({ kind: 'polyline' as const, points: trail, color: o.color, dashed: false }))
            }
          }
          out.push(opt({ kind: 'point' as const, x, y, label: o.text, color: o.color }))
          break
        }
        case 'vector': {
          const x = this.value(o.x, env), y = this.value(o.y, env), dx = this.value(o.dx, env), dy = this.value(o.dy, env)
          if (x === undefined || y === undefined || dx === undefined || dy === undefined) continue
          out.push(opt({ kind: 'segment' as const, x1: x, y1: y, x2: x + dx, y2: y + dy, color: o.color, dashed: o.dashed, arrow: true, label: o.text }))
          break
        }
        case 'segment': {
          const x1 = this.value(o.x1, env), y1 = this.value(o.y1, env), x2 = this.value(o.x2, env), y2 = this.value(o.y2, env)
          if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) continue
          out.push(opt({ kind: 'segment' as const, x1, y1, x2, y2, color: o.color, dashed: o.dashed, arrow: false, label: o.text }))
          break
        }
        case 'path': {
          const a = this.value(o.from ?? '0', env), b = this.value(o.to ?? '1', env)
          if (a === undefined || b === undefined) continue
          const pts = this.sample(o.x, o.y, o.variable ?? 's', Math.min(a, b), Math.max(a, b), env)
          if (pts.length >= 2) out.push(opt({ kind: 'polyline' as const, points: pts, color: o.color, dashed: o.dashed }))
          break
        }
        case 'function': {
          const a = this.value(o.from ?? '0', env), b = this.value(o.to ?? '1', env)
          if (a === undefined || b === undefined) continue
          const pts = this.sample('x', o.y, 'x', Math.min(a, b), Math.max(a, b), env)
          if (pts.length >= 2) out.push(opt({ kind: 'polyline' as const, points: pts, color: o.color, dashed: o.dashed }))
          break
        }
        case 'label': {
          const x = this.value(o.x, env), y = this.value(o.y, env)
          if (x === undefined || y === undefined || o.text === undefined) continue
          out.push(opt({ kind: 'label' as const, x, y, text: o.text, color: o.color }))
          break
        }
        default: continue
      }
    }
    return out
  }

  /** Texto de una magnitud con sus decimales (`decimalSeparator` del idioma de la interfaz). */
  static format(v: number, decimals?: number, decimalSeparator: '.' | ',' = '.'): string {
    if (!Number.isFinite(v)) return '—'
    const sep = (s: string): string => (decimalSeparator === '.' ? s : s.replace('.', decimalSeparator))
    if (decimals !== undefined) return sep(v.toFixed(Math.max(0, Math.min(8, Math.trunc(decimals)))))
    if (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0)) {
      const [m, e] = v.toExponential(2).split('e')
      const n = Number(e)
      return sep(m.replace(/\.?0+$/, '')) + `e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`
    }
    let t = v.toFixed(3)
    while (t.includes('.') && t.endsWith('0')) t = t.slice(0, -1)
    if (t.endsWith('.')) t = t.slice(0, -1)
    return sep(t)
  }

  /** Problemas del modelo: nombres, expresiones que no se entienden o usan variables desconocidas, valores no finitos. */
  problems(): SimulationProblem[] {
    const out: SimulationProblem[] = []
    const b = this.block
    const known = new Set<string>()
    const push = (path: string, message: string, isError: boolean): void => { out.push({ path, message, isError }) }
    const checkName = (n: string, path: string): void => {
      const ok = n !== '' && /^\p{L}[\p{L}\p{N}_]*$/u.test(n) && Array.from(n).length <= 24
      if (!ok) { push(path, `Nombre «${n}» no válido: usa letras, cifras y _ (empieza por letra), como v0, theta, Vmax.`, true); return }
      if (RESERVED.has(n)) { push(path, `«${n}» está reservado (x es el eje de las gráficas; e y pi son constantes): usa otro nombre.`, true); return }
      const k = SimulationEngine.key(n)
      if (known.has(k)) push(path, `El nombre «${n}» está repetido.`, true)
      known.add(k)
    }
    const checkExpr = (text: string, path: string, allowed: ReadonlySet<string>): void => {
      const c = this.compile(text)
      if (!c.ok) { push(path, `Expresión «${text}» no válida: ${c.message}. Usa sintaxis de calculadora: v0*cos(theta*pi/180), sqrt(L/g), exp(-t/tau).`, true); return }
      const extra = [...freeVariables(c.expr)].filter((v) => !allowed.has(v)).sort()
      if (extra.length) push(path, `«${text}» usa «${extra.join(', ')}», que no está definido (disponibles: ${[...allowed].sort().join(', ')}). Define antes las magnitudes que uses.`, true)
    }
    if (!b.params.length && !b.time) push('params', 'Una simulación necesita al menos un deslizador (params) o un reloj (time).', true)
    b.constants.forEach((c, i) => { checkName(c.name, `constants[${i}]`); if (!Number.isFinite(c.value)) push(`constants[${i}]`, 'Valor no finito.', true) })
    b.params.forEach((p, i) => {
      checkName(p.name, `params[${i}]`)
      if (!(p.min < p.max)) push(`params[${i}]`, 'min debe ser menor que max.', true)
      if (!(p.step > 0) || p.step > p.max - p.min) push(`params[${i}]`, 'Paso inadecuado (debe ser > 0 y menor que el rango).', false)
      if (p.value < p.min || p.value > p.max) push(`params[${i}]`, 'El valor inicial está fuera del rango.', false)
    })
    const tm = b.time
    if (tm) {
      checkName(tm.name, 'time.name')
      const allowed = new Set([...known].filter((k) => k !== SimulationEngine.key(tm.name)))
      for (const d of b.derived) allowed.add(SimulationEngine.key(d.name))
      checkExpr(tm.min, 'time.min', allowed)
      checkExpr(tm.max, 'time.max', allowed)
      if (!(tm.speed > 0) || tm.speed > 1e6) push('time.speed', 'speed debe ser positiva (unidades de tiempo por segundo).', true)
    }
    b.derived.forEach((d, i) => { checkExpr(d.expr, `derived[${i}].expr`, new Set(known)); checkName(d.name, `derived[${i}]`) })
    // valores con los parámetros iniciales
    const env = this.environment(this.initialParams, undefined)
    b.derived.forEach((d, i) => {
      if (env[SimulationEngine.key(d.name)] === undefined && this.compile(d.expr).ok) push(`derived[${i}]`, `«${d.name} = ${d.expr}» no da un número con los valores iniciales (¿división por cero, raíz de negativo?).`, false)
    })
    if (tm) { const tb = this.timeBounds(this.initialParams); if (tb && !(tb[1] > tb[0])) push('time', 'El reloj no avanza: max debe ser mayor que min.', true) }
    const vars = new Set(known)
    b.objects.forEach((o, i) => {
      const p = `objects[${i}]`
      if (!(SIM_OBJECT_KINDS as readonly string[]).includes(o.kind)) { push(p, `kind «${o.kind}» no válido (${SIM_OBJECT_KINDS.join(', ')}).`, true); return }
      const need = o.kind === 'point' || o.kind === 'label' ? ['x', 'y'] : o.kind === 'vector' ? ['x', 'y', 'dx', 'dy'] : o.kind === 'segment' ? ['x1', 'y1', 'x2', 'y2'] : o.kind === 'path' ? ['x', 'y', 'from', 'to'] : ['y', 'from', 'to']
      const have = new Map(simObjectExpressions(o))
      const missing = need.filter((k) => !have.has(k))
      if (missing.length) { push(p, `«${o.kind}» necesita ${missing.join(', ')}.`, true); return }
      if (o.kind === 'label' && !o.text) push(p, 'label necesita text.', true)
      const allowed = new Set(vars)
      if (o.kind === 'path') allowed.add(SimulationEngine.key(o.variable ?? 's'))
      for (const [k, e] of simObjectExpressions(o)) {
        const a = new Set(allowed)
        if (o.kind === 'function' && k === 'y') a.add('x')
        checkExpr(e, `${p}.${k}`, a)
      }
    })
    return out
  }
}
