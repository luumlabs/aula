// Comprueba que los textos de la ficha del App Store (docs/app-store/listing.md) caben en los límites de Apple.
//   node scripts/dev/app-store-check.mjs
import { readFileSync } from 'node:fs'

const LIMITS = { name: 30, 'name-alt': 30, subtitle: 30, promo: 170, keywords: 100, description: 4000, whatsnew: 4000 }
const md = readFileSync('docs/app-store/listing.md', 'utf8')
let bad = 0
for (const [, field, lang, body] of md.matchAll(/<!-- ([a-z-]+):([a-z]+) -->\n([\s\S]*?)\n<!-- \/\1 -->/g)) {
  const text = body.trim()
  const max = LIMITS[field]
  if (!max) continue
  const ok = text.length <= max && text.length > 0
  if (!ok) bad++
  console.log(`${ok ? '✓' : '✗'} ${field} (${lang}): ${text.length} / ${max}`)
}
if (bad) { console.error(`\n${bad} texto(s) fuera de límite`); process.exit(1) }
