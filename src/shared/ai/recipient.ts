// A quién manda Aula los datos cuando usa la IA: la empresa detrás de cada proveedor (para el aviso de la IA de terceros en
// los dispositivos, guía 5.1.2(i) del App Store). Puro: sin Node ni DOM.
import type { AIProviderKind } from '../settings/ai'
import { isLoopbackHost } from './customProvider'

/** Para qué recibe datos: responder (chat, corrección, cursos) o transcribir grabaciones. */
export type AIRecipientUse = 'answers' | 'recordings'

export interface AIRecipient {
  /** Estable: 'anthropic', 'openai', 'google'…, 'host:<servidor>' o 'provider:<id>'. */
  id: string
  /** Nombre propio de la empresa o del servidor (un dato, no un texto de la interfaz). */
  name: string
  /** El producto, si se conoce mejor por él («Claude», «ChatGPT»). */
  product?: string
  uses: AIRecipientUse[]
}

type Known = Omit<AIRecipient, 'uses'>

const ANTHROPIC: Known = { id: 'anthropic', name: 'Anthropic', product: 'Claude' }
const CHATGPT: Known = { id: 'openai', name: 'OpenAI', product: 'ChatGPT' }

/** La empresa de cada preset (src/main/services/ai/presets.ts). */
const BY_PRESET: Readonly<Record<string, Known>> = {
  'claude-cli': ANTHROPIC,
  anthropic: ANTHROPIC,
  'codex-cli': CHATGPT,
  openai: { id: 'openai', name: 'OpenAI' },
  gemini: { id: 'google', name: 'Google', product: 'Gemini' },
  deepseek: { id: 'deepseek', name: 'DeepSeek' },
  mistral: { id: 'mistral', name: 'Mistral AI' },
  groq: { id: 'groq', name: 'Groq' },
  xai: { id: 'xai', name: 'xAI', product: 'Grok' },
  openrouter: { id: 'openrouter', name: 'OpenRouter' },
  mimo: { id: 'xiaomi', name: 'Xiaomi', product: 'MiMo' },
  'opencode-zen': { id: 'opencode', name: 'OpenCode', product: 'Zen' },
  'opencode-cli': { id: 'opencode-cli', name: 'OpenCode' }
}

/** Con OpenCode, los datos van al proveedor del modelo («proveedor/modelo», el de la izquierda), no a OpenCode. */
const OPENCODE_PROVIDERS: Readonly<Record<string, Known>> = {
  anthropic: ANTHROPIC,
  openai: { id: 'openai', name: 'OpenAI' },
  google: { id: 'google', name: 'Google', product: 'Gemini' },
  'google-vertex': { id: 'google', name: 'Google', product: 'Gemini' },
  opencode: { id: 'opencode', name: 'OpenCode', product: 'Zen' },
  deepseek: { id: 'deepseek', name: 'DeepSeek' },
  mistral: { id: 'mistral', name: 'Mistral AI' },
  groq: { id: 'groq', name: 'Groq' },
  xai: { id: 'xai', name: 'xAI', product: 'Grok' },
  openrouter: { id: 'openrouter', name: 'OpenRouter' },
  'github-copilot': { id: 'github', name: 'GitHub', product: 'Copilot' }
}

/** La empresa del modelo de OpenCode; null si está vacío (el de OpenCode por defecto) o no se conoce. */
function opencodeCompany(model: string | undefined): Known | null {
  const slash = (model ?? '').indexOf('/')
  if (slash <= 0) return null
  return OPENCODE_PROVIDERS[(model ?? '').slice(0, slash).trim().toLowerCase()] ?? null
}

function hostOf(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return ''
  }
}

/**
 * Quién recibe los datos de un proveedor; null si no salen de este ordenador (el modelo de Aula, la IA simulada, o un
 * servidor en este mismo equipo). Un preset con su dirección de siempre es su empresa; con otra, o uno personalizado, el
 * servidor al que se manda. OpenCode, el proveedor de su modelo (`model`, «proveedor/modelo») si se conoce.
 */
export function aiRecipientOf(
  p: { id: string; kind: AIProviderKind; label: string; baseURL?: string; presetBaseURL?: string; model?: string },
  use: AIRecipientUse
): AIRecipient | null {
  if (p.kind === 'aula-local' || p.id === 'fake') return null
  const viaOpenCode = p.kind === 'opencode-cli' ? opencodeCompany(p.model) : null
  if (viaOpenCode) return { ...viaOpenCode, uses: [use] }
  const host = hostOf(p.baseURL)
  if (host && isLoopbackHost(host)) return null
  const known = BY_PRESET[p.id]
  const presetHost = hostOf(p.presetBaseURL)
  if (known && (!host || !presetHost || host === presetHost)) return { ...known, uses: [use] }
  if (host) return { id: `host:${host}`, name: host, uses: [use] }
  // sin dirección: las CLI de cada empresa, o un servidor local con su dirección de siempre
  if (p.kind === 'anthropic' || p.kind === 'claude-cli') return { ...ANTHROPIC, uses: [use] }
  if (p.kind === 'codex-cli') return { ...CHATGPT, uses: [use] }
  if (p.kind === 'ollama' || p.kind === 'lmstudio') return null
  return { id: `provider:${p.id}`, name: p.label, uses: [use] }
}

/** Une por empresa (sumando los usos), sin repetir y en orden. */
export function mergeRecipients(list: readonly (AIRecipient | null)[]): AIRecipient[] {
  const out: AIRecipient[] = []
  for (const r of list) {
    if (!r) continue
    const same = out.find((x) => x.id === r.id)
    if (!same) out.push({ ...r, uses: [...r.uses] })
    else for (const u of r.uses) if (!same.uses.includes(u)) same.uses.push(u)
  }
  return out
}

/** «Anthropic (Claude)» o «Anthropic». */
export function recipientLabel(r: Pick<AIRecipient, 'name' | 'product'>): string {
  return r.product ? `${r.name} (${r.product})` : r.name
}
