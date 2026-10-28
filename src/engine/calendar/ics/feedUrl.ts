// Direcciones de calendarios .ics (la parte isomorfa de CanvasKit/ICS/ICSFeed.swift): normalizar lo que pega el estudiante,
// `webcal://` → `https://`, solo https (o http hacia localhost) y reconocer si unos bytes empiezan como un calendario.
// La propia dirección es el secreto: nunca se registra ni se muestra completa (`feedHost`).
import { decodeUTF16 } from './parser'

/** ¿Es un servidor local? (`localhost`, `127.0.0.1`, `::1`, `*.localhost`) */
export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost')
}

function parseURL(text: string): URL | null {
  try {
    return new URL(text)
  } catch {
    return null
  }
}

/** ¿Se puede pedir esta dirección? https con servidor, o http hacia localhost (pruebas). */
export function isAllowedFeedURL(url: string | URL): boolean {
  const u = typeof url === 'string' ? parseURL(url) : url
  if (!u || !u.hostname) return false
  const scheme = u.protocol.replace(/:$/, '').toLowerCase()
  if (scheme === 'https') return true
  if (scheme === 'http') return isLoopbackHost(u.hostname)
  return false
}

/** Lo que escribe el estudiante → dirección aceptable: sin espacios, `webcal(s)://` → `https://`, `https://` si falta.
 *  `null` si no vale (otro esquema, sin servidor, con usuario y contraseña, o con espacios dentro). */
export function normalizeFeedURL(text: string): string | null {
  let s = text.trim()
  if (!s || /\s/.test(s)) return null
  const lower = s.toLowerCase()
  if (lower.startsWith('webcals://')) s = 'https://' + s.slice('webcals://'.length)
  else if (lower.startsWith('webcal://')) s = 'https://' + s.slice('webcal://'.length)
  else if (!s.includes('://')) s = 'https://' + s
  // «https://» a secas o «https:///x» no tienen servidor
  if (/^[a-z][a-z0-9+.-]*:\/\/(?:[/?#]|$)/i.test(s)) return null
  const u = parseURL(s)
  if (!u || !u.hostname || u.username || u.password || !isAllowedFeedURL(u)) return null
  return u.toString()
}

/** `webcal://` → `https://`; `null` si no es https (o http hacia localhost). */
export function upgradeFeedURL(url: string): string | null {
  const u = parseURL(url.trim())
  if (!u) return null
  const scheme = u.protocol.replace(/:$/, '').toLowerCase()
  if (scheme === 'webcal' || scheme === 'webcals') {
    const fixed = parseURL('https:' + url.trim().slice(url.trim().indexOf(':') + 1))
    return fixed && isAllowedFeedURL(fixed) ? fixed.toString() : null
  }
  return isAllowedFeedURL(u) ? u.toString() : null
}

/** Solo el servidor de una dirección (para los mensajes y registros: la ruta lleva el token del calendario). */
export function feedHost(url: string): string {
  return parseURL(url)?.hostname || '?'
}

/** ¿Empieza como un calendario (`BEGIN:VCALENDAR`, tras un posible BOM o espacios)? Acepta UTF-8, Latin-1 y UTF-16. */
export function looksLikeCalendar(data: Uint8Array | string): boolean {
  let text: string
  if (typeof data === 'string') text = data.slice(0, 4096)
  else {
    const head = data.subarray(0, 4096)
    text = decodeUTF16(head) ?? new TextDecoder('utf-8').decode(head)
  }
  return /BEGIN:VCALENDAR/i.test(text)
}
