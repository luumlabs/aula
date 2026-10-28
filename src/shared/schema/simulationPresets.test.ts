// Los modelos de simulación siguen el idioma de la interfaz: en inglés no queda ningún texto visible en español.
import { afterEach, describe, expect, it } from 'vitest'
import { setAILocale } from '@shared/ai/i18n'
import { SimulationPresets } from './simulationPresets'
import type { SimulationBlock } from './visual'

/** Todo lo que se ve escrito en la simulación (rótulos, unidades, ejes, leyendas, fórmulas y preguntas). */
function visibleTexts(s: SimulationBlock): string[] {
  const p = s.plot
  const all = [
    s.title, s.intro, s.caption, ...s.prompts,
    ...s.params.flatMap((x) => [x.label, x.unit]), ...s.constants.flatMap((x) => [x.label, x.unit]),
    ...s.derived.flatMap((x) => [x.label, x.unit]), s.time?.label, s.time?.unit,
    p.title, p.xLabel, p.yLabel, p.caption, ...p.curves.map((x) => x.label), ...p.lines.map((x) => x.label), ...p.points.map((x) => x.label),
    ...p.parametric.map((x) => x.label), ...p.polar.map((x) => x.label), ...p.regions.map((x) => x.label), ...p.labels.map((x) => x.tex),
    ...s.objects.map((x) => x.text), ...s.formulas.flatMap((x) => [x.name, x.when, ...x.vars.map((v) => v.meaning)])
  ]
  return all.filter((x): x is string => typeof x === 'string' && x.length > 0)
}

const SPANISH_CHARS = /[áéíóúñ¿¡«»]/i
const SPANISH_WORDS = /\b(tiempo|velocidad|altura|longitud|amplitud|gravedad|periodo|frecuencia|masa|tensión|corriente|resistencia|capacidad|oferta|demanda|precio|cantidad|población|años|año|dosis|núcleos|concentración|constante|inhibidor|de|del|la|el|los|las|con|sin|por|que|qué)\b/i

describe('SimulationPresets en inglés', () => {
  afterEach(() => setAILocale('es'))

  it('ningún texto visible queda en español', () => {
    setAILocale('en')
    for (const name of SimulationPresets.names) {
      const s = SimulationPresets.make(name)!
      for (const text of visibleTexts(s)) {
        expect(SPANISH_CHARS.test(text), `${name}: «${text}»`).toBe(false)
        expect(SPANISH_WORDS.test(text), `${name}: «${text}»`).toBe(false)
      }
      // también las fórmulas en TeX (sin palabras: solo letras con tilde)
      for (const tex of [...s.derived.map((d) => d.tex), ...s.formulas.map((f) => f.tex)]) if (tex) expect(SPANISH_CHARS.test(tex), `${name}: ${tex}`).toBe(false)
      if (s.time) expect(s.time.label, name).toBe('Time')
    }
  })

  it('se construyen al pedirlos: el idioma vale en cada llamada', () => {
    setAILocale('en')
    expect(SimulationPresets.make('projectile')!.title).toBe('Projectile motion')
    expect(SimulationPresets.make('rc')!.prompts[1]).toBe('How many time constants does it take to be “almost full” (99%)?')
    setAILocale('es')
    const p = SimulationPresets.make('projectile')!
    expect(p.title).toBe('Tiro parabólico')
    expect(p.time?.label).toBe('Tiempo')
  })
})
