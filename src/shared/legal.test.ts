// Direcciones públicas de Aula: el código de cada versión, la política de privacidad y el soporte (con su mitad en español).
import { describe, expect, it } from 'vitest'
import { AULA_REPO_URL, isLegalDoc, publicDocURL, sourceCodeURL } from './legal'

describe('direcciones públicas', () => {
  it('la política de privacidad y el soporte, en inglés sin ancla', () => {
    expect(publicDocURL('privacy', 'en')).toBe('https://github.com/luumlabs/aula/blob/main/docs/PRIVACY.md')
    expect(publicDocURL('support', 'en')).toBe('https://github.com/luumlabs/aula/blob/main/docs/SUPPORT.md')
    expect(publicDocURL('privacy', 'EN-us')).toBe('https://github.com/luumlabs/aula/blob/main/docs/PRIVACY.md')
  })

  it('en español, la mitad en español (#español)', () => {
    expect(publicDocURL('privacy', 'es')).toBe('https://github.com/luumlabs/aula/blob/main/docs/PRIVACY.md#espa%C3%B1ol')
    expect(publicDocURL('support', 'es-ES')).toMatch(/\/docs\/SUPPORT\.md#espa%C3%B1ol$/)
  })

  it('el código de una versión publicada es su etiqueta; si no, el repositorio', () => {
    expect(sourceCodeURL('0.2.7')).toBe(`${AULA_REPO_URL}/tree/v0.2.7`)
    expect(sourceCodeURL('1.0.0-beta.2')).toBe(`${AULA_REPO_URL}/tree/v1.0.0-beta.2`)
    expect(sourceCodeURL('')).toBe(AULA_REPO_URL)
    expect(sourceCodeURL('dev')).toBe(AULA_REPO_URL)
  })

  it('solo los dos documentos legales', () => {
    expect(isLegalDoc('aula')).toBe(true)
    expect(isLegalDoc('third-party')).toBe(true)
    expect(isLegalDoc('../etc/passwd')).toBe(false)
    expect(isLegalDoc(3)).toBe(false)
  })
})
