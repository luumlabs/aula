// The App Store prototype asks before sending study content to an AI destination.
// Grants are intentionally held only in memory and can be revoked from Settings.
import { tr } from '@shared/ai/i18n'
import { AIError } from './errors'
import { abortReason } from './http/options'

export interface AIConsentDestination {
  provider: string
  origin: string
}

export type AIConsentPrompt = (destination: AIConsentDestination) => Promise<boolean>

export class AIConsentGate {
  private readonly grants = new Set<string>()
  private readonly pending = new Map<string, Promise<boolean>>()
  private generation = 0

  constructor(private readonly prompt: AIConsentPrompt) {}

  async authorize(url: string, label: string): Promise<boolean> {
    let parsed: URL
    try { parsed = new URL(url) } catch { return false }
    if (!['http:', 'https:'].includes(parsed.protocol)) return false
    const provider = label.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, 80) || 'AI provider'
    const destination = { provider, origin: parsed.origin }
    const key = JSON.stringify(destination)
    if (this.grants.has(key)) return true
    const existing = this.pending.get(key)
    if (existing) return existing
    const generation = this.generation
    const request = Promise.resolve().then(() => this.prompt(destination)).then(allowed => {
      if (!allowed || this.generation !== generation) return false
      this.grants.add(key)
      return true
    }).catch(() => false).finally(() => {
      if (this.pending.get(key) === request) this.pending.delete(key)
    })
    this.pending.set(key, request)
    return request
  }

  revokeAll(): void {
    this.generation++
    this.grants.clear()
  }
}

let prompt: AIConsentPrompt | undefined
const sessionConsent = new AIConsentGate(destination => prompt ? prompt(destination) : Promise.resolve(false))

/** Installed by the main process; absence of a prompt must never grant permission. */
export function installAIConsentPrompt(next: AIConsentPrompt): void { prompt = next }
export function revokeAIConsent(): void { sessionConsent.revokeAll() }

export async function authorizeAIRequest(url: string, provider: string, signal: AbortSignal): Promise<void> {
  if (process.mas !== true) return
  if (signal.aborted) throw abortReason(signal)
  const allowed = await sessionConsent.authorize(url, provider)
  if (signal.aborted) throw abortReason(signal)
  if (!allowed) throw new AIError('other', tr(
    'Aula no envió tus datos. Para usar esta IA, abre Aula y acepta compartir la información solicitada.',
    'Aula did not send your data. To use this AI, open Aula and agree to share the requested information.'
  ))
}
