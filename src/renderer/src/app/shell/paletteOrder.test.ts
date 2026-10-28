import { describe, expect, it } from 'vitest'
import { ASK_VALUE, filterCommands, focusSnippet, paletteValues, splitGroups, type Filterable } from './paletteOrder'

const COMMANDS: Filterable[] = [
  { id: 'new-course', group: 'actions', label: 'Nuevo curso con Aula' },
  { id: 'home', group: 'navigate', label: 'Hoy' },
  { id: 'calendar', group: 'navigate', label: 'Calendario' },
  { id: 'settings', group: 'navigate', label: 'Ajustes', keywords: ['preferencias'] },
  { id: 'course:trig', group: 'courses', label: 'Exam #2 · MATH 101', keywords: ['Trigonometría'] },
  { id: 'grapher', group: 'tools', label: 'Calculadora gráfica' }
]

function order(query: string, hitIDs: string[] = []): string[] {
  const { strong, weak } = splitGroups(filterCommands(COMMANDS, query), query)
  return paletteValues(strong, hitIDs, weak, query.trim().length > 2)
}

describe('orden de la paleta', () => {
  it('«calend» y «ajustes» eligen la pantalla, no «Pregúntale a Aula»', () => {
    expect(order('calend')[0]).toBe('cmd:calendar')
    expect(order('ajustes')[0]).toBe('cmd:settings')
    expect(order('calend').at(-1)).toBe(ASK_VALUE)
  })
  it('lo encontrado en los cursos va antes que una coincidencia suelta y antes de preguntar', () => {
    const v = order('trigonometría', ['trig/glossary/1', 'trig/lesson/a'])
    expect(v.indexOf('hit:trig/glossary/1')).toBeLessThan(v.indexOf(ASK_VALUE))
    expect(v[v.length - 1]).toBe(ASK_VALUE)
    const fuzzy = order('cal', ['c/lesson/x'])
    expect(fuzzy[0]).toBe('cmd:calendar')
  })
  it('sin nada que coincida, preguntar a Aula es lo único (y lo elegido)', () => {
    expect(order('zanahoria cuántica')).toEqual([ASK_VALUE])
  })
  it('sin consulta: todos los comandos en su orden y sin preguntar', () => {
    expect(order('')).toEqual(['cmd:new-course', 'cmd:home', 'cmd:calendar', 'cmd:settings', 'cmd:course:trig', 'cmd:grapher'])
  })
  it('el fragmento empieza cerca de la primera coincidencia', () => {
    const long = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut **derivada** de la función'
    const f = focusSnippet(long)
    expect(f.startsWith('…')).toBe(true)
    expect(f.indexOf('**')).toBeLessThan(45)
    expect(focusSnippet('La **derivada** mide')).toBe('La **derivada** mide')
  })
})
