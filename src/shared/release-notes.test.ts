import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { notesForLanguage, releaseNotesText } from './release-notes'

const both = `<!-- lang:en -->
# Aula 0.1.1

## What's new
- Faster.

## Install
| System | Download |
| --- | --- |

<!-- lang:es -->
# Aula 0.1.1

## Lo nuevo
- Más rápida.

## Instalar
| Sistema | Descarga |
`

describe('notas de la versión', () => {
  it('elige la lengua y quita el título y la tabla de instalación', () => {
    expect(notesForLanguage(both, 'es')).toBe('## Lo nuevo\n- Más rápida.')
    expect(notesForLanguage(both, 'en-US')).toBe("## What's new\n- Faster.")
    // otra lengua: la primera
    expect(notesForLanguage(both, 'fr')).toBe("## What's new\n- Faster.")
  })
  it('sin marcas, enteras', () => {
    expect(notesForLanguage('- Uno\n- Dos', 'es')).toBe('- Uno\n- Dos')
    expect(notesForLanguage(undefined, 'es')).toBeUndefined()
  })
  it('normaliza lo que da electron-updater (texto, lista, HTML del feed de GitHub)', () => {
    expect(releaseNotesText('  hola ')).toBe('hola')
    expect(releaseNotesText([{ version: '0.1.1', note: 'a' }, { version: '0.1.0', note: 'b' }])).toBe('a\n\nb')
    expect(releaseNotesText('<h2>Lo nuevo</h2><ul><li>Más rápida &amp; mejor</li></ul>')).toBe('Lo nuevo\n- Más rápida & mejor')
    expect(releaseNotesText(null)).toBeUndefined()
    expect(releaseNotesText('No content.'.replace('No content.', ''))).toBeUndefined()
  })
  it('las notas de la versión actual (package.json) traen las dos lenguas marcadas', () => {
    const { version } = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as { version: string }
    const md = readFileSync(join(__dirname, `../../docs/release-notes/${version}.md`), 'utf8')
    const es = notesForLanguage(md, 'es') ?? ''
    const en = notesForLanguage(md, 'en') ?? ''
    // cada lengua empieza con texto (sin el título, que la app quita)
    expect(es.trim().length).toBeGreaterThan(40)
    expect(en.trim().length).toBeGreaterThan(40)
    expect(md).not.toMatch(/Aula 2\b/)
    expect(es).toContain('## Lo nuevo')
    expect(es).not.toMatch(/## Instalar|What's new/)
    expect(en).toContain("## What's new")
    expect(en).not.toMatch(/## Install|Lo nuevo/)
  })
})
