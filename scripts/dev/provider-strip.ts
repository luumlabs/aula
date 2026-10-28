// Fila de logos de las IA para el README («Choose your AI» / «Elige tu IA»), en claro y en oscuro.
// Uso: npx esbuild scripts/dev/provider-strip.ts --bundle --platform=node --format=esm --outfile=/tmp/aula-strip.mjs && node /tmp/aula-strip.mjs
//      → docs/media/screenshots/providers-{light,dark}-{en,es}.svg
// Los trazos salen de src/renderer/src/design/providers/logos.ts (los mismos de la app); el arco de Aula y el enchufe, de sus iconos.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BRAND_LOGOS, type BrandLogoId } from '../../src/renderer/src/design/providers/logos.ts'
import { ICON_PATHS } from '../../src/renderer/src/design/icons/paths.ts'

type Item = { kind: 'brand'; id: BrandLogoId; caption: string } | { kind: 'icon'; icon: 'aula' | 'plug'; caption: string }

const ITEMS: Item[] = [
  { kind: 'brand', id: 'claude', caption: 'Claude' },
  { kind: 'brand', id: 'chatgpt', caption: 'ChatGPT' },
  { kind: 'icon', icon: 'aula', caption: 'Aula (local)' },
  { kind: 'brand', id: 'ollama', caption: 'Ollama' },
  { kind: 'brand', id: 'lmstudio', caption: 'LM Studio' },
  { kind: 'brand', id: 'opencode', caption: 'OpenCode' },
  { kind: 'brand', id: 'anthropic', caption: 'Anthropic' },
  { kind: 'brand', id: 'openai', caption: 'OpenAI' },
  { kind: 'brand', id: 'gemini', caption: 'Gemini' },
  { kind: 'brand', id: 'openrouter', caption: 'OpenRouter' },
  { kind: 'brand', id: 'deepseek', caption: 'DeepSeek' },
  { kind: 'brand', id: 'mistral', caption: 'Mistral' },
  { kind: 'brand', id: 'groq', caption: 'Groq' },
  { kind: 'brand', id: 'grok', caption: 'xAI Grok' },
  { kind: 'brand', id: 'xiaomi', caption: 'Xiaomi MiMo' },
  { kind: 'icon', icon: 'plug', caption: 'OpenAI-compatible' } // en español: «Compatible OpenAI» (ver CAPTIONS_ES)
]

// los colores de «Papel y luz» (styles.css)
const THEMES = {
  light: { ink: '#201e1a', caption: '#585550', accent: '#b4502f' },
  dark: { ink: '#f0eae3', caption: '#c2bdb7', accent: '#ea9a6c' }
} as const

/** Los pies que cambian en español. */
const CAPTIONS_ES: Record<string, string> = { 'OpenAI-compatible': 'Compatible OpenAI' }

const COLS = 8
const CELL_W = 116
const CELL_H = 92
const LOGO = 34

/** El color de marca, aclarado en oscuro como en la app (mezcla con blanco al 16 %). */
function brandColor(hex: string | null, theme: keyof typeof THEMES): string {
  if (!hex) return THEMES[theme].ink
  if (theme === 'light') return hex
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(c * 0.84 + 255 * 0.16)
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, '0')).join('')}`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

function strip(theme: keyof typeof THEMES, lang: 'en' | 'es'): string {
  const t = THEMES[theme]
  const rows = Math.ceil(ITEMS.length / COLS)
  const W = COLS * CELL_W
  const H = rows * CELL_H
  const items = ITEMS.map((i) => ({ ...i, caption: lang === 'es' ? (CAPTIONS_ES[i.caption] ?? i.caption) : i.caption }))
  const cells = items.map((item, i) => {
    const cx = (i % COLS) * CELL_W + CELL_W / 2
    const top = Math.floor(i / COLS) * CELL_H + 12
    const x = cx - LOGO / 2
    let glyph: string
    if (item.kind === 'brand') {
      const l = BRAND_LOGOS[item.id]
      glyph = `<svg x="${x}" y="${top}" width="${LOGO}" height="${LOGO}" viewBox="${l.viewBox}" fill="${brandColor(l.color, theme)}">${l.paths.map((d) => `<path d="${d}"/>`).join('')}</svg>`
    } else {
      const color = item.icon === 'aula' ? t.accent : t.ink
      glyph = `<svg x="${x}" y="${top}" width="${LOGO}" height="${LOGO}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" color="${color}">${ICON_PATHS[item.icon]}</svg>`
    }
    const caption = `<text x="${cx}" y="${top + LOGO + 24}" text-anchor="middle">${esc(item.caption)}</text>`
    return `<g><title>${esc(item.caption)}</title>${glyph}${caption}</g>`
  })
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(items.map((i) => i.caption).join(', '))}">`,
    `<g font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="13" fill="${t.caption}">`,
    ...cells,
    '</g>',
    '</svg>',
    ''
  ].join('\n')
}

for (const theme of ['light', 'dark'] as const)
  for (const lang of ['en', 'es'] as const) {
    const file = resolve(`docs/media/screenshots/providers-${theme}-${lang}.svg`)
    writeFileSync(file, strip(theme, lang))
    console.log('ok', file)
  }
