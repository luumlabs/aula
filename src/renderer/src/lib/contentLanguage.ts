// El idioma del contenido del curso que se estudia (`pack.language`). Lo da la pantalla de estudio y lo declara el texto del
// curso (RichText), no la columna entera: los botones, avisos y etiquetas de la interfaz siguen en el idioma de la interfaz
// (lo lee el lector de pantalla) y, de derecha a izquierda, solo se da la vuelta la prosa, no los ejercicios ni las figuras.
import { createContext, useContext } from 'react'
import { CourseLanguages } from '@engine/base/language'

/** Un código de idioma con forma BCP-47 («es», «pt-BR», «zh-Hans»…): lo demás no se pone en `lang`. */
const BCP47 = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/

/** De derecha a izquierda, las fórmulas y el código siguen de izquierda a derecha. KaTeX es un `span` en línea: con solo
 *  `direction` no abre un contexto propio y sus trozos (bloques en línea) se ordenarían al revés; por eso, aislado. */
export const RTL_CONTENT_CLASS = '[&_:is(.katex,pre)]:[direction:ltr] [&_.katex]:[unicode-bidi:isolate]'

export interface ContentLang {
  lang?: string
  dir?: 'rtl'
  /** Las reglas de derecha a izquierda (fórmulas y código aislados). */
  className?: string
}

/** `lang` y `dir` del texto del curso para su idioma («ar» → rtl). Sin idioma (o con uno raro), nada. */
export function contentLang(code: string | null | undefined): ContentLang {
  const c = code?.trim().replace(/_/g, '-') ?? ''
  if (!BCP47.test(c)) return {}
  return CourseLanguages.find(c)?.isRTL ? { lang: c, dir: 'rtl', className: RTL_CONTENT_CLASS } : { lang: c }
}

/** El idioma del curso que se estudia: lo da la pantalla de estudio (fuera de ella, ninguno). */
export const StudyLanguage = createContext<string | undefined>(undefined)

/** `lang`, `dir` y clases para el texto del curso a la vista. */
export function useContentLang(): ContentLang {
  return contentLang(useContext(StudyLanguage))
}
