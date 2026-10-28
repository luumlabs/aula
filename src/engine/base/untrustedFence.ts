// Valla anti-inyección (port de BaseKit/UntrustedFence.swift): todo lo que escribe una página o un archivo ajeno llega a la
// IA dentro de `<<<CONTENIDO_NO_CONFIABLE id=…>>> … <<<FIN_CONTENIDO_NO_CONFIABLE id=…>>>` con un id ALEATORIO por lectura.
// Esto reduce el riesgo de inyección de instrucciones; no lo elimina.

export const FENCE_OPEN = '<<<CONTENIDO_NO_CONFIABLE'
export const FENCE_CLOSE = '<<<FIN_CONTENIDO_NO_CONFIABLE'

/** 16 hex aleatorios (generador criptográfico). */
export function fenceRandomID(): string {
  const a = new Uint8Array(8)
  const c = (globalThis as { crypto?: { getRandomValues?: (x: Uint8Array) => Uint8Array } }).crypto
  if (c?.getRandomValues) c.getRandomValues(a)
  else for (let i = 0; i < 8; i++) a[i] = Math.floor(Math.random() * 256)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Parte cada racha de 3 o más `<` o `>` en trozos de 2 separados por espacios, que nunca forman un marcador.
 * Los `<` se agrupan por la derecha y los `>` por la izquierda: `<<<` → `< <<`, `>>>` → `>> >`.
 */
export function breakMarkers(text: string): string {
  if (!text.includes('<<<') && !text.includes('>>>')) return text
  return text.replace(/<{3,}|>{3,}/g, (run) => {
    const c = run[0]
    const pairs = Array(Math.floor(run.length / 2)).fill(c + c) as string[]
    const odd = run.length % 2 === 1
    const pieces = c === '<' ? (odd ? ['<', ...pairs] : pairs) : (odd ? [...pairs, '>'] : pairs)
    return pieces.join(' ')
  })
}

/** Valor de cabecera: sin marcas, sin saltos de línea ni espacios (que separan campos), acotado. */
export function fenceHeaderValue(value: string): string {
  const flat = Array.from(value).map((ch) => (/[\s\p{Cc}\p{Cf}]/u.test(ch) ? '%20' : ch)).join('')
  return Array.from(breakMarkers(flat).replace(/>/g, '%3E').replace(/</g, '%3C')).slice(0, 600).join('')
}

/** Envuelve `text` con un id nuevo. `fields` va en la cabecera (p. ej. `url`), saneado y en una sola línea. */
export function wrapUntrusted(text: string, source = 'navegador', fields: Array<[string, string]> = []): string {
  const id = fenceRandomID()
  let header = `${FENCE_OPEN} id=${id}`
  if (source) header += ` fuente=${fenceHeaderValue(source)}`
  for (const [k, v] of fields) if (v) header += ` ${fenceHeaderValue(k)}=${fenceHeaderValue(v)}`
  return `${header}>>>\n${breakMarkers(text)}\n${FENCE_CLOSE} id=${id}>>>`
}

export const UntrustedFence = {
  openMarker: FENCE_OPEN,
  closeMarker: FENCE_CLOSE,
  wrap: wrapUntrusted,
  randomID: fenceRandomID,
  breakMarkers,
  headerValue: fenceHeaderValue
}
