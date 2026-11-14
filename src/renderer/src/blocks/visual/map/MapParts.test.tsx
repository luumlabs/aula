// Piezas del mapa en papel y en pantalla táctil: la escala con sus cifras escritas y las chinchetas numeradas.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import '@renderer/i18n'
import { choroplethClasses, legendStops } from '../lib/mapChoropleth'
import { ChoroplethLegend, MapPin, PrintedLegend } from './MapParts'

/** El texto visible (sin etiquetas ni atributos como `title`). */
const visibleText = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

describe('escala del mapa de coropletas', () => {
  it('los límites de las clases se leen sin pasar el ratón por encima', () => {
    const stops = legendStops(choroplethClasses([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])!, String)
    const html = renderToStaticMarkup(<ChoroplethLegend colors={['a', 'b', 'c', 'd', 'e']} ranges={['1 – 3', '3 – 5', '5 – 7', '7 – 9', '9 – 10']} stops={stops} unit="%" maxWidth={600} />)
    expect(visibleText(html)).toBe('% 1 3 5 7 9 10')
  })
  it('con valores exactos, el valor de cada escalón', () => {
    const stops = legendStops(choroplethClasses([10, 20, 30])!, String)
    const html = renderToStaticMarkup(<ChoroplethLegend colors={['a', 'b', 'c']} ranges={['10', '20', '30']} stops={stops} maxWidth={600} />)
    expect(visibleText(html)).toBe('10 20 30')
  })
})

describe('en papel, la chincheta cuyo nombre no cupo', () => {
  const pin = (badge?: number): string =>
    renderToStaticMarkup(<MapPin x={10} y={10} color="red" title="Corinto" label={null} active={false} state="idle" delay={0} animate={false} run onTap={() => undefined} badge={badge} />)
  it('lleva su número en la cabeza (y sin número, el punto blanco de siempre)', () => {
    expect(pin(2)).toMatch(/<text[^>]*>2<\/text>/)
    expect(pin()).not.toMatch(/<text/)
    expect(pin()).toMatch(/<circle/)
  })
  it('y la lista de debajo dice cuál es', () => {
    const html = renderToStaticMarkup(<PrintedLegend items={[{ title: 'Corinto', pin: { n: 1, color: 'red' } }, { title: 'Atenas', text: 'La polis más poblada' }]} />)
    expect(visibleText(html)).toBe('1 Corinto Atenas La polis más poblada')
  })
})
