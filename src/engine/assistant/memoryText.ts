// Memoria · texto: identidad, palabras, datos duros y parecido (port de StudyEngine/Memory/MemoryText.swift, adaptado de Luna).
// El parecido solo no separa una paráfrasis de una corrección: además se miran los «datos duros» (números, fechas, nombres
// propios) y la polaridad («le cuesta» / «ya no le cuesta»): dos frases casi iguales con datos distintos son un hecho y su
// corrección, nunca el mismo recuerdo.
import { Hashing } from '@engine/base/ids'
import { fold, foldPlain } from './fold'

/** Texto limpio para guardar: una línea, sin espacios de más, sin comillas de adorno alrededor, como mucho `max` caracteres. */
export function cleanText(s: string, max = 400): string {
  let t = s.replace(/[\r\n\t]/g, ' ')
  while (t.includes('  ')) t = t.replace(/ {2}/g, ' ')
  t = t.trim()
  for (const [a, b] of [['«', '»'], ['"', '"'], ['“', '”'], ["'", "'"]] as const) {
    if (t.startsWith(a) && t.endsWith(b) && Array.from(t).length > 2) t = t.slice(a.length, t.length - b.length).trim()
  }
  const chars = Array.from(t)
  if (chars.length > max) {
    const cut = chars.slice(0, max).join('')
    const sp = cut.lastIndexOf(' ')
    t = (sp >= 0 ? cut.slice(0, sp) : cut) + '…'
  }
  return t
}

/** Identidad de una nota para la deduplicación exacta: iguala mayúsculas, acentos, espacios y puntuación de frase; conserva lo
 * que cambia el dato («-5» no es «5», «C++» no es «C»). */
export function contentHash(s: string): string {
  const t = foldPlain(s)
  const decor = '"`«»“”„()[]{}\'’‘'
  const sentence = '.,;:!¡¿…'
  const spaced = Array.from(t).map((ch) => (decor.includes(ch) ? ' ' : ch)).join('')
  const tokens = spaced.split(/[ \n\t]+/).map((w) => {
    let a = 0, b = w.length
    while (a < b && sentence.includes(w[a])) a++
    while (b > a && sentence.includes(w[b - 1])) b--
    return w.slice(a, b)
  }).filter((w) => w && w !== '-')
  return Hashing.sha256Hex(tokens.join(' ')).slice(0, 32)
}

// MARK: Palabras

const STOP_ES = 'a al algo algun alguna algunas alguno algunos ante antes aqui asi aun aunque bajo bien cada casi como con contra cual cuales cuando de del desde donde dos el ella ellas ello ellos en entre era eran es esa esas ese eso esos esta estaba estan estar estas este esto estos fue fueron ha habia han hasta hay la las le les lo los mas me mi mis mucho muy nada ni no nos nosotros o os otra otras otro otros para pero poco por porque que quien quienes se sea segun ser si sin sobre solo son su sus tambien tan tanto te tiene tienen todo todos tu tus un una unas uno unos usted ya yo cosa cosas vez veces suele quiere prefiere estudiante alumno alumna sea sean fuera fueran haya hayan este esten pueda puedan hace hacer tener estar'
const STOP_EN = 'a an and are as at be been but by can could did do does for from had has have he her his i if in into is it its just me more most my no not of on or our she so some than that the their them then there these they this to too up us very was we were what when where which who will with would you your student user likes prefers wants'
const STOP_PT = 'ao aos as com da das de do dos e em essa esse esta este eu foi isso lhe mais mas na nas no nos o os ou para pela pelo por que se sem seu sua tem um uma voce'
const STOP_FR = 'au aux avec ce ces dans de des du elle en est et il je la le les leur lui mais me mon ne nous on ou par pas pour qu que qui sa se ses son sur ta te tu un une vous'
const STOP_IT = 'al alla alle che con da dei del della di e gli il in la le lo ma nel per si su un una'
const STOP_DE = 'auf aus bei das dem den der des die ein eine einen er es fur hat ich im in ist mit nicht sie und von zu'

/** Palabras vacías (es, en, pt, fr, it, de): no distinguen un recuerdo de otro. */
export const STOPWORDS: ReadonlySet<string> = new Set([STOP_ES, STOP_EN, STOP_PT, STOP_FR, STOP_IT, STOP_DE].join(' ').split(' '))

const allDigits = (w: string): boolean => /^\p{N}+$/u.test(w)
const len = (w: string): number => Array.from(w).length

/** Raíz ligera: sin plurales triviales («exámenes» → «examen»). */
export function stem(w: string): string {
  if (len(w) > 5 && w.endsWith('es')) return w.slice(0, -2)
  if (len(w) > 4 && w.endsWith('s')) return w.slice(0, -1)
  return w
}

/** Palabras de contenido (sin vacías, sin cifras, raíz ligera). */
export function contentTokens(s: string): Set<string> {
  return new Set(fold(s).split(' ').filter((w) => len(w) >= 3 && !STOPWORDS.has(w) && !allDigits(w)).map(stem))
}

/** Palabras de contenido en orden y sin repetir (lo primero suele ser de qué se habla; lo último, el dato). */
export function orderedTokens(s: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of fold(s).split(' ')) {
    if (len(w) < 3 || STOPWORDS.has(w) || allDigits(w)) continue
    const st = stem(w)
    if (!seen.has(st)) { seen.add(st); out.push(st) }
  }
  return out
}

// MARK: Datos duros y polaridad

/** Marca interna de polaridad (nunca aparece en un texto real). */
export const NEGATION = '\u0000neg'

const NUMBER_RE = /(?:(?<![\p{L}\p{N}_.$€£])[-+−])?[$€£]?\d+(?:[.,:/-]\d+)*(?:%|[$€£]|h(?![\p{L}\p{N}_]))?/gu
const PROPER_RE = /(?<![\p{L}\p{N}_])\p{Lu}[\p{L}\p{N}'-]{2,}(?![\p{L}\p{N}_])/gu
const NEGATION_RE = /(?<![\p{L}\p{N}_])(?:not|no|never|n't|cannot|can't|don't|doesn't|didn't|won't|isn't|aren't|nunca|jamás|jamas|tampoco|ya no|nao|não|jamais|pas|nie|kein|keine|nicht)(?![\p{L}\p{N}_])/iu
/** Palabras que van en mayúscula al empezar una frase o por costumbre y no son nombres. */
const NOT_NAMES = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'the', 'this', 'that', 'she', 'he', 'they', 'prefiere', 'tiene', 'estudia', 'le', 'su', 'sus', 'es', 'está', 'esta', 'suele', 'quiere', 'student', 'aula', 'his', 'her', 'their'])

/** Cifras con signo y unidad, fechas, nombres propios y la polaridad: lo que cambia el hecho aunque la frase sea casi igual. */
export function hardTokens(s: string): Set<string> {
  const out = new Set<string>()
  NUMBER_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = NUMBER_RE.exec(s))) {
    let v = m[0].replace(/−/g, '-')
    while (v && '.,:'.includes(v[v.length - 1])) v = v.slice(0, -1)
    while (v && '.,:'.includes(v[0])) v = v.slice(1)
    if (v) out.add(v)
  }
  // los nombres propios cuentan salvo al principio de la frase (donde la mayúscula es de la frase)
  PROPER_RE.lastIndex = 0
  while ((m = PROPER_RE.exec(s))) {
    const lw = fold(m[0])
    if (NOT_NAMES.has(lw) || STOPWORDS.has(lw)) continue
    if (m.index === 0) continue
    const before = s.slice(0, m.index).trim()
    if (/[.!?:]$/.test(before)) continue
    out.add(lw)
  }
  if (NEGATION_RE.test(s)) out.add(NEGATION)
  return out
}

/** Entidades para comparar: datos duros + palabras de contenido largas. */
export function entities(s: string): Set<string> {
  const out = hardTokens(s)
  for (const t of contentTokens(s)) if (len(t) >= 4) out.add(t)
  return out
}

const intersect = (a: Set<string>, b: Set<string>): number => {
  let n = 0
  for (const x of a) if (b.has(x)) n++
  return n
}
const minus = (a: Set<string>, ...bs: Set<string>[]): Set<string> => new Set([...a].filter((x) => !bs.some((b) => b.has(x))))
const isSubset = (a: Set<string>, b: Set<string>): boolean => [...a].every((x) => b.has(x))

// MARK: Parecido

/** Parecido por palabras (coseno de conjuntos: |A∩B| / √(|A|·|B|)), de 0 a 1. */
export function lexicalSimilarity(a: string, b: string): number {
  const ta = contentTokens(a), tb = contentTokens(b)
  if (!ta.size || !tb.size) return 0
  return intersect(ta, tb) / Math.sqrt(ta.size * tb.size)
}

/** Cuánto del conjunto más pequeño está en el otro. */
export function containment(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  return intersect(a, b) / Math.min(a.size, b.size)
}

/** El sujeto aproximado: las primeras palabras de contenido sin el último dato. */
export function head(s: string, n = 3): Set<string> {
  const t = orderedTokens(s)
  return new Set(t.length > 1 ? t.slice(0, -1).slice(0, n) : t.slice(0, n))
}

/** ¿Hablan de lo mismo? Si cada una tiene en su sujeto una palabra que la otra no tiene, no. */
export function sameSubject(a: string, b: string): boolean {
  const ha = head(a), hb = head(b)
  const onlyA = minus(ha, hb, hardTokens(a), contentTokens(b))
  const onlyB = minus(hb, ha, hardTokens(b), contentTokens(a))
  return onlyA.size === 0 || onlyB.size === 0
}

// MARK: Decisiones (de Luna: `dedup_decision` y `es_correccion`)

/** Umbrales con vectores (EmbeddingGemma 2, medidos con el modelo real) y sin ellos (solo palabras). */
export const THRESHOLDS = { mergeSemantic: 0.93, extendSemantic: 0.95, correctSemantic: 0.9, crossLanguageSemantic: 0.9, mergeLexical: 0.82, extendLexical: 0.8, correctLexical: 0.6 }

/** ¿Son el MISMO recuerdo? Devuelve el texto que debe quedarse, o undefined. */
export function mergeDecision(newText: string, oldText: string, semantic: number | undefined, lexical: number): string | undefined {
  const T = THRESHOLDS
  // entre idiomas («Prefers short explanations» / «Prefiere explicaciones cortas») solo se puede fiar del significado
  const crossLanguage = (semantic ?? 0) >= T.crossLanguageSemantic && lexical < 0.2 && differentLanguages(newText, oldText)
  const similar = crossLanguage ? true : semantic !== undefined ? semantic >= T.mergeSemantic || (semantic >= T.correctSemantic && lexical >= T.mergeLexical) : lexical >= T.mergeLexical
  const extendOK = semantic !== undefined ? semantic >= T.extendSemantic || (semantic >= T.mergeSemantic && lexical >= T.extendLexical) : lexical >= T.extendLexical
  if (!similar && !extendOK) return undefined
  if (!crossLanguage && !sameSubject(newText, oldText)) return undefined
  // en el mismo idioma, si cada frase trae palabras propias son dos hechos aunque los vectores se parezcan mucho
  if (!crossLanguage && lexical < T.mergeLexical) {
    const tn = contentTokens(newText), to = contentTokens(oldText)
    if (minus(tn, to).size && minus(to, tn).size) return undefined
  }
  const hn = hardTokens(newText), ho = hardTokens(oldText)
  if (hn.has(NEGATION) !== ho.has(NEGATION)) return undefined
  const onlyNew = minus(hn, ho), onlyOld = minus(ho, hn)
  if (onlyNew.size && onlyOld.size) return undefined
  if (onlyNew.size || onlyOld.size) {
    if (!extendOK) return undefined
    const [fuller, other] = onlyNew.size === 0 ? [oldText, newText] : [newText, oldText]
    if (!isSubset(contentTokens(other), contentTokens(fuller))) return undefined
    return fuller
  }
  // la misma frase en otro idioma: se queda la que ya había (el panel no cambia de idioma solo)
  if (crossLanguage) return oldText
  return similar ? newText : undefined
}

/** ¿El texto nuevo CORRIGE al viejo (mismo hecho, dato distinto o polaridad contraria)? En los tipos con varios valores a la vez
 * (`multiValued`) solo cuenta la polaridad. */
export function isCorrection(newText: string, oldText: string, semantic: number | undefined, lexical: number, multiValued = false): boolean {
  const T = THRESHOLDS
  const close = semantic !== undefined ? semantic >= T.correctSemantic || lexical >= T.correctLexical : lexical >= T.correctLexical
  if (!close || !sameSubject(newText, oldText)) return false
  const en = entities(newText), eo = entities(oldText)
  const onlyN = minus(en, eo), onlyO = minus(eo, en)
  const neg = new Set([NEGATION])
  if (en.has(NEGATION) !== eo.has(NEGATION)) {
    // «le cuesta X» / «ya no le cuesta X»: manda la última si el resto es casi igual
    if (minus(onlyN, neg).size <= 2 && minus(onlyO, neg).size <= 2) return true
  }
  if (multiValued) return false
  const hn = hardTokens(newText), ho = hardTokens(oldText)
  if (minus(hn, ho).size === 0 || minus(ho, hn).size === 0) {
    // sin conflicto de datos duros, una corrección es un valor cambiado y nada más
    if (onlyN.size > 2 || onlyO.size > 2) return false
  }
  if (!onlyN.size || !onlyO.size) return false
  return containment(en, eo) >= 0.5
}

// MARK: Idioma (sustituye a NLLanguageRecognizer: palabras vacías de cada idioma)

const LANGS: Array<[string, Set<string>]> = [
  ['es', new Set(STOP_ES.split(' ').concat(['explicaciones', 'cortas', 'prefiere', 'examen', 'le', 'cuesta']))],
  ['en', new Set(STOP_EN.split(' ').concat(['explanations', 'short', 'prefers', 'exam', 'finds', 'hard']))],
  ['pt', new Set(STOP_PT.split(' '))], ['fr', new Set(STOP_FR.split(' '))], ['it', new Set(STOP_IT.split(' '))], ['de', new Set(STOP_DE.split(' '))]
]

/** Idioma probable (solo cuando hay señales claras). */
export function guessLanguage(s: string): string | undefined {
  const words = fold(s).split(' ').filter((w) => w)
  if (!words.length) return undefined
  const scores = LANGS.map(([code, set]) => [code, words.filter((w) => set.has(w)).length] as const).sort((a, b) => b[1] - a[1])
  const [best, second] = scores
  if (best[1] === 0 || best[1] === second[1]) return undefined
  return best[0]
}

/** ¿Están escritas en idiomas distintos? (solo cuando se reconoce con seguridad) */
export function differentLanguages(a: string, b: string): boolean {
  const la = guessLanguage(a), lb = guessLanguage(b)
  return la !== undefined && lb !== undefined && la !== lb
}

// MARK: Caducidad de lo pasajero

const PERISHABLE = /(?<![\p{L}\p{N}_])(today|tomorrow|tonight|this (morning|afternoon|evening|week|weekend|month)|next week|right now|at the moment|for now|these days|hoy|mañana|esta (mañana|tarde|noche|semana)|este (fin de semana|mes)|la semana que viene|la próxima semana|ahora mismo|de momento|por ahora|estos días|hoje|amanhã|esta semana|aujourd'hui|demain|cette semaine|oggi|domani|questa settimana|heute|morgen|diese woche)(?![\p{L}\p{N}_])/iu

/** ¿Declara un estado pasajero («esta semana», «por ahora»…)? */
export function isPerishable(s: string): boolean {
  return PERISHABLE.test(s)
}

// MARK: Claves

/** Clave estable a partir de lo que propone la IA («Exam: Química parcial 2» → «exam:quimica-parcial-2»). */
export function normalizedKey(raw: string | undefined | null): string | undefined {
  if (!raw || !raw.trim()) return undefined
  const i = raw.indexOf(':')
  const parts = i >= 0 ? [raw.slice(0, i), raw.slice(i + 1)] : [raw]
  const norm = parts.map((p) => fold(p).replace(/ /g, '-')).filter((p) => p)
  if (!norm.length) return undefined
  return norm.join(':').slice(0, 80)
}

// MARK: Vectores pequeños (int8): un recuerdo ocupa 512 bytes en disco

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || !a.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (na <= 0 || nb <= 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=')
  }
  return out
}

function fromBase64(s: string): Uint8Array | undefined {
  const clean = s.replace(/=+$/, '')
  if (/[^A-Za-z0-9+/]/.test(clean)) return undefined
  const out: number[] = []
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1] ?? 'A') << 12) | (B64.indexOf(clean[i + 2] ?? 'A') << 6) | B64.indexOf(clean[i + 3] ?? 'A')
    out.push((n >> 16) & 255)
    if (i + 2 < clean.length) out.push((n >> 8) & 255)
    if (i + 3 < clean.length) out.push(n & 255)
  }
  return new Uint8Array(out)
}

/** Cuantiza un vector normalizado a int8 (error de coseno < 1e-3) y lo codifica en base64 (mismo formato que la app Swift). */
export function encodeVector(v: readonly number[]): string {
  return toBase64(Uint8Array.from(v.map((x) => Math.max(-127, Math.min(127, Math.round(x * 127))) & 255)))
}

export function decodeVector(s: string): number[] | undefined {
  const d = fromBase64(s)
  if (!d || !d.length) return undefined
  return Array.from(d, (b) => (b > 127 ? b - 256 : b) / 127)
}

export const MemoryText = {
  fold, clean: cleanText, contentHash, stem, contentTokens, orderedTokens, hardTokens, entities, lexicalSimilarity, containment, head, sameSubject,
  mergeDecision, isCorrection, differentLanguages, isPerishable, normalizedKey, stopwords: STOPWORDS, negation: NEGATION
}
