// Cuándo se enseña «Apoya a Aula»: siempre sin app nativa; dentro de una, solo si ella dice que sí (supportLink()).
import { describe, expect, it } from 'vitest'
import { SPONSORS_URL, showsSupportLink } from './supportLink'

describe('showsSupportLink', () => {
  it('sin app nativa (la ventana del ordenador o un navegador): sí', () => {
    expect(showsSupportLink(undefined)).toBe(true)
    expect(showsSupportLink(null)).toBe(true)
  })

  it('una app que no lo dice (una versión anterior): no', () => {
    expect(showsSupportLink({})).toBe(false)
    expect(showsSupportLink({ switchAula() {} })).toBe(false)
  })

  it('la app dice que sí (iPhone con la tienda de EE. UU., o Android): sí; que no: no', () => {
    expect(showsSupportLink({ supportLink: () => true })).toBe(true)
    expect(showsSupportLink({ supportLink: () => false })).toBe(false)
  })

  it('solo un método que devuelve true de verdad (Android no puede poner campos)', () => {
    expect(showsSupportLink({ supportLink: true })).toBe(false)
    expect(showsSupportLink({ supportLink: () => 'true' })).toBe(false)
    expect(showsSupportLink({ supportLink: () => 1 })).toBe(false)
    expect(showsSupportLink('x')).toBe(false)
    expect(showsSupportLink(true)).toBe(false)
  })

  it('si la app falla al contestar: no', () => {
    expect(showsSupportLink({ supportLink: () => { throw new Error('puente roto') } })).toBe(false)
  })

  it('se llama como método, con su objeto (como exige addJavascriptInterface)', () => {
    expect(showsSupportLink({ v: true, supportLink(this: { v: boolean }) { return this.v } })).toBe(true)
  })

  it('el enlace es la página de GitHub Sponsors de Luum Labs', () => {
    expect(SPONSORS_URL).toBe('https://github.com/sponsors/luumlabs')
  })
})
