import { chars as toChars, isASCII, isWhitespace } from '../core/text'
import { vulgarFractions } from '../numbers/fraction'
import { convertTeX } from './tex-import'

/** Texto ya normalizado, con el índice original (en caracteres) de cada carácter de salida. */
export class NormalizedText {
  constructor(
    readonly chars: string[],
    /** `origin[i]` = índice, en el texto original, del carácter que produjo `chars[i]`. */
    readonly origin: number[],
    /** Longitud (en caracteres) del texto original. */
    readonly originalLength: number,
  ) {}

  get string(): string {
    return this.chars.join('')
  }

  /** Posición en el texto original para el carácter normalizado `i` (se ajusta a los extremos). */
  position(i: number): number {
    if (this.origin.length === 0) return 0
    if (i < 0) return this.origin[0]
    if (i >= this.origin.length) return this.originalLength
    return this.origin[i]
  }
}

/** Longitud máxima de una expresión (en caracteres). */
export const MAX_EXPRESSION_LENGTH = 2000

const SUPERSCRIPTS: ReadonlyMap<string, string> = new Map([
  ['⁰', '0'], ['¹', '1'], ['²', '2'], ['³', '3'], ['⁴', '4'], ['⁵', '5'], ['⁶', '6'], ['⁷', '7'], ['⁸', '8'], ['⁹', '9'],
  ['⁺', '+'], ['⁻', '-'], ['⁽', '('], ['⁾', ')'], ['ⁿ', 'n'], ['ˣ', 'x'],
])
const SUBSCRIPTS: ReadonlyMap<string, string> = new Map([
  ['₀', '0'], ['₁', '1'], ['₂', '2'], ['₃', '3'], ['₄', '4'], ['₅', '5'], ['₆', '6'], ['₇', '7'], ['₈', '8'], ['₉', '9'],
  ['ₐ', 'a'], ['ₑ', 'e'], ['ₒ', 'o'], ['ₓ', 'x'], ['ₙ', 'n'], ['ₖ', 'k'], ['ₘ', 'm'], ['ₚ', 'p'], ['ₛ', 's'], ['ₜ', 't'],
])

const MINUS_LIKE = new Set(['−', '–', '—', '‒', '‐', '‑', '﹣', '－', '➖'])
const TIMES_LIKE = new Set(['×', '·', '⋅', '∙', '∗', '•', '⨯', '✕', '✖', '⋆', '∘'])
const DIVIDE_LIKE = new Set(['÷', '∕', '⁄', '／', '➗'])
const INVISIBLE = new Set([
  '​', '‌', '‍', '‎', '‏', '⁠', '⁡', '⁢', '⁣', '⁤',
  '﻿', '­', '‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩',
])

const REPLACEMENTS: ReadonlyMap<string, string> = new Map([
  ['π', 'pi'], ['∞', 'inf'], ['√', 'sqrt '], ['∛', 'cbrt '],
  ['≤', '<='], ['⩽', '<='], ['≦', '<='], ['≥', '>='], ['⩾', '>='], ['≧', '>='], ['≠', '!='],
  ['“', '"'], ['”', '"'], ['„', '"'], ['‟', '"'], ['«', '"'], ['»', '"'],
  ['‘', "'"], ['’', "'"], ['‚', "'"], ['‛', "'"], ['′', "'"], ['″', "''"],
  ['º', '°'], ['˚', '°'], ['⌊', 'floor('], ['⌈', 'ceil('], ['⌋', ')'], ['⌉', ')'],
  ['⟨', '('], ['〈', '('], ['⟩', ')'], ['〉', ')'], ['∣', '|'], ['٫', '.'],
])

/**
 * Normalización de Unicode: lo que escribe una persona (o pega desde un PDF/Word) se reduce a ASCII matemático.
 */
export function normalizeText(text: string): NormalizedText {
  const original = toChars(text)
  let source: readonly string[] = original
  let sourceOrigin: readonly number[] = original.map((_, i) => i)
  if (original.some((c) => c === '\\' || c === '$')) {
    const t = convertTeX(original)
    source = t.chars
    sourceOrigin = t.origin
  }

  const out: string[] = []
  const org: number[] = []
  const emit = (s: string, o: number): void => {
    for (const ch of toChars(s)) {
      out.push(ch)
      org.push(o)
    }
  }

  let i = 0
  while (i < source.length) {
    const c = source[i]
    const o = sourceOrigin[i]

    // χ²cdf(…) / χ²pdf(…) de las calculadoras → chi2cdf / chi2pdf
    if ((c === 'χ' || c === 'Χ') && i + 4 < source.length && source[i + 1] === '²') {
      const tail = (source[i + 2] + source[i + 3] + source[i + 4]).toLowerCase()
      if (tail === 'cdf' || tail === 'pdf') {
        emit('chi2', o)
        i += 2
        continue
      }
    }

    // Exponentes escritos con superíndices: x² → x^2, x⁻¹ → x^-1
    if (SUPERSCRIPTS.has(c)) {
      let run = ''
      let j = i
      while (j < source.length && SUPERSCRIPTS.has(source[j])) {
        run += SUPERSCRIPTS.get(source[j])
        j += 1
      }
      emit('^', o)
      emit(run, o)
      i = j
      continue
    }
    // Subíndices: x₁ → x_1, log₂ → log_2
    if (SUBSCRIPTS.has(c)) {
      let run = ''
      let j = i
      while (j < source.length && SUBSCRIPTS.has(source[j])) {
        run += SUBSCRIPTS.get(source[j])
        j += 1
      }
      emit('_', o)
      emit(run, o)
      i = j
      continue
    }

    if (isASCII(c)) {
      if (isWhitespace(c)) emit(' ', o)
      else {
        out.push(c)
        org.push(o)
      }
      i += 1
      continue
    }

    if (INVISIBLE.has(c)) {
      i += 1
      continue
    }
    if (isWhitespace(c)) {
      emit(' ', o)
      i += 1
      continue
    }
    if (MINUS_LIKE.has(c)) {
      emit('-', o)
      i += 1
      continue
    }
    if (TIMES_LIKE.has(c)) {
      emit('*', o)
      i += 1
      continue
    }
    if (DIVIDE_LIKE.has(c)) {
      emit('/', o)
      i += 1
      continue
    }
    if (vulgarFractions.has(c)) {
      out.push(c)
      org.push(o)
      i += 1
      continue
    }

    const rep = REPLACEMENTS.get(c)
    if (rep !== undefined) {
      emit(rep, o)
    } else {
      // Compatibilidad Unicode (NFKC): ａ → a, １ → 1, ＝ → =, ℝ → R, ㎏ → kg, ℃ → °C…
      const folded = c.normalize('NFKC')
      if (folded === c) {
        out.push(c)
        org.push(o)
      } else emit(folded, o)
    }
    i += 1
  }
  return new NormalizedText(out, org, original.length)
}
