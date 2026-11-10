// La edición de la App Store pide permiso antes de enviar contenido de estudio a un destino de IA.
// Los permisos viven solo en memoria (hasta cerrar Aula) y se pueden retirar desde Ajustes.
import { tr } from '@shared/ai/i18n'
import { edition } from '@main/services/edition'
import { AIError } from './errors'
import { abortReason } from './http/options'

export interface AIConsentDestination {
  provider: string
  origin: string
}

/**
 * Pregunta al estudiante. `true` = permite; `false` = «Ahora no»; `null` = no se pudo preguntar (Aula no está a la vista).
 * `signal` se aborta cuando ya nadie espera la respuesta: el diálogo debe cerrarse.
 */
export type AIConsentPrompt = (destination: AIConsentDestination, signal: AbortSignal) => Promise<boolean | null>

interface PendingPrompt {
  result: Promise<boolean>
  closer: AbortController
  waiters: number
}

/** Tras un «Ahora no», cuánto se espera antes de volver a preguntar por el mismo destino. */
export const DECLINE_MS = 10 * 60_000
/** Cuánto espera una petición a que el estudiante responda antes de rendirse (el diálogo se cierra). */
export const CONSENT_WAIT_MS = 2 * 60_000

export class AIConsentGate {
  private readonly grants = new Set<string>()
  private readonly declined = new Map<string, number>()
  private readonly pending = new Map<string, PendingPrompt>()
  private generation = 0

  constructor(
    private readonly prompt: AIConsentPrompt,
    private readonly options: { now?: () => number; declineMs?: number } = {}
  ) {}

  /** ¿Se puede enviar a este destino? Varias peticiones a la vez comparten una sola pregunta. */
  async authorize(url: string, label: string, signal?: AbortSignal): Promise<boolean> {
    let parsed: URL
    try { parsed = new URL(url) } catch { return false }
    if (!['http:', 'https:'].includes(parsed.protocol)) return false
    // el nombre va a un diálogo: sin saltos de línea ni marcas de dirección que lo disfracen
    const provider = label.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ').trim().slice(0, 80) || 'AI provider'
    const destination = { provider, origin: parsed.origin }
    const key = JSON.stringify(destination)
    if (this.grants.has(key)) return true
    if ((this.declined.get(key) ?? 0) > this.now()) return false
    if (signal?.aborted) throw abortReason(signal)
    let entry = this.pending.get(key)
    if (!entry) {
      entry = this.ask(key, destination)
      this.pending.set(key, entry)
    }
    return this.wait(entry, signal)
  }

  /** Retira lo concedido, olvida las negativas y cierra las preguntas abiertas: una respuesta tardía ya no cuenta. */
  revokeAll(): void {
    this.generation++
    this.grants.clear()
    this.declined.clear()
    for (const entry of this.pending.values()) entry.closer.abort()
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  private ask(key: string, destination: AIConsentDestination): PendingPrompt {
    const generation = this.generation
    const closer = new AbortController()
    const entry: PendingPrompt = { closer, waiters: 0, result: Promise.resolve(false) }
    entry.result = Promise.resolve()
      .then(() => this.prompt(destination, closer.signal))
      .then((answer) => {
        if (this.generation !== generation) return false
        if (answer === true) {
          this.grants.add(key)
          return true
        }
        // solo un «Ahora no» de verdad se recuerda; un diálogo cerrado porque nadie esperaba, no
        if (answer === false && !closer.signal.aborted) this.declined.set(key, this.now() + (this.options.declineMs ?? DECLINE_MS))
        return false
      })
      .catch(() => false)
      .finally(() => {
        if (this.pending.get(key) === entry) this.pending.delete(key)
      })
    return entry
  }

  /** Espera la respuesta; si quien espera se cancela, se va, y si era el último se cierra la pregunta. */
  private wait(entry: PendingPrompt, signal?: AbortSignal): Promise<boolean> {
    entry.waiters++
    return new Promise<boolean>((resolve, reject) => {
      let left = false
      const leave = (): void => {
        if (left) return
        left = true
        if (--entry.waiters === 0) entry.closer.abort()
      }
      const onAbort = (): void => {
        leave()
        reject(abortReason(signal))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      void entry.result.then((allowed) => {
        signal?.removeEventListener('abort', onAbort)
        left = true
        resolve(allowed)
      })
    })
  }
}

let prompt: AIConsentPrompt | undefined
const sessionConsent = new AIConsentGate((destination, signal) => (prompt ? prompt(destination, signal) : Promise.resolve(null)))
/** Peticiones ya autorizadas que siguen en curso: retirar el permiso las corta. */
const active = new Set<AbortController>()

/** Lo instala el proceso principal; sin pregunta instalada nunca se concede nada. */
export function installAIConsentPrompt(next: AIConsentPrompt): void { prompt = next }

/** Retira los permisos de esta sesión y corta lo que se estuviera enviando. */
export function revokeAIConsent(): void {
  sessionConsent.revokeAll()
  for (const controller of [...active]) {
    controller.abort(new AIError('other', tr('Retiraste el permiso para compartir con esta IA.', 'You revoked permission to share with this AI.')))
  }
  active.clear()
}

/** Apunta una petición autorizada mientras dura; devuelve cómo borrarla al terminar. */
export function trackAIRequest(controller: AbortController): () => void {
  if (!edition.aiConsent) return () => undefined
  active.add(controller)
  return () => { active.delete(controller) }
}

/** Con permiso obligatorio, ninguna petición sigue una redirección: la clave y los datos no salen a otro origen. */
export function consentFetchInit(): Pick<RequestInit, 'redirect'> {
  return edition.aiConsent ? { redirect: 'error' } : {}
}

/** Lanza si no hay permiso para enviar a `url`. Respeta la cancelación y no espera la respuesta indefinidamente. */
export async function authorizeAIRequest(url: string, provider: string, signal: AbortSignal, waitMs: number = CONSENT_WAIT_MS): Promise<void> {
  if (!edition.aiConsent) return
  if (signal.aborted) throw abortReason(signal)
  const wait = new AbortController()
  const onAbort = (): void => wait.abort(abortReason(signal))
  signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => wait.abort(new AIError('other', tr(
    'Aula no envió tus datos: la pregunta para compartirlos con esta IA quedó sin responder. Vuelve a intentarlo con Aula a la vista.',
    'Aula did not send your data: the question about sharing it with this AI went unanswered. Try again with Aula in view.'
  ))), waitMs)
  let allowed: boolean
  try {
    allowed = await sessionConsent.authorize(url, provider, wait.signal)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
  if (signal.aborted) throw abortReason(signal)
  if (!allowed) throw new AIError('other', tr(
    'Aula no envió tus datos porque no hay permiso para compartirlos con esta IA. Acéptalo cuando Aula lo pregunte, o ve a Ajustes → Privacidad y datos y restablece los permisos para que vuelva a preguntar.',
    'Aula did not send your data because there is no permission to share it with this AI. Accept when Aula asks, or go to Settings → Privacy and data and reset the permissions so it asks again.'
  ))
}
