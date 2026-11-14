// Mapas con países, encuadres con nombre, coropletas y rutas con sentido; gráficos con barras horizontales y destacados.
import { describe, expect, it } from 'vitest'
import { decodeBlock, encodeBlock, type Block } from '@shared/schema'
import { ContentValidator } from './validator'
import { ContentNormalizer } from './normalizer'

const v = ContentValidator.withMath()
const block = (raw: unknown): Block => decodeBlock(ContentNormalizer.block(raw as never))!
const issues = (b: Block, severity: 'error' | 'warning'): string[] => v.checkBlock(b, 'b').filter((i) => i.severity === severity).map((i) => i.message)

describe('mapa: países por su nombre', () => {
  it('un mapa solo con países no está vacío', () => {
    const b = block({ type: 'map', countries: ['Francia', 'Alemania', { name: 'IT', color: 'teal', label: 'Fundadores' }] })
    expect(issues(b, 'error')).toEqual([])
  })
  it('un país desconocido es un error con sugerencias', () => {
    const e = issues(block({ type: 'map', countries: ['Portgal', 'Prusia'] }), 'error')
    expect(e.some((m) => m.includes('«Portgal»') && m.includes('Portugal'))).toBe(true)
    expect(e.some((m) => m.includes('«Prusia»') && m.includes('regions'))).toBe(true)
  })
  it('un encuadre desconocido avisa con los que hay', () => {
    const w = issues(block({ type: 'map', region: 'Atlántida', countries: ['Francia'] }), 'warning')
    expect(w.some((m) => m.includes('Atlántida') && m.includes('europe'))).toBe(true)
    expect(issues(block({ type: 'map', region: 'europa', countries: ['Francia'] }), 'warning').some((m) => m.includes('region'))).toBe(false)
  })
  it('region «constructor» o «__proto__» avisa sin romper la validación', () => {
    for (const region of ['constructor', '__proto__', 'Constructor']) {
      const b = block({ type: 'map', region, countries: ['Francia'] })
      expect(() => v.checkBlock(b, 'b'), region).not.toThrow()
      expect(issues(b, 'warning').some((m) => m.includes('No entiendo region')), region).toBe(true)
    }
  })
  it('coropletas: valor y color a la vez, valores a medias y sin unidad avisan', () => {
    const w = issues(block({ type: 'map', countries: [{ name: 'España', value: 47.4, color: 'blue' }, { name: 'Francia', value: 68 }, { name: 'Italia' }] }), 'warning')
    expect(w.some((m) => m.includes('`color` se ignora'))).toBe(true)
    expect(w.some((m) => m.includes('Unos países traen `value`'))).toBe(true)
    expect(w.some((m) => m.includes('unidad'))).toBe(true)
  })
  it('la práctica vale con 3 países (y avisa con menos)', () => {
    expect(issues(block({ type: 'map', practice: true, countries: ['Francia', 'Alemania', 'Italia'] }), 'warning').some((m) => m.includes('práctica'))).toBe(false)
    expect(issues(block({ type: 'map', practice: true, countries: ['Francia', 'Alemania'] }), 'warning').some((m) => m.includes('al menos 3'))).toBe(true)
    expect(issues(block({ type: 'map', practice: true, countries: ['Francia', 'France', 'Italia'] }), 'error').some((m) => m.includes('mismo título'))).toBe(true)
  })
})

describe('mapa: el normalizador', () => {
  it('una región que nombra un país de hoy sin contorno pasa a ser ese país', () => {
    const b = block({ type: 'map', regions: [{ name: 'Francia', color: 'blue', md: 'Aliado' }, { name: 'Imperio carolingio', points: [[48, 2], [50, 10], [44, 12]] }] })
    expect(b.type === 'map' && b.countries).toEqual([{ name: 'Francia', color: 'blue', md: 'Aliado' }])
    expect(b.type === 'map' && b.regions.map((r) => r.name)).toEqual(['Imperio carolingio'])
  })
  it('países con otros nombres de campo, en una cadena o como objeto {país: valor}', () => {
    const a = block({ type: 'map', states: 'España, Portugal' })
    expect(a.type === 'map' && a.countries.map((c) => c.name)).toEqual(['España', 'Portugal'])
    const c = block({ type: 'map', countries: { España: 47.4, Francia: '68,2', Italia: 'teal' }, units: 'M hab.' })
    expect(c.type === 'map' && c.countries).toEqual([{ name: 'España', value: 47.4 }, { name: 'Francia', value: 68.2 }, { name: 'Italia', color: 'teal' }])
    expect(c.type === 'map' && c.unit).toBe('M hab.')
  })
  it('extremos de ruta por el título de un marcador', () => {
    const b = block({
      type: 'map',
      markers: [{ title: 'Roma', lat: 41.9, lon: 12.5 }, { title: 'Atenas', lat: 37.98, lon: 23.73 }],
      routes: [{ from: 'roma', to: 'Atenas', arrow: true, label: 'Viaje' }, { points: ['Roma', [40, 18], 'Atenas'] }, { from: 'Esparta', to: 'Atenas' }]
    })
    if (b.type !== 'map') throw new Error('no es un mapa')
    expect(b.routes[0].points).toEqual([[41.9, 12.5], [37.98, 23.73]])
    expect(b.routes[0].arrow).toBe(true)
    expect(b.routes[1].points).toEqual([[41.9, 12.5], [40, 18], [37.98, 23.73]])
    // un título que no existe se queda como está y el validador lo dice
    expect(b.routes[2].points).toEqual([])
    expect(issues(b, 'error').some((m) => m.includes('from') && m.includes('marcador'))).toBe(true)
  })
})

describe('mapa: leer y escribir', () => {
  it('países (cadena u objeto), region, unit y flechas; un mapa viejo no cambia', () => {
    const b = decodeBlock({ type: 'map', region: 'europe', unit: '%', countries: ['Francia', { country: 'DE', value: '12,5', label: 'Alemania', md: '…' }, { name: '' }], routes: [{ points: [[1, 2], [3, 4]], arrow: true }, { points: [[1, 2], [3, 4]] }] })!
    if (b.type !== 'map') throw new Error('no es un mapa')
    expect(b.countries).toEqual([{ name: 'Francia' }, { name: 'DE', value: 12.5, label: 'Alemania', md: '…' }])
    expect(b.routes.map((r) => r.arrow)).toEqual([true, false])
    const out = encodeBlock(b) as Record<string, unknown>
    expect(out.countries).toEqual([{ name: 'Francia' }, { name: 'DE', label: 'Alemania', md: '…', value: 12.5 }])
    expect(out.region).toBe('europe')
    expect(out.unit).toBe('%')
    expect((out.routes as Array<Record<string, unknown>>).map((r) => r.arrow)).toEqual([true, undefined])
    expect(decodeBlock(out)).toEqual(b)
    const old = decodeBlock({ type: 'map', id: 'm1', markers: [{ lat: 1, lon: 2, title: 'A' }] })!
    const enc = encodeBlock(old) as Record<string, unknown>
    expect(enc.countries).toBeUndefined()
    expect(enc.region).toBeUndefined()
    expect(enc.unit).toBeUndefined()
  })
})

describe('gráficos: barras horizontales y destacados', () => {
  it('kind «hbar» es barras horizontales; horizontal se escribe solo si está', () => {
    const h = decodeBlock({ type: 'chart', kind: 'hbar', series: [{ name: 'S', points: [{ label: 'A', y: 1 }] }] })!
    expect(h.type === 'chart' && [h.kind, h.horizontal]).toEqual(['bar', true])
    expect((encodeBlock(h) as Record<string, unknown>).horizontal).toBe(true)
    const off = decodeBlock({ type: 'chart', kind: 'bar', horizontal: false, series: [] })!
    expect(off.type === 'chart' && off.horizontal).toBe(false)
    const plain = decodeBlock({ type: 'chart', kind: 'bar', series: [{ name: 'S', points: [{ label: 'A', y: 1 }] }] })!
    expect(plain.type === 'chart' && plain.horizontal).toBeUndefined()
    expect('horizontal' in (encodeBlock(plain) as Record<string, unknown>)).toBe(false)
  })
  it('highlight (y su alias tone: "accent") va y vuelve', () => {
    const b = decodeBlock({ type: 'chart', kind: 'bar', series: [{ name: 'S', points: [{ label: 'A', y: 1, highlight: true }, { label: 'B', y: 2, tone: 'accent' }, { label: 'C', y: 3, highlight: false }] }] })!
    if (b.type !== 'chart') throw new Error('no es un gráfico')
    expect(b.series[0].points.map((p) => p.highlight)).toEqual([true, true, undefined])
    const out = encodeBlock(b) as { series: Array<{ points: Array<Record<string, unknown>> }> }
    expect(out.series[0].points.map((p) => p.highlight)).toEqual([true, true, undefined])
    expect(decodeBlock(out)).toEqual(b)
  })
  it('más de 3 destacados avisa', () => {
    const pts = (n: number) => Array.from({ length: 6 }, (_, i) => ({ label: `P${i}`, y: i, highlight: i < n }))
    expect(issues(block({ type: 'chart', kind: 'bar', series: [{ name: 'S', points: pts(4) }] }), 'warning').some((m) => m.includes('highlight'))).toBe(true)
    expect(issues(block({ type: 'chart', kind: 'bar', series: [{ name: 'S', points: pts(2) }] }), 'warning').some((m) => m.includes('highlight'))).toBe(false)
  })
})
