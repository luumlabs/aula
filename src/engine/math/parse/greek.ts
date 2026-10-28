import { isASCIILetter, isUppercase } from '../core/text'

/**
 * Nombres de letras griegas escritos con letras latinas (`theta`, `alpha`, `Delta`…) ↔ símbolo griego (`θ`, `α`, `Δ`).
 *
 * Reglas (las aplica el analizador):
 * - Un nombre completo es **un solo símbolo**: `theta` = `θ`, igual que si se escribe `θ` o `\theta`.
 * - Mayúsculas: si la primera letra es mayúscula se usa la griega mayúscula cuando tiene forma propia
 *   (`Delta` → `Δ`, `Omega` → `Ω`, `Theta` → `Θ`); si no la tiene (`Alpha`, `Beta`, `Mu`…) se usa la minúscula.
 * - `pi` sigue siendo la constante π. `tau` es la letra τ (par motor, constante de tiempo), no 2π.
 * - Dentro de una palabra de varias letras se busca, en cada posición, primero una constante (`pi`, `inf`), luego una
 *   función (`sin`, `sen`, `ln`…), luego un nombre griego (el más largo) y si no, una letra suelta.
 * - Para escribir el producto de letras sueltas que forman un nombre griego (m·u), sepáralas: `m u` o `m*u`.
 */
const TABLE: ReadonlyMap<string, { lower: string; upper: string | null }> = new Map(
  (
    [
      ['alpha', 'α', null], ['beta', 'β', null], ['gamma', 'γ', 'Γ'], ['delta', 'δ', 'Δ'],
      ['epsilon', 'ε', null], ['varepsilon', 'ε', null], ['zeta', 'ζ', null], ['eta', 'η', null],
      ['theta', 'θ', 'Θ'], ['vartheta', 'θ', 'Θ'], ['iota', 'ι', null], ['kappa', 'κ', null],
      ['lambda', 'λ', 'Λ'], ['mu', 'μ', null], ['nu', 'ν', null], ['xi', 'ξ', 'Ξ'],
      ['rho', 'ρ', null], ['varrho', 'ρ', null], ['sigma', 'σ', 'Σ'], ['tau', 'τ', null],
      ['upsilon', 'υ', 'Υ'], ['phi', 'φ', 'Φ'], ['varphi', 'φ', 'Φ'], ['chi', 'χ', null],
      ['psi', 'ψ', 'Ψ'], ['omega', 'ω', 'Ω'],
    ] as Array<[string, string, string | null]>
  ).map(([name, lower, upper]) => [name, { lower, upper }]),
)

const NAME_OF_SYMBOL: ReadonlyMap<string, string> = (() => {
  const out = new Map<string, string>()
  // los nombres «var…» son variantes: el nombre preferido es el corto
  for (const [name, s] of TABLE) {
    if (name.startsWith('var')) continue
    out.set(s.lower, name)
    if (s.upper) out.set(s.upper, name[0].toUpperCase() + name.slice(1))
  }
  return out
})()

function splitSubscript(name: string): [string, string] {
  const u = name.indexOf('_')
  return u < 0 ? [name, ''] : [name.slice(0, u), name.slice(u)]
}

export const GreekLetters = {
  table: TABLE,

  /** Nombres ordenados de mayor a menor longitud (para el corte voraz de palabras pegadas). */
  namesLongestFirst: [...TABLE.keys()].sort((a, b) => (a.length !== b.length ? b.length - a.length : a < b ? -1 : a > b ? 1 : 0)) as readonly string[],

  /** Símbolo → nombre en minúsculas (para buscar valores guardados con el nombre: `θ` ↔ `theta`). */
  nameOfSymbol: NAME_OF_SYMBOL,

  /** Símbolo griego de un nombre escrito con letras latinas (`theta` → `θ`, `Delta` → `Δ`), o `null`. */
  symbol(lowercasedName: string, firstIsUppercase: boolean): string | null {
    const entry = TABLE.get(lowercasedName)
    if (!entry) return null
    if (firstIsUppercase && entry.upper) return entry.upper
    return entry.lower
  },

  /** Símbolo griego de una palabra completa (`"Theta"` → `"Θ"`), o `null` si no es un nombre griego. */
  symbolForWord(word: string): string | null {
    if (word === '' || ![...word].every(isASCIILetter)) return null
    return GreekLetters.symbol(word.toLowerCase(), isUppercase(word[0]))
  },

  /** Nombre canónico de una variable: los nombres griegos pasan a su símbolo, también con subíndice (`Delta_x` → `Δ_x`). */
  canonical(name: string): string {
    const u = name.indexOf('_')
    if (u < 0) return GreekLetters.symbolForWord(name) ?? name
    const s = GreekLetters.symbolForWord(name.slice(0, u))
    return s === null ? name : s + name.slice(u)
  },

  /** Otra forma de escribir el mismo nombre de variable (`θ` ↔ `theta`, `θ_1` ↔ `theta_1`), o `null`. */
  alias(name: string): string | null {
    const [base, tail] = splitSubscript(name)
    const n = NAME_OF_SYMBOL.get(base)
    if (n !== undefined) return n + tail
    const s = GreekLetters.symbolForWord(base)
    if (s !== null && s !== base) return s + tail
    return null
  },

  /** Busca el valor de una variable en un diccionario, aceptando también su otra forma (`θ` o `theta`). */
  lookup<V>(name: string, env: Readonly<Record<string, V>>): V | undefined {
    if (Object.prototype.hasOwnProperty.call(env, name)) return env[name]
    const a = GreekLetters.alias(name)
    if (a === null) return undefined
    return Object.prototype.hasOwnProperty.call(env, a) ? env[a] : undefined
  },
}
