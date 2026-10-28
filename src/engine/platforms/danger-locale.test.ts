// El aviso de permiso del navegador explica el riesgo en el idioma de la interfaz (J5-1).
import { afterEach, describe, expect, it } from 'vitest'
import { setAILocale } from '@shared/ai/i18n'
import { classifyAction, classifyURL, dangerReason } from './danger'
import { clickPolicy, navigationPolicy } from './page'

const ES = /[áéíóúñ¿]|Podría|Parece|Abriría|Cerraría/

describe('motivos del permiso del navegador', () => {
  afterEach(() => setAILocale('es'))

  it('en inglés, cada categoría tiene su motivo en inglés', () => {
    setAILocale('en')
    for (const c of ['submit', 'assessment', 'delete', 'message', 'payment', 'logout', 'unenroll', 'permission', 'consent',
      'credentials', 'modify', 'upload', 'closeWindow', 'externalApp', 'system'] as const) {
      expect(dangerReason(c), c).not.toMatch(ES)
    }
    expect(dangerReason('assessment')).toBe('It could start, resume or retake an exam or quiz (timed or with limited attempts).')
  })

  it('un enlace de examen, una contraseña o un sitio externo explican el riesgo en inglés', () => {
    setAILocale('en')
    const exam = classifyURL('https://canvas.example.edu/courses/1/quizzes/2/take')
    expect(exam?.reason).toMatch(/exam|quiz/i)
    expect(exam?.reason).not.toMatch(ES)
    const pwd = classifyAction({ action: 'typeText', role: 'AXPasswordField', label: 'Password', text: 'x' })
    expect(pwd?.reason).toBe('Aula never reads or types passwords.')
    const nav = navigationPolicy('https://other.example.com/page', { kind: 'canvas', baseURL: 'https://canvas.example.edu' })
    expect(nav.decision).toBe('ask')
    expect(nav.decision !== 'allow' && nav.reason).toBe('It would open another site outside your platform.')
    const click = clickPolicy({ ref: 'e1', role: 'button', label: 'Save', disabled: true } as Parameters<typeof clickPolicy>[0], { pageURL: 'https://canvas.example.edu', account: null })
    expect(click.decision !== 'allow' && click.reason).toBe('The button is disabled.')
  })

  it('en español siguen en español', () => {
    setAILocale('es')
    expect(dangerReason('logout')).toBe('Cerraría tu sesión.')
  })
})
