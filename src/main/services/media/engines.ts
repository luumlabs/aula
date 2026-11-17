// Qué servicio transcribe las grabaciones: el de un proveedor de IA que el estudiante YA tiene conectado y que sabe
// hacerlo (no todos saben: DeepSeek o Anthropic, por ejemplo, no). Sin ninguno, Aula lo dice y explica qué conectar.
import { providerEntry } from '../ai/registry'
import { resolveDeps, type ProviderDeps } from '../ai/providers/base'
import { resolveKey } from '../ai/providers/keys'
import { consentFetchInitSafe } from './net'
import { openAITranscription, type TranscriptionEngine } from './transcribe'

/** Proveedores con transcripción compatible con OpenAI y su modelo, por orden de preferencia (rápido y barato primero). */
export const TRANSCRIPTION_PROVIDERS: ReadonlyArray<{ id: string; model: string }> = [
  { id: 'groq', model: 'whisper-large-v3-turbo' },
  { id: 'openai', model: 'whisper-1' },
  { id: 'mistral', model: 'voxtral-mini-latest' }
]

/** El primer proveedor conectado que transcribe (con su clave), o undefined. */
function pickTranscriptionCandidate(deps: ProviderDeps = {}): { id: string; model: string; entry: NonNullable<ReturnType<typeof providerEntry>>; baseURL: string; key: string } | undefined {
  const { secrets } = resolveDeps(deps)
  for (const candidate of TRANSCRIPTION_PROVIDERS) {
    let entry
    try { entry = providerEntry(candidate.id) } catch { continue }
    const baseURL = entry?.provider.baseURL
    if (!entry || !baseURL) continue
    let key: string | null = null
    try { key = resolveKey(entry.provider, secrets) } catch { key = null }
    if (!key) continue
    return { id: candidate.id, model: candidate.model, entry, baseURL, key }
  }
  return undefined
}

/** El primer proveedor conectado que transcribe, o undefined. */
export function pickTranscriptionEngine(deps: ProviderDeps = {}): TranscriptionEngine | undefined {
  const c = pickTranscriptionCandidate(deps)
  if (!c) return undefined
  const { http } = resolveDeps(deps)
  return openAITranscription({
    baseURL: c.baseURL, apiKey: c.key, model: c.model, label: `${c.entry.label} · ${c.model}`,
    fetch: ((input: string | URL, init?: RequestInit) => http.fetch(String(input), { ...init, ...consentFetchInitSafe() })) as typeof fetch
  })
}

/** ¿Hay con qué transcribir ahora mismo? (para decirlo en la interfaz antes de que el estudiante suelte una grabación). */
export function canTranscribe(deps: ProviderDeps = {}): boolean {
  return pickTranscriptionCandidate(deps) !== undefined
}

/** El id del proveedor que transcribiría ahora (para el aviso de la IA de terceros en los dispositivos), o undefined. */
export function transcriptionProviderId(deps: ProviderDeps = {}): string | undefined {
  return pickTranscriptionCandidate(deps)?.id
}
