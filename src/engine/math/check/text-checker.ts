import { tr } from '../core/i18n'
import { charCount, chars as toChars, editDistance, foldDiacritics, isLetter, isNumberChar, isWhitespace, trimWSNL } from '../core/text'
import { roundHalfAwayFromZero } from '../eval/rounding'
import { textMatchOptions, type TextMatchOptions } from './specs'
import { Verdict, type CheckVerdict } from './verdict'

/** Artículos que se quitan en cualquier posición (es, en, fr, it, pt, de). */
const ARTICLES = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'lo', 'the',
  'le', 'les', 'une', 'des', 'il', 'gli', 'uno', 'um', 'uma', 'os', 'der', 'das', 'dem', 'ein', 'eine', 'einen', 'einem', 'einer',
])

/** Artículos que solo se quitan al principio: detrás son una letra o una palabra («vitamina A», «tipo I», «grupo O»). */
const LEADING_ARTICLES = new Set(['a', 'an', 'i', 'o', 'die', 'den'])

/** Prefijos de significado contrario: un cambio de uno a otro no es una errata («exotérmica» por «endotérmica»). */
export const CONTRARY_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['hipo', 'hiper'], ['hypo', 'hyper'], ['hipo', 'hyper'], ['hypo', 'hiper'], ['endo', 'exo'], ['end', 'ex'], ['ento', 'ecto'],
  ['intra', 'inter'], ['intra', 'extra'], ['infra', 'supra'], ['infra', 'ultra'], ['sub', 'super'], ['sub', 'supra'],
  ['pre', 'post'], ['ante', 'post'], ['anti', 'ante'], ['anti', 'pro'], ['homo', 'hetero'], ['ana', 'cata'], ['af', 'ef'],
  ['ab', 'ad'], ['in', 'ex'], ['im', 'ex'], ['macro', 'micro'], ['mono', 'poli'], ['mono', 'poly'], ['hipo', 'normo'],
  ['hiper', 'normo'], ['hypo', 'normo'], ['hyper', 'normo'], ['uni', 'multi'], ['iso', 'aniso'],
]

/** Prefijos de negación: «apolar» no es una errata de «polar», ni «atípico» de «típico». */
export const NEGATION_PREFIXES: readonly string[] = ['a', 'an', 'in', 'im', 'i', 'un', 'non', 'des', 'dis', 'anti']

/**
 * Rayas y guiones tipográficos que se leen como el guion `-`: guion (U+2010), guion sin salto (U+2011), raya de cifras
 * (U+2012), raya corta «–» (U+2013), raya «—» (U+2014), barra horizontal (U+2015), menos (U+2212), guion pequeño (U+FE63)
 * y de ancho completo (U+FF0D).
 */
export const DASHES: ReadonlySet<string> = new Set(['-', '‐', '‑', '‒', '–', '—', '―', '−', '﹣', '－'])

/** Comprobador de respuestas de texto: mayúsculas, acentos, puntuación, artículos, erratas y palabras clave. */
export class TextChecker {
  readonly accepted: readonly string[]
  readonly rejected: readonly string[]
  readonly options: TextMatchOptions

  constructor(accepted: readonly string[], rejected: readonly string[] = [], options: TextMatchOptions = textMatchOptions()) {
    this.accepted = accepted
    this.rejected = rejected
    this.options = options
  }

  /**
   * Texto → palabras normalizadas según las opciones.
   *
   * `loose`: segunda lectura en la que el guion pegado entre una letra y una cifra («U-235», «C-14», «B-12», «x-1») es
   * opcional, como un espacio. Los signos que cambian el sentido se conservan igual que en la lectura normal.
   */
  words(text: string, loose = false): string[] {
    const o = this.options
    // Compatibilidad Unicode (H₂O → H2O, ａ → a) sin tocar el sentido del texto
    let t = text.normalize('NFKC')
    if (o.ignoreCase) t = t.toLowerCase()
    if (o.ignoreAccents) t = foldDiacritics(t)
    let out = ''
    const cs = toChars(t)
    const lastChar = (): string | undefined => (out === '' ? undefined : out[out.length - 1])
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]
      if (isLetter(c) || isNumberChar(c)) {
        out += c
        continue
      }
      if (o.ignorePunctuation) {
        if (c === "'" || c === '’' || c === '`' || c === '´') continue // don't → dont
        // separador decimal entre cifras: 3,14 y 3.14 son la misma respuesta
        if ((c === '.' || c === ',') && i > 0 && i + 1 < cs.length && isNumberChar(cs[i - 1]) && isNumberChar(cs[i + 1])) {
          out += '.'
          continue
        }
        // Los signos con significado (cargas, sumas y restas) no son puntuación de prosa: «Na+» no es «Na» ni «3-4» es
        // «3+4». Se conservan como término propio; el guion de prosa («well-known», «COVID-19») sigue separando.
        if (c === '+' || c === '±' || DASHES.has(c)) {
          const isDash = DASHES.has(c)
          const nearest = (from: number, step: number): string | null => {
            let j = from
            while (j >= 0 && j < cs.length) {
              if (cs[j] !== ' ') return cs[j]
              j += step
            }
            return null
          }
          const prev = nearest(i - 1, -1)
          const next = nearest(i + 1, 1)
          const attachedPrev = i > 0 && cs[i - 1] !== ' '
          const attachedNext = i + 1 < cs.length && cs[i + 1] !== ' '
          let significant = false
          if (prev !== null && next !== null && isLetter(prev) && isLetter(next)) {
            significant = false // well-known, ácido-base
          } else if (loose && isDash && prev !== null && next !== null && isLetter(prev) && isNumberChar(next) && attachedPrev && attachedNext) {
            significant = false // U-235 = U 235
          } else if (prev !== null && next !== null && isLetter(prev) && isNumberChar(next) && attachedPrev && attachedNext && isDash) {
            // COVID-19 y Page-2 son prosa (palabra larga); Na-1, 2x-1 y x-1 son cargas o restas.
            const tokens = out.split(' ').filter((s) => s !== '')
            const lastToken = tokens.length > 0 ? charCount(tokens[tokens.length - 1]) : 0
            significant = lastToken <= 2
          } else if ((prev !== null && isNumberChar(prev)) || (next !== null && isNumberChar(next))) {
            significant = true // 3-4, 3 + 4, -3
          } else if (prev !== null && (isLetter(prev) || isNumberChar(prev))) {
            significant = true // Na+, Fe2+
          }
          if (significant) {
            if (out !== '' && lastChar() !== ' ') out += ' '
            out += isDash ? '-' : c
            out += ' '
          } else {
            out += ' '
          }
          continue
        }
        out += ' '
      } else {
        out += c
      }
    }
    let ws = splitWhitespace(out)
    if (o.ignoreArticles) {
      let filtered = ws
      // «a»/«an»… solo al principio («a cell» → «cell»; «vitamina A» se queda como está)
      while (filtered.length > 0 && LEADING_ARTICLES.has(filtered[0].toLowerCase())) filtered = filtered.slice(1)
      filtered = filtered.filter((w) => !ARTICLES.has(w.toLowerCase()))
      if (filtered.length > 0) ws = filtered
    }
    return ws
  }

  /** Erratas toleradas: 1 desde 5 letras y 2 desde 13. */
  private tolerance(expectedWord: string): number {
    if (!this.options.typoTolerance || toChars(expectedWord).some(isNumberChar)) return 0
    const n = charCount(expectedWord)
    return n >= 13 ? 2 : n >= 5 ? 1 : 0
  }

  /** ¿El cambio de `word` a `expected` es de significado y no de ortografía? (prefijos contrarios o de negación) */
  static changesMeaning(word: string, expected: string): boolean {
    const a = word.toLowerCase()
    const b = expected.toLowerCase()
    for (const [p, q] of CONTRARY_PREFIXES) {
      if ((a.startsWith(p) && !a.startsWith(q) && b.startsWith(q) && !b.startsWith(p)) || (a.startsWith(q) && !a.startsWith(p) && b.startsWith(p) && !b.startsWith(q))) {
        return true
      }
    }
    for (const p of NEGATION_PREFIXES) if (a === p + b || b === p + a) return true
    return false
  }

  /** ¿`word` es igual a `expected` o una errata tolerable? */
  private wordMatches(word: string, expected: string): { ok: boolean; typo: boolean } {
    if (word === expected) return { ok: true, typo: false }
    const tol = this.tolerance(expected)
    if (tol <= 0 || TextChecker.changesMeaning(word, expected)) return { ok: false, typo: false }
    return { ok: editDistance(toChars(word), toChars(expected), tol) <= tol, typo: true }
  }

  check(raw: string): CheckVerdict {
    const trimmed = trimWSNL(raw)
    if (trimmed === '') return Verdict.format(tr('Escribe tu respuesta.'))
    if (charCount(trimmed) > 5000) return Verdict.format(tr('La respuesta es demasiado larga.'))
    const given = this.words(trimmed)
    if (given.length === 0) return Verdict.format(tr('Escribe tu respuesta con letras o números.'))
    const normalized = given.join(' ')
    const acceptedWords = this.accepted.map((a) => this.words(a)).filter((w) => w.length > 0)
    if (acceptedWords.length === 0 && this.options.keywords.length === 0) {
      return Verdict.format(tr('El ejercicio no tiene respuestas aceptadas.'))
    }

    // 1. Coincidencia exacta
    if (acceptedWords.some((a) => sameWords(a, given))) return Verdict.correct(null, normalized)
    const isRejected = this.rejected.map((r) => this.words(r)).some((r) => r.length > 0 && sameWords(r, given))

    // 1a. Con el guion entre letra y cifra como opcional («U 235» = «U-235»), salvo que sea un error típico.
    if (!isRejected) {
      const looseGiven = this.words(trimmed, true)
      if (this.accepted.some((a) => {
        const w = this.words(a, true)
        return w.length > 0 && sameWords(w, looseGiven)
      })) {
        return Verdict.correct(null, normalized)
      }
    }

    // 1b. Un error típico conocido no es nunca una errata de la respuesta (el autor ya dijo que es incorrecto).
    if (isRejected) return Verdict.wrong(tr('No es correcto.'), ['other'], normalized)

    // 2. Erratas leves
    if (this.options.typoTolerance) {
      let best: Array<[string, string]> | null = null
      for (const a of acceptedWords) {
        if (a.length !== given.length) continue
        const typos: Array<[string, string]> = []
        let ok = true
        for (let k = 0; k < given.length; k++) {
          const m = this.wordMatches(given[k], a[k])
          if (!m.ok) {
            ok = false
            break
          }
          if (m.typo) typos.push([given[k], a[k]])
        }
        if (ok && typos.length > 0 && (best === null || typos.length < best.length)) best = typos
      }
      if (best !== null) {
        const shown = best.slice(0, 3).map((typo) => tr('«%@» → «%@»', typo[0], typo[1])).join(', ')
        return Verdict.partial(0.9, tr('Casi: revisa la ortografía (%@).', shown), ['other'], normalized)
      }
    }

    // 3. Palabras clave
    if (this.options.keywords.length > 0) {
      let present = 0
      for (const kw of this.options.keywords) {
        const alternatives = kw.split('|').map((s) => this.words(s)).filter((w) => w.length > 0)
        if (alternatives.some((alt) => this.containsPhrase(given, alt))) present += 1
      }
      const total = this.options.keywords.length
      if (present === total) return Verdict.correct(null, normalized)
      let credit = present / total
      const minimum = this.options.minKeywordsForCredit
      if (minimum !== null && present < minimum) credit = 0
      if (credit > 0) {
        return Verdict.partial(roundHalfAwayFromZero(credit * 100) / 100, tr('Mencionaste %lld de %lld ideas clave: te falta incluir alguna.', present, total), ['missingSolution'], normalized)
      }
      const message = present === 0
        ? tr('No aparece ninguna de las ideas clave que se esperan.')
        : tr('Faltan ideas clave: menciona al menos %lld.', minimum ?? total)
      return Verdict.wrong(message, ['missingSolution'], normalized)
    }

    return Verdict.wrong(tr('No es correcto.'), ['other'], normalized)
  }

  /** ¿Aparece la frase `phrase` (palabras consecutivas) dentro de `text`, con tolerancia a erratas? */
  private containsPhrase(text: readonly string[], phrase: readonly string[]): boolean {
    if (phrase.length > text.length) return false
    for (let start = 0; start <= text.length - phrase.length; start++) {
      let ok = true
      for (let k = 0; k < phrase.length; k++) {
        if (!this.wordMatches(text[start + k], phrase[k]).ok) {
          ok = false
          break
        }
      }
      if (ok) return true
    }
    return false
  }
}

function sameWords(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((w, i) => w === b[i])
}

/** `split(whereSeparator: isWhitespace)` de Swift (sin piezas vacías). */
function splitWhitespace(s: string): string[] {
  const out: string[] = []
  let cur = ''
  for (const c of toChars(s)) {
    if (isWhitespace(c)) {
      if (cur !== '') out.push(cur)
      cur = ''
    } else cur += c
  }
  if (cur !== '') out.push(cur)
  return out
}
