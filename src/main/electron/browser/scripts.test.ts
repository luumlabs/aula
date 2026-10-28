// Los guiones del mundo aislado son texto: aquí se comprueba que compilan (un error de sintaxis solo saldría en la app).
import { describe, expect, it } from 'vitest'
import {
  domClickScript, hasTextScript, locateRefScript, pageStateScript, signInStateScript, readabilityParseScript, readabilityScript, rememberMeScript, scrollScript,
  snapshotScript, successBannerScript
} from './scripts'

const compiles = (code: string): void => {
  // eslint-disable-next-line no-new-func
  expect(() => new Function(`return ${code}`)).not.toThrow()
}

describe('guiones de página', () => {
  it('todos compilan, también con textos con comillas y saltos de línea', () => {
    compiles(pageStateScript())
    compiles(signInStateScript({ signedIn: ['a[href*="logout" i]', '#x'], signedOut: ['body.notloggedin'] }))
    compiles(snapshotScript({ start: 5, budget: 1000, maxElements: 10, full: true }))
    compiles(locateRefScript('e12', { label: 'Tema "1"\n', href: 'https://x/a?b=1', submits: false, formAction: '' }))
    compiles(locateRefScript('e1', null))
    compiles(domClickScript('e3'))
    compiles(scrollScript({ direction: 'down', amount: 0.5 }))
    compiles(hasTextScript("l'examen </script>"))
    compiles(rememberMeScript())
    compiles(successBannerScript('Sesión iniciada'))
    compiles(readabilityParseScript())
  })

  it('Readability está disponible para leer artículos', () => {
    const src = readabilityScript()
    expect(src).toBeTruthy()
    // eslint-disable-next-line no-new-func
    expect(() => new Function(src!)).not.toThrow()
  })

  it('el texto de los campos de formulario nunca entra en la lectura', () => {
    expect(snapshotScript({ start: 1 })).toContain('INPUT:1,TEXTAREA:1,SELECT:1')
  })
})
