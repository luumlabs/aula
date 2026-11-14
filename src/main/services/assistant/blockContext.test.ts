// «Marcar y preguntar al tutor»: el tutor sabe en qué figura de la lección está el estudiante.
import { describe, expect, it } from 'vitest'
import { contextIsEmpty, newMessage } from './models'
import { makePack } from '@shared/schema'
import { systemPrompt, turnPrompt, type AssistantAppInfo } from './prompts'

const info: AssistantAppInfo = { platforms: [], computerUseEnabled: false, platformDatesConnected: false, dailyMinutes: 30, courseLanguage: 'es', provider: 'fake', webSearch: false }

describe('el bloque que mira el estudiante', () => {
  it('un contexto con solo el bloque no está vacío', () => {
    expect(contextIsEmpty({ courseID: 'c', blockID: 'fig-1' })).toBe(false)
    expect(contextIsEmpty({ courseID: 'c' })).toBe(true)
  })

  it('el turno dice qué figura es (para leerla con get_lesson)', () => {
    const message = newMessage('user', 'He marcado en la figura «El corazón»: «Aorta».', { context: { courseID: 'c', skillID: 's', blockID: 'fig-1', screen: 'lesson' } })
    const s = turnPrompt({ message, history: [], info, courses: [], runs: [], mentions: '', attachments: '', earlierFiles: '' })
    expect(s).toContain('## Where the student is right now')
    expect(s).toContain('figure block `fig-1`')
    expect(s).toContain('get_lesson')
    expect(s).toContain('`block_id`')
  })

  it('una figura del enunciado de un ejercicio: el ejercicio (get_exercise), no la lección, y que está sin resolver', () => {
    const context = { courseID: 'c', skillID: 's', blockID: 'fig-q', exerciseID: 'ex-7', screen: 'practice', lastResult: 'not solved yet' }
    const message = newMessage('user', 'He marcado en el diagrama «Cuadrantes»: «Ángulo».', { context })
    const s = turnPrompt({ message, history: [], info, courses: [], runs: [], mentions: '', attachments: '', earlierFiles: '' })
    expect(s).toContain('figure block `fig-q` in the statement of that exercise')
    expect(s).toContain('Exercise id: `ex-7`')
    expect(s).toContain('- Result: not solved yet')
    expect(s).not.toContain('of that lesson')
  })

  it('el tutor sigue dando pistas antes que la respuesta si la figura marcada es de un ejercicio sin resolver', () => {
    const s = systemPrompt({ appLanguage: 'es', course: makePack({ id: 'c', title: 'Trigonometría' }) })
    expect(s).toMatch(/what they marked on a figure[^\n]*statement of an exercise they haven't solved yet[^\n]*hint-first/)
  })
})
