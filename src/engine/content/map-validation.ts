// Validación de lo nuevo del mapa: países por su nombre (que existan; si no, los parecidos), el encuadre con nombre, los
// valores de un mapa de coropletas y la práctica con países. La llama checkMap (visual-validation.ts).
import type { ContentIssue, IssueSeverity, MapBlock } from '@shared/schema'
import { findCountry, MAP_REGIONS, regionBox, suggestCountries } from '@engine/geo/countries'

const issue = (severity: IssueSeverity, path: string, message: string): ContentIssue => ({ severity, path, message })

/** Nombres que se preguntan en la práctica: los títulos de los marcadores y los países (en minúscula). */
export function mapQuizNames(m: MapBlock): string[] {
  return [...m.markers.map((x) => x.title), ...m.countries.map((c) => findCountry(c.name)?.ne ?? c.name)].map((s) => s.trim().toLowerCase())
}

export function checkMapCountries(m: MapBlock, path: string): ContentIssue[] {
  const out: ContentIssue[] = []
  const seen = new Map<string, number>()
  m.countries.forEach((c, i) => {
    const p = `${path}.countries[${i}]`
    const found = findCountry(c.name)
    if (!found) {
      const close = suggestCountries(c.name)
      out.push(issue('error', p, `País «${c.name}» desconocido` + (close.length ? `; ¿quisiste decir ${close.join(', ')}?` : '.') +
        ' Usa su nombre actual en español o inglés, o el código ISO («FR»). Para estados históricos (Prusia, URSS, Imperio otomano) o zonas sin frontera de hoy usa `regions`.'))
      return
    }
    const before = seen.get(found.ne)
    if (before !== undefined) out.push(issue('warning', p, `«${c.name}» repite el país de countries[${before}]: se dibuja una sola vez.`))
    else seen.set(found.ne, i)
    if (c.value !== undefined && c.color !== undefined) out.push(issue('warning', p + '.color', 'Con `value` el color sale del valor (mapa de coropletas): `color` se ignora.'))
  })
  const valued = m.countries.filter((c) => c.value !== undefined).length
  if (valued > 0 && valued < m.countries.length) out.push(issue('warning', path + '.countries', 'Unos países traen `value` y otros no: los que no lo traen se pintan aparte, sin escala. Da un valor a todos o a ninguno.'))
  if (valued > 0 && valued < 3) out.push(issue('warning', path + '.countries', 'Un mapa de coropletas necesita varios países con su valor (mejor ≥ 5).'))
  if (valued > 0 && !m.unit) out.push(issue('warning', path + '.unit', 'Indica la unidad de los valores en `unit` («M hab.», «%», «t CO₂ por persona»).'))
  if (m.region !== undefined && !regionBox(m.region)) {
    out.push(issue('warning', path + '.region', `No entiendo region «${m.region}»: usa ${Object.keys(MAP_REGIONS).join(', ')}, el nombre de un país o «oeste,sur,este,norte»; o quítalo para encuadrar el contenido.`))
  }
  m.routes.forEach((r, i) => {
    if (r.arrow && r.points.length > 1 && r.points.every((q) => q.length >= 2 && q[0] === r.points[0][0] && q[1] === r.points[0][1])) {
      out.push(issue('warning', `${path}.routes[${i}]`, 'La ruta empieza y acaba en el mismo sitio.'))
    }
  })
  return out
}
