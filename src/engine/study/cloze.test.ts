// Tarjetas cloze con huecos dentro de fórmulas: «**[…]**» dentro de \ce{…} salía como puntos (tarjeta ajr-c4 del curso de
// estequiometría del juez). Dentro de una fórmula el hueco es TeX y KaTeX (con mhchem) lo dibuja.
import { describe, expect, it } from 'vitest'
import { latexIssues } from '@engine/content/tex'
import { renderCloze } from './cloze'

const AJR_C4 = 'Combustión del propano ajustada: $\\ce{C3H8 + {{c1::5}}O2 -> {{c2::3}}CO2 + {{c3::4}}H2O}$'

describe('renderCloze', () => {
  it('fuera de las fórmulas, Markdown como siempre', () => {
    expect(renderCloze('La {{c1::mitocondria}} produce ATP.', false)).toBe('La **[…]** produce ATP.')
    expect(renderCloze('La {{c1::mitocondria}} produce ATP.', true)).toBe('La **mitocondria** produce ATP.')
    expect(renderCloze('La derivada de $x^2$ es {{c1::$2x$}}.', true)).toBe('La derivada de $x^2$ es **$2x$**.')
    expect(renderCloze('{{c1::A::pista}} y {{c2::B}}', false)).toBe('**[…]** y **[…]**')
    expect(renderCloze('{{c1}} … ::', false)).toBe('{{c1}} … ::')
  })

  it('dentro de \\ce, un recuadro de TeX (y la respuesta con su fórmula química)', () => {
    expect(renderCloze(AJR_C4, false)).toBe('Combustión del propano ajustada: $\\ce{C3H8 + {\\boxed{\\,?\\,}}O2 -> {\\boxed{\\,?\\,}}CO2 + {\\boxed{\\,?\\,}}H2O}$')
    expect(renderCloze(AJR_C4, true)).toBe('Combustión del propano ajustada: $\\ce{C3H8 + {\\boxed{\\ce{5}}}O2 -> {\\boxed{\\ce{3}}}CO2 + {\\boxed{\\ce{4}}}H2O}$')
    expect(renderCloze('$\\ce{2H2 + O2 -> 2{{c1::H2O}}}$', true)).toBe('$\\ce{2H2 + O2 -> 2{\\boxed{\\ce{H2O}}}}$')
  })

  it('en una fórmula normal, \\boxed; las llaves de la respuesta no cortan el hueco', () => {
    expect(renderCloze('$E = {{c1::mc^2}}$', false)).toBe('$E = {\\boxed{\\,?\\,}}$')
    expect(renderCloze('$E = {{c1::mc^2}}$', true)).toBe('$E = {\\boxed{mc^2}}$')
    expect(renderCloze('$$\\sin 30^\\circ = {{c1::\\frac{1}{2}}}$$', true)).toBe('$$\\sin 30^\\circ = {\\boxed{\\frac{1}{2}}}$$')
    expect(renderCloze('\\(v = {{c1::d/t}}\\) y {{c2::km/h}}', false)).toBe('\\(v = {\\boxed{\\,?\\,}}\\) y **[…]**')
    // tras cerrar el \ce, lo que sigue en la fórmula ya no es química
    expect(renderCloze('$\\ce{H2O} + {{c1::x}}$', true)).toBe('$\\ce{H2O} + {\\boxed{x}}$')
  })

  it('un «$» de dinero no abre fórmula', () => {
    expect(renderCloze('Cuesta US$ 5 y el {{c1::IVA}} va aparte.', false)).toBe('Cuesta US$ 5 y el **[…]** va aparte.')
  })

  it('KaTeX dibuja la tarjeta con el hueco oculto y resuelto', () => {
    for (const front of [AJR_C4, '$E = {{c1::mc^2}}$', '$x^{{c1::2}}$', '$a_{{c1::n}}$', '$$\\sin 30^\\circ = {{c1::\\frac{1}{2}}}$$', '$\\ce{Fe^{ {{c1::3+}} }}$', '$\\ce{2H2 + O2 -> 2{{c1::H2O}}}$']) {
      for (const revealed of [false, true]) expect(latexIssues(renderCloze(front, revealed), 'front'), `${front} ${revealed}`).toEqual([])
    }
  })
})
