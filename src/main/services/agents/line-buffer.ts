// Troceado en líneas de un flujo de bytes y cola acotada de texto (port de `AgentKit/CLI/LineBuffer.swift`).

const decoder = new TextDecoder('utf-8', { fatal: false })

/**
 * Separa en líneas un flujo de bytes que llega en trozos arbitrarios. Corta por `\n` (que nunca aparece dentro de un carácter
 * UTF-8 de varios bytes), quita el `\r` final y descarta enteras las líneas de más de `maxLineBytes` (las cuenta en `droppedLines`).
 */
export class LineBuffer {
  private parts: Buffer[] = []
  private size = 0
  private discarding = false
  /** Líneas descartadas por superar el tamaño máximo. */
  droppedLines = 0

  constructor(readonly maxLineBytes = 16 * 1024 * 1024) {}

  /** Añade un trozo y devuelve las líneas completas que contiene (sin el salto). */
  append(chunk: Uint8Array): string[] {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    const lines: string[] = []
    let start = 0
    while (start < data.length) {
      const newline = data.indexOf(0x0a, start)
      if (newline < 0) break
      if (this.discarding) {
        this.discarding = false
      } else {
        this.push(data.subarray(start, newline))
        if (this.size > this.maxLineBytes) this.droppedLines += 1
        else lines.push(this.decode())
        this.reset()
      }
      start = newline + 1
    }
    if (start < data.length && !this.discarding) {
      this.push(data.subarray(start))
      if (this.size > this.maxLineBytes) {
        this.reset()
        this.discarding = true
        this.droppedLines += 1
      }
    }
    return lines
  }

  /** Lo que quede sin salto de línea al llegar a EOF. */
  finish(): string | undefined {
    const pending = !this.discarding && this.size > 0 ? this.decode() : undefined
    this.reset()
    this.discarding = false
    return pending
  }

  get pendingByteCount(): number {
    return this.size
  }

  private push(b: Buffer): void {
    if (b.length === 0) return
    // se copia: el trozo de origen puede reutilizarse
    this.parts.push(Buffer.from(b))
    this.size += b.length
  }

  private reset(): void {
    this.parts = []
    this.size = 0
  }

  private decode(): string {
    let data = this.parts.length === 1 ? this.parts[0] : Buffer.concat(this.parts, this.size)
    if (data.length > 0 && data[data.length - 1] === 0x0d) data = data.subarray(0, data.length - 1)
    return decoder.decode(data)
  }
}

/** Guarda solo el final de un flujo (para mensajes de error), con un tope de bytes. */
export class TailBuffer {
  private storage = Buffer.alloc(0)
  truncated = false

  constructor(readonly capacity = 32 * 1024) {}

  append(chunk: Uint8Array): void {
    const data = Buffer.from(chunk)
    if (data.length >= this.capacity) {
      this.storage = Buffer.from(data.subarray(data.length - this.capacity))
      this.truncated = true
      return
    }
    const merged = Buffer.concat([this.storage, data])
    if (merged.length > this.capacity) {
      this.storage = Buffer.from(merged.subarray(merged.length - this.capacity))
      this.truncated = true
    } else {
      this.storage = merged
    }
  }

  /** Texto acumulado (recortado por el principio si hizo falta). */
  get text(): string {
    let value = decoder.decode(this.storage)
    if (this.truncated) value = '…' + value
    return value.trim()
  }
}
