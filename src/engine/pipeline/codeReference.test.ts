// La referencia del bloque `code` (block_reference("code")): el esquema, todos los lenguajes que resalta Aula con sus alias, la
// salida escondida en un enunciado y cuándo basta un ``` en un texto; sus ejemplos se leen como bloques válidos.
import { describe, expect, it } from 'vitest'
import { decodeBlock } from '@shared/schema/blocks'
import { CODE_LANGUAGES, codeLanguage } from '@engine/content/codeLanguages'
import { AUTHORING_GUIDE, BLOCK_REFERENCE, BLOCK_REFERENCE_TYPES, blockReferenceKey } from './guide'

describe('referencia del bloque code', () => {
  const ref = BLOCK_REFERENCE.code

  it('está en la herramienta y sus alias llevan a ella', () => {
    expect(BLOCK_REFERENCE_TYPES).toContain('code')
    for (const alias of ['snippet', 'listing', 'codeblock', 'program']) expect(blockReferenceKey(alias)).toBe('code')
  })

  it('cuenta el esquema, la salida en un enunciado, los lenguajes, los alias y las vallas', () => {
    expect(ref).toContain('{"type":"code","language":"python","code":"…","output":"…","caption":"md"}')
    expect(ref).toContain('hides it automatically when it matches the answer')
    expect(ref).toContain('except when the question asks to identify the language')
    for (const l of CODE_LANGUAGES.filter((x) => x !== 'plaintext')) expect(ref, l).toMatch(new RegExp(`Languages: [^\\n]*\\b${l.replace('-', '\\-')}\\b`))
    expect(ref).toContain('py → python')
    expect(ref).toContain('```python … ```')
    expect(ref).toContain('A cloze gap ([[1]]) cannot go inside code')
  })

  it('los alias que promete existen de verdad', () => {
    const hints = /Aliases: ([^\n]+)/.exec(ref)?.[1] ?? ''
    let checked = 0
    for (const [, from, to] of hints.matchAll(/([\w/+#.-]+) → (\w[\w-]*)/g)) {
      if (['plain', 'pseudocode', 'program'].includes(to)) continue
      for (const alias of from.split('/')) {
        expect(codeLanguage(alias), `${alias} → ${to}`).toBe(to)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(30)
  })

  it('sus ejemplos son bloques válidos', () => {
    const examples = ref.split('\n').filter((l) => l.startsWith('{"type":'))
    expect(examples.length).toBeGreaterThanOrEqual(5)
    for (const e of examples) {
      expect(['code', 'text'], e).toContain(decodeBlock(JSON.parse(e))?.type)
    }
  })

  it('la guía de autoría manda a ella y cuenta que las vallas también se colorean', () => {
    expect(AUTHORING_GUIDE).toContain('block_reference("code")')
    expect(AUTHORING_GUIDE).toContain('fenced code blocks with their language')
  })
})
