// Vista previa de lo que escribe el estudiante (port de MathPreviewer): LaTeX de lo que se entendió o el error de sintaxis.
import { MathError } from '@engine/math/core/types'
import { MathParser } from '@engine/math/parse/parser'
import { toLatex } from '@engine/math/print/latex'

export interface ExpressionPreview {
  tex?: string
  error?: string
}

export function previewExpression(text: string): ExpressionPreview {
  const t = text.trim()
  if (!t) return {}
  if (t.includes('=')) {
    try { const eq = MathParser.parseEquation(t); return { tex: `${toLatex(eq.lhs)} = ${toLatex(eq.rhs)}` } } catch (err) {
      return err instanceof MathError ? { error: err.message } : {}
    }
  }
  try { return { tex: toLatex(MathParser.parse(t)) } } catch (err) {
    if (!(err instanceof MathError)) return {}
    // listas, intervalos y puntos no son expresiones: no se marcan como error
    const low = t.toLowerCase()
    if (t.includes(',') || t.includes(';') || low.includes(' o ') || low.includes(' or ') || t.includes('∪')) return {}
    return { error: err.message }
  }
}
