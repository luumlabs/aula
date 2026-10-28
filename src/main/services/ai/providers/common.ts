// Piezas comunes a los proveedores: reparación del historial de herramientas, errores al preparar la petición, el texto de
// la prueba de conexión y la separación del razonamiento escrito entre `<think>…</think>` (port de JSONTools/ToolPairing,
// RequestErrors, PingText y ThinkTagSplitter).
import type { ChatMessage, ChatResponse } from '@shared/ai/types'
import { messageImages, messageText, msg } from '@shared/ai/types'
import { tr } from '@shared/ai/i18n'
import { AIError } from '../errors'
import type { ProviderConfig } from './config'

export const MISSING_RESULT_TEXT = 'Error: no hay resultado para esta llamada (no llegó a ejecutarse).'

/**
 * Repara el historial para que cada llamada a herramienta tenga su resultado (las APIs devuelven 400 si falta):
 * cada mensaje `assistant` con llamadas va seguido de un `tool` por llamada, en el mismo orden (si falta, uno de error), y
 * los `tool` huérfanos se descartan.
 */
export function repairToolPairing(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  let i = 0
  while (i < messages.length) {
    const m = messages[i]
    const calls = m.toolCalls ?? []
    if (m.role === 'assistant' && calls.length) {
      out.push(m)
      let j = i + 1
      const results = new Map<string, ChatMessage>()
      while (j < messages.length && messages[j].role === 'tool') {
        const id = messages[j].toolCallID
        if (id && calls.some((c) => c.id === id) && !results.has(id)) results.set(id, messages[j])
        j += 1
      }
      for (const call of calls) out.push(results.get(call.id) ?? msg.toolResult(call.id, call.name, MISSING_RESULT_TEXT))
      i = j
    } else if (m.role === 'tool') {
      i += 1 // huérfano
    } else {
      out.push(m)
      i += 1
    }
  }
  return out
}

export function noModelError(config: Pick<ProviderConfig, 'label'>): AIError {
  return new AIError('other', tr(`No hay ningún modelo elegido para ${config.label}. Elige uno en los ajustes de IA.`,
    `There's no model selected for ${config.label}. Choose one in AI settings.`), { code: 'ai_no_model' })
}

export function noMessagesError(): AIError {
  return new AIError('other', tr('La petición no tiene mensajes.', 'The request has no messages.'), { code: 'ai_error' })
}

export function noVisionError(config: Pick<ProviderConfig, 'label' | 'model'>, model?: string): AIError {
  const m = model || config.model
  return new AIError('unsupported', tr(
    `El modelo «${m}» de ${config.label} no admite imágenes. Cambia a un modelo con visión o quita las imágenes de la petición.`,
    `The "${m}" model from ${config.label} doesn't support images. Switch to a model with vision or remove the images from the request.`
  ))
}

/** ¿Hay imágenes que el modelo tendría que ver (de la persona o de una herramienta)? */
export function hasImages(messages: ChatMessage[]): boolean {
  return messages.some((m) => (m.role === 'user' || m.role === 'tool') && messageImages(m).length > 0)
}

export const PING_PROMPT = 'Responde solo: OK'

/** Texto que devuelve «Probar conexión». */
export function describePing(response: ChatResponse): string {
  const text = messageText(response.message).trim()
  if (text) return text
  if (response.message.reasoning) {
    return tr('(conexión correcta; el modelo solo devolvió razonamiento)', '(connection successful; the model only returned reasoning)')
  }
  return tr('(conexión correcta; el modelo no devolvió texto)', '(connection successful; the model returned no text)')
}

export function pingNoModelError(config: Pick<ProviderConfig, 'label'>): AIError {
  return new AIError('other', tr(`Elige un modelo para ${config.label} antes de probar la conexión.`,
    `Choose a model for ${config.label} before testing the connection.`), { code: 'ai_no_model' })
}

export function modelsNotListable(config: Pick<ProviderConfig, 'label'>): AIError {
  return new AIError('http', tr(`${config.label} no permite listar los modelos (404). Escribe el nombre del modelo a mano en los ajustes de IA.`,
    `${config.label} doesn’t allow listing models (404). Enter the model name manually in AI settings.`), { status: 404 })
}

export function modelsNotJSON(config: Pick<ProviderConfig, 'label'>): AIError {
  return new AIError('badResponse', tr(`${config.label} respondió a la lista de modelos con algo que no es JSON. Revisa la URL base.`,
    `${config.label} responded to the model list with something that isn’t JSON. Check the base URL.`))
}

export function modelsEmpty(config: Pick<ProviderConfig, 'label'>): AIError {
  return new AIError('badResponse', tr(`${config.label} no devolvió ningún modelo. Revisa la URL base y la clave.`,
    `${config.label} returned no models. Check the base URL and API key.`))
}

/** «<proveedor> no devolvió ninguna respuesta…». */
export function noAnswerText(p: string): string {
  return tr(`${p} no devolvió ninguna respuesta. Inténtalo de nuevo; si se repite, revisa el modelo y la URL base.`,
    `${p} returned no response. Try again; if it happens again, check the model and base URL.`)
}

/** «La conexión con <proveedor> se cortó antes de que terminara la respuesta…». */
export function cutText(p: string): string {
  return tr(`La conexión con ${p} se cortó antes de que terminara la respuesta. Inténtalo de nuevo.`,
    `The connection to ${p} dropped before the response finished. Try again.`)
}

/**
 * Separa el razonamiento que algunos modelos locales (DeepSeek-R1, Qwen… por Ollama, LM Studio o vLLM sin parser de
 * razonamiento) escriben DENTRO del texto entre `<think>` y `</think>`. Solo actúa si la respuesta EMPIEZA por `<think>`;
 * funciona aunque las etiquetas lleguen partidas entre trozos.
 */
export class ThinkTagSplitter {
  private state: 'start' | 'inside' | 'after' = 'start'
  private held = ''
  private skipNewlines = false
  private static readonly OPEN = '<think>'
  private static readonly CLOSE = '</think>'

  feed(text: string): { reasoning: string; visible: string } {
    let reasoning = ''
    let visible = ''
    let buf = this.held + text
    this.held = ''
    for (;;) {
      if (this.state === 'start') {
        const trimmed = buf.replace(/^\s+/, '')
        if (!trimmed) {
          this.held = buf // solo espacios: ¿vendrá «<think>»?
          break
        }
        if (trimmed.startsWith(ThinkTagSplitter.OPEN)) {
          buf = trimmed.slice(ThinkTagSplitter.OPEN.length)
          this.state = 'inside'
          continue
        }
        if (ThinkTagSplitter.OPEN.startsWith(trimmed)) {
          this.held = buf // inicio parcial de la etiqueta
          break
        }
        this.state = 'after'
        continue
      }
      if (this.state === 'inside') {
        const r = buf.indexOf(ThinkTagSplitter.CLOSE)
        if (r >= 0) {
          reasoning += buf.slice(0, r)
          buf = buf.slice(r + ThinkTagSplitter.CLOSE.length)
          this.state = 'after'
          this.skipNewlines = true
          continue
        }
        // retener lo que podría ser el inicio de «</think>»
        let keep = 0
        for (let n = Math.min(buf.length, ThinkTagSplitter.CLOSE.length - 1); n >= 1; n--) {
          if (ThinkTagSplitter.CLOSE.startsWith(buf.slice(buf.length - n))) {
            keep = n
            break
          }
        }
        reasoning += buf.slice(0, buf.length - keep)
        this.held = buf.slice(buf.length - keep)
        break
      }
      // after
      if (this.skipNewlines) {
        buf = buf.replace(/^[\n\r]+/, '')
        if (buf) this.skipNewlines = false
      }
      visible += buf
      break
    }
    return { reasoning, visible }
  }

  /** Fin del flujo: devuelve lo que quedaba retenido. */
  finish(): { reasoning: string; visible: string } {
    const held = this.held
    this.held = ''
    return this.state === 'inside' ? { reasoning: held, visible: '' } : { reasoning: '', visible: held }
  }
}
