// Los países de un mapa en texto (documentos en Markdown y Word, que no pueden pintar el mapa): su nombre en la lengua del
// documento y su grupo, su valor o su explicación.
import type { MapBlock } from '@shared/schema'
import { countryLabel, findCountry } from '@engine/geo/countries'
import type { DocLang } from './words'

const numberText = (v: number): string => (Math.round(v) === v && Math.abs(v) < 1e15 ? String(v) : String(Number(v.toPrecision(6))))

/** Como mucho, los países que guarda un mapa (decodeMap se queda con 120). */
const MAX_COUNTRIES = 120

/** Lista de los países del mapa («- Francia: Aliados», «- España: 47.4 M hab.»), o '' si no tiene. */
export function mapCountriesText(m: MapBlock, lang: DocLang): string {
  if (!m.countries.length) return ''
  const shown = m.countries.slice(0, MAX_COUNTRIES)
  const lines = shown.map((c) => {
    const found = findCountry(c.name)
    const name = found ? countryLabel(found, lang) : c.name
    const parts = [c.label, c.value !== undefined ? numberText(c.value) + (m.unit ? ` ${m.unit}` : '') : undefined, c.md].filter((x): x is string => !!x && x.trim() !== '')
    return `- ${name}` + (parts.length ? `: ${parts.join(' — ')}` : '')
  })
  // si alguna vez llegan más, se dice cuántos faltan (nada desaparece en silencio)
  if (m.countries.length > shown.length) lines.push(`- … (+${m.countries.length - shown.length})`)
  return '\n\n' + lines.join('\n')
}
