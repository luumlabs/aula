// El aviso de la IA de terceros en los dispositivos (guía 5.1.2(i) del App Store), del lado del Mac, que es quien manda: un
// dispositivo no manda nada a la IA sin haber aceptado a quién se manda. Lo aceptado se guarda por dispositivo
// (devices.json → aiConsent) y vuelve a pedirse si la IA cambia a otra empresa. Sin Electron.
import type { RpcErrorInfo } from '@shared/ipc'
import type { AIConsentState } from '@shared/ipc/ai'
import type { AIRecipient } from '@shared/ai/recipient'
import { AI_CONSENT_REFUSED, cleanConsentIds, consentNeeded, sameIds, sendsToAI } from '@shared/ai/consent'
import { tr } from '@shared/ai/i18n'
import { AulaError, invalidArgs } from '../errors'

export interface AIConsentDeps {
  /** A quién mandaría Aula los datos ahora (ai/recipients.ts). */
  recipients(): Promise<AIRecipient[]>
  accepted(deviceId: string): string[]
  accept(deviceId: string, ids: string[]): boolean
}

/** A quién se mandaría ahora y si este dispositivo ya lo aceptó. */
export async function consentState(d: AIConsentDeps, deviceId: string): Promise<AIConsentState> {
  const recipients = await d.recipients()
  return { needed: consentNeeded(recipients, d.accepted(deviceId)), recipients }
}

/** El estudiante aceptó el aviso: vale solo si nombra a los destinatarios de ahora (la IA pudo cambiar mientras lo leía). */
export async function acceptConsent(d: AIConsentDeps, deviceId: string, args: unknown): Promise<AIConsentState> {
  const ids = cleanConsentIds(args)
  if (!ids) throw invalidArgs(tr('Aviso no válido', 'Invalid notice'))
  const now = await consentState(d, deviceId)
  if (!sameIds(ids, now.recipients.map((r) => r.id))) {
    throw new AulaError(AI_CONSENT_REFUSED, tr('La IA de Aula cambió mientras tanto: revisa el aviso otra vez.', 'Aula’s AI changed in the meantime: check the notice again.'), now)
  }
  d.accept(deviceId, ids)
  return consentState(d, deviceId)
}

/** Si esta llamada manda algo a la IA y falta aceptar el aviso, el error que recibe el dispositivo; si no, null. */
export async function consentRefusal(d: AIConsentDeps, deviceId: string, method: string, args: unknown): Promise<RpcErrorInfo | null> {
  if (!sendsToAI(method, args)) return null
  const state = await consentState(d, deviceId)
  if (!state.needed) return null
  return {
    code: AI_CONSENT_REFUSED,
    message: tr('Antes de usar la IA desde este dispositivo, acepta el aviso que aparece en él.', 'Before using the AI from this device, accept the notice it shows.'),
    details: state
  }
}
