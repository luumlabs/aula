// Puerta de privacidad de la memoria y del chat (port de StudyEngine/Memory/MemoryPrivacy.swift).
// Detección conservadora por forma, no una garantía: por eso, además, la IA tiene prohibido proponer esos datos y el estudiante
// ve y borra todo en Ajustes → Memoria. Mensajes en el idioma de la app (`tr`).
import { tr } from '@shared/ai/i18n'
import { fold } from './fold'

export type PrivacyVerdict = { kind: 'ok' } | { kind: 'secret'; why: string } | { kind: 'sensitive'; why: string }

/** Un trozo de texto (inicio y fin en unidades UTF-16, como `String.slice`). */
export interface TextRange { start: number; end: number }

// Límites de palabra que entienden acentos (el `\b` de JS solo sabe ASCII)
const B = '(?<![\\p{L}\\p{N}_])'
const E = '(?![\\p{L}\\p{N}_])'

/** Claves con prefijo conocido (OpenAI, Anthropic, GitHub, Slack, Google, AWS, Hugging Face, Stripe…), JWT y claves privadas. */
const PREFIXED = new RegExp(
  '(?<![A-Za-z0-9_])(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[abeoprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16,}|AIza[0-9A-Za-z_-]{30,}|ya29\\.[0-9A-Za-z_-]{20,}|hf_[A-Za-z0-9]{30,}|npm_[A-Za-z0-9]{30,}|gsk_[A-Za-z0-9]{30,}|xai-[A-Za-z0-9]{30,}|whsec_[A-Za-z0-9+/=]{24,}|eyJ[A-Za-z0-9_-]{8,}\\.eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,})|-----BEGIN [A-Z ]*PRIVATE KEY-----|[Bb][Ee][Aa][Rr][Ee][Rr]\\s+[A-Za-z0-9._~+/-]{20,}',
  'gu'
)

/** Contraseña dentro de una dirección (`https://usuario:clave@sitio`). */
const USERINFO = /\/\/[^\s/@:]+:[^\s/@]+@/gu

/** «nombre: valor» / «nombre (de Canvas) es valor» con nombres que siempre son secretos. */
const STRONG_ASSIGNMENT = new RegExp(
  B + '(?:password|passwd|passphrase|passcode|contrase[ñn]a|senha|mot de passe|passwort|api[ _-]?key|access[ _-]?token|secret[ _-]?key|client[ _-]?secret|token|clave (?:api|secreta|privada|de acceso)|c[oó]digo de (?:acceso|verificaci[oó]n|seguridad)|pin)' +
  '(?:\\s+(?:de|del|of|for|para|en|on|to|in|da|do|du|von|f[üu]r|my|mi|su|the|la|el|[\\p{L}\\p{N}._-]{2,24})){0,3}?\\s*(?<sep>[:=]|' + B + '(?:is|es|era|was|é|est|ist|sería|would be)' + E + ')\\s*["\'«]?(?<v>[^\\s"\'»]{3,})',
  'giu'
)

/** Palabras que describen en vez de revelar («la contraseña es obligatoria»). */
const DESCRIPTIVE = new Set(['necesaria', 'necesario', 'obligatoria', 'obligatorio', 'segura', 'seguro', 'larga', 'corta', 'correcta', 'incorrecta', 'secreta',
  'privada', 'personal', 'nueva', 'vieja', 'temporal', 'distinta', 'diferente', 'importante', 'required', 'needed', 'necessary', 'secret',
  'private', 'strong', 'weak', 'long', 'short', 'correct', 'wrong', 'new', 'old', 'temporary', 'different', 'important', 'optional', 'opcional',
  'the', 'una', 'uno', 'la', 'el', 'lo', 'mi', 'su', 'tu', 'my', 'your', 'his', 'her', 'same', 'misma', 'mismo', 'igual', 'esa', 'esta', 'that', 'this'])

/** Nombres corrientes («clave», «pass», «código») que solo cuentan si el valor tiene forma de secreto. */
const WEAK_ASSIGNMENT = new RegExp(
  B + '(?:clave|pass|pwd|c[oó]digo|code|key|llave|usuario y contrase[ñn]a)\\s*(?:[:=]|' + B + '(?:is|es|era|was)' + E + ')\\s*["\'«]?(?<v>[^\\s"\'»]{4,})',
  'giu'
)

/** Cadenas largas con aspecto de generadas (letras y cifras mezcladas, sin espacios). */
const OPAQUE = /(?<![A-Za-z0-9/._-])(?=[A-Za-z0-9_\-+/=]*\d)(?=[A-Za-z0-9_\-+/=]*[A-Za-z])[A-Za-z0-9_\-+/=]{28,}(?![A-Za-z0-9/._-])/gu

/** Números de tarjeta (13–19 cifras, con espacios o guiones; se comprueba Luhn). */
const CARD_LIKE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/gu
/** Documentos y cuentas: SSN (EE. UU.), DNI/NIE (España), IBAN, CPF (Brasil), CURP (México). */
const IDENTITY_NUMBER = /\b\d{3}-\d{2}-\d{4}\b|\b\d{8}[A-HJ-NP-TV-Z]\b|\b[XYZ]\d{7}[A-Z]\b|\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}\b|\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/u
/** Contacto personal (correo y teléfono): no hace falta para estudiar. */
// (empieza donde empieza la palabra: sin eso, un texto largo sin «@» costaba un tiempo cuadrático, 0,2 s con 20 000 letras)
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u
const PHONE = /(?<![\w-])(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?)?\d{3}[ .-]\d{3,4}(?:[ .-]\d{2,4})?(?![\w-])/u

/** Direcciones (http, https, webcal) de un texto. */
const URL_PATTERN = /\b(?:https?|webcal):\/\/[^\s<>"'«»]+/giu
/** Parámetros que llevan una clave (`…?token=…`, `…&authtoken=…`). */
const SECRET_PARAMS = new Set(['token', 'access_token', 'accesstoken', 'auth', 'authtoken', 'auth_token', 'key', 'apikey', 'api_key', 'secret',
  'client_secret', 'sig', 'signature', 'password', 'pass', 'pwd', 'session', 'sessionid', 'sid', 'private_token'])
/** Palabras de direcciones que suelen llevar la clave en el camino (calendarios, fuentes, API, ganchos). */
const FEED_WORDS = ['feed', 'calendar', 'ical', '.ics', 'export', 'token', 'auth', 'hook', '/api/', 'secret', 'private']

function matches(re: RegExp, text: string): RegExpExecArray[] {
  re.lastIndex = 0
  const out: RegExpExecArray[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    out.push(m)
    if (m[0].length === 0) re.lastIndex++
  }
  return out
}

const trimEdge = (s: string, chars: string): string => {
  let a = 0, b = s.length
  while (a < b && chars.includes(s[a])) a++
  while (b > a && chars.includes(s[b - 1])) b--
  return s.slice(a, b)
}

const isUpper = (c: string): boolean => c !== c.toLowerCase() && c === c.toUpperCase()
const isLower = (c: string): boolean => c !== c.toUpperCase() && c === c.toLowerCase()

/** ¿Tiene forma de secreto? (cifras, símbolos, mayúsculas y minúsculas mezcladas o muy largo) */
export function looksGenerated(v: string): boolean {
  const chars = Array.from(v)
  const hasDigit = chars.some((c) => /\p{N}/u.test(c))
  const hasSymbol = chars.some((c) => '!@#$%^&*_+=-?~/.'.includes(c))
  const mixed = chars.length >= 8 && chars.some(isUpper) && chars.some(isLower)
  return hasDigit || hasSymbol || mixed || chars.length >= 16
}

/** Una cadena larga sin espacios es un token si mezcla mayúsculas, minúsculas y cifras, o es hexadecimal larga; no si es un
 * identificador legible con guiones («math112-trigonometria-otono-2026»). */
export function looksLikeToken(s: string): boolean {
  const segments = s.split(/[-_]/).filter((x) => x.length > 0)
  if (segments.length >= 3 && segments.every((x) => x.length <= 14)) return false
  const hex = s.length >= 32 && /^[0-9a-fA-F]+$/.test(s)
  const mixed = /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s)
  return hex || mixed || s.includes('+') || s.includes('/') || s.endsWith('=')
}

export function luhn(digits: string): boolean {
  let sum = 0
  const rev = Array.from(digits).reverse()
  for (let i = 0; i < rev.length; i++) {
    let d = Number(rev[i])
    if (!Number.isInteger(d)) return false
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9 }
    sum += d
  }
  return sum % 10 === 0
}

function queryItems(url: string): Array<[string, string]> {
  const q = url.indexOf('?')
  if (q < 0) return []
  const rest = url.slice(q + 1).split('#')[0]
  return rest.split('&').filter(Boolean).map((p) => {
    const i = p.indexOf('=')
    const dec = (x: string): string => { try { return decodeURIComponent(x.replace(/\+/g, ' ')) } catch { return x } }
    return i < 0 ? [dec(p), ''] : [dec(p.slice(0, i)), dec(p.slice(i + 1))]
  })
}

/** ¿La dirección lleva una clave? En la memoria (`strict`), en cualquier dirección; en el chat, solo en las de calendarios, fuentes y
 * API (un enlace a un documento compartido se puede seguir pegando). */
export function isSecretURL(url: string, strict: boolean): boolean {
  const low = url.toLowerCase()
  if (low.startsWith('webcal://') || low.includes('/feeds/calendars/') || (low.includes('export_execute.php') && low.includes('authtoken='))) return true
  if (/\/private-[0-9a-f]{16,}/.test(low)) return true
  if (queryItems(url).some(([k, v]) => SECRET_PARAMS.has(k.toLowerCase()) && v.length >= 12)) return true
  const i = url.indexOf('://')
  const rest = i >= 0 ? url.slice(i + 3) : url
  const pieces = rest.split(/[/?&=#_.:;,]/).filter((x) => x.length > 0)
  if (!pieces.some((p) => p.length >= 20 && looksLikeToken(p))) return false
  return strict || FEED_WORDS.some((w) => low.includes(w))
}

/** Trozos del texto con direcciones que llevan una clave. */
export function secretURLRanges(text: string, strict: boolean): TextRange[] {
  if (!text.includes('://')) return []
  const out: TextRange[] = []
  for (const m of matches(URL_PATTERN, text)) {
    let end = m.index + m[0].length
    // sin la puntuación final de la frase
    while (end > m.index && '.,;:!?)]'.includes(text[end - 1])) end--
    if (isSecretURL(text.slice(m.index, end), strict)) out.push({ start: m.index, end })
  }
  return out
}

function namedRange(m: RegExpExecArray, name: string): TextRange | undefined {
  const v = m.groups?.[name]
  if (v === undefined) return undefined
  // el valor es lo último de la coincidencia (o lo está el separador antes del valor)
  const at = name === 'v' ? m.index + m[0].length - v.length : m.index + m[0].lastIndexOf(v)
  return { start: at, end: at + v.length }
}

function strongHit(m: RegExpExecArray): boolean {
  const sep = m.groups?.sep ?? ''
  const v = trimEdge(m.groups?.v ?? '', '.,;:!?)»"\'')
  return sep === ':' || sep === '=' || !DESCRIPTIVE.has(fold(v)) || looksGenerated(v)
}

/** Motivo (sin repetir el dato) si el texto lleva algo que nunca se guarda. */
export function secretReason(text: string): string | undefined {
  const keyOrToken = tr('Parece una clave o un token.', 'It looks like a key or a token.')
  const password = tr('Parece una contraseña o un código de acceso.', 'It looks like a password or an access code.')
  if (matches(PREFIXED, text).length || matches(USERINFO, text).length) return keyOrToken
  if (secretURLRanges(text, true).length) return tr('Parece un enlace privado (lleva una clave).', 'It looks like a private link (it carries a key).')
  for (const m of matches(STRONG_ASSIGNMENT, text)) if (strongHit(m)) return password
  for (const m of matches(WEAK_ASSIGNMENT, text)) if (looksGenerated(m.groups?.v ?? '')) return password
  for (const m of matches(OPAQUE, text)) if (looksLikeToken(m[0])) return keyOrToken
  for (const m of matches(CARD_LIKE, text)) {
    const digits = m[0].replace(/\D/g, '')
    if (digits.length >= 13 && luhn(digits)) return tr('Parece un número de tarjeta.', 'It looks like a card number.')
  }
  if (IDENTITY_NUMBER.test(text)) return tr('Parece un número de documento o de cuenta.', 'It looks like an ID or account number.')
  if (EMAIL.test(text) || PHONE.test(text)) return tr('Lleva un correo o un teléfono.', 'It contains an email or a phone number.')
  return undefined
}

/** Lo que el chat tapa antes de mandar el mensaje a la IA y guardarlo (sin correos ni teléfonos, que sí pueden venir al caso):
 * claves con prefijo, contraseñas en direcciones, el VALOR de «mi contraseña de Canvas es …» y números de tarjeta. */
export function chatSecretRanges(text: string): TextRange[] {
  const out: TextRange[] = []
  for (const m of matches(PREFIXED, text)) out.push({ start: m.index, end: m.index + m[0].length })
  for (const m of matches(USERINFO, text)) out.push({ start: m.index, end: m.index + m[0].length })
  for (const m of matches(STRONG_ASSIGNMENT, text)) {
    const r = namedRange(m, 'v')
    if (r && strongHit(m)) out.push(r)
  }
  for (const m of matches(CARD_LIKE, text)) {
    const digits = m[0].replace(/\D/g, '')
    if (digits.length >= 13 && luhn(digits)) out.push({ start: m.index, end: m.index + m[0].length })
  }
  return out
}

/** Sustituye los trozos (de atrás adelante; los que se solapan, una vez). */
export function replaceRanges(text: string, ranges: TextRange[], token: string): string {
  let out = text
  let lastStart = Number.MAX_SAFE_INTEGER
  for (const r of [...ranges].sort((a, b) => b.start - a.start)) {
    if (r.end <= r.start || r.end > lastStart) continue
    out = out.slice(0, r.start) + token + out.slice(r.end)
    lastStart = r.start
  }
  return out
}

// MARK: Datos delicados (solo con confirmación)

type Category = 'health' | 'beliefs' | 'intimate' | 'legal' | 'family'

function reason(c: Category): string {
  switch (c) {
    case 'health': return tr('Habla de salud.', 'It is about health.')
    case 'beliefs': return tr('Habla de creencias o ideas políticas.', 'It is about beliefs or politics.')
    case 'intimate': return tr('Habla de su vida íntima.', 'It is about their private life.')
    case 'legal': return tr('Habla de su situación legal o económica.', 'It is about their legal or financial situation.')
    case 'family': return tr('Habla de asuntos familiares delicados.', 'It is about delicate family matters.')
  }
}

/** Términos que casi nunca son materia de estudio: cuentan estén donde estén (raíces, sin acentos). */
const ALWAYS_SENSITIVE: Array<[string, Category]> = [
  ['tdah', 'health'], ['adhd', 'health'], ['dislexi', 'health'], ['dyslexi', 'health'], ['discalcul', 'health'], ['dyscalcul', 'health'], ['asperger', 'health'],
  ['autismo', 'health'], ['autistic', 'health'], ['autista', 'health'], ['epilep', 'health'], ['anorexi', 'health'], ['bulimi', 'health'], ['autolesi', 'health'], ['self harm', 'health'],
  ['suicid', 'health'], ['ataques de panico', 'health'], ['panic attack', 'health'], ['diagnosticad', 'health'], ['diagnosed', 'health'], ['medicacion', 'health'], ['medication', 'health'],
  ['trastorno de', 'health'], ['orientacion sexual', 'intimate'], ['sexual orientation', 'intimate'], ['transgener', 'intimate'], ['transexual', 'intimate'],
  ['indocumentad', 'legal'], ['undocumented', 'legal'], ['estatus migratorio', 'legal'], ['situacion migratoria', 'legal'], ['immigration status', 'legal'],
  ['antecedentes penales', 'legal'], ['criminal record', 'legal']
]

/** Términos que también son temas de clase («la depresión del punto de congelación»): solo cuentan dichos de la persona. */
const PERSONAL_SENSITIVE: Array<[string, Category]> = [
  ['ansiedad', 'health'], ['anxiety', 'health'], ['depresi', 'health'], ['depress', 'health'], ['enfermedad', 'health'], ['enferma', 'health'], ['illness', 'health'], ['sick', 'health'],
  ['discapacidad', 'health'], ['disability', 'health'], ['disabled', 'health'], ['terapia', 'health'], ['therapy', 'health'], ['psicologo', 'health'], ['psicologa', 'health'],
  ['psiquiatra', 'health'], ['psychiatrist', 'health'], ['therapist', 'health'], ['embarazada', 'health'], ['pregnant', 'health'], ['diabet', 'health'], ['cancer', 'health'],
  ['migrana', 'health'], ['migraine', 'health'], ['insomnio', 'health'], ['insomnia', 'health'], ['alergic', 'health'], ['allergic', 'health'], ['medicamento', 'health'], ['pastillas', 'health'],
  ['catolic', 'beliefs'], ['catholic', 'beliefs'], ['musulman', 'beliefs'], ['muslim', 'beliefs'], ['judio', 'beliefs'], ['judia', 'beliefs'], ['jewish', 'beliefs'], ['evangelic', 'beliefs'],
  ['atea', 'beliefs'], ['ateo', 'beliefs'], ['atheist', 'beliefs'], ['budista', 'beliefs'], ['buddhist', 'beliefs'], ['religios', 'beliefs'], ['religious', 'beliefs'],
  ['de izquierdas', 'beliefs'], ['de derechas', 'beliefs'], ['vota', 'beliefs'], ['votes', 'beliefs'],
  ['gay', 'intimate'], ['lesbiana', 'intimate'], ['lesbian', 'intimate'], ['bisexual', 'intimate'], ['no binari', 'intimate'], ['non binary', 'intimate'],
  ['deuda', 'legal'], ['debt', 'legal'], ['arrestad', 'legal'], ['arrested', 'legal'],
  ['divorci', 'family'], ['maltrato', 'family'], ['abused', 'family'], ['abusad', 'family'], ['fallecio', 'family'], ['murio', 'family'], ['passed away', 'family']
]

/** Lo que suele ir antes cuando se habla de la propia persona («tiene», «sufre», «sus padres»…): hasta tres palabras antes. */
const PERSONAL_MARKERS = new Set(['tiene', 'tengo', 'tenia', 'padece', 'padezco', 'sufre', 'sufro', 'toma', 'tomo', 'soy', 'estoy', 'vive', 'vivo', 'padres', 'madre', 'padre',
  'has', 'have', 'had', 'suffers', 'suffer', 'takes', 'take', 'am', 'im', 'lives', 'parents', 'mother', 'father', 'mom', 'dad', 'tem', 'sou', 'suis', 'bin', 'habe'])
/** Verbos corrientes que solo cuentan justo delante («es católica», «está embarazada»; no «es la depresión…»). */
const ADJACENT_MARKERS = new Set(['es', 'esta', 'fue', 'era', 'is', 'was', 'are', 'est', 'ist', 'e'])

/** Motivo si el texto toca una categoría delicada. */
export function sensitiveReason(text: string): string | undefined {
  const words = fold(text).split(' ').filter((w) => w.length > 0)
  const joined = ' ' + words.join(' ') + ' '
  for (const [term, c] of ALWAYS_SENSITIVE) if (joined.includes(' ' + term)) return reason(c)
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    for (const [term, c] of PERSONAL_SENSITIVE) {
      const parts = term.split(' ')
      if (!w.startsWith(parts[0])) continue
      if (parts.length > 1 && !parts.slice(1).every((p, k) => words[i + 1 + k] === p)) continue
      // palabras cortas solo enteras («gay», «ateo»)
      if (parts.length === 1 && term.length <= 4 && w !== term) continue
      const before = words.slice(Math.max(0, i - 3), i)
      if (before.some((b) => PERSONAL_MARKERS.has(b))) return reason(c)
      if (i > 0 && ADJACENT_MARKERS.has(words[i - 1])) return reason(c)
    }
  }
  return undefined
}

export function privacyCheck(text: string): PrivacyVerdict {
  const s = secretReason(text)
  if (s) return { kind: 'secret', why: s }
  const d = sensitiveReason(text)
  if (d) return { kind: 'sensitive', why: d }
  return { kind: 'ok' }
}

/** Prepara un turno para la IA que extrae recuerdos: con algo con forma de secreto, el turno entero se sustituye por un aviso. */
export function redactForExtraction(text: string): string {
  return secretReason(text) === undefined ? text : '[' + tr('mensaje con datos privados omitido', 'message with private data left out') + ']'
}

export const MemoryPrivacy = {
  check: privacyCheck, secretReason, sensitiveReason, secretURLRanges, chatSecretRanges, isSecretURL, looksGenerated, looksLikeToken, luhn, redactForExtraction
}
