// Decodificación de entidades HTML (`&aacute;`, `&#241;`, `&#x3C0;`…): las de HTML 4 más las habituales de MathML.

const latin1Names = [
  'nbsp', 'iexcl', 'cent', 'pound', 'curren', 'yen', 'brvbar', 'sect', 'uml', 'copy', 'ordf', 'laquo', 'not', 'shy', 'reg', 'macr',
  'deg', 'plusmn', 'sup2', 'sup3', 'acute', 'micro', 'para', 'middot', 'cedil', 'sup1', 'ordm', 'raquo', 'frac14', 'frac12', 'frac34', 'iquest',
  'Agrave', 'Aacute', 'Acirc', 'Atilde', 'Auml', 'Aring', 'AElig', 'Ccedil', 'Egrave', 'Eacute', 'Ecirc', 'Euml', 'Igrave', 'Iacute', 'Icirc', 'Iuml',
  'ETH', 'Ntilde', 'Ograve', 'Oacute', 'Ocirc', 'Otilde', 'Ouml', 'times', 'Oslash', 'Ugrave', 'Uacute', 'Ucirc', 'Uuml', 'Yacute', 'THORN', 'szlig',
  'agrave', 'aacute', 'acirc', 'atilde', 'auml', 'aring', 'aelig', 'ccedil', 'egrave', 'eacute', 'ecirc', 'euml', 'igrave', 'iacute', 'icirc', 'iuml',
  'eth', 'ntilde', 'ograve', 'oacute', 'ocirc', 'otilde', 'ouml', 'divide', 'oslash', 'ugrave', 'uacute', 'ucirc', 'uuml', 'yacute', 'thorn', 'yuml'
]
const greekUpper = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi', 'Rho']
const greekLower = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron', 'pi', 'rho', 'sigmaf', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega']

/** Tabla completa nombre → texto. */
export const ENTITY_TABLE: ReadonlyMap<string, string> = (() => {
  const t = new Map<string, string>(Object.entries({
    quot: '"', amp: '&', apos: "'", lt: '<', gt: '>',
    OElig: 'Œ', oelig: 'œ', Scaron: 'Š', scaron: 'š', Yuml: 'Ÿ', fnof: 'ƒ', circ: 'ˆ', tilde: '˜',
    thetasym: 'ϑ', upsih: 'ϒ', piv: 'ϖ',
    ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '', zwj: '', lrm: '', rlm: '',
    ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
    dagger: '†', Dagger: '‡', bull: '•', hellip: '…', permil: '‰', prime: '′', Prime: '″', lsaquo: '‹', rsaquo: '›',
    oline: '‾', frasl: '⁄', euro: '€', image: 'ℑ', weierp: '℘', real: 'ℜ', trade: '™', alefsym: 'ℵ',
    larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔', crarr: '↵', lArr: '⇐', uArr: '⇑', rArr: '⇒', dArr: '⇓', hArr: '⇔',
    forall: '∀', part: '∂', exist: '∃', empty: '∅', nabla: '∇', isin: '∈', notin: '∉', ni: '∋', prod: '∏', sum: '∑',
    minus: '−', lowast: '∗', radic: '√', prop: '∝', infin: '∞', ang: '∠', and: '∧', or: '∨', cap: '∩', cup: '∪',
    int: '∫', there4: '∴', sim: '∼', cong: '≅', asymp: '≈', ne: '≠', equiv: '≡', le: '≤', ge: '≥',
    sub: '⊂', sup: '⊃', nsub: '⊄', sube: '⊆', supe: '⊇', oplus: '⊕', otimes: '⊗', perp: '⊥', sdot: '⋅',
    lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', lang: '〈', rang: '〉', loz: '◊',
    spades: '♠', clubs: '♣', hearts: '♥', diams: '♦',
    InvisibleTimes: '', it: '', InvisibleComma: '', ic: '', ApplyFunction: '', af: '', NoBreak: '', ZeroWidthSpace: '',
    NewLine: '\n', Tab: '\t', hyphen: '‐', dash: '‐', check: '✓', star: '☆', starf: '★', phone: '☎',
    leq: '≤', geq: '≥', neq: '≠', approx: '≈', pm: '±', mp: '∓', cdot: '·', centerdot: '·', ell: 'ℓ', hbar: 'ħ',
    varepsilon: 'ε', straightepsilon: 'ϵ', varphi: 'φ', straightphi: 'ϕ', vartheta: 'ϑ', varpi: 'ϖ', varrho: 'ϱ', varsigma: 'ς',
    setminus: '∖', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', emptyset: '∅', in: '∈', rightarrow: '→', leftarrow: '←',
    Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔', Leftrightarrow: '⇔', mapsto: '↦', infty: '∞', partial: '∂',
    angle: '∠', degree: '°', div: '÷', midast: '*', ast: '*', lbrace: '{', rbrace: '}', lbrack: '[', rbrack: ']',
    lpar: '(', rpar: ')', comma: ',', period: '.', colon: ':', semi: ';', excl: '!', quest: '?', num: '#', percnt: '%',
    dollar: '$', plus: '+', equals: '=', sol: '/', bsol: '\\', verbar: '|', vert: '|', lowbar: '_', grave: '`', commat: '@',
    Hat: '^', ldquor: '„', rdquor: '”', lsquor: '‚', rsquor: '’', MediumSpace: ' '
  }))
  latin1Names.forEach((name, i) => t.set(name, String.fromCharCode(0xa0 + i)))
  // Griego mayúscula: U+0391… (salta U+03A2); minúscula: U+03B1…
  let cp = 0x391
  for (const name of greekUpper) t.set(name, String.fromCodePoint(cp++))
  cp = 0x3a3
  for (const name of ['Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega']) t.set(name, String.fromCodePoint(cp++))
  cp = 0x3b1
  for (const name of greekLower) t.set(name, String.fromCodePoint(cp++))
  return t
})()

/** Lo que devuelven los navegadores para las referencias numéricas 0x80–0x9F (Windows-1252). */
const cp1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030,
  0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178
}

function resolve(body: string): string | null {
  if (body.startsWith('#')) {
    const digits = body.slice(1)
    let value: number
    if (digits.startsWith('x') || digits.startsWith('X')) {
      const hex = digits.slice(1)
      if (!/^[0-9a-fA-F]+$/.test(hex)) return null
      value = parseInt(hex, 16)
    } else {
      if (!/^[0-9]+$/.test(digits)) return null
      value = parseInt(digits, 10)
    }
    // Como el `UInt32(…)` de Swift: más allá de 32 bits no es un número válido
    if (!Number.isFinite(value) || value > 0xffffffff) return null
    if (cp1252[value] !== undefined) value = cp1252[value]
    if (value === 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return '�'
    return String.fromCodePoint(value)
  }
  return ENTITY_TABLE.get(body) ?? null
}

/** Decodifica las entidades de un texto; las desconocidas se dejan tal cual. Lineal aunque el texto ocupe megas. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  const parts: string[] = []
  let i = 0
  const n = s.length
  while (i < n) {
    const a = s.indexOf('&', i)
    if (a < 0) { parts.push(s.slice(i)); break }
    if (a > i) parts.push(s.slice(i, a))
    // Busca el ';' dentro de una ventana corta (los nombres de entidad son ASCII); se cuenta en bytes como en Swift
    let j = a + 1
    let bytes = 1
    while (j < n && bytes < 34) {
      const c = s.charCodeAt(j)
      if (c === 59 || c === 38 || c === 32 || c === 10) break
      bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? 2 : 3
      j++
    }
    let replacement: string | null = null
    if (j < n && bytes < 34 && s.charCodeAt(j) === 59 && j > a + 1) replacement = resolve(s.slice(a + 1, j))
    if (replacement !== null) {
      parts.push(replacement)
      i = j + 1
    } else {
      parts.push('&')
      i = a + 1
    }
  }
  return parts.join('')
}
