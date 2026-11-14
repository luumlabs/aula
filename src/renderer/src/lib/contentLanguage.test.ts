import { describe, expect, it } from 'vitest'
import { contentLang, RTL_CONTENT_CLASS } from './contentLanguage'

describe('idioma del texto del curso', () => {
  it('declara el idioma del curso y, en árabe, de derecha a izquierda', () => {
    expect(contentLang('es')).toEqual({ lang: 'es' })
    expect(contentLang('pt-BR')).toEqual({ lang: 'pt-BR' })
    expect(contentLang('zh_Hans')).toEqual({ lang: 'zh-Hans' })
    expect(contentLang('ar')).toEqual({ lang: 'ar', dir: 'rtl', className: RTL_CONTENT_CLASS })
    expect(contentLang('ar-EG')).toEqual({ lang: 'ar-EG', dir: 'rtl', className: RTL_CONTENT_CLASS })
  })
  it('sin idioma o con algo que no es un código, nada', () => {
    for (const c of [undefined, null, '', '  ', 'español', 'es es', '"><x', 'e']) expect(contentLang(c), String(c)).toEqual({})
  })
  it('de derecha a izquierda, KaTeX es un aislado de izquierda a derecha (con solo direction sus trozos se dan la vuelta)', () => {
    expect(RTL_CONTENT_CLASS).toContain('[&_.katex]:[unicode-bidi:isolate]')
    expect(RTL_CONTENT_CLASS).toContain('[&_:is(.katex,pre)]:[direction:ltr]')
  })
})
