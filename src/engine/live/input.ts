// Lo que el estudiante hace sobre la imagen del navegador en vivo llega de un dispositivo: aquí se comprueba y se acota
// antes de tocar la ventana (cuántos eventos, qué teclas, cuánto texto) y se traduce a posiciones de la página. Puro.
import type { LiveInput } from '@shared/live/types'

export const MAX_EVENTS = 32
export const MAX_TEXT = 4000
/** Tamaños de página admitidos (un teléfono estrecho … un escritorio). */
export const VIEWPORT_LIMITS = { minW: 320, maxW: 1600, minH: 400, maxH: 1600 }
export const DEFAULT_VIEWPORT = { width: 1100, height: 760 }

/** Teclas con nombre que se pueden mandar (además de un solo carácter). El valor es el `keyCode` de Electron. */
export const KEY_CODES: Readonly<Record<string, string>> = {
  Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape', Delete: 'Delete', Space: 'Space',
  ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown'
}

const frac = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null)
const delta = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(2400, Math.max(-2400, Math.round(v))) : 0)

/** Los eventos válidos de una lista que llega de fuera (lo raro se descarta; como mucho `MAX_EVENTS`). */
export function sanitizeLiveInput(raw: unknown): LiveInput[] {
  if (!Array.isArray(raw)) return []
  const out: LiveInput[] = []
  for (const item of raw.slice(0, MAX_EVENTS)) {
    const e = item as Record<string, unknown> | null
    if (!e || typeof e !== 'object') continue
    switch (e.type) {
      case 'tap': {
        const x = frac(e.x)
        const y = frac(e.y)
        if (x === null || y === null) break
        const count = e.count === 2 || e.count === 3 ? e.count : 1
        out.push({ type: 'tap', x, y, ...(count > 1 ? { count } : {}) })
        break
      }
      case 'wheel': {
        const x = frac(e.x)
        const y = frac(e.y)
        const dx = delta(e.dx)
        const dy = delta(e.dy)
        if (x === null || y === null || (!dx && !dy)) break
        out.push({ type: 'wheel', x, y, dx, dy })
        break
      }
      case 'text': {
        if (typeof e.text !== 'string' || !e.text) break
        // sin caracteres de control (un salto de línea se manda como tecla Enter)
        // eslint-disable-next-line no-control-regex
        const text = e.text.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_TEXT)
        if (text) out.push({ type: 'text', text })
        break
      }
      case 'key': {
        if (typeof e.key !== 'string') break
        const named = Object.prototype.hasOwnProperty.call(KEY_CODES, e.key)
        const single = [...e.key].length === 1 && e.key >= ' '
        if (!named && !single) break
        out.push({ type: 'key', key: e.key, ...(e.shift === true ? { shift: true } : {}), ...(e.alt === true ? { alt: true } : {}), ...(e.ctrl === true ? { ctrl: true } : {}), ...(e.meta === true ? { meta: true } : {}) })
        break
      }
    }
  }
  return out
}

/** De fracción de la página a punto (px enteros dentro de la página). */
export function toPoint(x: number, y: number, size: { width: number; height: number }): { x: number; y: number } {
  return { x: Math.min(size.width - 1, Math.max(0, Math.round(x * size.width))), y: Math.min(size.height - 1, Math.max(0, Math.round(y * size.height))) }
}

/** El tamaño de página que se puede poner (acotado y entero). */
export function clampViewport(width: unknown, height: unknown): { width: number; height: number } {
  const n = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d)
  return { width: n(width, VIEWPORT_LIMITS.minW, VIEWPORT_LIMITS.maxW, DEFAULT_VIEWPORT.width), height: n(height, VIEWPORT_LIMITS.minH, VIEWPORT_LIMITS.maxH, DEFAULT_VIEWPORT.height) }
}

/** El tamaño de la imagen que se manda: la página reducida para que no pase de `maxWidth` (nunca ampliada). */
export function frameSize(page: { width: number; height: number }, maxWidth: unknown): { w: number; h: number } {
  const max = typeof maxWidth === 'number' && Number.isFinite(maxWidth) ? Math.min(1600, Math.max(240, Math.round(maxWidth))) : 1000
  const scale = Math.min(1, max / Math.max(1, page.width))
  return { w: Math.max(1, Math.round(page.width * scale)), h: Math.max(1, Math.round(page.height * scale)) }
}

/** Qué teclado conviene para un campo (por su tipo y sus pistas). */
export function fieldKind(type: string, inputMode: string, autocomplete: string): 'text' | 'password' | 'email' | 'number' | 'tel' | 'url' | 'search' | 'code' {
  const t = type.toLowerCase()
  const ac = autocomplete.toLowerCase()
  if (t === 'password' || ac.includes('password')) return 'password'
  if (ac === 'one-time-code') return 'code'
  if (t === 'email' || inputMode === 'email' || ac === 'email' || ac === 'username') return 'email'
  if (t === 'number' || inputMode === 'numeric' || inputMode === 'decimal') return 'number'
  if (t === 'tel' || inputMode === 'tel') return 'tel'
  if (t === 'url' || inputMode === 'url') return 'url'
  if (t === 'search' || inputMode === 'search') return 'search'
  return 'text'
}

/** ¿Un campo cuyo contenido Aula no debe leer nunca? (contraseñas, códigos de un solo uso, datos de pago). */
export function isPrivateField(type: string, autocomplete: string, name: string): boolean {
  const t = type.toLowerCase()
  const hint = `${autocomplete} ${name}`.toLowerCase()
  return t === 'password' || t === 'hidden' || /password|passwd|one-time-code|otp|cc-|card|cvv|cvc|iban|ssn|secret|token/.test(hint)
}
