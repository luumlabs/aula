import { describe, expect, it } from 'vitest'
import { safeHref } from './RichText'

describe('enlaces del texto con Markdown', () => {
  it('deja pasar la web, el correo y las citas de página del lector', () => {
    expect(safeHref(' https://example.com/a ')).toBe('https://example.com/a')
    expect(safeHref('mailto:x@example.com')).toBe('mailto:x@example.com')
    expect(safeHref('#aula-page-12')).toBe('#aula-page-12')
  })
  it('y nada más: rutas, file:, javascript: u otras anclas se quedan en texto', () => {
    for (const u of ['/etc/passwd', 'file:///tmp/x', 'javascript:alert(1)', '//evil.example', '#aula-page-', '#aula-page-1x', '#other', 'aula-page-3']) expect(safeHref(u), u).toBe('')
  })
})
