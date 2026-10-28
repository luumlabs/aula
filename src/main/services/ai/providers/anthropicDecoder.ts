// Eventos SSE de `POST /v1/messages` (y la respuesta completa) → eventos de chat (port de AnthropicStreamDecoder.swift).
// Uso: entrada = `input_tokens + cache_read + cache_creation`, con lecturas (`cachedTokens`) y escrituras (`cacheWriteTokens`) aparte.
// Si la respuesta usó herramientas y trajo razonamiento firmado, su esqueleto se guarda para reenviarlo en el paso siguiente.
import type { JSONValue } from '@shared/ai/json'
import type { ChatEvent, FinishReason } from '@shared/ai/types'
import { AIError } from '../errors'
import { arr, at, canonicalJSON, int, obj, str, tryParseJSON } from '../core/json'
import type { SSEEvent } from '../http/sse'
import type { ChatStreamDecoder } from '../http/streaming'
import { fromStreamError, type ErrorContext } from '../http/providerErrors'
import { cutText, noAnswerText } from './common'
import { ThinkingVault, type VaultBlock } from './memory'

type BlockKind = 'text' | 'thinking' | 'redacted' | 'toolUse' | 'other'
interface BlockState {
  kind: BlockKind
  text: string
  signature: string
  data: string
  toolID: string
  toolIndex: number
}

const block = (kind: BlockKind, init: Partial<BlockState> = {}): BlockState => ({ kind, text: '', signature: '', data: '', toolID: '', toolIndex: -1, ...init })

export function mapAnthropicStop(raw: string): FinishReason {
  switch (raw) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop'
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'length'
    case 'tool_use':
      return 'toolCalls'
    case 'refusal':
      return 'contentFilter'
    default:
      return 'other'
  }
}

export class AnthropicStreamDecoder implements ChatStreamDecoder {
  private blocks = new Map<number, BlockState>()
  private order: number[] = []
  private toolCounter = 0
  private inputTokens = 0
  private cacheRead = 0
  private cacheCreate = 0
  private outputTokens = 0
  private thinkingTokens = 0
  private sawUsage = false
  private stopReason: FinishReason | undefined
  private sawStop = false
  private sawPayload = false
  private emittedToolCall = false
  private unsupportedBlock = false

  constructor(private readonly context: ErrorContext, private readonly vault: ThinkingVault = ThinkingVault.shared) {}

  get isComplete(): boolean {
    return this.sawStop || this.stopReason !== undefined
  }

  handle(event: SSEEvent): ChatEvent[] {
    const raw = event.data.trim()
    if (!raw) return []
    const json = obj(tryParseJSON(raw))
    if (!json) return []
    const type = str(json.type) ?? event.event ?? ''
    this.sawPayload = true
    switch (type) {
      case 'message_start':
        this.absorbUsage(at(json, 'message', 'usage'))
        return []
      case 'content_block_start':
        return this.blockStart(json)
      case 'content_block_delta':
        return this.blockDelta(json)
      case 'content_block_stop':
        return []
      case 'message_delta': {
        const r = str(at(json, 'delta', 'stop_reason'))
        if (r !== undefined) this.stopReason = mapAnthropicStop(r)
        this.absorbUsage(json.usage)
        return []
      }
      case 'message_stop':
        this.sawStop = true
        return []
      case 'error':
        throw fromStreamError(json.error ?? json, this.context)
      default:
        return [] // ping y eventos futuros
    }
  }

  /** Respuesta completa (`stream: false`). */
  handleJSONBody(json: JSONValue): ChatEvent[] {
    this.sawPayload = true
    const o = obj(json)
    if (o?.type === 'error') throw fromStreamError(o.error ?? json, this.context)
    this.absorbUsage(o?.usage)
    const out: ChatEvent[] = []
    ;(arr(o?.content) ?? []).forEach((bv, i) => {
      const b = obj(bv)
      switch (str(b?.type) ?? '') {
        case 'text': {
          const t = str(b?.text) ?? ''
          this.blocks.set(i, block('text', { text: t }))
          this.order.push(i)
          if (t) out.push({ type: 'text', text: t })
          break
        }
        case 'thinking': {
          const t = str(b?.thinking) ?? ''
          this.blocks.set(i, block('thinking', { text: t, signature: str(b?.signature) ?? '' }))
          this.order.push(i)
          if (t) out.push({ type: 'reasoning', text: t })
          break
        }
        case 'redacted_thinking':
          this.blocks.set(i, block('redacted', { data: str(b?.data) ?? '' }))
          this.order.push(i)
          break
        case 'tool_use': {
          const id = str(b?.id) ?? `toolu_${i}`
          const st = block('toolUse', { toolID: id, toolIndex: this.toolCounter++ })
          this.blocks.set(i, st)
          this.order.push(i)
          this.emittedToolCall = true
          out.push({ type: 'tool_call', index: st.toolIndex, id, name: str(b?.name) ?? '', argumentsFragment: canonicalJSON(b?.input ?? {}) })
          break
        }
        default:
          this.unsupportedBlock = true
      }
    })
    const r = str(o?.stop_reason)
    if (r !== undefined) this.stopReason = mapAnthropicStop(r)
    else if (this.stopReason === undefined) this.stopReason = 'stop'
    return out
  }

  finishStream(): ChatEvent[] {
    if (!this.isComplete) {
      if (!this.sawPayload) throw new AIError('badResponse', noAnswerText(this.context.provider))
      throw new AIError('network', cutText(this.context.provider))
    }
    const out: ChatEvent[] = []
    if (this.sawUsage) {
      out.push({
        type: 'usage',
        usage: {
          promptTokens: this.inputTokens + this.cacheRead + this.cacheCreate,
          completionTokens: this.outputTokens,
          reasoningTokens: this.thinkingTokens,
          cachedTokens: this.cacheRead,
          cacheWriteTokens: this.cacheCreate
        }
      })
    }
    let reason = this.stopReason ?? 'stop'
    if (reason === 'stop' && this.emittedToolCall) reason = 'toolCalls'
    out.push({ type: 'finished', finish: reason })
    this.storeThinking()
    return out
  }

  private blockStart(json: Record<string, JSONValue>): ChatEvent[] {
    const idx = int(json.index)
    const cb = obj(json.content_block)
    if (idx === undefined || !cb) return []
    const out: ChatEvent[] = []
    switch (str(cb.type) ?? '') {
      case 'text': {
        const st = block('text')
        this.blocks.set(idx, st)
        this.order.push(idx)
        const t = str(cb.text)
        if (t) {
          st.text = t
          out.push({ type: 'text', text: t })
        }
        break
      }
      case 'thinking': {
        const t = str(cb.thinking) ?? ''
        this.blocks.set(idx, block('thinking', { text: t, signature: str(cb.signature) ?? '' }))
        this.order.push(idx)
        if (t) out.push({ type: 'reasoning', text: t })
        break
      }
      case 'redacted_thinking':
        this.blocks.set(idx, block('redacted', { data: str(cb.data) ?? '' }))
        this.order.push(idx)
        break
      case 'tool_use': {
        const id = str(cb.id) ?? `toolu_${idx}`
        const st = block('toolUse', { toolID: id, toolIndex: this.toolCounter++ })
        this.blocks.set(idx, st)
        this.order.push(idx)
        this.emittedToolCall = true
        out.push({ type: 'tool_call', index: st.toolIndex, id, name: str(cb.name) ?? '', argumentsFragment: '' })
        break
      }
      default:
        this.blocks.set(idx, block('other'))
        this.unsupportedBlock = true
    }
    return out
  }

  private blockDelta(json: Record<string, JSONValue>): ChatEvent[] {
    const idx = int(json.index)
    const delta = obj(json.delta)
    if (idx === undefined || !delta) return []
    let st = this.blocks.get(idx)
    if (!st) {
      st = block('other')
      this.blocks.set(idx, st)
    }
    switch (str(delta.type) ?? '') {
      case 'text_delta': {
        const t = str(delta.text)
        if (!t) return []
        if (st.kind === 'text') st.text += t
        return [{ type: 'text', text: t }]
      }
      case 'input_json_delta':
        if (st.kind !== 'toolUse') return []
        return [{ type: 'tool_call', index: st.toolIndex, argumentsFragment: str(delta.partial_json) ?? '' }]
      case 'thinking_delta': {
        const t = str(delta.thinking) ?? ''
        if (st.kind === 'thinking') st.text += t
        return t ? [{ type: 'reasoning', text: t }] : []
      }
      case 'signature_delta':
        if (st.kind === 'thinking') st.signature += str(delta.signature) ?? ''
        return []
      default:
        return []
    }
  }

  private absorbUsage(uv: JSONValue | undefined): void {
    const u = obj(uv)
    if (!u) return
    const v = (k: string) => int(u[k])
    if (v('input_tokens') !== undefined) {
      this.inputTokens = v('input_tokens')!
      this.sawUsage = true
    }
    if (v('cache_read_input_tokens') !== undefined) {
      this.cacheRead = v('cache_read_input_tokens')!
      this.sawUsage = true
    }
    if (v('cache_creation_input_tokens') !== undefined) {
      this.cacheCreate = v('cache_creation_input_tokens')!
      this.sawUsage = true
    }
    if (v('output_tokens') !== undefined) {
      this.outputTokens = v('output_tokens')!
      this.sawUsage = true
    }
    const thinking = int(at(u, 'output_tokens_details', 'thinking_tokens'))
    if (thinking !== undefined) this.thinkingTokens = thinking
  }

  /** Guarda el esqueleto si la respuesta usó herramientas y trajo razonamiento firmado (y todos sus bloques se entienden). */
  private storeThinking(): void {
    if (this.unsupportedBlock || !this.emittedToolCall) return
    const skeleton: VaultBlock[] = []
    let hasThinking = false
    for (const idx of this.order) {
      const b = this.blocks.get(idx)
      if (!b) continue
      switch (b.kind) {
        case 'thinking':
          if (!b.signature) return // sin firma no se puede reenviar
          skeleton.push({ type: 'thinking', text: b.text, signature: b.signature })
          hasThinking = true
          break
        case 'redacted':
          skeleton.push({ type: 'redacted', data: b.data })
          hasThinking = true
          break
        case 'text':
          skeleton.push({ type: 'text', text: b.text })
          break
        case 'toolUse':
          skeleton.push({ type: 'toolUse', id: b.toolID })
          break
        case 'other':
          return
      }
    }
    if (hasThinking) this.vault.store(skeleton)
  }
}
