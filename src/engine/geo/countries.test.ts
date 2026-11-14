import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { companionParent, COUNTRIES, countryCompanions, countryKey, countryLabel, findCountry, MAP_REGIONS, regionBox, regionPreset, suggestCountries } from './countries'

const atlas = (f: string): string[] => {
  const topo = JSON.parse(readFileSync(join(__dirname, '../../../node_modules/world-atlas', f), 'utf8')) as { objects: { countries: { geometries: Array<{ properties: { name: string } }> } } }
  return topo.objects.countries.geometries.map((g) => g.properties.name)
}

describe('countryKey', () => {
  it('iguala abreviaturas, acentos y el orden de las palabras', () => {
    expect(countryKey('Dem. Rep. Congo')).toBe(countryKey('Democratic Republic of the Congo'))
    expect(countryKey('República Democrática del Congo')).toBe(countryKey('Rep. Dem. del Congo'))
    expect(countryKey('Côte d’Ivoire')).toBe(countryKey("Cote d'Ivoire"))
    expect(countryKey('EE. UU.')).toBe('eeuu')
    expect(countryKey('U.S.A.')).toBe('usa')
    expect(countryKey('S. Sudan')).toBe(countryKey('South Sudan'))
  })
})

describe('findCountry', () => {
  const ne = (s: string): string | undefined => findCountry(s)?.ne
  it('entiende nombres en español e inglés, alias y códigos ISO', () => {
    expect(ne('Germany')).toBe('Germany')
    expect(ne('Alemania')).toBe('Germany')
    expect(ne('DE')).toBe('Germany')
    expect(ne('Dem. Rep. Congo')).toBe('Dem. Rep. Congo')
    expect(ne('República Democrática del Congo')).toBe('Dem. Rep. Congo')
    expect(ne('drc')).toBe('Dem. Rep. Congo')
    expect(ne('Congo')).toBe('Congo')
    expect(ne('Costa de Marfil')).toBe("Côte d'Ivoire")
    expect(ne("Côte d'Ivoire")).toBe("Côte d'Ivoire")
    expect(ne('EE. UU.')).toBe('United States of America')
    expect(ne('Estados Unidos')).toBe('United States of America')
    expect(ne('us')).toBe('United States of America')
    expect(ne('Reino Unido')).toBe('United Kingdom')
    expect(ne('UK')).toBe('United Kingdom')
    expect(ne('Bosnia')).toBe('Bosnia and Herz.')
    expect(ne('Bosnia y Herzegovina')).toBe('Bosnia and Herz.')
    expect(ne('Chequia')).toBe('Czechia')
    expect(ne('Czech Republic')).toBe('Czechia')
    expect(ne('Países Bajos')).toBe('Netherlands')
    expect(ne('Holanda')).toBe('Netherlands')
    expect(ne('Corea del Sur')).toBe('South Korea')
    expect(ne('Macedonia del Norte')).toBe('Macedonia')
    expect(ne('Turquía')).toBe('Turkey')
    expect(ne('Sáhara Occidental')).toBe('W. Sahara')
    expect(ne('Myanmar')).toBe('Myanmar')
    expect(ne('Birmania')).toBe('Myanmar')
    expect(ne('Guinea Ecuatorial')).toBe('Eq. Guinea')
    expect(ne('Sudán del Sur')).toBe('S. Sudan')
    expect(ne('Japón')).toBe('Japan')
    expect(ne('Malta')).toBe('Malta')
  })
  it('no confunde países parecidos', () => {
    expect(ne('Níger')).toBe('Niger')
    expect(ne('Nigeria')).toBe('Nigeria')
    expect(ne('Guinea')).toBe('Guinea')
    expect(ne('Guinea-Bissau')).toBe('Guinea-Bissau')
    expect(ne('Sudán')).toBe('Sudan')
    expect(ne('Dominica')).toBe('Dominica')
    expect(ne('República Dominicana')).toBe('Dominican Rep.')
  })
  it('no inventa estados históricos', () => {
    expect(findCountry('Prusia')).toBeUndefined()
    expect(findCountry('URSS')).toBeUndefined()
    expect(findCountry('')).toBeUndefined()
  })
})

describe('suggestCountries', () => {
  it('propone los parecidos', () => {
    expect(suggestCountries('Portgal')).toContain('Portugal')
    expect(suggestCountries('Alemanía')).toContain('Alemania')
    expect(suggestCountries('Prusia').length).toBeLessThanOrEqual(4)
  })
})

describe('countryLabel', () => {
  it('nombra el país en la lengua del estudiante', () => {
    expect(countryLabel(findCountry('DE')!, 'es')).toBe('Alemania')
    expect(countryLabel(findCountry('DE')!, 'en')).toBe('Germany')
    expect(countryLabel(findCountry('Somaliland')!, 'es')).toBe('Somalilandia')
  })
})

describe('la tabla de países', () => {
  it('cada recuadro es finito y tiene sur < norte y oeste < este', () => {
    for (const c of COUNTRIES) {
      const [w, s, e, n] = c.bbox
      expect([w, s, e, n].every(Number.isFinite), c.ne).toBe(true)
      expect(s < n, c.ne).toBe(true)
      expect(w < e, c.ne).toBe(true)
      expect(e - w < 360, c.ne).toBe(true)
    }
  })
  it('cada nombre existe en el contorno de 1:50 millones y «small» son justo los que faltan en el de 1:110', () => {
    const n50 = new Set(atlas('countries-50m.json'))
    const n110 = new Set(atlas('countries-110m.json'))
    expect(COUNTRIES.length).toBe(n50.size)
    for (const c of COUNTRIES) {
      expect(n50.has(c.ne), c.ne).toBe(true)
      expect(c.small, c.ne).toBe(!n110.has(c.ne))
    }
  })
  it('cada país se encuentra por su nombre y por su código', () => {
    for (const c of COUNTRIES) {
      expect(findCountry(c.ne)?.ne, c.ne).toBe(c.ne)
      if (c.a2) expect(findCountry(c.a2)?.ne, c.a2).toBe(c.ne)
    }
  })
  it('los códigos ISO no se repiten', () => {
    const codes = COUNTRIES.flatMap((c) => (c.a2 ? [c.a2] : []))
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe('regionBox', () => {
  it('encuadres con nombre en español e inglés', () => {
    const [w, s, e, n] = MAP_REGIONS.europe
    expect(regionBox('europa')).toEqual({ latMin: s, latMax: n, lonMin: w, lonMax: e })
    expect(regionBox('Europe')).toEqual(regionBox('europa'))
    expect(regionPreset('Oriente Medio')).toBe('middle-east')
    expect(regionPreset('Península Ibérica')).toBe('iberian-peninsula')
    expect(regionPreset('Sudamérica')).toBe('south-america')
    expect(regionPreset('Atlántida')).toBeUndefined()
  })
  it('un país, con margen y dentro del mundo', () => {
    const b = regionBox('Chile')!
    expect(b.lonMin).toBeLessThan(-75.8)
    expect(b.lonMax).toBeGreaterThan(-67)
    expect(b.latMin).toBeGreaterThanOrEqual(-85)
    expect(b.latMin).toBeLessThan(-55.7)
    expect(b.latMax).toBeGreaterThan(-17.5)
  })
  it('un recuadro escrito', () => {
    expect(regionBox('-10,35,5,44')).toEqual({ latMin: 35, latMax: 44, lonMin: -10, lonMax: 5 })
    expect(regionBox('10,50,5,40')).toBeUndefined()
  })
  it('Rusia no da la vuelta al mundo', () => {
    const b = regionBox('Rusia')!
    expect(b.lonMax - b.lonMin).toBeLessThan(220)
    expect(b.lonMin).toBeGreaterThan(0)
  })
  it('lo desconocido no encuadra', () => {
    expect(regionBox('Prusia')).toBeUndefined()
    expect(regionBox('')).toBeUndefined()
  })
  it('los nombres heredados de Object no son encuadres (ni rompen)', () => {
    for (const r of ['constructor', 'Constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(() => regionBox(r), r).not.toThrow()
      expect(regionBox(r), r).toBeUndefined()
      expect(regionPreset(r), r).toBeUndefined()
    }
    expect(countryKey('constructor')).toBe('constructor')
    expect(countryKey('__proto__ toString')).toBe('prototostring')
  })
})

describe('partes de un país (Somalilandia, Chipre del Norte)', () => {
  it('van con su país, que las encuadra', () => {
    expect(countryCompanions('Somalia')).toEqual(['Somaliland'])
    expect(countryCompanions('Cyprus')).toEqual(['N. Cyprus'])
    expect(countryCompanions('France')).toEqual([])
    expect(companionParent('Somaliland')).toBe('Somalia')
    expect(companionParent('N. Cyprus')).toBe('Cyprus')
    expect(companionParent('Somalia')).toBeUndefined()
    // el recuadro de Chipre llega al norte de la isla (Kyrenia, 35,3° N; el cabo, 35,7°)
    const cy = findCountry('Chipre')!.bbox
    expect(cy[3]).toBeGreaterThanOrEqual(35.7)
    expect(cy[2]).toBeGreaterThanOrEqual(34.6)
    expect(regionBox('Chipre')!.latMax).toBeGreaterThan(35.7)
  })
  it('se siguen encontrando aparte por su nombre', () => {
    expect(findCountry('Somalilandia')?.ne).toBe('Somaliland')
    expect(findCountry('Chipre del Norte')?.ne).toBe('N. Cyprus')
  })
})
