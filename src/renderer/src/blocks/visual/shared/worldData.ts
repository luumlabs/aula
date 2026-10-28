// Contorno del mundo sin conexión: Natural Earth (dominio público) del paquete world-atlas, en TopoJSON. El de 1:110 millones
// para el mundo y los continentes; el de 1:50 millones (más pesado) solo cuando el mapa enseña una región o un país.
import { feature, mesh } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import type { Feature, FeatureCollection, Geometry, MultiLineString } from 'geojson'

export interface World { countries: Array<Feature<Geometry>>; borders: MultiLineString }

const cache = new Map<string, Promise<World>>()

function build(topo: Topology): World {
  const obj = topo.objects.countries as GeometryCollection
  const fc = feature(topo, obj) as unknown as FeatureCollection<Geometry>
  const borders = mesh(topo, obj, (a, b) => a !== b) as MultiLineString
  return { countries: fc.features, borders }
}

export function loadWorld(detail: boolean): Promise<World> {
  const key = detail ? '50m' : '110m'
  let p = cache.get(key)
  if (!p) {
    const load: Promise<{ default: unknown }> = detail ? import('world-atlas/countries-50m.json') : import('world-atlas/countries-110m.json')
    p = load.then((m) => build(m.default as Topology))
    cache.set(key, p)
  }
  return p
}
