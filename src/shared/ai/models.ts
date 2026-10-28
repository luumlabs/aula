// Nombres de modelo para personas (port de ModelInfo.prettyName). Solo para enseñar: a la API siempre va el `id`.
const KNOWN: Record<string, string> = {
  gpt: 'GPT', deepseek: 'DeepSeek', mimo: 'MiMo', glm: 'GLM', oss: 'OSS', ai: 'AI', openai: 'OpenAI',
  llama: 'Llama', qwen: 'Qwen', kimi: 'Kimi', gemma: 'Gemma', gemini: 'Gemini', claude: 'Claude', mistral: 'Mistral'
}

/** «gpt-6-sol» → «GPT-6 Sol»; «claude-sonnet-5-5» → «Claude Sonnet 5.5»; «qwen3.5:9b» → «Qwen3.5 9B». */
export function prettyModelName(id: string): string {
  let base = id
  const slash = base.lastIndexOf('/')
  if (slash >= 0) base = base.slice(slash + 1)
  let tag = ''
  const colon = base.indexOf(':')
  if (colon >= 0) {
    tag = base.slice(colon + 1)
    base = base.slice(0, colon)
  }
  // «claude-sonnet-5-5» → versión con punto
  if (base.toLowerCase().startsWith('claude-')) base = base.replace(/-(\d)-(\d)(?=$|-)/g, '-$1.$2')
  const words: string[] = []
  for (const w of base.split('-')) {
    if (!w) continue
    const lower = w.toLowerCase()
    if (KNOWN[lower]) words.push(KNOWN[lower])
    else if (/^v?\d/.test(lower)) words.push(lower.startsWith('v') ? 'V' + w.slice(1) : w)
    else if (/^\d+(\.\d+)?b$/.test(lower)) words.push(w.toUpperCase())
    else words.push(w.charAt(0).toUpperCase() + w.slice(1))
  }
  // «GPT 6 Sol» → «GPT-6 Sol»; «gpt-oss» se escribe así
  let name = words.join(' ').replace(/^GPT (\d)/, 'GPT-$1').replace(/^GPT OSS\b/, 'gpt-oss')
  if (tag && tag.toLowerCase() !== 'latest') name += ' ' + (/^\d+(\.\d+)?b$/i.test(tag) ? tag.toUpperCase() : tag)
  return name
}
