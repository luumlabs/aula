// Química (puro): adapta el motor (src/engine/chem) a lo que dibuja la herramienta: masa molar con su composición,
// ecuación balanceada término a término con la cuenta de átomos, arcos del donut y mensajes (el motor ya los localiza;
// los del balanceo, no: van en `englishBalanceMessage`).
import { parseFormula } from '@engine/chem/parser'
import { molarMassDetails } from '@engine/chem/composition'
import { balance, type BalanceStatus } from '@engine/chem/balancer'
import { effectiveCoefficient } from '@engine/chem/equation'
import type { Formula } from '@engine/chem/formula'

export interface Part {
  symbol: string
  z: number
  count: number
  mass: number
  massText: string
  subtotal: number
  percent: number
}

export interface MolarView {
  formula: Formula
  ce: string
  value: number
  decimals: number
  approximate: boolean
  parts: Part[]
}

export type Failure = { ok: false; error: unknown }

/** Masa molar con su desglose (ordenado como en las fórmulas: C, H y luego alfabético). */
export function molarView(text: string): ({ ok: true } & MolarView) | Failure | null {
  if (!text.trim()) return null
  try {
    const f = parseFormula(text)
    const m = molarMassDetails(f)
    return {
      ok: true,
      formula: f,
      ce: f.ce,
      value: m.value,
      decimals: m.decimalPlaces,
      approximate: m.isApproximate,
      parts: m.contributions.map((c) => ({ symbol: c.atom.symbol, z: c.atom.atomicNumber, count: c.count, mass: c.atomicMass, massText: c.atomicMassText, subtotal: c.subtotal, percent: c.massPercent }))
    }
  } catch (error) {
    return { ok: false, error }
  }
}

export interface BalancedTerm {
  coef: number
  ce: string
  /** Fórmula en texto plano (la entiende el analizador): clave de los datos de estequiometría. */
  plain: string
  side: 'reactants' | 'products'
}

export interface AtomRow {
  symbol: string
  left: number
  right: number
}

export interface BalanceView {
  status: BalanceStatus
  terms: BalancedTerm[]
  atoms: AtomRow[]
  charge: { left: number; right: number } | null
  /** Mensaje del motor (español). */
  message: string
  ce: string | null
  reversible: boolean
}

/** Balancea y deja los términos y la cuenta de átomos de cada lado. */
export function balanceView(text: string): BalanceView | null {
  if (!text.trim()) return null
  const b = balance(text)
  const eq = b.equation
  if (!eq) return { status: b.status, terms: [], atoms: [], charge: null, message: b.message, ce: null, reversible: false }
  const terms: BalancedTerm[] = [
    ...eq.reactants.map((t) => ({ coef: effectiveCoefficient(t).toNumber(), ce: t.formula.ceBody(false), plain: t.formula.plainText, side: 'reactants' as const })),
    ...eq.products.map((t) => ({ coef: effectiveCoefficient(t).toNumber(), ce: t.formula.ceBody(false), plain: t.formula.plainText, side: 'products' as const }))
  ]
  const left = eq.atomTotals('reactants')
  const right = eq.atomTotals('products')
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort((a, b) => a.atomicNumber - b.atomicNumber || (a.massNumber ?? 0) - (b.massNumber ?? 0))
  const atoms = keys.map((k) => ({ symbol: k.symbol, left: left.get(k)?.toNumber() ?? 0, right: right.get(k)?.toNumber() ?? 0 }))
  const cl = eq.chargeTotal('reactants').toNumber()
  const cr = eq.chargeTotal('products').toNumber()
  return { status: b.status, terms, atoms, charge: cl !== 0 || cr !== 0 ? { left: cl, right: cr } : null, message: b.message, ce: eq.ce, reversible: eq.arrow === 'reversible' }
}

/** Arcos de un donut (radianes, empezando arriba) a partir de porcentajes; deja un hueco pequeño entre trozos. */
export function donutArcs(percents: number[], gap = 0.02): { start: number; end: number }[] {
  const total = percents.reduce((a, b) => a + b, 0) || 1
  const out: { start: number; end: number }[] = []
  let a = -Math.PI / 2
  for (const p of percents) {
    const sweep = (p / total) * Math.PI * 2
    const g = percents.length > 1 ? Math.min(gap, sweep / 3) : 0
    out.push({ start: a + g / 2, end: a + sweep - g / 2 })
    a += sweep
  }
  return out
}

/** Camino SVG de un arco de anillo. */
export function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  const large = end - start > Math.PI ? 1 : 0
  if (end - start >= Math.PI * 2 - 1e-6) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r}`
  }
  const x0 = cx + r * Math.cos(start)
  const y0 = cy + r * Math.sin(start)
  const x1 = cx + r * Math.cos(end)
  const y1 = cy + r * Math.sin(end)
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

/**
 * Mensaje de error para la interfaz. El motor ya lo da en el idioma de la app (lo fija App con applyEngineLanguage);
 * si no es un error del motor, una frase genérica.
 */
export function chemErrorText(error: unknown, es: boolean): string {
  if (error instanceof Error && error.message) return error.message
  return es ? 'No se pudo calcular.' : "Couldn't calculate that."
}

/** Mensaje del balanceo en inglés según su estado. */
export function englishBalanceMessage(status: BalanceStatus): string {
  switch (status) {
    case 'balanced':
      return 'Balanced with the smallest whole-number coefficients.'
    case 'alreadyBalanced':
      return 'It was already balanced.'
    case 'multipleSolutions':
      return 'This equation mixes several independent reactions, so there is no single way to balance it. One valid combination is shown.'
    case 'impossible':
      return "It can't be balanced: some element appears on one side only."
    case 'invalid':
      return "I can't read that equation."
  }
}
