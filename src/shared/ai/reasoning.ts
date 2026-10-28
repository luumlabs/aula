// Niveles de razonamiento que admite cada modelo (port de AICore/ReasoningCapabilities.swift).
// «Automático» se representa por ausencia en la petición, nunca como un valor de la API.
import type { AIProviderKind } from '../settings/ai'
import { tr } from './i18n'

export interface ReasoningCapabilities {
  efforts: string[]
  defaultEffort?: string
  /** Modos de `thinking` que acepta el modelo (Anthropic: adaptive, enabled, disabled). `undefined` = no se sabe. */
  thinkingTypes?: string[]
}

export const AUTOMATIC_EFFORT = 'automatic'

/** Limpia los niveles (minúsculas, sin vacíos, sin «automatic», sin repetidos) y valida el predeterminado. */
export function reasoningCaps(efforts: string[], defaultEffort?: string | null, thinkingTypes?: string[] | null): ReasoningCapabilities {
  const seen = new Set<string>()
  const sanitized: string[] = []
  for (const raw of efforts) {
    const v = String(raw).trim().toLowerCase()
    if (!v || v === AUTOMATIC_EFFORT || seen.has(v)) continue
    seen.add(v)
    sanitized.push(v)
  }
  const caps: ReasoningCapabilities = { efforts: sanitized }
  if (defaultEffort && sanitized.includes(defaultEffort)) caps.defaultEffort = defaultEffort
  if (thinkingTypes) caps.thinkingTypes = [...thinkingTypes]
  return caps
}

/** El nivel si el modelo lo admite (o `undefined`). */
export function validatedEffort(caps: ReasoningCapabilities | undefined | null, raw: string | undefined | null): string | undefined {
  if (!caps || raw == null) return undefined
  const v = raw.trim().toLowerCase()
  return caps.efforts.includes(v) ? v : undefined
}

export function supportsAdaptiveThinking(caps: ReasoningCapabilities | undefined | null): boolean {
  return caps?.thinkingTypes?.includes('adaptive') === true
}

/** Nombre de un nivel para personas («Alto», «Sin razonamiento»…). */
export function reasoningLevelName(value: string): string {
  switch (value) {
    case 'auto':
    case AUTOMATIC_EFFORT:
      return tr('Automático', 'Automatic')
    case 'none':
      return tr('Sin razonamiento', 'No reasoning')
    case 'enabled':
      return tr('Activado', 'Enabled')
    case 'minimal':
      return tr('Mínimo', 'Minimum')
    case 'low':
      return tr('Bajo', 'Low')
    case 'medium':
      return tr('Medio', 'Medium')
    case 'high':
      return tr('Alto', 'High')
    case 'xhigh':
      return tr('Extra alto', 'Extra high')
    case 'max':
      return tr('Máximo', 'Maximum')
    case 'ultra':
      return tr('Ultra', 'Ultra')
    default:
      return value
  }
}

/** Lo que hace falta saber del proveedor para deducir capacidades conocidas. */
export interface ReasoningProviderInfo {
  kind: AIProviderKind
  baseURL?: string
}

function hostOf(baseURL: string | undefined): string {
  if (!baseURL) return ''
  try {
    return new URL(baseURL.trim()).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Acepta el identificador y sus versiones con fecha; no infiere capacidades de cualquier nombre con el mismo prefijo. */
function matches(model: string, families: string[]): boolean {
  return families.some((f) => {
    if (model === f) return true
    const e = escapeRegex(f)
    return new RegExp(`^${e}-\\d{8}$`).test(model) || new RegExp(`^${e}-\\d{4}-\\d{2}-\\d{2}$`).test(model)
  })
}

/** Niveles de `output_config.effort` y modos de `thinking` de cada Claude (doc oficial, comprobado el 19-10-2026). */
function claude(m: string): ReasoningCapabilities | undefined {
  const basic = ['low', 'medium', 'high']
  const all = [...basic, 'xhigh', 'max']
  // razonamiento adaptativo siempre activo: `disabled` da un 400
  if (matches(m, ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-mythos-5-1', 'claude-fable-5', 'claude-mythos-5'])) {
    return reasoningCaps(all, m.startsWith('claude-opus-5-5') ? 'medium' : 'high', ['adaptive'])
  }
  if (matches(m, ['claude-haiku-5-5'])) return reasoningCaps(all, 'medium', ['adaptive', 'disabled'])
  if (matches(m, ['claude-opus-5', 'claude-sonnet-5'])) return reasoningCaps(all, 'high', ['adaptive', 'disabled'])
  // sin `thinking` no piensan: hay que pedir el modo adaptativo
  if (matches(m, ['claude-opus-4-8', 'claude-opus-4-7'])) return reasoningCaps(all, 'high', ['adaptive', 'disabled'])
  if (matches(m, ['claude-opus-4-6', 'claude-sonnet-4-6'])) return reasoningCaps([...basic, 'max'], 'high', ['adaptive', 'enabled', 'disabled'])
  // solo pensamiento manual (`budget_tokens`): el adaptativo da un 400
  if (matches(m, ['claude-opus-4-5'])) return reasoningCaps(basic, 'high', ['enabled', 'disabled'])
  return undefined
}

/**
 * Respaldo conservador, verificado en las páginas oficiales de OpenAI/Anthropic/DeepSeek/MiMo en octubre de 2026.
 * Las CLIs Codex y OpenCode dependen de su catálogo: no se confunden sus variantes con los parámetros de una API.
 */
export function knownReasoningCapabilities(model: string, provider: ReasoningProviderInfo): ReasoningCapabilities | undefined {
  if (!model) return undefined
  const host = hostOf(provider.baseURL)
  const m = model.toLowerCase()
  const basic = ['low', 'medium', 'high']
  const extended = [...basic, 'xhigh', 'max']
  if (provider.kind === 'codex-cli' || provider.kind === 'opencode-cli' || provider.kind === 'aula-local') return undefined
  if (provider.kind === 'claude-cli') {
    if (['opus', 'sonnet', 'haiku', 'fable'].includes(m)) return reasoningCaps(extended)
    return claude(m)
  }
  if (host === 'api.openai.com') {
    if (matches(m, ['gpt-6.1-sol', 'gpt-6-astra'])) return reasoningCaps(extended)
    if (matches(m, ['gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6'])) {
      return reasoningCaps(['none', ...extended], 'medium')
    }
    // gpt-5.5: none, low, medium (predeterminado), high, xhigh
    if (matches(m, ['gpt-5.5'])) return reasoningCaps(['none', ...basic, 'xhigh'], 'medium')
  }
  if (host === 'api.anthropic.com') return claude(m)
  if (host === 'api.deepseek.com' && matches(m, ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4.1-flash'])) {
    return reasoningCaps(['none', 'low', 'high', 'max'], 'high')
  }
  if ((host === 'xiaomimimo.com' || host.endsWith('.xiaomimimo.com')) &&
      matches(m, ['mimo-v2.6-flash', 'mimo-v2.6-pro', 'mimo-v2.6-pro-ultraspeed', 'mimo-v2.5-pro', 'mimo-v2.5'])) {
    // MiMo declara un interruptor thinking.type; no publica niveles de esfuerzo
    return reasoningCaps(['none', 'enabled'])
  }
  return undefined
}
