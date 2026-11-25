// El aviso de la IA de terceros en un dispositivo (guía 5.1.2(i) del App Store), del lado de la interfaz: antes de la primera
// llamada que manda algo a la IA (shared/ai/consent.ts) enseña a quién se manda y espera a que el estudiante continúe. Lo
// aceptado lo guarda el Mac (que además no deja pasar nada sin ello: remote/ai-consent.ts). En la demostración no hay Mac:
// se enseña un aviso propio y se recuerda solo en memoria. Puro (sin DOM): las pruebas le dan sus dependencias.
import type { AIConsentState } from '@shared/ipc/ai'
import { AI_CONSENT_REFUSED, asConsentState, sendsToAI } from '@shared/ai/consent'
import type { AulaClientError, InvokeGuard } from './api'

export interface AIConsentGuardDeps {
  /** ¿Es la demostración? (sin Mac: nada se pide ni se guarda) */
  demo(): boolean
  /** ¿El aviso de la demostración ya se da por visto? (las capturas del App Store) */
  demoSeen?(): boolean
  /** El estado del aviso en el Mac (`ai.consent`). */
  fetch(): Promise<AIConsentState>
  /** Acepta esos destinatarios en el Mac (`ai.acceptConsent`). */
  accept(ids: string[]): Promise<AIConsentState>
  /** Enseña el aviso y espera la respuesta: true = continuar. */
  ask(state: AIConsentState, demo: boolean): Promise<boolean>
  /** El error de «no se ha enviado nada» (cancelado). */
  declined(): Error
}

const codeOf = (e: unknown): string | undefined => (typeof (e as { code?: unknown } | null)?.code === 'string' ? (e as { code: string }).code : undefined)

/** Vueltas como mucho si la IA cambia mientras se lee el aviso. */
const MAX_ROUNDS = 3

export function createAIConsentGuard(d: AIConsentGuardDeps): InvokeGuard & { forget(): void } {
  let cached: AIConsentState | null = null
  let demoOk = false
  // una sola hoja aunque lleguen varias llamadas a la vez; si se cancela, todas se rechazan
  let asking: Promise<void> | null = null
  const once = (run: () => Promise<void>): Promise<void> => {
    asking ??= run().finally(() => { asking = null })
    return asking
  }

  /** Pregunta hasta que quede aceptado (o se cancele). */
  const settle = async (start: AIConsentState): Promise<void> => {
    let s = start
    for (let round = 0; round < MAX_ROUNDS && s.needed; round++) {
      if (!(await d.ask(s, false))) throw d.declined()
      try {
        s = await d.accept(s.recipients.map((r) => r.id))
      } catch (e) {
        // la IA cambió mientras se leía: otra vuelta con los nombres nuevos
        const next = codeOf(e) === AI_CONSENT_REFUSED ? asConsentState((e as AulaClientError).details) : null
        if (!next) throw e
        s = next
      }
    }
    if (s.needed) throw d.declined()
    cached = s
  }

  return {
    async before(method, args) {
      if (!sendsToAI(method, args)) return
      if (d.demo()) {
        if (demoOk || d.demoSeen?.()) return
        await once(async () => {
          if (!(await d.ask({ needed: true, recipients: [] }, true))) throw d.declined()
          demoOk = true
        })
        return
      }
      if (asking) return asking
      // si el Mac no contesta, decide su propia guardia (y `recover` pregunta entonces)
      cached ??= await d.fetch().catch(() => null)
      const s = cached
      if (s?.needed) await once(() => settle(s))
    },
    async recover(method, args, err) {
      if (err.code !== AI_CONSENT_REFUSED || !sendsToAI(method, args) || d.demo()) return false
      const s = asConsentState(err.details) ?? (await d.fetch())
      if (s.needed) await once(() => settle(s))
      else cached = s
      return true
    },
    forget() {
      cached = null
    }
  }
}
