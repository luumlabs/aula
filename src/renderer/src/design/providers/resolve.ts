// Qué logo corresponde a un proveedor de IA (por su id de preset, su tipo, el host de su URL o, en último caso, su nombre)
// y a un modelo (por su prefijo «proveedor/modelo» o su familia). Puro: sin React ni DOM, con pruebas al lado.
import { BRAND_LOGOS, type BrandLogoId } from './logos'

/** Un logo de marca, el de Aula (su motor propio) o el genérico de «compatible con OpenAI». */
export type LogoId = BrandLogoId | 'aula' | 'custom'

export interface ProviderLike {
  id?: string | null
  kind?: string | null
  baseURL?: string | null
  label?: string | null
}

/** Ids de los presets (src/main/services/ai/presets.ts) → logo. */
const BY_PRESET: Record<string, LogoId> = {
  'claude-cli': 'claude',
  'codex-cli': 'chatgpt',
  'opencode-cli': 'opencode',
  anthropic: 'anthropic',
  openai: 'openai',
  openrouter: 'openrouter',
  deepseek: 'deepseek',
  mimo: 'xiaomi',
  gemini: 'gemini',
  mistral: 'mistral',
  groq: 'groq',
  xai: 'grok',
  'opencode-zen': 'opencode',
  'aula-local': 'aula',
  ollama: 'ollama',
  lmstudio: 'lmstudio',
  custom: 'custom'
}

/** Tipos de proveedor con un único logo posible (los `openai-compatible` dependen de la URL). */
const BY_KIND: Record<string, LogoId> = {
  'claude-cli': 'claude',
  'codex-cli': 'chatgpt',
  'opencode-cli': 'opencode',
  anthropic: 'anthropic',
  'aula-local': 'aula',
  ollama: 'ollama',
  lmstudio: 'lmstudio'
}

/** Sufijos de host → logo (un servicio propio con la URL de un proveedor conocido lleva su logo). */
const BY_HOST: [string, LogoId][] = [
  ['anthropic.com', 'anthropic'],
  ['openai.com', 'openai'],
  ['openrouter.ai', 'openrouter'],
  ['deepseek.com', 'deepseek'],
  ['xiaomimimo.com', 'xiaomi'],
  ['generativelanguage.googleapis.com', 'gemini'],
  ['mistral.ai', 'mistral'],
  ['groq.com', 'groq'],
  ['x.ai', 'grok'],
  ['opencode.ai', 'opencode'],
  ['dashscope.aliyuncs.com', 'qwen'],
  ['moonshot.ai', 'kimi'],
  ['moonshot.cn', 'kimi'],
  ['z.ai', 'zai'],
  ['bigmodel.cn', 'zai']
]

/** Palabras de un nombre visible («Claude (suscripción) · sonnet») → logo; el orden importa (ChatGPT antes que OpenAI). */
const BY_WORD: [RegExp, LogoId][] = [
  [/\bchatgpt\b|\bcodex\b/i, 'chatgpt'],
  [/\bclaude\b/i, 'claude'],
  [/\banthropic\b/i, 'anthropic'],
  [/\bopenrouter\b/i, 'openrouter'],
  [/\bopenai\b/i, 'openai'],
  [/\bdeepseek\b/i, 'deepseek'],
  [/\bmimo\b|\bxiaomi\b/i, 'xiaomi'],
  [/\bgemini\b/i, 'gemini'],
  [/\bmistral\b/i, 'mistral'],
  [/\bgroq\b/i, 'groq'],
  [/\bgrok\b|\bxai\b/i, 'grok'],
  [/\bopencode\b/i, 'opencode'],
  [/\bollama\b/i, 'ollama'],
  [/\blm ?studio\b/i, 'lmstudio'],
  [/\baula\b/i, 'aula']
]

/** Prefijos «creador/» de OpenRouter, Groq o Zen → logo del creador del modelo. */
const BY_MAKER: Record<string, LogoId> = {
  anthropic: 'claude',
  openai: 'openai',
  google: 'gemini',
  deepseek: 'deepseek',
  'deepseek-ai': 'deepseek',
  xiaomi: 'xiaomi',
  mistralai: 'mistral',
  'x-ai': 'grok',
  xai: 'grok',
  qwen: 'qwen',
  moonshotai: 'kimi',
  'meta-llama': 'meta',
  'z-ai': 'zai',
  zai: 'zai',
  thudm: 'zai'
}

/** Familias de modelos por su nombre → logo del creador. */
const BY_FAMILY: [RegExp, LogoId][] = [
  [/^claude|^(opus|sonnet|haiku)\b/i, 'claude'],
  [/^gpt|^o[1-9](\b|-)|^chatgpt/i, 'openai'],
  [/^gemini|^gemma/i, 'gemini'],
  [/^deepseek/i, 'deepseek'],
  [/^mimo/i, 'xiaomi'],
  [/^(mistral|magistral|codestral|devstral|ministral|pixtral)/i, 'mistral'],
  [/^grok/i, 'grok'],
  [/^(qwen|qwq)/i, 'qwen'],
  [/^kimi/i, 'kimi'],
  [/^(llama|meta-llama)/i, 'meta'],
  [/^glm/i, 'zai']
]

function host(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).host.toLowerCase() || null
  } catch {
    return null
  }
}

/** Logo por la URL base: proveedores conocidos, y Ollama o LM Studio en este ordenador por su puerto de siempre. */
export function logoForBaseURL(url: string | null | undefined): LogoId | null {
  const h = host(url)
  if (!h) return null
  const name = h.replace(/:\d+$/, '')
  for (const [suffix, logo] of BY_HOST) if (name === suffix || name.endsWith(`.${suffix}`)) return logo
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(name)) {
    if (h.endsWith(':11434')) return 'ollama'
    if (h.endsWith(':1234')) return 'lmstudio'
  }
  return null
}

/** Logo por un texto libre (el nombre del proveedor que guarda una creación de curso, p. ej.). null si no se reconoce. */
export function logoForText(text: string | null | undefined): LogoId | null {
  if (!text) return null
  for (const [re, logo] of BY_WORD) if (re.test(text)) return logo
  return null
}

/** El logo de un proveedor. Lo desconocido (un servicio propio) lleva el genérico «compatible con OpenAI». */
export function logoForProvider(p: ProviderLike): LogoId {
  const byId = p.id ? BY_PRESET[p.id] : undefined
  if (byId && byId !== 'custom') return byId
  const byKind = p.kind ? BY_KIND[p.kind] : undefined
  if (byKind) return byKind
  return logoForBaseURL(p.baseURL) ?? (byId ? 'custom' : logoForText(p.label)) ?? 'custom'
}

/** El logo del creador de un modelo («deepseek/deepseek-v4.1-flash», «qwen3.5:9b», «claude-sonnet-5-5»…), o null. */
export function logoForModel(model: string | null | undefined): LogoId | null {
  const m = (model ?? '').trim()
  if (!m) return null
  const slash = m.indexOf('/')
  if (slash > 0) {
    const maker = BY_MAKER[m.slice(0, slash).toLowerCase()]
    if (maker) return maker
  }
  const name = slash > 0 ? m.slice(slash + 1) : m
  for (const [re, logo] of BY_FAMILY) if (re.test(name)) return logo
  return null
}

/** ¿Es un logo de marca (con trazos propios) y no uno de Aula? */
export function isBrandLogo(id: LogoId): id is BrandLogoId {
  return id in BRAND_LOGOS
}
