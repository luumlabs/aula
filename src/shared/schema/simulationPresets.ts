// Modelos probados para el bloque `simulation` (port de StudyModel/SimulationPresets.swift): la IA escribe
// `"preset": "projectile"` (y, si quiere, cambia rangos, valores o textos) y el modelo pone el resto. Los ángulos de los
// deslizadores van en grados y se pasan a radianes en las fórmulas. Los textos visibles van en español e inglés con `tr`,
// que elige el idioma de la interfaz al construir cada modelo (cada uno es una función: se evalúa en cada llamada).
import { tr } from '@shared/ai/i18n'
import { foldDiacritics } from '@engine/base/ids'
import { makeFormulaItem as F } from './common'
import { makePlotCurve, makePlotLine, makePlotSpec } from './plot'
import { makeSimDerived as D, makeSimObject as O, makeSimParam as P, makeSimTime, makeSimulation, type SimulationBlock } from './visual'

const NAMES = ['projectile', 'pendulum', 'spring', 'wave', 'rc', 'supply-demand', 'population', 'decay', 'pharmacokinetics', 'enzyme'] as const

const ALIASES: Record<string, string> = {
  projectile: 'projectile', 'projectile-motion': 'projectile', 'tiro-parabolico': 'projectile', parabolic: 'projectile', proyectil: 'projectile',
  pendulum: 'pendulum', pendulo: 'pendulum', 'simple-pendulum': 'pendulum', 'pendulo-simple': 'pendulum',
  spring: 'spring', 'mass-spring': 'spring', resorte: 'spring', muelle: 'spring', oscillator: 'spring', harmonic: 'spring', mas: 'spring',
  wave: 'wave', onda: 'wave', 'travelling-wave': 'wave', 'traveling-wave': 'wave',
  rc: 'rc', 'rc-circuit': 'rc', 'circuito-rc': 'rc', capacitor: 'rc', condensador: 'rc',
  'supply-demand': 'supply-demand', 'supply-and-demand': 'supply-demand', 'oferta-demanda': 'supply-demand', 'oferta-y-demanda': 'supply-demand', market: 'supply-demand',
  population: 'population', logistic: 'population', poblacion: 'population', 'population-growth': 'population', 'crecimiento-poblacional': 'population',
  decay: 'decay', 'radioactive-decay': 'decay', 'half-life': 'decay', desintegracion: 'decay', 'vida-media': 'decay',
  pharmacokinetics: 'pharmacokinetics', farmacocinetica: 'pharmacokinetics', pk: 'pharmacokinetics', 'drug-dosing': 'pharmacokinetics', dosis: 'pharmacokinetics',
  enzyme: 'enzyme', 'michaelis-menten': 'enzyme', enzima: 'enzyme', 'enzyme-kinetics': 'enzyme', 'cinetica-enzimatica': 'enzyme'
}

const t = (name: string, min: string, max: string, speed: number, extra: { autoplay?: boolean; label?: string; unit?: string } = {}) =>
  makeSimTime({ name, min, max, speed, loop: true, autoplay: extra.autoplay ?? false, label: extra.label, unit: extra.unit })

/** El rótulo del reloj (el deslizador del tiempo). */
const timeLabel = (): string => tr('Tiempo', 'Time')

function projectile(): SimulationBlock {
  return makeSimulation({
    title: tr('Tiro parabólico', 'Projectile motion'), preset: 'projectile',
    params: [P('v0', tr('Velocidad inicial', 'Initial speed'), 5, 40, 1, 25, 'm/s'), P('theta', tr('Ángulo', 'Launch angle'), 5, 85, 1, 45, '°'),
      P('h0', tr('Altura inicial', 'Initial height'), 0, 30, 1, 0, 'm')],
    constants: [{ name: 'g', value: 9.81, label: tr('Gravedad', 'Gravity'), unit: 'm/s²' }],
    derived: [D('vx', 'v0*cos(theta*pi/180)', { show: false }), D('vy', 'v0*sin(theta*pi/180)', { show: false }),
      D('T', '(vy+sqrt(vy^2+2*g*h0))/g', { label: tr('Tiempo de vuelo', 'Time of flight'), unit: 's', decimals: 2, tex: 'T=\\frac{v_y+\\sqrt{v_y^2+2gh_0}}{g}' }),
      D('R', 'vx*T', { label: tr('Alcance horizontal', 'Horizontal range'), unit: 'm', decimals: 1, tex: 'R=v_x\\,T' }),
      D('H', 'h0+vy^2/(2*g)', { label: tr('Altura máxima', 'Maximum height'), unit: 'm', decimals: 1, tex: 'H=h_0+\\frac{v_y^2}{2g}' })],
    time: t('t', '0', 'T', 1, { label: timeLabel(), unit: 's' }),
    plot: makePlotSpec({ xMin: 0, xMax: 200, yMin: 0, yMax: 120, xLabel: 'x (m)', yLabel: 'y (m)', aspectRatio: 0.55 }),
    objects: [O('path', { x: 'vx*s', y: 'h0+vy*s-g*s^2/2', from: '0', to: 'T', variable: 's', color: 'gray', dashed: true }),
      O('point', { x: 'vx*t', y: 'h0+vy*t-g*t^2/2', color: 'accent', trail: true }),
      O('vector', { x: 'vx*t', y: 'h0+vy*t-g*t^2/2', dx: 'vx*0.9', dy: '(vy-g*t)*0.9', text: '$\\vec v$', color: 'blue' })],
    formulas: [F(tr('Posición horizontal', 'Horizontal position'), 'x=v_0\\cos\\theta\\,t'),
      F(tr('Posición vertical', 'Vertical position'), 'y=h_0+v_0\\sin\\theta\\,t-\\frac{1}{2}gt^2')],
    prompts: [
      tr('Con $h_0=0$, ¿qué ángulo da el mayor alcance?', 'With $h_0=0$, which angle gives the greatest range?'),
      tr('Sube la altura inicial: ¿sigue siendo 45° el mejor ángulo?', 'Raise the initial height: is 45° still the best angle?'),
      tr('¿Por qué 30° y 60° llegan al mismo sitio?', 'Why do 30° and 60° land in the same place?')
    ]
  })
}

function pendulum(): SimulationBlock {
  return makeSimulation({
    title: tr('Péndulo simple', 'Simple pendulum'), preset: 'pendulum',
    params: [P('L', tr('Longitud', 'Length'), 0.2, 3, 0.1, 1.5, 'm'), P('theta0', tr('Amplitud', 'Amplitude'), 2, 40, 1, 20, '°'),
      P('g', tr('Gravedad', 'Gravity'), 1.6, 24.8, 0.1, 9.8, 'm/s²')],
    derived: [D('w', 'sqrt(g/L)', { show: false }), D('T', '2*pi*sqrt(L/g)', { label: tr('Periodo', 'Period'), unit: 's', decimals: 2, tex: 'T=2\\pi\\sqrt{\\frac{L}{g}}' }),
      D('f', '1/T', { label: tr('Frecuencia', 'Frequency'), unit: 'Hz', decimals: 2 }), D('phi', 'theta0*pi/180*cos(w*t)', { show: false })],
    time: t('t', '0', '20', 1, { autoplay: true, label: timeLabel(), unit: 's' }),
    plot: makePlotSpec({ xMin: -2.2, xMax: 2.2, yMin: -3.3, yMax: 0.3, grid: false, axes: false, equalAspect: true, aspectRatio: 0.62 }),
    objects: [O('path', { x: 'L*sin(s)', y: '-L*cos(s)', from: '-theta0*pi/180', to: 'theta0*pi/180', variable: 's', color: 'gray', dashed: true }),
      O('segment', { x1: '-0.4', y1: '0', x2: '0.4', y2: '0', color: 'ink' }),
      O('segment', { x1: '0', y1: '0', x2: 'L*sin(phi)', y2: '-L*cos(phi)', color: 'ink' }),
      O('point', { x: 'L*sin(phi)', y: '-L*cos(phi)', color: 'accent' })],
    formulas: [F(tr('Periodo (oscilaciones pequeñas)', 'Period (small oscillations)'), 'T=2\\pi\\sqrt{\\frac{L}{g}}'),
      F(tr('Ángulo', 'Angle'), '\\theta(t)=\\theta_0\\cos(\\omega t),\\quad \\omega=\\sqrt{\\frac{g}{L}}')],
    prompts: [
      tr('Cambia la amplitud: ¿cambia el periodo?', 'Change the amplitude: does the period change?'),
      tr('¿Qué longitud tendría un péndulo que tarda 2 s en ir y volver?', 'How long would a pendulum be if it takes 2 s to swing there and back?'),
      tr('Pon la gravedad de la Luna (1,6 m/s²): ¿qué le pasa al periodo?', 'Set the Moon’s gravity (1.6 m/s²): what happens to the period?')
    ]
  })
}

function spring(): SimulationBlock {
  return makeSimulation({
    title: tr('Oscilador masa-resorte', 'Mass–spring oscillator'), preset: 'spring',
    params: [P('k', tr('Constante del resorte', 'Spring constant'), 1, 50, 1, 10, 'N/m'), P('m', tr('Masa', 'Mass'), 0.1, 5, 0.1, 1, 'kg'),
      P('A', tr('Amplitud', 'Amplitude'), 0.1, 1, 0.05, 0.6, 'm')],
    derived: [D('w', 'sqrt(k/m)', { label: tr('Frecuencia angular', 'Angular frequency'), unit: 'rad/s', decimals: 2, tex: '\\omega=\\sqrt{\\frac{k}{m}}' }),
      D('T', '2*pi/w', { label: tr('Periodo', 'Period'), unit: 's', decimals: 2 }),
      D('E', 'k*A^2/2', { label: tr('Energía mecánica', 'Mechanical energy'), unit: 'J', decimals: 2, tex: 'E=\\frac{1}{2}kA^2' })],
    time: t('t', '0', '10', 1, { label: timeLabel(), unit: 's' }),
    plot: makePlotSpec({ xMin: 0, xMax: 10, yMin: -1.2, yMax: 1.2, xLabel: 't (s)', yLabel: 'x (m)', curves: [makePlotCurve({ expr: 'A*cos(w*x)', label: 'x(t)', color: 'accent' })], aspectRatio: 0.5 }),
    objects: [O('segment', { x1: 't', y1: '-1.2', x2: 't', y2: '1.2', color: 'gray', dashed: true }), O('point', { x: 't', y: 'A*cos(w*t)', color: 'accent' })],
    formulas: [F(tr('Posición', 'Position'), 'x(t)=A\\cos(\\omega t)')],
    prompts: [
      tr('Duplica la masa: ¿cuánto cambia el periodo?', 'Double the mass: how much does the period change?'),
      tr('¿Depende el periodo de la amplitud?', 'Does the period depend on the amplitude?')
    ]
  })
}

function wave(): SimulationBlock {
  return makeSimulation({
    title: tr('Onda viajera', 'Travelling wave'), preset: 'wave',
    params: [P('A', tr('Amplitud', 'Amplitude'), 0.2, 2, 0.1, 1, 'm'), P('lambda', tr('Longitud de onda', 'Wavelength'), 1, 8, 0.5, 4, 'm'),
      P('f', tr('Frecuencia', 'Frequency'), 0.1, 2, 0.1, 0.5, 'Hz')],
    derived: [D('v', 'lambda*f', { label: tr('Velocidad de la onda', 'Wave speed'), unit: 'm/s', decimals: 2, tex: 'v=\\lambda f' }),
      D('T', '1/f', { label: tr('Periodo', 'Period'), unit: 's', decimals: 2 })],
    time: t('t', '0', '20', 1, { autoplay: true, label: timeLabel(), unit: 's' }),
    plot: makePlotSpec({ xMin: 0, xMax: 10, yMin: -2.2, yMax: 2.2, xLabel: 'x (m)', yLabel: 'y (m)', curves: [makePlotCurve({ expr: 'A*sin(2*pi*(x/lambda-f*t))', label: 'y(x, t)', color: 'blue' })], aspectRatio: 0.45 }),
    objects: [O('point', { x: '2', y: 'A*sin(2*pi*(2/lambda-f*t))', color: 'accent' })],
    formulas: [F(tr('Onda armónica', 'Harmonic wave'), 'y(x,t)=A\\sin\\left(2\\pi\\left(\\frac{x}{\\lambda}-ft\\right)\\right)')],
    prompts: [
      tr('El punto rojo, ¿avanza con la onda o solo sube y baja?', 'Does the red dot travel with the wave, or does it just move up and down?'),
      tr('Duplica la frecuencia: ¿qué le pasa a la velocidad si no cambias $\\lambda$?', 'Double the frequency: what happens to the speed if you keep $\\lambda$ the same?')
    ]
  })
}

function rc(): SimulationBlock {
  return makeSimulation({
    title: tr('Carga de un condensador (circuito RC)', 'Charging a capacitor (RC circuit)'), preset: 'rc',
    params: [P('V0', tr('Tensión de la fuente', 'Source voltage'), 1, 12, 0.5, 9, 'V'), P('R', tr('Resistencia', 'Resistance'), 1, 50, 1, 10, 'kΩ'),
      P('C', tr('Capacidad', 'Capacitance'), 10, 500, 10, 200, 'µF')],
    derived: [D('tau', 'R*C/1000', { label: tr('Constante de tiempo τ', 'Time constant τ'), unit: 's', decimals: 2, tex: '\\tau=RC' }),
      D('Vc', 'V0*(1-exp(-t/tau))', { label: tr('Tensión del condensador ahora', 'Capacitor voltage now'), unit: 'V', decimals: 2 }),
      D('I', 'V0/R*exp(-t/tau)', { label: tr('Corriente ahora', 'Current now'), unit: 'mA', decimals: 3 })],
    time: t('t', '0', '20', 2, { label: timeLabel(), unit: 's' }),
    plot: makePlotSpec({
      xMin: 0, xMax: 20, yMin: 0, yMax: 13, xLabel: 't (s)', yLabel: 'V_C (V)', curves: [makePlotCurve({ expr: 'V0*(1-exp(-x/tau))', label: 'V_C(t)', color: 'teal' })],
      lines: [makePlotLine({ kind: 'horizontal', y: 'V0', label: 'V₀', color: 'gray', dashed: true }), makePlotLine({ kind: 'vertical', x: 'tau', label: 'τ', color: 'gray', dashed: true })], aspectRatio: 0.5
    }),
    objects: [O('point', { x: 't', y: 'Vc', color: 'accent' })],
    formulas: [F(tr('Carga', 'Charging'), 'V_C(t)=V_0\\left(1-e^{-t/\\tau}\\right)'), F(tr('Corriente', 'Current'), 'I(t)=\\frac{V_0}{R}e^{-t/\\tau}')],
    prompts: [
      tr('¿Qué porcentaje de $V_0$ alcanza el condensador al cabo de $\\tau$?', 'What percentage of $V_0$ does the capacitor reach after a time $\\tau$?'),
      tr('¿Cuántas constantes de tiempo hacen falta para que esté «casi lleno» (99 %)?', 'How many time constants does it take to be “almost full” (99%)?')
    ]
  })
}

function supplyDemand(): SimulationBlock {
  return makeSimulation({
    title: tr('Oferta y demanda', 'Supply and demand'), preset: 'supply-demand',
    params: [P('a', tr('Demanda a precio 0', 'Demand at price 0'), 60, 150, 5, 120), P('b', tr('Sensibilidad de la demanda', 'Demand sensitivity'), 0.5, 4, 0.1, 2),
      P('c', tr('Oferta a precio 0', 'Supply at price 0'), -20, 40, 5, 0), P('d', tr('Sensibilidad de la oferta', 'Supply sensitivity'), 0.5, 4, 0.1, 1.5),
      P('tax', tr('Impuesto por unidad', 'Tax per unit'), 0, 20, 1, 0)],
    derived: [D('P', '(a-c+d*tax)/(b+d)', { label: tr('Precio de equilibrio', 'Equilibrium price'), decimals: 2, tex: 'P^*=\\frac{a-c+d\\,t}{b+d}' }),
      D('Q', 'a-b*P', { label: tr('Cantidad de equilibrio', 'Equilibrium quantity'), decimals: 1, tex: 'Q^*=a-bP^*' }),
      D('CS', 'Q*(a/b-P)/2', { label: tr('Excedente del consumidor', 'Consumer surplus'), decimals: 1 })],
    plot: makePlotSpec({
      xMin: 0, xMax: 160, yMin: 0, yMax: 90, xLabel: tr('Cantidad (Q)', 'Quantity (Q)'), yLabel: tr('Precio (P)', 'Price (P)'),
      curves: [makePlotCurve({ expr: '(a-x)/b', label: tr('Demanda', 'Demand'), color: 'blue' }), makePlotCurve({ expr: '(x-c)/d+tax', label: tr('Oferta', 'Supply'), color: 'orange' })],
      aspectRatio: 0.6
    }),
    objects: [O('segment', { x1: '0', y1: 'P', x2: 'Q', y2: 'P', color: 'gray', dashed: true }), O('segment', { x1: 'Q', y1: '0', x2: 'Q', y2: 'P', color: 'gray', dashed: true }),
      O('point', { x: 'Q', y: 'P', text: 'E', color: 'accent' })],
    formulas: [F(tr('Demanda', 'Demand'), 'Q_d=a-bP'), F(tr('Oferta con impuesto t', 'Supply with tax t'), 'Q_s=c+d\\,(P-t)')],
    prompts: [
      tr('Sube el impuesto: ¿quién paga más, el comprador o el vendedor?', 'Raise the tax: who pays more, the buyer or the seller?'),
      tr('Haz la demanda más sensible al precio (sube $b$): ¿qué pasa con el equilibrio?', 'Make demand more sensitive to price (raise $b$): what happens to the equilibrium?')
    ]
  })
}

function population(): SimulationBlock {
  const years = tr('años', 'years')
  return makeSimulation({
    title: tr('Crecimiento de una población', 'Population growth'), preset: 'population',
    params: [P('N0', tr('Población inicial', 'Initial population'), 1, 100, 1, 10), P('r', tr('Tasa de crecimiento', 'Growth rate'), 0.05, 1.5, 0.05, 0.5, tr('por año', 'per year')),
      P('K', tr('Capacidad de carga', 'Carrying capacity'), 100, 1000, 50, 600)],
    derived: [D('N', 'K/(1+((K-N0)/N0)*exp(-r*t))', { label: tr('Población ahora', 'Population now'), decimals: 0 }),
      D('ti', 'ln((K-N0)/N0)/r', { label: tr('Crecimiento más rápido en t =', 'Fastest growth at t ='), unit: years, decimals: 1 })],
    time: t('t', '0', '30', 3, { label: timeLabel(), unit: years }),
    plot: makePlotSpec({
      xMin: 0, xMax: 30, yMin: 0, yMax: 1100, xLabel: tr('t (años)', 't (years)'), yLabel: tr('N (individuos)', 'N (individuals)'),
      curves: [makePlotCurve({ expr: 'K/(1+((K-N0)/N0)*exp(-r*x))', label: tr('Logístico', 'Logistic'), color: 'green' }),
        makePlotCurve({ expr: 'N0*exp(r*x)', label: tr('Exponencial', 'Exponential'), color: 'gray', dashed: true })],
      lines: [makePlotLine({ kind: 'horizontal', y: 'K', label: 'K', color: 'green', dashed: true })], aspectRatio: 0.55
    }),
    objects: [O('point', { x: 't', y: 'N', color: 'accent' })],
    formulas: [F(tr('Modelo logístico', 'Logistic model'), '\\frac{dN}{dt}=rN\\left(1-\\frac{N}{K}\\right)'), F(tr('Solución', 'Solution'), 'N(t)=\\frac{K}{1+\\frac{K-N_0}{N_0}e^{-rt}}')],
    prompts: [
      tr('¿Cuándo se parecen el modelo exponencial y el logístico, y cuándo se separan?', 'When do the exponential and logistic models look alike, and when do they pull apart?'),
      tr('¿A qué población crece más deprisa? Compárala con $K/2$.', 'At what population does it grow fastest? Compare it with $K/2$.')
    ]
  })
}

function decay(): SimulationBlock {
  return makeSimulation({
    title: tr('Desintegración radiactiva', 'Radioactive decay'), preset: 'decay',
    params: [P('N0', tr('Núcleos iniciales', 'Initial nuclei'), 100, 1000, 50, 1000), P('T12', tr('Vida media', 'Half-life'), 1, 20, 0.5, 5)],
    derived: [D('lambda', 'ln(2)/T12', { label: tr('Constante de desintegración', 'Decay constant'), decimals: 3, tex: '\\lambda=\\frac{\\ln 2}{T_{1/2}}' }),
      D('N', 'N0*0.5^(t/T12)', { label: tr('Núcleos que quedan', 'Nuclei remaining'), decimals: 0 })],
    time: t('t', '0', '50', 3, { label: timeLabel() }),
    plot: makePlotSpec({
      xMin: 0, xMax: 50, yMin: 0, yMax: 1100, xLabel: 't', yLabel: tr('N (núcleos)', 'N (nuclei)'), curves: [makePlotCurve({ expr: 'N0*0.5^(x/T12)', label: 'N(t)', color: 'purple' })],
      lines: [makePlotLine({ kind: 'horizontal', y: 'N0/2', label: 'N₀/2', color: 'gray', dashed: true }), makePlotLine({ kind: 'vertical', x: 'T12', label: 'T½', color: 'gray', dashed: true })], aspectRatio: 0.5
    }),
    objects: [O('point', { x: 't', y: 'N', color: 'accent' })],
    formulas: [F(tr('Ley de desintegración', 'Decay law'), 'N(t)=N_0\\left(\\frac{1}{2}\\right)^{t/T_{1/2}}=N_0e^{-\\lambda t}')],
    prompts: [
      tr('¿Cuántos núcleos quedan tras 3 vidas medias?', 'How many nuclei are left after 3 half-lives?'),
      tr('¿Llega a cero alguna vez?', 'Does it ever reach zero?')
    ]
  })
}

function pharmacokinetics(): SimulationBlock {
  const conc = '(D/Vd)*exp(-k*(x-tau*floor(x/tau)))*(1-exp(-k*tau*(floor(x/tau)+1)))/(1-exp(-k*tau))'
  const concNow = '(D/Vd)*exp(-k*(t-tau*floor(t/tau)))*(1-exp(-k*tau*(floor(t/tau)+1)))/(1-exp(-k*tau))'
  return makeSimulation({
    title: tr('Dosis repetidas de un fármaco', 'Repeated drug doses'),
    intro: tr('Modelo de un compartimento con dosis intravenosas en bolo cada τ horas.', 'One-compartment model with intravenous bolus doses every τ hours.'),
    preset: 'pharmacokinetics',
    params: [P('D', tr('Dosis', 'Dose'), 100, 1000, 50, 500, 'mg'), P('Vd', tr('Volumen de distribución', 'Volume of distribution'), 20, 100, 5, 40, 'L'),
      P('t12', tr('Vida media', 'Half-life'), 2, 12, 0.5, 6, 'h'), P('tau', tr('Intervalo entre dosis', 'Dosing interval'), 4, 24, 1, 8, 'h')],
    constants: [{ name: 'MEC', value: 10, label: tr('Concentración mínima eficaz', 'Minimum effective concentration'), unit: 'mg/L' },
      { name: 'MTC', value: 40, label: tr('Concentración tóxica', 'Toxic concentration'), unit: 'mg/L' }],
    derived: [D('k', 'ln(2)/t12', { label: tr('Constante de eliminación', 'Elimination rate constant'), unit: '1/h', decimals: 3, tex: 'k=\\frac{\\ln 2}{t_{1/2}}' }),
      D('C0', 'D/Vd', { label: tr('Concentración tras la 1.ª dosis', 'Concentration after the 1st dose'), unit: 'mg/L', decimals: 1, tex: 'C_0=\\frac{D}{V_d}' }),
      D('Cmax', 'C0/(1-exp(-k*tau))', { label: tr('Pico en estado estacionario', 'Steady-state peak'), unit: 'mg/L', decimals: 1, tex: 'C_{\\max}^{ss}=\\frac{C_0}{1-e^{-k\\tau}}' }),
      D('Cmin', 'Cmax*exp(-k*tau)', { label: tr('Valle en estado estacionario', 'Steady-state trough'), unit: 'mg/L', decimals: 1 })],
    time: t('t', '0', '72', 6, { label: timeLabel(), unit: 'h' }),
    plot: makePlotSpec({
      xMin: 0, xMax: 72, yMin: 0, xLabel: 't (h)', yLabel: tr('Concentración (mg/L)', 'Concentration (mg/L)'), curves: [makePlotCurve({ expr: conc, label: 'C(t)', color: 'teal' })],
      lines: [makePlotLine({ kind: 'horizontal', y: 'MEC', label: tr('Mínima eficaz', 'Minimum effective'), color: 'green', dashed: true }),
        makePlotLine({ kind: 'horizontal', y: 'MTC', label: tr('Tóxica', 'Toxic'), color: 'red', dashed: true })], aspectRatio: 0.55
    }),
    objects: [O('point', { x: 't', y: concNow, color: 'accent' })],
    formulas: [F(tr('Una dosis', 'Single dose'), 'C(t)=\\frac{D}{V_d}e^{-kt}'), F(tr('Acumulación', 'Accumulation'), 'R=\\frac{1}{1-e^{-k\\tau}}')],
    prompts: [
      tr('¿Cuántas dosis hacen falta para llegar al estado estacionario? (unas 4–5 vidas medias)', 'How many doses does it take to reach steady state? (about 4–5 half-lives)'),
      tr('Ajusta la dosis y el intervalo para quedarte siempre entre las dos líneas.', 'Adjust the dose and the interval so you always stay between the two lines.')
    ]
  })
}

function enzyme(): SimulationBlock {
  return makeSimulation({
    title: tr('Cinética de Michaelis-Menten', 'Michaelis–Menten kinetics'), preset: 'enzyme',
    params: [P('Vmax', tr('Velocidad máxima', 'Maximum velocity'), 10, 100, 5, 80, 'µmol/min'), P('Km', tr('Constante de Michaelis', 'Michaelis constant'), 0.5, 20, 0.5, 5, 'mM'),
      P('I', tr('Inhibidor competitivo', 'Competitive inhibitor'), 0, 20, 1, 0, 'mM')],
    constants: [{ name: 'Ki', value: 2, label: tr('Constante del inhibidor', 'Inhibition constant'), unit: 'mM' }],
    // «ap» de aparente; en inglés, «app» (apparent)
    derived: [D('Kapp', 'Km*(1+I/Ki)', { label: tr('Km aparente', 'Apparent Km'), unit: 'mM', decimals: 1, tex: tr('K_m^{ap}', 'K_m^{app}') + '=K_m\\left(1+\\frac{[I]}{K_i}\\right)' })],
    plot: makePlotSpec({
      xMin: 0, xMax: 50, yMin: 0, yMax: 110, xLabel: '[S] (mM)', yLabel: 'v (µmol/min)',
      curves: [makePlotCurve({ expr: 'Vmax*x/(Km+x)', label: tr('Sin inhibidor', 'No inhibitor'), color: 'gray', dashed: true }),
        makePlotCurve({ expr: 'Vmax*x/(Kapp+x)', label: tr('Con inhibidor', 'With inhibitor'), color: 'purple' })],
      lines: [makePlotLine({ kind: 'horizontal', y: 'Vmax', label: 'Vmax', color: 'gray', dashed: true }), makePlotLine({ kind: 'horizontal', y: 'Vmax/2', label: 'Vmax/2', color: 'gray', dashed: true })], aspectRatio: 0.55
    }),
    objects: [O('point', { x: 'Kapp', y: 'Vmax/2', text: '$K_m$', color: 'accent' }), O('segment', { x1: 'Kapp', y1: '0', x2: 'Kapp', y2: 'Vmax/2', color: 'accent', dashed: true })],
    formulas: [F(tr('Ecuación de Michaelis-Menten', 'Michaelis–Menten equation'), 'v=\\frac{V_{\\max}[S]}{K_m+[S]}')],
    prompts: [
      tr('Añade inhibidor competitivo: ¿cambia $V_{\\max}$ o $K_m$?', 'Add a competitive inhibitor: does $V_{\\max}$ or $K_m$ change?'),
      tr('¿Qué significa una $K_m$ pequeña sobre la afinidad de la enzima?', 'What does a small $K_m$ tell you about the enzyme’s affinity?')
    ]
  })
}

const MAKERS: Record<string, () => SimulationBlock> = {
  projectile, pendulum, spring, wave, rc, 'supply-demand': supplyDemand, population, decay, pharmacokinetics, enzyme
}

export const SimulationPresets = {
  names: NAMES as readonly string[],
  /** Nombre canónico («tiro parabólico», "Projectile Motion" → "projectile"). */
  canonical(raw: string): string {
    const t = foldDiacritics(raw.toLowerCase()).replace(/_/g, '-').replace(/ /g, '-')
    return ALIASES[t] ?? t
  },
  /** El modelo de la biblioteca (nuevo cada vez), o undefined si no existe. */
  make(name: string): SimulationBlock | undefined {
    return MAKERS[SimulationPresets.canonical(name)]?.()
  }
}
