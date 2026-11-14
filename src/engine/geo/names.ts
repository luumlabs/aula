// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/map.ts (normal()).
// Clave para comparar nombres de países como los escribe la IA o un libro, en español o en inglés: «Dem. Rep. Congo»,
// «República Democrática del Congo» y «Democratic Republic of the Congo» dan la misma clave. Sin dependencias (también lo
// usa el generador scripts/dev/country-table.mjs).

/** Abreviaturas y palabras que se escriben distinto en español e inglés, a una sola forma. */
const TOKENS: Record<string, string> = {
  dem: 'democratic', democratica: 'democratic', rep: 'republic', republica: 'republic',
  is: 'islands', isl: 'islands', islas: 'islands', isla: 'island', eq: 'equatorial', ecuatorial: 'equatorial',
  herz: 'herzegovina', fr: 'french', s: 'south', sur: 'south', n: 'north', norte: 'north', w: 'western', occidental: 'western',
  st: 'saint', ste: 'sainte'
}

/** Palabras que no distinguen un país de otro. */
const STOP = new Set(['the', 'of', 'and', 'de', 'del', 'la', 'las', 'los', 'el', 'y', 'e'])

/** Sin acentos ni mayúsculas; las siglas con puntos («U.S.A.», «EE. UU.») quedan juntas. */
function plain(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\b([a-z])\.\s?(?=[a-z]\b)/g, '$1')
    .replace(/\b([a-z]{2})\.\s?(?=[a-z]{2}\.)/g, '$1')
}

/** Clave de un nombre de país: palabras sin signos, abreviaturas desplegadas, sin palabras vacías y en orden alfabético. */
export function countryKey(name: string): string {
  return plain(name)
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== '')
    .map((w) => (Object.hasOwn(TOKENS, w) ? TOKENS[w] : w))
    .filter((w) => !STOP.has(w))
    .sort()
    .join('')
}

/** Clave de un nombre de región («Oriente Medio», «middle-east»): sin acentos ni signos, en su orden. */
export function regionKey(name: string): string {
  return plain(name).replace(/[^a-z0-9]+/g, '')
}
