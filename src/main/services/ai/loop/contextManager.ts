// Estimación de tokens y recorte del historial del agente para que quepa en la ventana de contexto (port de ContextManager.swift).
import type { JSONValue } from '@shared/ai/json'
import type { ChatMessage, ImagePart, ToolCall, ToolSpec } from '@shared/ai/types'
import { msg } from '@shared/ai/types'
import { tr } from '@shared/ai/i18n'
import { canonicalJSON } from '../core/json'
import { formatToolCall, formatToolResult } from './textToolProtocol'

/** Resultado de una llamada a herramienta, tal como se guarda en el historial. */
export interface ResultItem {
  callID: string
  name: string
  text: string
  images: ImagePart[]
  ok: boolean
  /** Ya se recortó para ahorrar contexto. */
  trimmed?: boolean
}

/** Un paso del agente: lo que dijo el modelo y los resultados de sus herramientas. */
export interface Turn {
  /** Texto visible del asistente (sin bloques de herramienta). */
  text: string
  /** Respuesta completa en modo de texto (con los bloques ```tool); `undefined` = reconstruirla desde `calls`. */
  rawText?: string
  reasoning?: string
  calls: ToolCall[]
  items: ResultItem[]
}

/** Mensaje del asistente en el formato del modo actual. */
export function turnAssistantMessage(t: Turn, textMode: boolean): ChatMessage {
  if (textMode) {
    if (t.rawText !== undefined) return msg.assistant(t.rawText)
    const parts: string[] = []
    if (t.text) parts.push(t.text)
    for (const c of t.calls) parts.push(formatToolCall(c))
    return msg.assistant(parts.join('\n\n'))
  }
  return msg.assistant(t.text, t.calls, t.reasoning)
}

/** Resultados: un `tool` por llamada (nativo) o un único mensaje del usuario con `<tool_result>` (modo de texto). */
export function turnResultMessages(t: Turn, textMode: boolean): ChatMessage[] {
  if (textMode) {
    if (!t.items.length) return []
    const body = t.items.map((it) => formatToolResult(it.name, it.ok, it.text)).join('\n')
    return [msg.user(body, t.items.flatMap((it) => it.images))]
  }
  return t.items.map((it) => msg.toolResult(it.callID, it.name, it.text, it.images))
}

export function turnMessages(t: Turn, textMode: boolean): ChatMessage[] {
  return [turnAssistantMessage(t, textMode), ...turnResultMessages(t, textMode)]
}

export const CHARS_PER_TOKEN = 3.5
export const TOKENS_PER_IMAGE = 1500
export const TRIM_MARKER = '[recortado]'
/**
 * Al recortar lo barato (resultados y argumentos de pasos antiguos) se baja hasta esta fracción del presupuesto: así los pasos
 * siguientes caben sin volver a recortar y la caché de prompts vale entre recorte y recorte.
 */
export const TRIM_HYSTERESIS = 0.8

const scalars = (s: string) => {
  let n = 0
  for (const _ of s) n++
  return n
}

export function estimateText(text: string): number {
  return Math.ceil(scalars(text) / CHARS_PER_TOKEN)
}

export function estimateMessage(m: ChatMessage): number {
  let chars = 0
  let extra = 4
  for (const p of m.content) {
    if (p.type === 'text') chars += scalars(p.text)
    else extra += TOKENS_PER_IMAGE
  }
  for (const c of m.toolCalls ?? []) chars += scalars(c.name) + scalars(canonicalJSON(c.arguments)) + 16
  if (m.reasoning) chars += scalars(m.reasoning)
  return extra + Math.ceil(chars / CHARS_PER_TOKEN)
}

export function estimateMessages(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => n + estimateMessage(m), 0)
}

export function estimateTools(tools: ToolSpec[]): number {
  return tools.reduce((n, t) => n + estimateText(t.name + t.description + canonicalJSON(t.inputSchema)) + 8, 0)
}

export function estimateTurn(t: Turn, textMode: boolean): number {
  return estimateMessages(turnMessages(t, textMode))
}

export interface TrimReport {
  trimmedResults: number
  shrunkArguments: number
  droppedTurns: number
}

export function reportChanged(r: TrimReport): boolean {
  return r.trimmedResults > 0 || r.shrunkArguments > 0 || r.droppedTurns > 0
}

/** Frase para un aviso (una por combinación, para que cada idioma la construya entera). */
export function reportSummary(r: TrimReport): string {
  const t = r.trimmedResults
  const s = r.shrunkArguments
  const d = r.droppedTurns
  const parts: string[] = []
  if (t > 0) parts.push(tr(`recorté ${t} resultado(s) antiguo(s)`, `trimmed ${t} old result(s)`))
  if (s > 0) parts.push(tr(`acorté los argumentos de ${s} llamada(s) antigua(s)`, `shortened the arguments for ${s} old call(s)`))
  if (d > 0) parts.push(tr(`omití ${d} paso(s) antiguo(s)`, `skipped ${d} old step(s)`))
  if (!parts.length) return tr('Contexto largo.', 'Long context.')
  return tr(`Contexto largo: ${parts.join(', ')}.`, `Context too long: ${parts.join(', ')}.`)
}

/** Nota que se coloca tras el primer mensaje cuando se omitieron pasos antiguos. */
export function droppedNote(count: number): ChatMessage {
  return msg.user(`[Nota del sistema: para ahorrar espacio se omitieron los ${count} pasos más antiguos de esta conversación (tus llamadas y sus resultados). El trabajo ya realizado con las herramientas sigue guardado; continúa desde los pasos recientes.]`)
}

export function shouldTrim(item: ResultItem): boolean {
  return !item.trimmed && (scalars(item.text) > 300 || item.images.length > 0)
}

/** Primera línea (hasta 200 caracteres) + `[recortado]`. */
export function trimmedItem(item: ResultItem): ResultItem {
  const first = item.text.split('\n').find((l) => l.length > 0) ?? ''
  const chars = Array.from(first)
  const head = chars.length > 200 ? chars.slice(0, 200).join('') + '…' : first
  return { ...item, text: head ? head + '\n' + TRIM_MARKER : TRIM_MARKER, images: [], trimmed: true }
}

export function hardCut(text: string, max: number): string {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  return chars.slice(0, max).join('') + '\n' + TRIM_MARKER
}

/** Acorta las cadenas de más de 400 caracteres a 200 + «…[recortado]». */
export function shrinkValue(v: JSONValue): { value: JSONValue; changed: boolean } {
  if (typeof v === 'string') {
    const chars = Array.from(v)
    if (chars.length <= 400) return { value: v, changed: false }
    return { value: chars.slice(0, 200).join('') + '…' + TRIM_MARKER, changed: true }
  }
  if (Array.isArray(v)) {
    let changed = false
    const out = v.map((e) => {
      const r = shrinkValue(e)
      changed = changed || r.changed
      return r.value
    })
    return { value: out, changed }
  }
  if (v && typeof v === 'object') {
    let changed = false
    const out: Record<string, JSONValue> = {}
    for (const [k, e] of Object.entries(v)) {
      const r = shrinkValue(e)
      changed = changed || r.changed
      out[k] = r.value
    }
    return { value: out, changed }
  }
  return { value: v, changed: false }
}

type Step = { kind: 'trimResults' | 'shrinkArguments' | 'dropTurns'; keep: number }

/**
 * Si el total estimado pasa de `budget`, recorta `turns` (en el sitio), de lo menos a lo más dañino y parando en cuanto cabe:
 * 1) resultados antiguos → primera línea + [recortado]; 2) argumentos largos de llamadas antiguas; 3) lo mismo con el paso
 * anterior al último (hasta aquí se protegen los 2 recientes); 4) pasos enteros, del más antiguo (siempre queda el último);
 * 5) solo en modo agresivo (tras «contexto excedido»), los resultados que queden a 4 000 caracteres como mucho.
 */
export function fitTurns(turns: Turn[], fixedTokens: number, budget: number, textMode: boolean, aggressive: boolean): TrimReport {
  const report: TrimReport = { trimmedResults: 0, shrunkArguments: 0, droppedTurns: 0 }
  const est = turns.map((t) => estimateTurn(t, textMode))
  const total = () => fixedTokens + est.reduce((a, b) => a + b, 0)
  const current = total()
  if (!aggressive && current <= budget) return report
  const hard = aggressive ? Math.min(budget, Math.max(1, Math.floor(current / 2))) : budget
  const soft = aggressive ? hard : Math.max(1, Math.floor(budget * TRIM_HYSTERESIS))
  if (current <= soft) return report

  const plan: Step[] = aggressive
    ? [{ kind: 'trimResults', keep: 1 }, { kind: 'shrinkArguments', keep: 1 }, { kind: 'dropTurns', keep: 1 }]
    : [{ kind: 'trimResults', keep: 2 }, { kind: 'shrinkArguments', keep: 2 }, { kind: 'trimResults', keep: 1 },
        { kind: 'shrinkArguments', keep: 1 }, { kind: 'dropTurns', keep: 2 }, { kind: 'dropTurns', keep: 1 }]

  for (const step of plan) {
    const goal = step.kind === 'dropTurns' ? hard : step.keep >= 2 ? soft : hard
    if (total() <= goal) continue
    if (step.kind === 'trimResults') {
      for (let i = 0; i < Math.max(0, turns.length - step.keep); i++) {
        let touched = false
        turns[i].items = turns[i].items.map((it) => {
          if (!shouldTrim(it)) return it
          report.trimmedResults++
          touched = true
          return trimmedItem(it)
        })
        if (touched) {
          est[i] = estimateTurn(turns[i], textMode)
          if (total() <= goal) break
        }
      }
    } else if (step.kind === 'shrinkArguments') {
      for (let i = 0; i < Math.max(0, turns.length - step.keep); i++) {
        let shrunk = 0
        turns[i].calls = turns[i].calls.map((c) => {
          const r = shrinkValue(c.arguments)
          if (!r.changed) return c
          shrunk++
          return { ...c, arguments: r.value, rawArguments: undefined }
        })
        if (shrunk > 0) {
          turns[i].rawText = undefined // se reconstruye desde las llamadas ya acortadas
          report.shrunkArguments += shrunk
          est[i] = estimateTurn(turns[i], textMode)
          if (total() <= goal) break
        }
      }
    } else {
      while (total() > goal && turns.length > step.keep) {
        turns.shift()
        est.shift()
        report.droppedTurns++
      }
    }
  }
  if (aggressive && total() > hard) {
    for (let i = 0; i < turns.length; i++) {
      let touched = false
      turns[i].items = turns[i].items.map((it) => {
        if (!(scalars(it.text) > 4000 || it.images.length > 0)) return it
        report.trimmedResults++
        touched = true
        return { ...it, text: hardCut(it.text, 4000), images: [], trimmed: true }
      })
      if (touched) est[i] = estimateTurn(turns[i], textMode)
    }
  }
  return report
}
