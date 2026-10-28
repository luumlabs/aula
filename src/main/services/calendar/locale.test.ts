// Los mensajes del calendario salen en el idioma de la interfaz (funciones y getters: se eligen al usarlos).
import { afterEach, describe, expect, it } from 'vitest'
import { setAILocale } from '@shared/ai/i18n'
import { CalendarError, CalendarMessages } from '@engine/calendar'
import { ICSLimitErrors, untitledEvent } from '@engine/calendar/ics'
import { FeedErrors } from './feeds'

afterEach(() => setAILocale('es'))

describe('idioma de los mensajes del calendario', () => {
  it('FeedErrors y CalendarMessages en inglés, sin cambiar los códigos', () => {
    setAILocale('en')
    const e = FeedErrors.notFound()
    expect(e.code).toBe('calendar_not_found')
    expect(e.message).toBe('The calendar link no longer exists or has expired. Generate a new one and paste it again.')
    expect(FeedErrors.hostNotFound('x.edu').message).toContain('“x.edu”')
    expect(CalendarMessages.missingTitle).toBe('Give the event a name.')
    expect(CalendarError.readOnly('Parcial').message).toContain('“Parcial” comes from your study platform')
    expect(ICSLimitErrors.tooManyEvents(50_000).message).toBe('The calendar has too many events (more than 50,000).')
    expect(untitledEvent()).toBe('(Untitled)')
  })

  it('en español siguen como antes', () => {
    setAILocale('es')
    expect(FeedErrors.notFound().message).toBe('El enlace del calendario ya no existe o caducó. Genera uno nuevo y vuelve a pegarlo.')
    expect(CalendarMessages.missingTitle).toBe('Ponle un nombre al evento.')
    expect(untitledEvent()).toBe('(Sin título)')
  })
})
