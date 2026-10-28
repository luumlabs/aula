// Catálogo del conversor de unidades: cada unidad con su factor a la unidad base de la categoría (y desplazamiento para
// las temperaturas). Factores exactos por definición (libra internacional, galón de EE. UU., atm…), como en la app Swift
// (la app Swift anterior: Sources/StudyUI/Tools/UnitConverterView.swift).

export interface UnitDef {
  id: string
  /** Símbolo que se muestra (no se traduce). */
  symbol: string
  /** valor_base = valor × factor + offset */
  factor: number
  offset?: number
}

export interface UnitCategory {
  id: string
  units: UnitDef[]
  from: string
  to: string
}

const POUND = 0.45359237
const GALLON = 3.785411784
const TORR = 101325 / 760
const G0 = 9.80665

const u = (id: string, symbol: string, factor: number, offset = 0): UnitDef => ({ id, symbol, factor, offset })

export const CATEGORIES: UnitCategory[] = [
  {
    id: 'length',
    from: 'km',
    to: 'mi',
    units: [
      u('km', 'km', 1000), u('m', 'm', 1), u('cm', 'cm', 0.01), u('mm', 'mm', 0.001), u('um', 'µm', 1e-6), u('nm', 'nm', 1e-9), u('pm', 'pm', 1e-12), u('A', 'Å', 1e-10),
      u('mi', 'mi', 1609.344), u('yd', 'yd', 0.9144), u('ft', 'ft', 0.3048), u('in', 'in', 0.0254), u('nmi', 'nmi', 1852), u('au', 'au', 149597870700), u('ly', 'ly', 9460730472580800), u('pc', 'pc', 3.0856775814913673e16)
    ]
  },
  {
    id: 'mass',
    from: 'kg',
    to: 'lb',
    units: [
      u('t', 't', 1000), u('kg', 'kg', 1), u('g', 'g', 1e-3), u('mg', 'mg', 1e-6), u('ug', 'µg', 1e-9), u('u', 'u', 1.66053906892e-27),
      u('lb', 'lb', POUND), u('oz', 'oz', POUND / 16), u('st', 'st', POUND * 14), u('ct', 'ct', 2e-4)
    ]
  },
  { id: 'temperature', from: 'C', to: 'F', units: [u('C', '°C', 1, 273.15), u('K', 'K', 1), u('F', '°F', 5 / 9, 459.67 * (5 / 9))] },
  {
    id: 'time',
    from: 'h',
    to: 'min',
    units: [u('s', 's', 1), u('ms', 'ms', 1e-3), u('us', 'µs', 1e-6), u('ns', 'ns', 1e-9), u('min', 'min', 60), u('h', 'h', 3600), u('d', 'd', 86400), u('wk', 'wk', 604800), u('yr', 'yr', 31557600)]
  },
  {
    id: 'volume',
    from: 'L',
    to: 'mL',
    units: [
      u('L', 'L', 1), u('mL', 'mL', 1e-3), u('m3', 'm³', 1000), u('dm3', 'dm³', 1), u('cm3', 'cm³', 1e-3), u('gal', 'gal', GALLON), u('qt', 'qt', GALLON / 4), u('pt', 'pt', GALLON / 8),
      u('cup', 'cup', GALLON / 16), u('floz', 'fl oz', GALLON / 128), u('tbsp', 'tbsp', GALLON / 256), u('tsp', 'tsp', GALLON / 768), u('in3', 'in³', 0.016387064), u('ft3', 'ft³', 28.316846592)
    ]
  },
  {
    id: 'area',
    from: 'm2',
    to: 'ha',
    units: [u('m2', 'm²', 1), u('km2', 'km²', 1e6), u('cm2', 'cm²', 1e-4), u('mm2', 'mm²', 1e-6), u('ha', 'ha', 1e4), u('ac', 'ac', 4046.8564224), u('ft2', 'ft²', 0.09290304), u('in2', 'in²', 0.00064516), u('yd2', 'yd²', 0.83612736), u('mi2', 'mi²', 2589988.110336)]
  },
  { id: 'speed', from: 'ms', to: 'kmh', units: [u('ms', 'm/s', 1), u('kmh', 'km/h', 1 / 3.6), u('mph', 'mph', 0.44704), u('kn', 'kn', 1852 / 3600), u('c', 'c', 299792458)] },
  {
    id: 'energy',
    from: 'kcal',
    to: 'kJ',
    units: [u('J', 'J', 1), u('kJ', 'kJ', 1000), u('cal', 'cal', 4.184), u('kcal', 'kcal', 4184), u('Wh', 'Wh', 3600), u('kWh', 'kWh', 3.6e6), u('eV', 'eV', 1.602176634e-19), u('BTU', 'BTU', 1055.05585262)]
  },
  {
    id: 'pressure',
    from: 'atm',
    to: 'kPa',
    units: [u('Pa', 'Pa', 1), u('kPa', 'kPa', 1000), u('hPa', 'hPa', 100), u('bar', 'bar', 1e5), u('atm', 'atm', 101325), u('mmHg', 'mmHg', TORR), u('torr', 'Torr', TORR), u('psi', 'psi', (POUND * G0) / (0.0254 * 0.0254)), u('inHg', 'inHg', TORR * 25.4)]
  },
  { id: 'power', from: 'kW', to: 'hp', units: [u('W', 'W', 1), u('kW', 'kW', 1000), u('MW', 'MW', 1e6), u('mW', 'mW', 1e-3), u('hp', 'hp', 550 * 0.3048 * POUND * G0), u('CV', 'CV', 75 * G0)] },
  { id: 'force', from: 'N', to: 'kgf', units: [u('N', 'N', 1), u('kN', 'kN', 1000), u('dyn', 'dyn', 1e-5), u('kgf', 'kgf', G0), u('lbf', 'lbf', POUND * G0)] },
  { id: 'angle', from: 'deg', to: 'rad', units: [u('deg', '°', 1), u('rad', 'rad', 180 / Math.PI), u('grad', 'gon', 0.9), u('rev', 'rev', 360), u('arcmin', '′', 1 / 60), u('arcsec', '″', 1 / 3600)] },
  {
    id: 'data',
    from: 'GB',
    to: 'MB',
    units: [u('bit', 'bit', 1), u('B', 'B', 8), u('kB', 'kB', 8e3), u('MB', 'MB', 8e6), u('GB', 'GB', 8e9), u('TB', 'TB', 8e12), u('KiB', 'KiB', 8 * 1024), u('MiB', 'MiB', 8 * 1024 ** 2), u('GiB', 'GiB', 8 * 1024 ** 3)]
  }
]

export function categoryById(id: string): UnitCategory {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0]
}

export function unitIn(cat: UnitCategory, id: string): UnitDef {
  return cat.units.find((x) => x.id === id) ?? cat.units[0]
}

/**
 * Convierte pasando por la unidad base (sirve también para las temperaturas, que no son proporcionales). Las unidades con
 * desplazamiento restan números grandes y dejan ruido de coma flotante (32 °F daban 2·10⁻¹⁴ °C): lo que no llega a 10⁻¹²
 * de los términos que se restan es cero.
 */
export function convert(value: number, from: UnitDef, to: UnitDef): number {
  if (from.id === to.id) return value
  const fo = from.offset ?? 0
  const tOff = to.offset ?? 0
  const base = value * from.factor + fo
  const r = (base - tOff) / to.factor
  if (!fo && !tOff) return r
  const terms = Math.max(Math.abs(value * from.factor), Math.abs(fo), Math.abs(base), Math.abs(tOff))
  const tolerance = (1e-12 * terms) / Math.abs(to.factor)
  return Number.isFinite(r) && Math.abs(r) <= tolerance ? 0 : r
}

/** Cuántas unidades `to` hay en una unidad `from` (para la línea «1 km = 0,621371 mi»). Las temperaturas no tienen factor. */
export function ratio(from: UnitDef, to: UnitDef): number | null {
  if (from.offset || to.offset) return null
  return from.factor / to.factor
}
