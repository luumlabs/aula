// Utilidades de texto del chat con Aula (port de AssistantText y AssistantCatalog.readable/text de StudyEngine/Assistant).
import type { Block } from '@shared/schema/blocks'
import { tr } from '@shared/ai/i18n'
import { charCount, prefixChars } from './fold'
import { chatSecretRanges, replaceRanges, secretURLRanges } from './privacy'

/** Una línea, sin dobles espacios, como mucho `max` caracteres (con «…»). */
export function oneLine(text: string, max: number): string {
  const s = text.replace(/\n/g, ' ').replace(/ {2}/g, ' ').trim()
  return charCount(s) <= max ? s : prefixChars(s, max - 1) + '…'
}

/** Título a partir de la primera pregunta: una línea, sin Markdown, como mucho ~48 caracteres cortando en palabra. */
export function titleFrom(text: string): string {
  const line = oneLine(text, 200).replace(/\*\*/g, '').replace(/`/g, '')
  if (charCount(line) <= 48) return line
  const cut = prefixChars(line, 48)
  const sp = cut.lastIndexOf(' ')
  if (sp >= 0 && charCount(cut.slice(0, sp)) > 24) return cut.slice(0, sp) + '…'
  return cut + '…'
}

const KNOWN_SECRETS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{16,}/g, /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, /\bghp_[A-Za-z0-9]{30,}\b/g, /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g, /\bAIza[0-9A-Za-z_-]{30,}\b/g, /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g,
  /\bbearer\s+[A-Za-z0-9._-]{20,}/gi, /\b\d{3,6}~[A-Za-z0-9]{40,}\b/g, // tokens de Canvas: «12345~AbC…»
  /(?:api[_\- ]?key|token|clave|password|contraseña)\s*[:=]\s*\S{12,}/gi
]

/** Quita claves y tokens que el estudiante haya pegado (nunca se mandan a la IA ni se guardan). Además de las claves con forma
 * conocida: los enlaces privados de calendario y las direcciones con clave, el valor de «mi contraseña de Canvas es …» y los
 * números de tarjeta (AI-05). */
export function redactSecrets(text: string): { text: string; redacted: boolean } {
  const hidden = tr('[clave oculta]', '[key hidden]')
  let out = text
  let hit = false
  for (const re of KNOWN_SECRETS) {
    re.lastIndex = 0
    if (re.test(out)) {
      hit = true
      re.lastIndex = 0
      out = out.replace(re, hidden)
    }
  }
  const urls = secretURLRanges(out, false)
  if (urls.length) {
    hit = true
    out = replaceRanges(out, urls, tr('[enlace privado oculto]', '[private link hidden]'))
  }
  const values = chatSecretRanges(out)
  if (values.length) {
    hit = true
    out = replaceRanges(out, values, hidden)
  }
  return { text: out, redacted: hit }
}

/** Texto para enseñar en una lista (sin `$`, con las órdenes de LaTeX más comunes como símbolos y los huecos como «___»). */
export function readable(s: string): string {
  let t = s.replace(/\\left/g, '').replace(/\\right/g, '')
  t = t.replace(/\\(?:d|t)?frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2')
  const table: Array<[string, string]> = [['\\leq', '≤'], ['\\geq', '≥'], ['\\neq', '≠'], ['\\le', '≤'], ['\\ge', '≥'], ['\\ne', '≠'], ['\\cdot', '·'], ['\\times', '×'], ['\\pi', 'π'],
    ['\\theta', 'θ'], ['\\alpha', 'α'], ['\\beta', 'β'], ['\\sqrt', '√'], ['\\infty', '∞'], ['^2', '²'], ['^3', '³'], ['$', ''], ['**', '']]
  for (const [a, b] of table) t = t.split(a).join(b)
  t = t.replace(/\[\[\d+\]\]/g, '___')
  return t.replace(/\\/g, '')
}

/** Texto legible de unos bloques (para buscar y para describir un ejercicio). */
export function textOfBlocks(blocks: readonly Block[]): string {
  const parts: string[] = []
  for (const b of blocks) {
    switch (b.type) {
      case 'text': parts.push(b.md); break
      case 'math': parts.push(`$${b.tex}$`); break
      case 'callout': parts.push([b.title, b.md].filter((x): x is string => !!x).join(': ')); break
      case 'example': parts.push(b.problem); break
      default: break
    }
  }
  return parts.join(' ').replace(/\n/g, ' ').trim()
}

/** Recorta para la IA («…» al final). */
export function clip(s: string, max: number): string {
  return charCount(s) <= max ? s : prefixChars(s, max) + '…'
}
