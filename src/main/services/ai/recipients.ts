// A quién mandaría Aula ahora los datos de un dispositivo (el aviso de la IA de terceros, guía 5.1.2(i)): la IA activa, que
// responde, y la que transcribe las grabaciones, que puede ser otra empresa. Con la IA simulada (pruebas), nadie.
// (No sale por ai/index.ts: media importa de ai, y esto importa de media.)
import type { AIStatus } from '@shared/ai/views'
import { aiRecipientOf, mergeRecipients, type AIRecipient } from '@shared/ai/recipient'
import { modelOverride, providerEntry, type ProviderEntry } from './registry'
import { aiStatus } from './service'
import { transcriptionProviderId } from '../media/engines'

export interface RecipientDeps {
  status(): Promise<AIStatus>
  entry(id: string): ProviderEntry | undefined
  transcriptionId(): string | undefined
  simulated(): boolean
}

const realDeps: RecipientDeps = {
  status: () => aiStatus(),
  entry: (id) => { try { return providerEntry(id) } catch { return undefined } },
  transcriptionId: () => { try { return transcriptionProviderId() } catch { return undefined } },
  simulated: () => !!modelOverride()
}

function recipientFor(d: RecipientDeps, id: string, fallback: { kind: ProviderEntry['kind']; label: string; model?: string } | null, use: 'answers' | 'recordings'): AIRecipient | null {
  const entry = d.entry(id)
  const kind = entry?.kind ?? fallback?.kind
  if (!kind) return null
  // (el modelo: con OpenCode dice a qué empresa van los datos)
  const model = fallback?.model ?? entry?.config?.model
  return aiRecipientOf({ id, kind, label: entry?.label ?? fallback?.label ?? id, baseURL: entry?.provider.baseURL, presetBaseURL: entry?.preset?.baseURL, ...(model ? { model } : {}) }, use)
}

/** Los destinatarios de ahora, sin repetir (una empresa que responde y transcribe sale una vez, con los dos usos). */
export async function currentAIRecipients(d: RecipientDeps = realDeps): Promise<AIRecipient[]> {
  if (d.simulated()) return []
  const status = await d.status()
  const list: (AIRecipient | null)[] = []
  const r = status.resolved
  if (status.ready && r) list.push(recipientFor(d, r.providerId, { kind: r.kind, label: r.label, model: r.model }, 'answers'))
  const t = d.transcriptionId()
  if (t) list.push(recipientFor(d, t, null, 'recordings'))
  return mergeRecipients(list)
}
