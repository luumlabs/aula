// Analizador incremental de Server-Sent Events (port de SSEParser.swift).
//
// Trabaja sobre BYTES: una línea solo se decodifica como UTF-8 cuando está completa, así que un carácter partido entre dos
// trozos de red (media «ñ» o medio emoji) nunca se corrompe. Cumple la especificación de `text/event-stream`: finales de
// línea `\n`, `\r\n` o `\r` (también con el `\r\n` partido entre trozos), comentarios `:`, eventos separados por una línea en
// blanco, varias líneas `data:` unidas con `\n`, un único espacio inicial del valor fuera y el BOM inicial descartado.
// Tolerancias propias: `finish()` entrega el evento pendiente aunque falte la línea en blanco final, y las líneas gigantes
// (> maxLineBytes) se descartan en vez de agotar la memoria.

export interface SSEEvent {
  /** Nombre del evento (`event:`), si lo hubo. */
  event?: string
  /** Datos (`data:`); varias líneas se unen con `\n`. */
  data: string
  id?: string
  /** `retry:` en milisegundos. */
  retry?: number
}

export function isDoneEvent(e: SSEEvent): boolean {
  return e.data.trim() === '[DONE]'
}

const encoder = new TextEncoder()

export class SSEParser {
  private parts: Uint8Array[] = []
  private lineLen = 0
  private skipNextLF = false
  private overflowing = false
  private atStreamStart = true
  private eventName: string | undefined
  private dataLines: string[] = []
  private eventID: string | undefined
  private eventRetry: number | undefined
  private readonly maxLineBytes: number
  // `ignoreBOM`: el decodificador NO debe quitar un BOM al principio de cada línea (solo vale el del inicio del flujo)
  private readonly decoder = new TextDecoder('utf-8', { ignoreBOM: true })

  /** Último `id:` visto (persiste entre eventos). */
  lastEventID: string | undefined
  /** Último `retry:` visto, en milisegundos. */
  retryMilliseconds: number | undefined
  /** Líneas descartadas por superar `maxLineBytes`. */
  droppedLines = 0
  /** Líneas de comentario recibidas (saber que el servidor sigue vivo). */
  commentLines = 0
  totalBytes = 0

  constructor(maxLineBytes = 8 * 1024 * 1024) {
    this.maxLineBytes = Math.max(1, maxLineBytes)
  }

  /** Procesa un trozo (bytes o texto) y devuelve los eventos que quedaron completos. */
  feed(chunk: Uint8Array | string): SSEEvent[] {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk
    const events: SSEEvent[] = []
    this.totalBytes += bytes.length
    let start = 0
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]
      if (this.skipNextLF) {
        this.skipNextLF = false
        if (b === 0x0a) {
          start = i + 1 // la segunda mitad de un \r\n
          continue
        }
      }
      if (b === 0x0d || b === 0x0a) {
        this.append(bytes.subarray(start, i))
        this.endLine(events)
        if (b === 0x0d) this.skipNextLF = true
        start = i + 1
      }
    }
    this.append(bytes.subarray(start))
    return events
  }

  /** Fin del flujo: procesa una última línea sin salto y entrega el evento pendiente, si lo hay. */
  finish(): SSEEvent[] {
    const events: SSEEvent[] = []
    if (this.lineLen > 0 && !this.overflowing) this.endLine(events)
    this.dispatch(events)
    this.parts = []
    this.lineLen = 0
    this.overflowing = false
    this.skipNextLF = false
    return events
  }

  private append(seg: Uint8Array): void {
    if (this.overflowing || seg.length === 0) return
    this.parts.push(seg.slice())
    this.lineLen += seg.length
    if (this.lineLen > this.maxLineBytes) {
      this.overflowing = true
      this.droppedLines += 1
      this.parts = []
      this.lineLen = 0
    }
  }

  private takeLine(): Uint8Array {
    if (this.parts.length === 1) {
      const only = this.parts[0]
      this.parts = []
      this.lineLen = 0
      return only
    }
    const out = new Uint8Array(this.lineLen)
    let off = 0
    for (const p of this.parts) {
      out.set(p, off)
      off += p.length
    }
    this.parts = []
    this.lineLen = 0
    return out
  }

  private endLine(events: SSEEvent[]): void {
    if (this.overflowing) {
      this.overflowing = false
      this.parts = []
      this.lineLen = 0
      this.atStreamStart = false
      return
    }
    let bytes = this.takeLine()
    if (this.atStreamStart) {
      this.atStreamStart = false
      if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3)
    }
    if (bytes.length === 0) {
      this.dispatch(events)
      return
    }
    if (bytes[0] === 0x3a) {
      this.commentLines += 1 // ':' → comentario
      return
    }
    const text = this.decoder.decode(bytes)
    const colon = text.indexOf(':')
    let field: string
    let value: string
    if (colon >= 0) {
      field = text.slice(0, colon)
      value = text.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)
    } else {
      field = text
      value = ''
    }
    switch (field) {
      case 'event':
        this.eventName = value
        break
      case 'data':
        this.dataLines.push(value)
        break
      case 'id':
        if (!value.includes('\u0000')) {
          this.eventID = value
          this.lastEventID = value
        }
        break
      case 'retry':
        if (/^[0-9]+$/.test(value)) {
          const n = Number(value)
          if (Number.isSafeInteger(n)) {
            this.retryMilliseconds = n
            this.eventRetry = n
          }
        }
        break
      default:
        break // campos desconocidos: se ignoran
    }
  }

  private dispatch(events: SSEEvent[]): void {
    if (this.dataLines.length) {
      const e: SSEEvent = { data: this.dataLines.join('\n') }
      if (this.eventName !== undefined) e.event = this.eventName
      if (this.eventID !== undefined) e.id = this.eventID
      if (this.eventRetry !== undefined) e.retry = this.eventRetry
      events.push(e)
    }
    this.eventName = undefined
    this.dataLines = []
    this.eventID = undefined
    this.eventRetry = undefined
  }
}
