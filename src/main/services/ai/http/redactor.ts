// Oculta claves de API en cualquier texto que pueda acabar en un mensaje de error o en el registro (port de Redactor.swift).
import { tr } from '@shared/ai/i18n'

export function keyPlaceholder(): string {
  return tr('«clave»', '“key”')
}

const PATTERNS = [
  /\bsk-[A-Za-z0-9_\-*.]{6,}/g, // OpenAI, DeepSeek, OpenRouter (sk-or-…), Anthropic (sk-ant-…)
  /\b(?:xai|gsk|pplx|tgp|tp)-[A-Za-z0-9_\-*.]{8,}/g, // xAI, Groq, Perplexity, otros
  /\bAIza[0-9A-Za-z_-]{20,}/g, // Google
  /\bbearer\s+[A-Za-z0-9._\-*]{8,}/gi // cabeceras Authorization repetidas
]

/** Sustituye las claves exactas indicadas (si miden 6+ caracteres) y todo lo que parezca una clave de API. */
export function scrubSecrets(text: string, secrets: string[] = []): string {
  const placeholder = keyPlaceholder()
  let out = text
  for (const s of secrets) if (s.length >= 6) out = out.split(s).join(placeholder)
  for (const re of PATTERNS) out = out.replace(re, placeholder)
  return out
}
