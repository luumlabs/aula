import { describe, expect, it } from 'vitest'
import { decodeBlock, type MapBlock } from '@shared/schema'
import { COUNTRIES } from '@engine/geo/countries'
import { mapCountriesText } from './mapText'

const map = (raw: Record<string, unknown>): MapBlock => {
  const b = decodeBlock({ type: 'map', ...raw })
  if (b?.type !== 'map') throw new Error('no es un mapa')
  return b
}

describe('los países de un mapa en un documento', () => {
  it('nombre en la lengua del documento y su grupo, valor o explicación', () => {
    const m = map({ unit: 'M hab.', countries: [{ name: 'DE', label: 'Aliados' }, { name: 'España', value: 47.4 }, 'Prusia'] })
    expect(mapCountriesText(m, 'es')).toBe('\n\n- Alemania: Aliados\n- España: 47.4 M hab.\n- Prusia')
    expect(mapCountriesText(m, 'en')).toContain('- Germany: Aliados')
  })
  it('un mapa del mundo con 100 países los lista todos; si hubiera más de 120, dice cuántos faltan', () => {
    const names = COUNTRIES.filter((c) => c.a2 && !c.small).slice(0, 100).map((c) => c.ne)
    expect(names).toHaveLength(100)
    const world = map({ unit: '%', countries: names.map((name, i) => ({ name, value: i })) })
    expect(world.countries).toHaveLength(100)
    const lines = mapCountriesText(world, 'es').trim().split('\n')
    expect(lines).toHaveLength(100)
    expect(lines[99]).toMatch(/: 99 %$/)
    const more: MapBlock = { ...world, countries: Array.from({ length: 130 }, (_, i) => ({ name: names[i % 100], value: i })) }
    const out = mapCountriesText(more, 'es').trim().split('\n')
    expect(out).toHaveLength(121)
    expect(out[120]).toBe('- … (+10)')
  })
  it('sin países, nada', () => {
    expect(mapCountriesText(map({ markers: [{ lat: 1, lon: 2, title: 'A' }] }), 'es')).toBe('')
  })
})
