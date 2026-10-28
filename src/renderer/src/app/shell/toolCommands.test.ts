import { describe, expect, it } from 'vitest'
import tools from '@renderer/i18n/locales/en/tools.json'
import { filterCommands } from './paletteOrder'
import { toolCommandSpecs } from './toolCommands'

const en = tools as unknown as Record<string, { name: string; desc: string }>

describe('⌘K encuentra las herramientas (J2-6)', () => {
  const specs = toolCommandSpecs((id) => en[id].name, (id) => en[id].desc)
  const first = (q: string) => filterCommands(specs, q).flatMap((g) => g.items)[0]?.toolId

  it('hay una entrada por herramienta, con su nombre', () => {
    expect(specs.length).toBeGreaterThanOrEqual(12)
    expect(specs.every((s) => s.label && s.group === 'tools')).toBe(true)
  })

  it.each([
    ['calculator', 'calculator'],
    ['grapher', 'grapher'],
    ['periodic table', 'periodic'],
    ['pomodoro', 'timer'],
    ['units', 'units'],
    ['tabla periódica', 'periodic'],
    ['molecules', 'molecules']
  ])('«%s» → %s', (q, id) => {
    expect(first(q)).toBe(id)
  })
})
