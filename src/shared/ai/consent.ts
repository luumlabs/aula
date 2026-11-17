// El aviso de la IA de terceros en los dispositivos (guía 5.1.2(i) del App Store): qué métodos mandan algo a la IA y cómo
// se apunta lo que el estudiante aceptó. Una sola lista para la interfaz (que pregunta) y el servidor remoto del Mac (que no
// deja pasar nada sin permiso). Puro: sin Node ni DOM.
import type { AIConsentState } from '../ipc/ai'
import { PROACTIVE_ROUTINES, routineUsesAI } from '../automations/types'
import type { AIRecipient } from './recipient'

/** El servidor no lo hizo: falta aceptar el aviso (los detalles traen el estado, con los destinatarios de ahora). */
export const AI_CONSENT_REFUSED = 'ai_consent'
/** El estudiante canceló el aviso: no se mandó nada. */
export const AI_CONSENT_DECLINED = 'ai_consent_declined'

/** Métodos que siempre mandan algo a la IA (lo que se escribe, se añade o se corrige; ai.chatStream, solo un propietario).
 *  `documents.import` transcribe las grabaciones con el servicio de transcripción; los argumentos solo traen referencias
 *  `aula-upload://`, y una grabación se reconoce por su contenido, así que cuenta siempre. */
const ALWAYS: ReadonlySet<string> = new Set([
  'chat.send', 'chat.retry', 'chat.continue', 'chat.answerCard',
  'create.addFiles', 'create.addText', 'create.addURL', 'create.start',
  'generation.extend', 'generation.resume', 'generation.answer',
  'study.gradeOpen', 'documents.aiStart', 'documents.import', 'live.give',
  'automations.runNow', 'automations.save',
  'ai.chatStream'
])

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Lo que enciende algo con IA en «Aula siempre activa»: el modo, los seguimientos y las rutinas que la usan (no las ligeras). */
const PROACTIVE_AI_FIELDS: ReadonlySet<string> = new Set(['enabled', 'followups', ...PROACTIVE_ROUTINES.filter(routineUsesAI)])

/** ¿Esta llamada manda algo a la IA? (también encender una automatización, una rutina con IA o «Aula siempre activa», o
 *  reanudarla tras una pausa) */
export function sendsToAI(method: string, args: unknown): boolean {
  if (ALWAYS.has(method)) return true
  if (!isObj(args)) return false
  switch (method) {
    case 'automations.setEnabled': return args.enabled === true
    case 'automations.setProactive': {
      const patch = args.patch
      return isObj(patch) && Object.entries(patch).some(([k, v]) => v === true && PROACTIVE_AI_FIELDS.has(k))
    }
    // reanudar vuelve a poner en marcha todo lo que estaba en pausa; pausar hasta una fecha, no
    case 'automations.pause': return args.until === null
    case 'settings.update': return isObj(args.persistent) && args.persistent.enabled === true
    default: return false
  }
}

/** ¿Falta aceptar a alguno de los destinatarios? */
export function consentNeeded(recipients: readonly AIRecipient[], accepted: readonly string[]): boolean {
  return recipients.some((r) => !accepted.includes(r.id))
}

/** Lo aceptado más lo nuevo, sin repetir; se quedan los últimos `max`. */
export function mergeAccepted(accepted: readonly string[], ids: readonly string[], max = 20): string[] {
  const out = [...accepted]
  for (const id of ids) {
    const i = out.indexOf(id)
    if (i >= 0) out.splice(i, 1)
    out.push(id)
  }
  return out.slice(-max)
}

const CONSENT_ID = /^[A-Za-z0-9:._\-[\]]{1,120}$/

/** Los argumentos de `ai.acceptConsent`: exactamente `{ ids }`, de 1 a 10 identificadores distintos y razonables; si no, null. */
export function cleanConsentIds(args: unknown): string[] | null {
  if (!isObj(args) || Object.keys(args).length !== 1 || !Array.isArray(args.ids)) return null
  const ids = args.ids
  if (ids.length < 1 || ids.length > 10) return null
  if (!ids.every((x): x is string => typeof x === 'string' && CONSENT_ID.test(x))) return null
  return new Set(ids).size === ids.length ? [...ids] : null
}

/** ¿Los mismos identificadores, sin mirar el orden ni las repeticiones? */
export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a)
  const sb = new Set(b)
  return sa.size === sb.size && [...sa].every((x) => sb.has(x))
}

/** Lee el estado del aviso que llega en los detalles de un error (de fuera: se comprueba la forma). */
export function asConsentState(v: unknown): AIConsentState | null {
  if (!isObj(v) || typeof v.needed !== 'boolean' || !Array.isArray(v.recipients)) return null
  const recipients: AIRecipient[] = []
  for (const r of v.recipients) {
    if (!isObj(r) || typeof r.id !== 'string' || typeof r.name !== 'string' || !Array.isArray(r.uses)) return null
    const uses = r.uses.filter((u): u is AIRecipient['uses'][number] => u === 'answers' || u === 'recordings')
    recipients.push({ id: r.id, name: r.name, ...(typeof r.product === 'string' ? { product: r.product } : {}), uses })
  }
  return { needed: v.needed, recipients }
}
