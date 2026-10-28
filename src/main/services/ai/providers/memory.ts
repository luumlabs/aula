// Memorias de proceso de los proveedores: el razonamiento firmado que hay que reenviar (ThinkingVault) y los parámetros que
// cada servidor ya rechazó (FixupMemory). Port de ThinkingVault.swift y FixupMemory.swift.
import { baseURLParts } from '../http/endpoints'

/** Esqueleto de una respuesta del asistente, en el orden original. */
export type VaultBlock =
  | { type: 'thinking'; text: string; signature: string }
  | { type: 'redacted'; data: string }
  | { type: 'text'; text: string }
  | { type: 'toolUse'; id: string }
  /** Elemento opaco de otra API (un `reasoning` con `encrypted_content` de la Responses API), en JSON compacto. */
  | { type: 'item'; raw: string }

function blockSize(blocks: VaultBlock[]): number {
  let n = 0
  for (const b of blocks) {
    switch (b.type) {
      case 'thinking':
        n += b.text.length + b.signature.length + 32
        break
      case 'redacted':
        n += b.data.length + 32
        break
      case 'text':
        n += b.text.length + 16
        break
      case 'toolUse':
        n += b.id.length + 16
        break
      case 'item':
        n += b.raw.length + 16
        break
    }
  }
  return n
}

/**
 * Guarda los bloques de razonamiento firmados (Anthropic `thinking` con `signature`, `redacted_thinking`; OpenAI
 * `reasoning` cifrado) de cada respuesta que usó herramientas, para devolverlos intactos en la petición siguiente.
 * Indexado por el id de cada `tool_use`; acotado en número y en bytes (si falta, el mensaje va sin razonamiento).
 */
export class ThinkingVault {
  /** Compartido por todos los proveedores del proceso: los ids de `tool_use` son únicos. */
  static readonly shared = new ThinkingVault()

  private entries = new Map<string, VaultBlock[]>()
  private order: string[] = []
  private bytes = 0

  constructor(private readonly maxEntries = 512, private readonly maxBytes = 24 * 1024 * 1024) {}

  store(blocks: VaultBlock[]): void {
    const ids = blocks.flatMap((b) => (b.type === 'toolUse' ? [b.id] : []))
    if (!ids.length) return
    const size = blockSize(blocks)
    for (const id of ids) {
      const old = this.entries.get(id)
      if (old) {
        this.bytes -= blockSize(old)
        this.order = this.order.filter((x) => x !== id)
      }
      this.entries.set(id, blocks)
      this.order.push(id)
      this.bytes += size
    }
    while ((this.entries.size > this.maxEntries || this.bytes > this.maxBytes) && this.order.length) {
      const oldest = this.order.shift()!
      const e = this.entries.get(oldest)
      if (e) {
        this.entries.delete(oldest)
        this.bytes -= blockSize(e)
      }
    }
  }

  lookup(toolUseID: string): VaultBlock[] | undefined {
    return this.entries.get(toolUseID)
  }

  purge(toolUseIDs: string[]): void {
    for (const id of toolUseIDs) {
      const e = this.entries.get(id)
      if (e) {
        this.entries.delete(id)
        this.bytes -= blockSize(e)
        this.order = this.order.filter((x) => x !== id)
      }
    }
  }

  removeAll(): void {
    this.entries.clear()
    this.order = []
    this.bytes = 0
  }

  get count(): number {
    return this.entries.size
  }
}

/**
 * Lo que cada servidor y modelo no admite, aprendido de sus 400 mientras la app está abierta: el bucle crea una petición
 * nueva en cada paso y, sin esto, cada paso repetía el 400 (el doble de peticiones). Solo se recuerdan parámetros quitados o
 * renombrados, nunca lo que depende del historial.
 */
export class FixupMemory {
  static readonly shared = new FixupMemory()
  private learned = new Map<string, Set<string>>()

  /** Clave: servidor (con puerto) y modelo. */
  static key(baseURL: string | undefined, model: string): string {
    let host = ''
    try {
      const p = baseURLParts(baseURL)
      host = p.hostname + (p.port ? ':' + p.port : '')
    } catch {
      host = ''
    }
    return host.toLowerCase() + '|' + model
  }

  tags(key: string): Set<string> {
    return new Set(this.learned.get(key) ?? [])
  }

  learn(key: string, tags: Iterable<string>): void {
    const add = [...tags]
    if (!add.length) return
    const cur = this.learned.get(key) ?? new Set<string>()
    for (const t of add) cur.add(t)
    this.learned.set(key, cur)
  }

  /** Para pruebas. */
  reset(): void {
    this.learned.clear()
  }
}
