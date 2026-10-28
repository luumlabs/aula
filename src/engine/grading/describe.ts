// «La respuesta correcta» para enseñar (markdown con matemáticas) y la respuesta canónica que escribiría el estudiante
// (port de ExerciseGrader.describe/texInterval y MathKitChecker.canonicalInput/numericRoundedInput).
import { answerForGrading, effectiveLabelMode, FigureGeometry, hasOwnKey, setOwn, type Answer, type AnswerOf, type Exercise } from '@shared/schema'
import { MathParser } from '@engine/math/parse/parser'
import { toLatex } from '@engine/math/print/latex'
import { MathKitChecker } from '@engine/math'
import { L } from './messages'
import { Input, type AnswerInput, type GradeLang } from './types'

/** Una expresión en LaTeX (si no se entiende, tal cual). */
export function texOf(expr: string): string {
  try { return toLatex(MathParser.parse(expr)) } catch { return expr }
}

/**
 * Intervalo de la clave en TeX: `(-inf, 3]` → `(-\infty, 3]`, `[0, +inf)` → `[0, \infty)`, `(-∞, 2) U (3, ∞)` →
 * `(-\infty, 2) \cup (3, \infty)`. Cada infinito se sustituye una sola vez y solo una «U» suelta es la unión.
 */
export function texInterval(s: string): string {
  let t = s.replace(/−/g, '-')
  t = t.replace(/(?<![A-Za-z\\])(?:(-)\s*|\+\s*)?(?:infinity|infty|inf|oo|∞)(?![A-Za-z])/gi, (_m, minus: string | undefined) => (minus ?? '') + '\\infty')
  t = t.replace(/(?<![A-Za-z\\])U(?![A-Za-z])/g, '\\cup ')
  t = t.replace(/∪/g, '\\cup ')
  return t.split('\\cup  ').join('\\cup ')
}

/** Texto que se muestra como «la respuesta correcta». */
export function describeAnswer(answer: Answer, lang?: GradeLang): string {
  const a = answerForGrading(answer)
  switch (a.kind) {
    case 'choice': return a.options.filter((o) => o.correct).map((o) => o.md).join(' · ')
    case 'numeric': return `$${texOf(a.value)}$` + (a.unit ? ` ${a.unit}` : '')
    case 'expression': return `$${texOf(a.expected)}$`
    case 'equation':
      try { const eq = MathParser.parseEquation(a.expected); return `$${toLatex(eq.lhs)} = ${toLatex(eq.rhs)}$` } catch { return `$${a.expected}$` }
    case 'set': return a.expected.map((x) => `$${texOf(x)}$`).join(', ')
    case 'interval': return `$${texInterval(a.expected)}$`
    case 'point': return '$(' + a.expected.map(texOf).join(',\\; ') + ')$'
    case 'short': return a.accepted[0] ?? ''
    case 'cloze': return a.blanks.map((b) => b.accepted[0] ?? '').join(' · ')
    case 'ordering': return a.items.map((x, i) => `${i + 1}. ${x}`).join('  ')
    case 'matching': return a.pairs.map((p) => `${p.left} → ${p.right}`).join(' · ')
    case 'truefalse': return a.value ? L(lang, 'Verdadero', 'True') : L(lang, 'Falso', 'False')
    case 'label': return a.spots.map((s) => s.accepted[0] ?? '').join(' · ')
    case 'open': return a.modelAnswer
    case 'multi': return a.parts.map((p) => `${p.label}) ` + describeAnswer(p.answer, lang)).join('\n')
    case 'chem':
      switch (a.mode) {
        case 'formula': case 'equation': return `$\\ce{${a.expected}}$`
        case 'number': return a.expected + (a.unit ? ` ${a.unit}` : '')
        default: return a.expected
      }
  }
}

/** «La respuesta correcta» de un ejercicio (markdown con matemáticas). */
export function correctAnswerMarkdown(exercise: Exercise, lang?: GradeLang): string {
  return describeAnswer(exercise.answer, lang)
}

/** La respuesta correcta escrita como la escribiría el estudiante (undefined si no se puede construir de forma fiable). */
export function canonicalInput(answer: Answer): AnswerInput | undefined {
  const a = answerForGrading(answer)
  switch (a.kind) {
    case 'numeric': { const s = MathKitChecker.canonicalNumericInput(a); return s === null ? undefined : Input.text(s) }
    case 'expression': return Input.text(a.expected)
    case 'equation': return Input.text(a.expected)
    case 'set': return Input.text(a.expected.join(', '))
    case 'interval': return Input.text(a.expected)
    case 'point': return Input.text('(' + a.expected.join(', ') + ')')
    case 'short': return a.accepted[0] !== undefined ? Input.text(a.accepted[0]) : undefined
    case 'truefalse': return Input.bool(a.value)
    case 'cloze': return Input.blanks(a.blanks.map((b) => b.accepted[0] ?? ''))
    case 'ordering': return Input.ordering([...a.items])
    case 'matching': {
      const pairs: Record<string, string> = {}
      for (const p of a.pairs) if (!hasOwnKey(pairs, p.left)) setOwn(pairs, p.left, p.right)
      return Input.matching(pairs)
    }
    case 'label':
      // «señala la parte»: el punto de cada parte
      if (effectiveLabelMode(a) === 'locate') return Input.blanks(a.spots.map((s) => FigureGeometry.format(s.x, s.y)))
      return Input.blanks(a.spots.map((s) => s.accepted[0] ?? ''))
    case 'choice': return Input.choice(a.options.filter((o) => o.correct).map((o) => o.id))
    case 'chem': return Input.text(a.mode === 'number' ? a.expected + (a.unit ? ` ${a.unit}` : '') : a.expected)
    case 'open': case 'multi': return undefined
  }
}

/** Clave numérica con decimales pedidos: el valor ya redondeado (sin quitar ceros) y la unidad si es obligatoria. */
export function numericRoundedInput(n: AnswerOf<'numeric'>): AnswerInput | undefined {
  const s = MathKitChecker.numericRoundedInput(n)
  return s === null ? undefined : Input.text(s)
}
