// La mitad inglesa de tr(es, en) / L(lang, es, en) no lleva comillas españolas «» (J5-2): en inglés van “…”.
// Y la regla de las claves ocultas del chat reconoce los marcadores de los dos idiomas (J5-6).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..', '..')

function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) { if (f !== 'renderer') files(p, out) }
    else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f)) out.push(p)
  }
  return out
}

/** Índice final (exclusivo) de la cadena que empieza en s[i] (', " o `), con ${…} anidados. */
function stringEnd(s: string, i: number): number {
  const q = s[i]
  let j = i + 1
  let depth = 0
  while (j < s.length) {
    const c = s[j]
    if (c === '\\') { j += 2; continue }
    if (q === '`' && depth === 0 && s.startsWith('${', j)) { depth = 1; j += 2; continue }
    if (depth) {
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === "'" || c === '"' || c === '`') { j = stringEnd(s, j); continue }
      j++
      continue
    }
    if (c === q) return j + 1
    j++
  }
  return j
}

const ws = (s: string, i: number) => { while (i < s.length && /\s/.test(s[i])) i++; return i }

/** Las mitades inglesas de las llamadas tr('…', '…') y L(x, '…', '…') de un archivo. */
function englishHalves(s: string): string[] {
  const out: string[] = []
  for (const m of s.matchAll(/\b(tr|L)\(/g)) {
    let k = ws(s, m.index! + m[0].length)
    if (m[1] === 'L') {
      const comma = s.indexOf(',', k)
      if (comma < 0 || /[()\n]/.test(s.slice(k, comma))) continue
      k = ws(s, comma + 1)
    }
    if (!`'"\``.includes(s[k] ?? '#')) continue
    const e1 = stringEnd(s, k)
    const k2 = ws(s, e1)
    if (s[k2] !== ',') continue
    const k3 = ws(s, k2 + 1)
    if (!`'"\``.includes(s[k3] ?? '#')) continue
    out.push(s.slice(k3, stringEnd(s, k3)))
  }
  return out
}

describe('textos del proceso principal', () => {
  it('la mitad inglesa de tr() no lleva «»', () => {
    const problems: string[] = []
    for (const f of files(SRC)) {
      for (const en of englishHalves(readFileSync(f, 'utf8'))) if (/[«»]/.test(en)) problems.push(`${f.slice(SRC.length + 1)}: ${en.slice(0, 90)}`)
    }
    expect(problems).toEqual([])
  })

  it('la regla 11 del chat nombra los marcadores de clave y enlace ocultos en español y en inglés', () => {
    const prompt = readFileSync(join(SRC, 'main', 'services', 'assistant', 'prompts.ts'), 'utf8')
    const text = readFileSync(join(SRC, 'engine', 'assistant', 'text.ts'), 'utf8')
    for (const marker of ['[clave oculta]', '[key hidden]', '[enlace privado oculto]', '[private link hidden]']) {
      expect(text, marker).toContain(marker)
      expect(prompt, marker).toContain(`"${marker}"`)
    }
  })
})
