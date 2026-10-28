// Los mensajes de las plataformas salen en el idioma de la interfaz (se eligen al lanzarse, no al importar el módulo).
import { afterEach, describe, expect, it } from 'vitest'
import { setAILocale } from '@shared/ai/i18n'
import { platformInfo } from '@engine/platforms'
import { addAccount } from './accounts'
import { probePlatform } from './probe'
import { errorForStatus } from '../canvas/errors'
import { statusDetail } from './status'

afterEach(() => setAILocale('es'))

describe('idioma de los mensajes de las plataformas', () => {
  it('una dirección no válida, en inglés y en español', async () => {
    setAILocale('en')
    expect(() => addAccount({ url: 'hola' })).toThrow('That address isn’t valid. Type something like campus.youruniversity.edu')
    expect((await probePlatform('hola')).error).toBe('That address isn’t valid.')
    setAILocale('es')
    expect(() => addAccount({ url: 'hola' })).toThrow('La dirección no es válida. Escribe algo como campus.tuuniversidad.edu')
  })

  it('Canvas, el estado de la sesión y «Otra página» siguen el idioma', () => {
    setAILocale('en')
    expect(errorForStatus(404, '', false).message).toBe('Canvas can’t find that (it may be hidden or deleted).')
    expect(statusDetail('checking')).toBe('Checking your session…')
    expect(platformInfo('other').displayName).toBe('Other website')
    setAILocale('es')
    expect(platformInfo('other').displayName).toBe('Otra página')
    expect(errorForStatus(404, '', false).code).toBe('not_found')
  })
})
