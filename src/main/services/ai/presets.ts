// Proveedores preconfigurados (port de ProviderPresets.swift + Groq, Google Gemini, Mistral y LM Studio). Los `id` son estables
// (se guardan en los ajustes). Direcciones y modelos verificados en octubre de 2026; `contextWindow` es la VENTANA DE TRABAJO que
// el bucle respeta al recortar el historial, no el máximo del modelo.
import type { AIProviderKind } from '@shared/settings/ai'
import { aiKeyRef } from '@shared/settings/ai'
import type { Bilingual } from '@shared/ai/i18n'
import type { AIProviderGroup } from '@shared/ai/views'
import type { ProviderConfig } from './providers/config'
import { hostOf } from './http/endpoints'

export interface ProviderPreset {
  id: string
  kind: AIProviderKind
  label: Bilingual
  group: AIProviderGroup
  baseURL?: string
  /** Modelo recomendado ('' = el predeterminado de la CLI o elegir uno). */
  model: string
  /** ¿Usa clave de API? (se guarda en el almacén con `ai.key.<id>`). */
  usesKey: boolean
  extraHeaders?: Record<string, string>
  supportsTools: boolean
  supportsVision: boolean
  supportsJSONMode: boolean
  contextWindow?: number
  maxOutputTokens?: number
  help: Bilingual
  /** Dónde se crea la clave. */
  keyURL?: string
  /** Al elegir solo el mejor proveedor disponible, gana el de prioridad más alta. */
  priority: number
}

const bi = (es: string, en: string): Bilingual => ({ es, en })

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // Suscripciones (CLI): las ejecuta el módulo de agentes (src/main/services/agents), que registra su fábrica.
  {
    id: 'claude-cli', kind: 'claude-cli', group: 'subscription', label: bi('Claude (suscripción)', 'Claude (subscription)'), model: '', usesKey: false,
    supportsTools: true, supportsVision: false, supportsJSONMode: false, priority: 90,
    help: bi(
      'Usa tu suscripción de Claude (Pro o Max) sin clave de API. Instala Claude Code (claude.com/claude-code) y ejecuta «claude» una vez en la terminal para iniciar sesión. Deja el modelo vacío para usar el predeterminado de la CLI; puedes escribir un alias como «sonnet» u «opus». Es la opción más económica para generar cursos largos si ya pagas Claude.',
      "Use your Claude subscription (Pro or Max) without an API key. Install Claude Code (claude.com/claude-code) and run “claude” once in a terminal to sign in. Leave the model empty to use the CLI's default; you can type an alias like “sonnet” or “opus”. It's the cheapest option for generating long courses if you already pay for Claude."
    )
  },
  {
    id: 'codex-cli', kind: 'codex-cli', group: 'subscription', label: bi('ChatGPT (Codex)', 'ChatGPT (Codex)'), model: '', usesKey: false,
    supportsTools: true, supportsVision: false, supportsJSONMode: false, priority: 88,
    help: bi(
      'Usa tu suscripción de ChatGPT (Plus o Pro) sin clave de API: pulsa «Conectar con ChatGPT» y Aula usa la herramienta oficial de OpenAI (Codex) para que inicies sesión. Si ya usas Codex en este ordenador con tu sesión, Aula lo usa tal cual.',
      'Use your ChatGPT subscription (Plus or Pro) without an API key: click “Connect to ChatGPT” and Aula uses OpenAI’s official tool (Codex) so you can sign in. If you already use Codex on this computer with your session, Aula uses it as is.'
    )
  },
  {
    id: 'opencode-cli', kind: 'opencode-cli', group: 'subscription', label: bi('OpenCode', 'OpenCode'), model: '', usesKey: false,
    supportsTools: true, supportsVision: false, supportsJSONMode: false, priority: 70,
    help: bi(
      'Usa la CLI «opencode» (opencode.ai) con los proveedores que ya hayas conectado allí (comando /connect), incluidos los modelos gratuitos de OpenCode Zen. Para elegir modelo escríbelo como «proveedor/modelo»; vacío usa el predeterminado de OpenCode.',
      'Use the “opencode” CLI (opencode.ai) with the providers you already connected there (/connect command), including the free OpenCode Zen models. To choose a model, write it as “provider/model”; empty uses OpenCode’s default.'
    )
  },
  // APIs con clave
  {
    id: 'anthropic', kind: 'anthropic', group: 'api', label: bi('Anthropic (API)', 'Anthropic (API)'), baseURL: 'https://api.anthropic.com',
    model: 'claude-sonnet-5-5', usesKey: true, supportsTools: true, supportsVision: true, supportsJSONMode: false,
    contextWindow: 200_000, maxOutputTokens: 32_000, keyURL: 'https://platform.claude.com/settings/keys', priority: 60,
    help: bi(
      'Crea la clave en platform.claude.com ▸ API keys (la API se factura aparte de la suscripción de Claude). «claude-sonnet-5-5» es el mejor equilibrio para cursos largos con herramientas; «claude-opus-5-5» es más preciso y más caro. Si ya tienes la suscripción de Claude, usar «Claude (suscripción)» te sale más barato.',
      'Create the key at platform.claude.com ▸ API keys (the API is billed separately from the Claude subscription). “claude-sonnet-5-5” is the best balance for long courses with tools; “claude-opus-5-5” is more accurate and more expensive. If you already have the Claude subscription, “Claude (subscription)” is cheaper.'
    )
  },
  {
    id: 'openai', kind: 'openai-compatible', group: 'api', label: bi('OpenAI', 'OpenAI'), baseURL: 'https://api.openai.com/v1', model: 'gpt-6-sol',
    usesKey: true, extraHeaders: { 'x-aula-idle-timeout': '240' }, supportsTools: true, supportsVision: true, supportsJSONMode: true,
    contextWindow: 200_000, maxOutputTokens: 64_000, keyURL: 'https://platform.openai.com/api-keys', priority: 58,
    help: bi(
      'Crea la clave en platform.openai.com/api-keys (la API se paga aparte de ChatGPT y necesita saldo). «gpt-6-sol» equilibra calidad y precio para cursos largos con herramientas; «gpt-6-luna» es más barato y «gpt-6-astra» el más capaz. Los modelos de razonamiento pueden tardar en empezar a responder. Pulsa «Actualizar modelos» para ver los que tiene tu cuenta.',
      'Create the key at platform.openai.com/api-keys (the API is paid separately from ChatGPT and needs credit). “gpt-6-sol” balances quality and price for long courses with tools; “gpt-6-luna” is cheaper and “gpt-6-astra” the most capable. Reasoning models may take a while to start answering. Click “Update models” to see the ones your account has.'
    )
  },
  {
    id: 'openrouter', kind: 'openai-compatible', group: 'api', label: bi('OpenRouter', 'OpenRouter'), baseURL: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-v4.1-flash', usesKey: true,
    // atribución: `X-OpenRouter-Title` es la cabecera actual; `X-Title` se sigue aceptando
    extraHeaders: { 'HTTP-Referer': 'https://aula.local', 'X-OpenRouter-Title': 'Aula', 'X-Title': 'Aula' },
    supportsTools: true, supportsVision: true, supportsJSONMode: true, contextWindow: 200_000, maxOutputTokens: 64_000,
    keyURL: 'https://openrouter.ai/keys', priority: 55,
    help: bi(
      'Una sola clave para cientos de modelos: créala en openrouter.ai/keys y añade saldo. Los modelos se escriben como «proveedor/modelo». Para cursos largos con herramientas elige uno que admita «tools»: «deepseek/deepseek-v4.1-flash» (barato) o «anthropic/claude-sonnet-5.5» (más preciso). Pulsa «Actualizar modelos» para ver la lista completa.',
      'One key for hundreds of models: create it at openrouter.ai/keys and add credit. Models are written as “provider/model”. For long courses with tools, choose one that supports “tools”: “deepseek/deepseek-v4.1-flash” (cheap) or “anthropic/claude-sonnet-5.5” (more accurate). Click “Update models” to see the full list.'
    )
  },
  {
    id: 'deepseek', kind: 'openai-compatible', group: 'api', label: bi('DeepSeek', 'DeepSeek'), baseURL: 'https://api.deepseek.com', model: 'deepseek-flash',
    usesKey: true, supportsTools: true, supportsVision: true, supportsJSONMode: true, contextWindow: 200_000, maxOutputTokens: 64_000,
    keyURL: 'https://platform.deepseek.com/api_keys', priority: 52,
    help: bi(
      'Crea tu clave en platform.deepseek.com ▸ API keys y pégala aquí (necesitas saldo en la cuenta). «deepseek-flash» es rápido, barato, admite herramientas e imágenes y piensa antes de responder: buena opción para generar cursos largos. «deepseek-v4-pro» es más potente (solo texto). Ojo: los nombres antiguos «deepseek-chat» y «deepseek-reasoner» dejaron de funcionar el 24 de julio de 2026.',
      'Create your key at platform.deepseek.com ▸ API keys and paste it here (you need credit in the account). “deepseek-flash” is fast, cheap, supports tools and images and thinks before answering: a good choice for long courses. “deepseek-v4-pro” is more powerful (text only). Note: the old names “deepseek-chat” and “deepseek-reasoner” stopped working on July 24, 2026.'
    )
  },
  {
    id: 'mimo', kind: 'openai-compatible', group: 'api', label: bi('Xiaomi MiMo', 'Xiaomi MiMo'), baseURL: 'https://token-plan-sgp.xiaomimimo.com/v1',
    model: 'mimo-v2.6-flash', usesKey: true, supportsTools: true, supportsVision: true, supportsJSONMode: false, contextWindow: 200_000, maxOutputTokens: 64_000,
    keyURL: 'https://platform.xiaomimimo.com', priority: 50,
    help: bi(
      'Consigue tu clave en platform.xiaomimimo.com. Esta dirección es la del plan «Token Plan»; si usas la API de pago por uso, cámbiala por https://api.xiaomimimo.com/v1. «mimo-v2.6-flash» es rápido y barato, con herramientas e imágenes; «mimo-v2.6-pro» rinde más en cursos largos y exigentes.',
      'Get your key at platform.xiaomimimo.com. This address is for the “Token Plan”; if you use the pay-as-you-go API, change it to https://api.xiaomimimo.com/v1. “mimo-v2.6-flash” is fast and cheap, with tools and images; “mimo-v2.6-pro” performs better on long, demanding courses.'
    )
  },
  {
    id: 'gemini', kind: 'openai-compatible', group: 'api', label: bi('Google Gemini', 'Google Gemini'),
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-flash-latest', usesKey: true,
    supportsTools: true, supportsVision: true, supportsJSONMode: true, contextWindow: 200_000, maxOutputTokens: 64_000,
    keyURL: 'https://aistudio.google.com/apikey', priority: 48,
    help: bi(
      'Crea una clave gratis en aistudio.google.com/apikey (Google AI Studio). Aula usa la API compatible con OpenAI de Gemini. «gemini-flash-latest» es rápido y tiene un nivel gratuito con límites por minuto; «gemini-pro-latest» es más capaz. Pulsa «Actualizar modelos» para ver los disponibles.',
      'Create a free key at aistudio.google.com/apikey (Google AI Studio). Aula uses Gemini’s OpenAI-compatible API. “gemini-flash-latest” is fast and has a free tier with per-minute limits; “gemini-pro-latest” is more capable. Click “Update models” to see what’s available.'
    )
  },
  {
    id: 'mistral', kind: 'openai-compatible', group: 'api', label: bi('Mistral', 'Mistral'), baseURL: 'https://api.mistral.ai/v1', model: 'mistral-medium-latest',
    usesKey: true, supportsTools: true, supportsVision: true, supportsJSONMode: true, contextWindow: 128_000, maxOutputTokens: 32_000,
    keyURL: 'https://console.mistral.ai/api-keys', priority: 45,
    help: bi(
      'Crea la clave en console.mistral.ai ▸ API Keys. «mistral-medium-latest» equilibra calidad y precio con herramientas e imágenes; «mistral-large-latest» es el más capaz y «mistral-small-latest» el más barato.',
      'Create the key at console.mistral.ai ▸ API Keys. “mistral-medium-latest” balances quality and price with tools and images; “mistral-large-latest” is the most capable and “mistral-small-latest” the cheapest.'
    )
  },
  {
    id: 'groq', kind: 'openai-compatible', group: 'api', label: bi('Groq', 'Groq'), baseURL: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b',
    usesKey: true, supportsTools: true, supportsVision: false, supportsJSONMode: true, contextWindow: 128_000, maxOutputTokens: 32_000,
    keyURL: 'https://console.groq.com/keys', priority: 44,
    help: bi(
      'Crea la clave en console.groq.com/keys (tiene un nivel gratuito con límites por minuto). Groq responde muy rápido; «openai/gpt-oss-120b» admite herramientas y sirve para cursos largos. Pulsa «Actualizar modelos» para ver la lista.',
      'Create the key at console.groq.com/keys (there is a free tier with per-minute limits). Groq answers very fast; “openai/gpt-oss-120b” supports tools and works for long courses. Click “Update models” to see the list.'
    )
  },
  {
    id: 'xai', kind: 'openai-compatible', group: 'api', label: bi('xAI (Grok)', 'xAI (Grok)'), baseURL: 'https://api.x.ai/v1', model: '',
    usesKey: true, supportsTools: true, supportsVision: true, supportsJSONMode: true, contextWindow: 128_000, maxOutputTokens: 32_000,
    keyURL: 'https://console.x.ai', priority: 42,
    help: bi(
      'Crea la clave en console.x.ai ▸ API Keys y añade saldo. Pulsa «Actualizar modelos» para elegir uno de los Grok que tiene tu cuenta; si no eliges, Aula usa el primero de la lista que admite herramientas.',
      'Create the key at console.x.ai ▸ API Keys and add credit. Click “Update models” to choose one of the Grok models your account has; if you don’t choose, Aula uses the first one in the list that supports tools.'
    )
  },
  {
    id: 'opencode-zen', kind: 'openai-compatible', group: 'api', label: bi('OpenCode Zen', 'OpenCode Zen'), baseURL: 'https://opencode.ai/inference/v1',
    model: 'deepseek-v4.1-flash', usesKey: true, supportsTools: true, supportsVision: false, supportsJSONMode: false, contextWindow: 200_000, maxOutputTokens: 64_000,
    keyURL: 'https://opencode.ai/zen', priority: 40,
    help: bi(
      'Inicia sesión en opencode.ai/zen, añade saldo y copia tu clave. Zen ofrece modelos probados con agentes; aquí solo funcionan los servidos por «chat/completions» (p. ej. «deepseek-v4.1-flash», «glm-5.3», «kimi-k3», «qwen3.8-max»). Hay modelos gratis por tiempo limitado, como «mimo-v2.6-flash-free».',
      'Sign in at opencode.ai/zen, add credit and copy your key. Zen offers models tested with agents; only the ones served by “chat/completions” work here (e.g. “deepseek-v4.1-flash”, “glm-5.3”, “kimi-k3”, “qwen3.8-max”). There are free models for a limited time, such as “mimo-v2.6-flash-free”.'
    )
  },
  // Modelos en este ordenador
  {
    id: 'aula-local', kind: 'aula-local', group: 'local', label: bi('Modelo de Aula (en este ordenador)', 'Aula model (on this computer)'), model: '',
    usesKey: false, supportsTools: true, supportsVision: false, supportsJSONMode: false, contextWindow: 32_768, maxOutputTokens: 8_192, priority: 22,
    help: bi(
      'Un modelo abierto que Aula descarga una vez y ejecuta en tu ordenador: sin clave, sin cuenta y sin internet después de la descarga. Aula elige el que mejor va con tu equipo. Para cursos largos, los modelos de la nube rinden más.',
      'An open model that Aula downloads once and runs on your computer: no key, no account and no internet after the download. Aula picks the one that suits your machine best. For long courses, cloud models perform better.'
    )
  },
  {
    id: 'ollama', kind: 'ollama', group: 'local', label: bi('Ollama (en este ordenador)', 'Ollama (on this computer)'), baseURL: 'http://localhost:11434/v1',
    model: 'qwen3.5:9b', usesKey: false, supportsTools: true, supportsVision: false, supportsJSONMode: true, contextWindow: 32_768, maxOutputTokens: 8_192, priority: 20,
    help: bi(
      'Usa los modelos que ya tienes en Ollama, sin clave ni internet. A mano: «ollama pull qwen3.5:9b» (o «gpt-oss:20b» con 16 GB o más). Ollama da solo 4 k de contexto por defecto en equipos con poca memoria. Para cursos largos, los modelos locales rinden menos que los de la nube.',
      'Use the models you already have in Ollama, with no key or internet. Manually: “ollama pull qwen3.5:9b” (or “gpt-oss:20b” with 16 GB or more). Ollama gives only 4k of context by default on machines with little memory. For long courses, local models perform worse than cloud ones.'
    )
  },
  {
    id: 'lmstudio', kind: 'lmstudio', group: 'local', label: bi('LM Studio (en este ordenador)', 'LM Studio (on this computer)'), baseURL: 'http://localhost:1234/v1',
    model: '', usesKey: true, supportsTools: true, supportsVision: false, supportsJSONMode: true, contextWindow: 32_768, maxOutputTokens: 8_192, priority: 18,
    help: bi(
      'Abre LM Studio, carga un modelo y activa el servidor local («Developer ▸ Start server», puerto 1234). Aula lo usa sin clave; si activaste «Require API token», pega aquí el token. Elige el modelo con «Actualizar modelos».',
      'Open LM Studio, load a model and start the local server (“Developer ▸ Start server”, port 1234). Aula uses it without a key; if you enabled “Require API token”, paste the token here. Choose the model with “Update models”.'
    )
  },
  // Personalizado
  {
    id: 'custom', kind: 'openai-compatible', group: 'custom', label: bi('Personalizado (compatible con OpenAI)', 'Custom (OpenAI-compatible)'), baseURL: '',
    model: '', usesKey: true, supportsTools: true, supportsVision: false, supportsJSONMode: false, priority: 10,
    help: bi(
      'Para cualquier servicio con API compatible con OpenAI (vLLM, llama.cpp, Together, una pasarela propia…). Escribe la URL base (suele acabar en /v1), el nombre exacto del modelo y, si el servicio la pide, la clave. Si el servicio no admite herramientas, Aula cambia solo a un modo de texto.',
      "For any service with an OpenAI-compatible API (vLLM, llama.cpp, Together, your own gateway…). Enter the base URL (usually ending in /v1), the exact model name, and, if the service requires it, the key. If the service doesn't support tools, Aula automatically switches to a text mode."
    )
  }
]

/** Busca un preset por su id (distingue mayúsculas). */
export function presetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id)
}

/** Nombres de modelo que sus proveedores ya retiraron y el que los sustituye (por id de preset). */
export const RETIRED_MODELS: Record<string, Record<string, string>> = {
  deepseek: { 'deepseek-chat': 'deepseek-flash', 'deepseek-reasoner': 'deepseek-flash', 'deepseek-v4-flash': 'deepseek-flash', 'deepseek-v4-flash-vision-exp': 'deepseek-flash' },
  mimo: { 'mimo-v2.5-pro': 'mimo-v2.6-pro' }
}

/** Direcciones antiguas de un preset que ya no son las documentadas (solo si la persona no las cambió). */
export const MOVED_BASE_URLS: Record<string, Record<string, string>> = {
  'opencode-zen': { 'https://opencode.ai/zen/v1': 'https://opencode.ai/inference/v1' }
}

/** La configuración con el modelo y la dirección al día si eran de los retirados (solo eso; lo demás no se toca). */
export function modernized(config: ProviderConfig): ProviderConfig {
  let presetID = config.id
  const host = hostOf(config.baseURL) ?? ''
  if (!RETIRED_MODELS[presetID] && host.endsWith('deepseek.com')) presetID = 'deepseek'
  if (!RETIRED_MODELS[presetID] && host.endsWith('xiaomimimo.com')) presetID = 'mimo'
  const c: ProviderConfig = { ...config }
  const replacement = RETIRED_MODELS[presetID]?.[config.model]
  if (replacement) c.model = replacement
  const moved = config.baseURL ? MOVED_BASE_URLS[config.id]?.[config.baseURL] : undefined
  if (moved) c.baseURL = moved
  return c
}

/** Configuración completa de un preset (sin lo que la persona haya cambiado). */
export function configFromPreset(p: ProviderPreset, label: string): ProviderConfig {
  return {
    id: p.id,
    kind: p.kind,
    label,
    baseURL: p.baseURL,
    model: p.model,
    secretRef: p.usesKey ? aiKeyRef(p.id) : null,
    extraHeaders: { ...(p.extraHeaders ?? {}) },
    supportsTools: p.supportsTools,
    supportsVision: p.supportsVision,
    supportsStreaming: true,
    supportsJSONMode: p.supportsJSONMode,
    contextWindow: p.contextWindow,
    maxOutputTokens: p.maxOutputTokens,
    enabled: true
  }
}
