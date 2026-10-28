// Limpieza y validación de una clave de API pegada por la persona (port de AICore/APIKeyFormat.swift). La misma regla al
// GUARDARLA (ajustes, bienvenida) y al USARLA, para que el error salga donde se pegó.
import { tr } from './i18n'

export type APIKeyProblem = 'empty' | 'invalidCharacters'

const QUOTES = new Set(['"', "'", '“', '”', '‘', '’', '`'])

function trimQuotes(s: string): string {
  let a = 0
  let b = s.length
  while (a < b && QUOTES.has(s[a])) a++
  while (b > a && QUOTES.has(s[b - 1])) b--
  return s.slice(a, b)
}

/** Quita espacios y saltos de línea de los extremos, las comillas que la envuelven y un «Bearer » delante. */
export function cleanAPIKey(raw: string): string {
  let key = trimQuotes(raw.trim()).trim()
  if (key.toLowerCase().startsWith('bearer ')) key = key.slice(7).trim()
  return key
}

/** La clave limpia o el problema que impide usarla. Solo ASCII visible (0x21–0x7E), como exige una cabecera HTTP. */
export function validateAPIKey(raw: string): { ok: true; key: string } | { ok: false; problem: APIKeyProblem } {
  const key = cleanAPIKey(raw)
  if (!key) return { ok: false, problem: 'empty' }
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i)
    if (c < 0x21 || c > 0x7e) return { ok: false, problem: 'invalidCharacters' }
  }
  return { ok: true, key }
}

/** «La clave de API de <proveedor> contiene espacios…» (el mismo texto al guardar y al usarla). */
export function invalidKeyCharactersMessage(provider: string): string {
  return tr(
    `La clave de API de ${provider} contiene espacios, saltos de línea u otros caracteres no válidos (a veces se cuelan al copiarla). Vuelve a pegarla en los ajustes de IA.`,
    `The API key for ${provider} contains spaces, line breaks, or other invalid characters (they sometimes sneak in when you copy it). Paste it again in AI settings.`
  )
}

/** Pista para la interfaz sin revelar la clave: «sk-…a1b2». */
export function maskAPIKey(key: string): string {
  const k = key.trim()
  if (k.length < 10) return '••••'
  const dash = k.indexOf('-')
  const prefix = dash > 0 && dash <= 6 ? k.slice(0, dash + 1) : ''
  return `${prefix}…${k.slice(-4)}`
}
