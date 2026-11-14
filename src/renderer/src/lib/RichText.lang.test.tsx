import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RichText } from './RichText'
import { RTL_CONTENT_CLASS, StudyLanguage } from './contentLanguage'

const inLanguage = (lang: string | undefined, node: ReactNode): string => renderToStaticMarkup(<StudyLanguage.Provider value={lang}>{node}</StudyLanguage.Provider>)

/** La etiqueta de apertura del envoltorio de RichText (con `&` sin escapar, como en las clases). */
const opening = (html: string): string => (/^<span[^>]*>/.exec(html)?.[0] ?? '').replaceAll('&amp;', '&')

describe('RichText en el idioma del curso', () => {
  it('el texto del curso declara su idioma (no la columna, que también lleva la interfaz)', () => {
    const html = inLanguage('ja', <RichText text="**光合成**" />)
    expect(opening(html)).toContain('lang="ja"')
    expect(opening(html)).not.toContain('dir=')
  })
  it('fuera de la pantalla de estudio (chat, lector…), sin idioma propio', () => {
    expect(opening(renderToStaticMarkup(<RichText text="hola" />))).not.toContain('lang=')
  })
  it('un aviso de Aula (`ui`) se queda en el idioma de la interfaz', () => {
    expect(opening(inLanguage('ja', <RichText text="Escribe tu respuesta primero." ui />))).not.toContain('lang=')
  })
  it('de derecha a izquierda: el texto en su sentido y las fórmulas aisladas de izquierda a derecha', () => {
    for (const inline of [false, true]) {
      const html = inLanguage('ar', <RichText text="المعادلة $x^2+1=0$" inline={inline} />)
      const tag = opening(html)
      expect(tag).toContain('lang="ar"')
      expect(tag).toContain('dir="rtl"')
      for (const c of RTL_CONTENT_CLASS.split(' ')) expect(tag).toContain(c)
      expect(html).toContain('class="katex"')
    }
  })
})
