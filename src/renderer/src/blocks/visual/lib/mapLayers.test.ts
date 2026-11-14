import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { geoArea, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import { decodeMap } from '@shared/schema/visual'
import { boxAt, intersects } from '../../plot/labels'
import { boundsAspect, contentBox, fitProjection, isWorldView, lonUnion, mapBounds, mapCountries, needsDetail, sanitizeMap, shortestArc } from './mapGeo'
import { choroplethClasses, classColor, classOf, classShade, legendLayout, legendStops } from './mapChoropleth'
import { BOW, bowedRoute, bowLabelSpot, routePolyline, routeSamples, routeTip } from './mapRoutes'
import { pinBody, pinCandidates, placeMapLabels, pointCandidates, unnamedPinNumbers, type Box, type LabelItem } from './mapLabels'
import { chipCandidates, countryFeature, featureAt, featuresByName, labelSpot, quizPool, resolveCountries, tappedCountry, type CountryFeature } from './mapCountries'
import { estimateMeasure } from './diagramLayout'

const map = (raw: Record<string, unknown>) => sanitizeMap(decodeMap(raw)!)

describe('encuadre con países y con nombre', () => {
  it('un mapa solo con España encuadra la península y Canarias', () => {
    const b = mapBounds(map({ countries: ['España'] }))
    expect(b.latMin).toBeLessThan(27.7)
    expect(b.latMin).toBeGreaterThan(15)
    expect(b.latMax).toBeGreaterThan(43.7)
    expect(b.latMax).toBeLessThan(55)
    expect(isWorldView(b)).toBe(false)
  })
  it('el margen del norte no estira Mercator (Finlandia no enseña medio mundo)', () => {
    const b = mapBounds(map({ countries: ['Finlandia', 'España', 'Grecia', 'Irlanda'] }))
    expect(b.latMax).toBeGreaterThan(70.1)
    expect(b.latMax).toBeLessThan(75)
    expect(b.latMin).toBeLessThan(27.7)
  })
  it('Malta pide el contorno detallado aunque se vea entero el Mediterráneo', () => {
    const m = map({ countries: ['Malta', 'Italia', 'Egipto', 'España'] })
    const b = mapBounds(m)
    expect(needsDetail({ ...b, lonMin: -180, lonMax: 180 }, mapCountries(m))).toBe(true)
    expect(needsDetail({ latMin: -60, latMax: 80, lonMin: -180, lonMax: 180 }, mapCountries(map({ countries: ['Brasil'] })))).toBe(false)
  })
  it('lat/lon/span manda; después region (unida al contenido); después el contenido; si no, el mundo', () => {
    const fixed = mapBounds(map({ lat: 40, lon: -3, span: 10, region: 'africa', countries: ['Japón'] }))
    expect(fixed.latMax - fixed.latMin).toBeCloseTo(10)
    const africa = mapBounds(map({ region: 'África' }))
    expect(africa).toEqual({ latMin: -36, latMax: 38, lonMin: -20, lonMax: 55 })
    // un marcador fuera del encuadre con nombre lo agranda
    const withMadrid = mapBounds(map({ region: 'africa', markers: [{ title: 'Madrid', lat: 40.4, lon: -3.7 }] }))
    expect(withMadrid.latMax).toBeGreaterThan(40.4)
    expect(withMadrid.latMin).toBe(-36)
    // los países pueden salirse del encuadre con nombre (Rusia en Europa)
    const europe = mapBounds(map({ region: 'europe', countries: ['Rusia', 'Francia'] }))
    expect(europe.lonMax).toBe(45)
    // un nombre desconocido se ignora y encuadra el contenido
    const unknown = mapBounds(map({ region: 'Atlántida', countries: ['Francia'] }))
    expect(unknown.lonMin).toBeGreaterThan(-15)
    expect(unknown.lonMax).toBeLessThan(25)
  })
  it('Rusia y Fiyi no encuadran el mundo entero (cruzan la línea de cambio de fecha)', () => {
    const fiji = mapBounds(map({ countries: ['Fiyi'] }))
    expect(fiji.lonMax - fiji.lonMin).toBeLessThan(20)
    const ru = contentBox(map({ countries: ['Rusia'] }))!
    expect(ru.lonMax).toBeGreaterThan(180)
    expect(ru.lonMax - ru.lonMin).toBeLessThan(170)
    // la proyección centra el encuadre: la punta este de Rusia cae dentro de la ventana
    const b = mapBounds(map({ countries: ['Rusia'] }))
    const p = fitProjection(b, 800, 420)
    const [x] = p([-172, 66])!
    expect(x).toBeGreaterThan(0)
    expect(x).toBeLessThan(800)
  })
  it('Kamchatka y Alaska juntas no dan la vuelta al mundo', () => {
    const b = contentBox(map({ markers: [{ title: 'Petropávlovsk', lat: 53, lon: 158.6 }, { title: 'Anchorage', lat: 61.2, lon: -149.9 }] }))!
    expect(b.lonMax - b.lonMin).toBeLessThan(60)
  })
  it('lo que cruza el meridiano 0 junto a lo que cruza la línea de cambio de fecha: el arco más corto (Francia y Rusia)', () => {
    // Francia (−4,8…9,6) y Rusia (27,3…190,3): de Bretaña a Chukotka, no el mundo entero sin girar
    for (const countries of [['Francia', 'Rusia'], ['Reino Unido', 'Francia', 'Rusia'], ['España', 'Rusia'], ['Argelia', 'Rusia']]) {
      const c = contentBox(map({ countries }))!
      expect(c.lonMin, countries.join('+')).toBeGreaterThan(-20)
      expect(c.lonMax, countries.join('+')).toBeGreaterThan(190)
      expect(c.lonMax - c.lonMin, countries.join('+')).toBeLessThan(215)
    }
    // un marcador en Lisboa y Rusia: por Europa, no por las Américas
    const lisbon = contentBox(map({ countries: ['Rusia'], markers: [{ title: 'Lisboa', lat: 38.7, lon: -9.1 }] }))!
    expect(lisbon.lonMin).toBeCloseTo(-9.1)
    expect(lisbon.lonMax).toBeGreaterThan(190)
    // el encuadre gira y Chukotka y París caen dentro de la ventana, sin el Pacífico entero
    const b = mapBounds(map({ countries: ['Francia', 'Rusia'] }))
    expect(b.lonMin).toBeGreaterThan(-60)
    const p = fitProjection(b, 800, 448)
    for (const [lon, lat] of [[-172, 66], [2.35, 48.85]]) {
      const [x, y] = p([lon, lat])!
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(800)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(448)
    }
    // no es el mundo entero: las Américas quedan fuera
    expect(b.lonMax - b.lonMin).toBeLessThan(300)
    const [nx, ny] = p([-74, 40.7])!
    expect(nx < 0 || nx > 800 || ny < 0 || ny > 448).toBe(true)
  })
  it('el arco más corto es el círculo menos su mayor hueco', () => {
    expect(shortestArc([[10, 20], [30, 40]])).toEqual([10, 40])
    expect(shortestArc([[-5, 10], [27, 190]])).toEqual([-5, 190])
    expect(shortestArc([[170, 190], [-170, -160]])).toEqual([170, 200])
    expect(shortestArc([[158.6, 158.6], [-149.9, -149.9]])).toEqual([158.6, 210.1])
    // puntos repartidos por todo el mundo: queda fuera el mayor hueco (de −170 a −60, 110°), aunque no sea el de la vuelta
    expect(shortestArc([[-170, -170], [-60, -60], [0, 0], [60, 60], [120, 120]])).toEqual([-60, 190])
    expect(shortestArc([[-170, -170], [-120, -120], [0, 0], [60, 60], [120, 120]])).toEqual([0, 240])
    // un tramo largo que da la vuelta se come los del principio: solo queda fuera de 15 a 20
    expect(shortestArc([[-170, -160], [0, 10], [20, 375]])).toEqual([20, 375])
    expect(shortestArc([[-170, -160], [0, 30], [20, 375]])).toEqual([-180, 180])
    expect(shortestArc([[-180, 180]])).toEqual([-180, 180])
    expect(shortestArc([])).toEqual([-180, 180])
  })
  it('un mapamundi sigue centrado como siempre; el arco más corto, solo si acerca de verdad', () => {
    // el G7, la Commonwealth, la Segunda Guerra Mundial: el mundo sin girar, como antes
    for (const countries of [
      ['Estados Unidos', 'Canadá', 'Reino Unido', 'Francia', 'Alemania', 'Italia', 'Japón'],
      ['Reino Unido', 'Canadá', 'Australia', 'India', 'Sudáfrica', 'Nueva Zelanda', 'Nigeria', 'Kenia'],
      ['Alemania', 'Italia', 'Japón', 'Reino Unido', 'Estados Unidos', 'Rusia', 'China', 'Francia']
    ]) {
      const b = mapBounds(map({ countries }))
      expect([b.lonMin, b.lonMax], countries.join('+')).toEqual([-180, 180])
    }
    // con puntos: el mismo encuadre de antes (Berlín, Tokio y Los Ángeles, por el Pacífico)
    expect(lonUnion([[13.4, 13.4], [139.7, 139.7], [-118.2, -118.2]])).toEqual([13.4, 241.8])
    expect(lonUnion([[-5, 10], [27, 190]])).toEqual([-5, 190])
  })
  it('ningún país queda cortado por el borde del mapa', () => {
    const inside = (b: { lonMin: number; lonMax: number }, w: number, e: number): boolean =>
      [-360, 0, 360].some((k) => b.lonMin <= w + k + 1e-9 && e + k <= b.lonMax + 1e-9)
    for (const countries of [
      ['Brasil', 'Rusia', 'India', 'China', 'Sudáfrica'],
      ['Reino Unido', 'Canadá', 'Australia', 'India', 'Sudáfrica', 'Nueva Zelanda', 'Nigeria', 'Kenia'],
      ['Estados Unidos', 'Canadá', 'Reino Unido', 'Francia', 'Alemania', 'Italia', 'Japón'],
      ['Alemania', 'Italia', 'Japón', 'Reino Unido', 'Estados Unidos', 'Rusia', 'China', 'Francia'],
      ['Estados Unidos', 'Rusia'], ['Francia', 'Rusia'], ['Alemania', 'Rusia'], ['Fiyi', 'Samoa', 'Tonga']
    ]) {
      const m = map({ countries })
      const b = mapBounds(m)
      expect(b.lonMax - b.lonMin, countries.join('+')).toBeLessThanOrEqual(360 + 1e-9)
      for (const c of mapCountries(m)) {
        // lo que cruza la línea de cambio de fecha en un mundo sin girar (Chukotka) es el mapamundi de siempre
        if (b.lonMax <= 180 && b.lonMax - b.lonMin >= 360 && c.bbox[2] > 180) continue
        expect(inside(b, c.bbox[0], c.bbox[2]), `${countries.join('+')}: ${c.ne}`).toBe(true)
      }
    }
  })
})

describe('mapa de coropletas', () => {
  it('cuantiles en 5 clases', () => {
    const c = choroplethClasses([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])!
    expect(c.k).toBe(5)
    expect(c.cuts).toEqual([3, 5, 7, 9])
    expect(classOf(1, c)).toBe(0)
    expect(classOf(3, c)).toBe(1)
    expect(classOf(10, c)).toBe(4)
  })
  it('los empates van juntos y nunca hay clases vacías', () => {
    const c = choroplethClasses([1, 1, 1, 1, 2, 3, 4, 5, 6, 7])!
    expect(new Set(c.cuts).size).toBe(c.cuts.length)
    expect(c.cuts.every((x, i) => i === 0 || x > c.cuts[i - 1])).toBe(true)
    const used = new Set([1, 1, 1, 1, 2, 3, 4, 5, 6, 7].map((v) => classOf(v, c)))
    expect(used.size).toBe(c.k)
  })
  it('con pocos valores distintos, cada uno su clase', () => {
    const c = choroplethClasses([10, 20, 20, 30])!
    expect(c.k).toBe(3)
    expect(c.exact).toEqual([10, 20, 30])
    expect([10, 20, 30].map((v) => classOf(v, c))).toEqual([0, 1, 2])
    expect(choroplethClasses([Number.NaN])).toBeUndefined()
    expect(choroplethClasses([5, 5])!.k).toBe(1)
  })
  it('escalones planos de la tinta: 26…88 %, sin degradados', () => {
    expect([0, 1, 2, 3, 4].map((i) => classShade(i, 5))).toEqual([26, 42, 57, 73, 88])
    expect([0, 1, 2].map((i) => classShade(i, 3))).toEqual([26, 57, 88])
    expect(classColor(4, 5, 'var(--viz-accent)')).toBe('color-mix(in oklab, var(--viz-accent) 88%, var(--viz-land))')
  })
  it('leyenda: límites con cuantiles, valores con clases exactas', () => {
    const fmt = (v: number): string => String(v)
    expect(legendStops(choroplethClasses([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])!, fmt)).toEqual({ under: 'edge', labels: ['1', '3', '5', '7', '9', '10'] })
    expect(legendStops(choroplethClasses([10, 20, 30])!, fmt)).toEqual({ under: 'swatch', labels: ['10', '20', '30'] })
  })
})

describe('rutas con sentido', () => {
  const proj = fitProjection({ latMin: 30, latMax: 45, lonMin: -10, lonMax: 30 }, 800, 400)
  const roma = [41.9, 12.5], atenas = [37.98, 23.73]
  it('el arco conserva los extremos y se separa ≈ 12 % de la cuerda en su mitad', () => {
    const pts = bowedRoute(proj, [roma, atenas])!
    const a = proj([roma[1], roma[0]])!, b = proj([atenas[1], atenas[0]])!
    expect(pts[0][0]).toBeCloseTo(a[0], 6)
    expect(pts[0][1]).toBeCloseTo(a[1], 6)
    expect(pts[pts.length - 1][0]).toBeCloseTo(b[0], 6)
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1])
    const mid = pts[16]
    // distancia del punto medio a la recta de la cuerda
    const off = Math.abs((b[0] - a[0]) * (a[1] - mid[1]) - (a[0] - mid[0]) * (b[1] - a[1])) / chord
    expect(off / chord).toBeGreaterThan(BOW * 0.8)
    expect(off / chord).toBeLessThan(BOW * 1.3)
  })
  it('un viaje largo se comba hacia donde ya se curva el círculo máximo (no se endereza)', () => {
    const atl = fitProjection({ latMin: 15, latMax: 45, lonMin: -80, lonMax: 0 }, 800, 400)
    const palos = [37.23, -6.89], guanahani = [24.05, -74.5]
    const plain = routePolyline(atl, [palos, guanahani])
    const pts = bowedRoute(atl, [palos, guanahani])!
    const a = pts[0], b = pts[pts.length - 1]
    const off = (p: number[]): number => ((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / Math.hypot(b[0] - a[0], b[1] - a[1])
    const gc = off(plain[Math.floor(plain.length / 2)])
    const bowed = off(pts[16])
    expect(Math.sign(bowed)).toBe(Math.sign(gc))
    expect(Math.abs(bowed)).toBeGreaterThan(Math.abs(gc))
  })
  it('las rutas de 3 o más puntos no se comban', () => {
    expect(bowedRoute(proj, [roma, [40, 18], atenas])).toBeUndefined()
  })
  it('la flecha mira hacia el final; el nombre va por fuera del arco', () => {
    const pts = bowedRoute(proj, [roma, atenas])!
    const tip = routeTip(proj, [roma, atenas], pts)!
    expect(tip.x).toBeCloseTo(pts[pts.length - 1][0], 6)
    // de Roma a Atenas se va hacia el este (y algo al sur), la punta baja hacia la derecha
    expect(Math.abs(tip.angle)).toBeLessThan(90)
    const spot = bowLabelSpot(pts)!
    const a = pts[0], b = pts[pts.length - 1]
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    // la normal hacia fuera apunta del centro de la cuerda hacia la cima del arco
    expect((spot.at[0] - mid[0]) * spot.out[0] + (spot.at[1] - mid[1]) * spot.out[1]).toBeGreaterThan(0)
    const poly = routeTip(proj, [roma, [40, 18], atenas])!
    expect(Number.isFinite(poly.angle)).toBe(true)
  })
  it('muestras de la ruta en pantalla cada pocos píxeles', () => {
    const line = routePolyline(proj, [roma, atenas])
    const s = routeSamples(line, (p) => p, 10)
    for (let i = 1; i < s.length; i++) expect(Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1])).toBeLessThanOrEqual(10.01)
  })
})

describe('nombres que no se pisan', () => {
  const frame = { x: 0, y: 0, w: 600, h: 400 }
  it('dos chinchetas a 10 px no se pisan los nombres', () => {
    const items = [300, 310].map((x) => ({ candidates: pinCandidates(x, 200), w: 60, h: 19 }))
    const [a, b] = placeMapLabels(items, [pinBody(300, 200), pinBody(310, 200)], [], frame)
    expect(a && b).toBeTruthy()
    expect(intersects(boxAt(a!, 60, 19), boxAt(b!, 60, 19))).toBe(false)
    for (const c of [a!, b!]) for (const p of [pinBody(300, 200), pinBody(310, 200)]) expect(intersects(boxAt(c, 60, 19), p)).toBe(false)
  })
  it('junto al borde derecho, el nombre va a la izquierda', () => {
    const [a] = placeMapLabels([{ candidates: pinCandidates(590, 200), w: 80, h: 19 }], [pinBody(590, 200)], [], frame)
    expect(a!.ax).toBe(1)
    expect(boxAt(a!, 80, 19).x + 80).toBeLessThanOrEqual(600)
  })
  it('un nombre que pisaría una ruta se mueve', () => {
    const ink: Array<[number, number]> = Array.from({ length: 30 }, (_, i) => [312 + i * 3, 185])
    const [a] = placeMapLabels([{ candidates: pinCandidates(300, 200), w: 60, h: 19 }], [pinBody(300, 200)], ink, frame)
    const box = boxAt(a!, 60, 19)
    expect(ink.some(([x, y]) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h)).toBe(false)
  })
  it('si no cabe en ningún sitio, se oculta', () => {
    const [a] = placeMapLabels([{ candidates: pointCandidates(300, 200), w: 60, h: 19 }], [{ x: 0, y: 0, w: 600, h: 400 }], [], frame)
    expect(a).toBeNull()
  })
  it('300 chinchetas se colocan deprisa', () => {
    const items = Array.from({ length: 300 }, (_, i) => ({ candidates: pinCandidates((i * 37) % 580 + 10, (i * 53) % 380 + 10), w: 70, h: 19 }))
    const obstacles = items.map((_, i) => pinBody((i * 37) % 580 + 10, (i * 53) % 380 + 10))
    const t0 = performance.now()
    placeMapLabels(items, obstacles, [], frame)
    expect(performance.now() - t0).toBeLessThan(40)
  })
})

describe('países sobre el contorno', () => {
  const topo = JSON.parse(readFileSync(join(__dirname, '../../../../../../node_modules/world-atlas/countries-110m.json'), 'utf8')) as Topology
  const features = (feature(topo, topo.objects.countries as GeometryCollection) as unknown as { features: CountryFeature[] }).features
  const byName = featuresByName(features)
  it('cada país de la lección encuentra su contorno por nombre', () => {
    const chosen = resolveCountries([{ name: 'Francia' }, { name: 'France' }, { name: 'Prusia' }, { name: 'DE' }])
    expect(chosen.map((c) => c.country.ne)).toEqual(['France', 'Germany'])
    for (const c of chosen) expect(byName.get(c.country.ne)).toBeDefined()
  })
  it('el nombre de Francia va en la Francia europea, no en la Guayana', () => {
    const proj = fitProjection({ latMin: -60, latMax: 80, lonMin: -180, lonMax: 180 }, 800, 400)
    const spot = labelSpot(byName.get('France')!, geoPath(proj))!
    const [ex, ey] = proj([2.5, 46.5])!
    expect(Math.hypot(spot.x - ex, spot.y - ey)).toBeLessThan(15)
  })
  it('el nombre de un país busca sitio dentro de su pieza si el centro está ocupado', () => {
    const all = chipCandidates(100, 100, 200, 100, () => true)
    expect(all[0]).toMatchObject({ x: 100, y: 100 })
    expect(all.length).toBeGreaterThan(6)
    // solo vale la mitad izquierda de la pieza
    const left = chipCandidates(100, 100, 200, 100, (x) => x < 90)
    expect(left.every((c) => c.x < 90)).toBe(true)
    expect(left.length).toBeGreaterThan(0)
  })
  it('el país bajo un punto: el más pequeño que lo contiene', () => {
    const items = ['Italy', 'France', 'Spain'].map((n) => ({ feature: byName.get(n)!, area: geoArea(byName.get(n)!), name: n }))
    expect(featureAt(12.5, 41.9, items)?.name).toBe('Italy')
    expect(featureAt(-3.7, 40.4, items)?.name).toBe('Spain')
    expect(featureAt(-30, 40, items)).toBeUndefined()
  })
  it('la práctica mezcla marcadores y países sin repetir nombres', () => {
    const pool = quizPool([{ title: 'Roma', lat: 41.9, lon: 12.5 }, { title: 'Francia', lat: 48.8, lon: 2.3 }], resolveCountries([{ name: 'France' }, { name: 'Alemania' }]), 'es')
    expect(pool.map((q) => q.name)).toEqual(['Roma', 'Francia', 'Alemania'])
    expect(pool[2]).toMatchObject({ kind: 'country', ne: 'Germany' })
  })
})

describe('países con partes (Somalia con Somalilandia, Chipre con el norte)', () => {
  const load = (f: string): CountryFeature[] => {
    const topo = JSON.parse(readFileSync(join(__dirname, '../../../../../../node_modules/world-atlas', f), 'utf8')) as Topology
    return (feature(topo, topo.objects.countries as GeometryCollection) as unknown as { features: CountryFeature[] }).features
  }
  for (const atlas of ['countries-110m.json', 'countries-50m.json']) {
    const byName = featuresByName(load(atlas))
    it(`se dibujan y se pulsan con su país (${atlas})`, () => {
      const own = new Set(['Somalia', 'Cyprus', 'Ethiopia'])
      const somalia = countryFeature('Somalia', byName, own)!
      const cyprus = countryFeature('Cyprus', byName, own)!
      const items = [{ feature: somalia, area: geoArea(somalia), ne: 'Somalia' }, { feature: cyprus, area: geoArea(cyprus), ne: 'Cyprus' }]
      // Hargeisa (Somalilandia), Mogadiscio, Kyrenia (norte de Chipre) y Limasol
      expect(featureAt(44.06, 9.56, items)?.ne).toBe('Somalia')
      expect(featureAt(45.34, 2.05, items)?.ne).toBe('Somalia')
      expect(featureAt(33.32, 35.34, items)?.ne).toBe('Cyprus')
      expect(featureAt(33.04, 34.68, items)?.ne).toBe('Cyprus')
      expect(geoArea(somalia)).toBeGreaterThan(geoArea(byName.get('Somalia')!))
      // el nombre va en la pieza más grande, la de Somalia
      const spot = labelSpot(somalia, geoPath(fitProjection({ latMin: -5, latMax: 15, lonMin: 38, lonMax: 54 }, 600, 400)))
      expect(spot).toBeDefined()
    })
    it(`si la lección nombra la parte aparte, va aparte (${atlas})`, () => {
      const own = new Set(['Somalia', 'Somaliland'])
      const somalia = countryFeature('Somalia', byName, own)!
      expect(geoArea(somalia)).toBeCloseTo(geoArea(byName.get('Somalia')!))
      expect(featureAt(44.06, 9.56, [{ feature: somalia, area: 0 }])).toBeUndefined()
    })
  }
  it('pulsar la parte en la práctica es pulsar su país, salvo que la lección la nombre aparte', () => {
    expect(tappedCountry('Somaliland', new Set(['Somalia', 'Kenya']))).toBe('Somalia')
    expect(tappedCountry('Somaliland', new Set(['Kenya']))).toBe('Somalia')
    expect(tappedCountry('N. Cyprus', new Set(['Cyprus']))).toBe('Cyprus')
    expect(tappedCountry('Somaliland', new Set(['Somalia', 'Somaliland']))).toBe('Somaliland')
    expect(tappedCountry('France', new Set(['Somalia']))).toBe('France')
  })
  it('un mapa con Chipre encuadra la isla entera', () => {
    const b = contentBox(map({ countries: ['Chipre', 'Grecia'] }))!
    expect(b.latMax).toBeGreaterThanOrEqual(35.7)
  })
})

describe('escala del mapa de coropletas', () => {
  const fake = (s: string): number => Array.from(s).length * 7
  const overlaps = (l: { labels: Array<{ x: number; text: string }> }): boolean =>
    l.labels.some((a, i) => i > 0 && a.x - fake(a.text) / 2 < l.labels[i - 1].x + fake(l.labels[i - 1].text) / 2 + 2)
  it('con cuantiles, las cifras de los límites bajo los bordes de las muestras, sin pisarse ni salirse', () => {
    const stops = legendStops(choroplethClasses([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])!, String)
    const l = legendLayout(stops, fake, 600)
    expect(l.labels.map((x) => x.text)).toEqual(['1', '3', '5', '7', '9', '10'])
    expect(l.labels[0].x).toBe(l.pad)
    expect(l.labels[5].x).toBe(l.width - l.pad)
    // el borde entre la 1.ª y la 2.ª muestra
    expect(l.labels[1].x).toBeCloseTo(l.pad + l.swatch + l.gap / 2)
    expect(overlaps(l)).toBe(false)
    expect(l.labels[0].x - fake('1') / 2).toBeGreaterThanOrEqual(0)
    expect(l.labels[5].x + fake('10') / 2).toBeLessThanOrEqual(l.width)
  })
  it('con valores exactos, una cifra bajo cada muestra', () => {
    const l = legendLayout(legendStops(choroplethClasses([10, 20, 30])!, String), fake, 600)
    expect(l.labels.map((x) => x.text)).toEqual(['10', '20', '30'])
    expect(l.labels[1].x).toBeCloseTo(l.pad + l.swatch + l.gap + l.swatch / 2)
  })
  it('las muestras crecen con las cifras largas y, si no caben, se escribe una de cada pocas', () => {
    const long = { under: 'edge' as const, labels: ['1,2 mil', '3,4 mil', '5,6 mil', '7,8 mil', '9,1 mil', '12,3 mil'] }
    const wide = legendLayout(long, fake, 800)
    expect(wide.labels).toHaveLength(6)
    expect(overlaps(wide)).toBe(false)
    const narrow = legendLayout(long, fake, 200)
    expect(narrow.width).toBeLessThanOrEqual(200 + 1)
    expect(narrow.labels.length).toBeLessThan(6)
    expect(narrow.labels[narrow.labels.length - 1].text).toBe('12,3 mil')
    expect(overlaps(narrow)).toBe(false)
  })
})

describe('en papel, las chinchetas sin nombre', () => {
  it('llevan un número en el orden de los marcadores (las que no tienen título, no)', () => {
    const at = { x: 0, y: 0, ax: 0, ay: 0 }
    const n = unnamedPinNumbers(['A', '', 'C', 'D', 'E'], new Map([[0, at], [2, null], [3, at], [4, null]]))
    expect([...n]).toEqual([[2, 1], [4, 2]])
  })
  it('diez ciudades griegas impresas a 560 px: cada nombre está en el mapa o numerado en la lista', () => {
    const cities: Array<[string, number, number]> = [
      ['Atenas', 37.98, 23.73], ['Esparta', 37.07, 22.43], ['Corinto', 37.94, 22.93], ['Tebas', 38.32, 23.32], ['Argos', 37.63, 22.73],
      ['Delfos', 38.48, 22.5], ['Olimpia', 37.64, 21.63], ['Micenas', 37.73, 22.76], ['Maratón', 38.15, 23.96], ['Termópilas', 38.8, 22.53]
    ]
    const b = map({ markers: cities.map(([title, lat, lon]) => ({ title, lat, lon })) })
    // como lo hace MapBlock en papel
    const W = 560
    const bounds = mapBounds(b)
    const aspect = Math.max(0.56, Math.min(0.72, boundsAspect(bounds)))
    const H = Math.round(Math.min(420, Math.max(300, W * Math.min(aspect, 0.6))))
    const proj = fitProjection(bounds, W, H)
    const chip = (s: string): number => estimateMeasure(s, 12.5, false) * 1.06 + 16
    const pts = b.markers.map((m) => proj([m.lon, m.lat])!)
    const obstacles: Box[] = [{ x: 0, y: H - 28, w: chip('Mapa: Natural Earth (dominio público)') + 10, h: 28 }, ...pts.map((p) => pinBody(p[0], p[1]))]
    const items: LabelItem[] = b.markers.map((m, i) => ({ candidates: pinCandidates(pts[i][0], pts[i][1]), w: chip(m.title), h: 19 }))
    const placed = placeMapLabels(items, obstacles, [], { x: 4, y: 4, w: W - 8, h: H - 8 })
    const pins = new Map(placed.map((c, i) => [i, c]))
    const numbers = unnamedPinNumbers(b.markers.map((m) => m.title), pins)
    // apiñadas en el Peloponeso, alguna no cabe; ninguna se pierde
    expect(numbers.size).toBeGreaterThan(0)
    for (let i = 0; i < cities.length; i++) expect(placed[i] !== null || numbers.has(i), cities[i][0]).toBe(true)
    expect([...numbers.values()]).toEqual(Array.from({ length: numbers.size }, (_, k) => k + 1))
  })
})
