// Unión de los fragmentos de llamadas a herramientas (port de ToolCallAssembler y ToolCallIndexer) y montaje de la respuesta.
import type { JSONValue } from '@shared/ai/json'
import type { ChatEvent, ChatResponse, FinishReason, ToolCall, Usage } from '@shared/ai/types'
import { emptyUsage, msg } from '@shared/ai/types'
import { fixLaTeXInValue, tryParseLenientJSON } from './repair'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Identificador corto aleatorio (minúsculas y dígitos). */
export function shortId(n = 8): string {
  let s = ''
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return s
}

interface PartialCall {
  id?: string
  name: string
  args: string
}

/** Une los fragmentos `tool_call` en llamadas completas (con reparación de JSON y del LaTeX mal escapado). */
export class ToolCallAssembler {
  private parts = new Map<number, PartialCall>()

  add(index: number, id: string | undefined, name: string | undefined, fragment: string): void {
    const p = this.parts.get(index) ?? { name: '', args: '' }
    if (id) p.id = id
    if (name) p.name = name // el nombre llega entero una vez; si repite, se conserva
    p.args += fragment
    this.parts.set(index, p)
  }

  get isEmpty(): boolean {
    return this.parts.size === 0
  }

  calls(): ToolCall[] {
    const out: ToolCall[] = []
    for (const idx of [...this.parts.keys()].sort((a, b) => a - b)) {
      const p = this.parts.get(idx)
      if (!p || !p.name) continue
      const raw = p.args.trim()
      const args: JSONValue = raw ? (tryParseLenientJSON(raw) ?? { _unparsed: raw }) : {}
      out.push({ id: p.id ?? `call_${idx}_${shortId(6)}`, name: p.name, arguments: fixLaTeXInValue(args), rawArguments: raw })
    }
    return out
  }
}

/**
 * Asigna un índice estable a cada fragmento de llamada. Algunos proveedores entregan la llamada entera sin `index`,
 * reutilizan `index: 0` para llamadas paralelas distintas (cada una con su `id`) o repiten el `id` en todos los fragmentos.
 */
export class ToolCallIndexer {
  private byProviderIndex = new Map<number, number>()
  private idOfEffective = new Map<number, string>()
  private effectiveOfID = new Map<string, number>()
  private named = new Set<number>()
  private next = 0
  private last: number | undefined

  private allocate(): number {
    const v = this.next
    this.next += 1
    this.last = v
    return v
  }

  resolve(index: number | undefined, rawID: string | undefined, rawName: string | undefined): number {
    const id = rawID ? rawID : undefined
    const name = rawName ? rawName : undefined
    let eff: number
    if (index !== undefined) {
      const existing = this.byProviderIndex.get(index)
      if (existing !== undefined) {
        const known = this.idOfEffective.get(existing)
        if (id && known !== undefined && known !== id && this.named.has(existing)) {
          eff = this.allocate() // mismo `index` reutilizado para otra llamada
          this.byProviderIndex.set(index, eff)
        } else eff = existing
      } else {
        eff = this.allocate()
        this.byProviderIndex.set(index, eff)
      }
    } else if (id) {
      eff = this.effectiveOfID.get(id) ?? this.allocate()
    } else if (name) {
      eff = this.last !== undefined && !this.named.has(this.last) ? this.last : this.allocate()
    } else {
      eff = this.last ?? this.allocate()
    }
    if (id && !this.idOfEffective.has(eff)) {
      this.idOfEffective.set(eff, id)
      this.effectiveOfID.set(id, eff)
    }
    if (name) this.named.add(eff)
    this.last = eff
    return eff
  }
}

/** Acumula los eventos de un flujo y arma la respuesta final (lo que hace `ChatProvider.complete` en Swift). */
export class ResponseCollector {
  text = ''
  reasoning = ''
  readonly assembler = new ToolCallAssembler()
  usage: Usage = emptyUsage()
  finish: FinishReason = 'stop'
  sawOutput = false

  add(e: ChatEvent): void {
    switch (e.type) {
      case 'text':
        this.text += e.text
        if (e.text) this.sawOutput = true
        break
      case 'reasoning':
        this.reasoning += e.text
        if (e.text) this.sawOutput = true
        break
      case 'tool_call':
        this.assembler.add(e.index, e.id, e.name, e.argumentsFragment)
        this.sawOutput = true
        break
      case 'usage':
        this.usage = e.usage
        break
      case 'finished':
        this.finish = e.finish
        break
    }
  }

  response(): ChatResponse {
    const calls = this.assembler.calls()
    let finish = this.finish
    if (calls.length && finish === 'stop') finish = 'toolCalls'
    return { message: msg.assistant(this.text, calls, this.reasoning || undefined), usage: this.usage, finish }
  }
}

/** La respuesta que daría una lista de eventos (útil para modelos simulados y adaptadores). */
export function responseFromEvents(events: ChatEvent[]): ChatResponse {
  const c = new ResponseCollector()
  for (const e of events) c.add(e)
  return c.response()
}
