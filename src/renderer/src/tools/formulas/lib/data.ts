// Hoja de fórmulas y constantes (contenido bilingüe: es la «chuleta» de la herramienta, no texto de la interfaz).
// Constantes: valores CODATA 2018 (los del SI de 2019 son exactos).

export type Subject = 'math' | 'physics' | 'chemistry'
export interface L10n {
  es: string
  en: string
}

export interface FormulaEntry {
  id: string
  subject: Subject
  topic: L10n
  name: L10n
  /** La fórmula en LaTeX. Bilingüe cuando lleva palabras o la notación cambia con el idioma (E_c en español, KE en inglés). */
  tex: string | L10n
  /** Cuándo se usa. */
  when: L10n
  /** Qué es cada letra (LaTeX en línea con $…$ no; texto plano con símbolos Unicode). */
  vars?: L10n
}

export interface Constant {
  id: string
  symbol: string
  name: L10n
  /** Valor en LaTeX (con \times10^{}). */
  value: string
  unit: string
  exact?: boolean
}

const T = (es: string, en: string): L10n => ({ es, en })

/** La fórmula en el idioma de la interfaz (A4-P1-2: «casos favorables» u «op/hip» no van en la hoja en inglés). */
export function texOf(f: Pick<FormulaEntry, 'tex'>, lang: keyof L10n): string {
  return typeof f.tex === 'string' ? f.tex : f.tex[lang]
}

const ALG = T('Álgebra', 'Algebra')
const GEO = T('Geometría', 'Geometry')
const TRIG = T('Trigonometría', 'Trigonometry')
const CALC = T('Cálculo', 'Calculus')
const PROB = T('Probabilidad y estadística', 'Probability and statistics')
const KIN = T('Cinemática', 'Kinematics')
const DYN = T('Dinámica', 'Dynamics')
const ENE = T('Trabajo y energía', 'Work and energy')
const OSC = T('Oscilaciones y ondas', 'Oscillations and waves')
const ELEC = T('Electricidad y magnetismo', 'Electricity and magnetism')
const THERMO = T('Termodinámica', 'Thermodynamics')
const MOD = T('Física moderna', 'Modern physics')
const STO = T('Mol y estequiometría', 'Moles and stoichiometry')
const GAS = T('Gases', 'Gases')
const SOL = T('Disoluciones', 'Solutions')
const TCH = T('Termoquímica y equilibrio', 'Thermochemistry and equilibrium')
const AB = T('Ácidos y bases', 'Acids and bases')
const ECH = T('Electroquímica y cinética', 'Electrochemistry and kinetics')

export const FORMULAS: FormulaEntry[] = [
  // MARK: Matemáticas
  { id: 'quadratic', subject: 'math', topic: ALG, name: T('Ecuación de segundo grado', 'Quadratic formula'), tex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', when: T('Para resolver ax² + bx + c = 0. El discriminante b² − 4ac dice cuántas soluciones reales hay.', 'To solve ax² + bx + c = 0. The discriminant b² − 4ac tells how many real solutions there are.') },
  { id: 'vieta', subject: 'math', topic: ALG, name: T('Suma y producto de raíces', 'Sum and product of roots'), tex: 'x_1 + x_2 = -\\frac{b}{a} \\qquad x_1 x_2 = \\frac{c}{a}', when: T('Para comprobar soluciones o construir una ecuación conociendo sus raíces.', 'To check solutions or build an equation from its roots.') },
  { id: 'binomial', subject: 'math', topic: ALG, name: T('Binomio de Newton', 'Binomial theorem'), tex: '(a+b)^n = \\sum_{k=0}^{n} \\binom{n}{k} a^{n-k} b^{k}', when: T('Para desarrollar potencias de una suma sin multiplicar a mano.', 'To expand powers of a sum without multiplying by hand.') },
  { id: 'logs', subject: 'math', topic: ALG, name: T('Propiedades de los logaritmos', 'Logarithm rules'), tex: '\\log_b(xy) = \\log_b x + \\log_b y \\qquad \\log_b x^n = n\\log_b x \\qquad \\log_b x = \\frac{\\ln x}{\\ln b}', when: T('Para despejar exponentes y cambiar de base.', 'To solve for exponents and change bases.') },
  { id: 'arith', subject: 'math', topic: ALG, name: T('Progresión aritmética', 'Arithmetic sequence'), tex: 'a_n = a_1 + (n-1)d \\qquad S_n = \\frac{n(a_1 + a_n)}{2}', when: T('Cuando cada término se obtiene sumando la misma diferencia d.', 'When each term adds the same difference d.') },
  { id: 'geomseq', subject: 'math', topic: ALG, name: T('Progresión geométrica', 'Geometric sequence'), tex: 'a_n = a_1 r^{n-1} \\qquad S_n = a_1\\frac{1 - r^n}{1 - r}', when: T('Cuando cada término se multiplica por la misma razón r (interés compuesto, crecimiento).', 'When each term is multiplied by the same ratio r (compound interest, growth).') },
  { id: 'pythagoras', subject: 'math', topic: GEO, name: T('Teorema de Pitágoras', 'Pythagorean theorem'), tex: 'a^2 + b^2 = c^2', when: T('En triángulos rectángulos: relaciona los catetos con la hipotenusa.', 'In right triangles: relates the legs to the hypotenuse.') },
  { id: 'distance', subject: 'math', topic: GEO, name: T('Distancia entre dos puntos', 'Distance between two points'), tex: 'd = \\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}', when: T('Para medir segmentos en el plano a partir de sus coordenadas.', 'To measure segments in the plane from their coordinates.') },
  { id: 'line', subject: 'math', topic: GEO, name: T('Recta: pendiente y punto', 'Line: point-slope form'), tex: 'y - y_1 = m(x - x_1) \\qquad m = \\frac{y_2 - y_1}{x_2 - x_1}', when: T('Para escribir la recta que pasa por dos puntos o por un punto con una pendiente.', 'To write the line through two points, or through a point with a given slope.') },
  { id: 'circlearea', subject: 'math', topic: GEO, name: T('Círculo', 'Circle'), tex: T('A = \\pi r^2 \\qquad L = 2\\pi r', 'A = \\pi r^2 \\qquad C = 2\\pi r'), when: T('Área y longitud de la circunferencia de radio r.', 'Area and circumference for radius r.') },
  { id: 'sphere', subject: 'math', topic: GEO, name: T('Esfera', 'Sphere'), tex: 'V = \\tfrac{4}{3}\\pi r^3 \\qquad A = 4\\pi r^2', when: T('Volumen y superficie de una esfera.', 'Volume and surface area of a sphere.') },
  { id: 'cylcone', subject: 'math', topic: GEO, name: T('Cilindro y cono', 'Cylinder and cone'), tex: T('V_{\\text{cil}} = \\pi r^2 h \\qquad V_{\\text{cono}} = \\tfrac{1}{3}\\pi r^2 h', 'V_{\\text{cyl}} = \\pi r^2 h \\qquad V_{\\text{cone}} = \\tfrac{1}{3}\\pi r^2 h'), when: T('Volúmenes de cuerpos de revolución; el cono es un tercio del cilindro.', 'Volumes of solids of revolution; a cone is a third of the cylinder.') },
  { id: 'sohcahtoa', subject: 'math', topic: TRIG, name: T('Razones trigonométricas', 'Trigonometric ratios'), tex: T('\\sin\\alpha = \\frac{\\text{op}}{\\text{hip}} \\quad \\cos\\alpha = \\frac{\\text{cont}}{\\text{hip}} \\quad \\tan\\alpha = \\frac{\\text{op}}{\\text{cont}}', '\\sin\\alpha = \\frac{\\text{opp}}{\\text{hyp}} \\quad \\cos\\alpha = \\frac{\\text{adj}}{\\text{hyp}} \\quad \\tan\\alpha = \\frac{\\text{opp}}{\\text{adj}}'), when: T('En un triángulo rectángulo, para pasar de ángulos a lados y al revés.', 'In a right triangle, to go from angles to sides and back.') },
  { id: 'pythid', subject: 'math', topic: TRIG, name: T('Identidad fundamental', 'Pythagorean identity'), tex: '\\sin^2\\alpha + \\cos^2\\alpha = 1', when: T('Para obtener el seno conociendo el coseno (o al revés) y simplificar.', 'To get the sine from the cosine (or vice versa) and simplify.') },
  { id: 'lawsines', subject: 'math', topic: TRIG, name: T('Teorema del seno', 'Law of sines'), tex: '\\frac{a}{\\sin A} = \\frac{b}{\\sin B} = \\frac{c}{\\sin C} = 2R', when: T('En cualquier triángulo cuando conoces un lado y su ángulo opuesto.', 'In any triangle when you know a side and its opposite angle.') },
  { id: 'lawcos', subject: 'math', topic: TRIG, name: T('Teorema del coseno', 'Law of cosines'), tex: 'a^2 = b^2 + c^2 - 2bc\\cos A', when: T('Con tres lados, o con dos lados y el ángulo que forman.', 'With three sides, or two sides and the angle between them.') },
  { id: 'addition', subject: 'math', topic: TRIG, name: T('Seno y coseno de una suma', 'Sum formulas'), tex: '\\sin(\\alpha\\pm\\beta) = \\sin\\alpha\\cos\\beta \\pm \\cos\\alpha\\sin\\beta \\\\ \\cos(\\alpha\\pm\\beta) = \\cos\\alpha\\cos\\beta \\mp \\sin\\alpha\\sin\\beta', when: T('Para ángulos que son suma de otros conocidos (75° = 45° + 30°).', 'For angles that are sums of known ones (75° = 45° + 30°).') },
  { id: 'double', subject: 'math', topic: TRIG, name: T('Ángulo doble', 'Double angle'), tex: '\\sin 2\\alpha = 2\\sin\\alpha\\cos\\alpha \\qquad \\cos 2\\alpha = \\cos^2\\alpha - \\sin^2\\alpha', when: T('Para simplificar expresiones y resolver ecuaciones trigonométricas.', 'To simplify expressions and solve trigonometric equations.') },
  { id: 'powerrule', subject: 'math', topic: CALC, name: T('Derivadas básicas', 'Basic derivatives'), tex: '(x^n)\' = n x^{n-1} \\quad (e^x)\' = e^x \\quad (\\ln x)\' = \\tfrac{1}{x} \\quad (\\sin x)\' = \\cos x', when: T('Las piezas con las que se derivan casi todas las funciones.', 'The building blocks for differentiating almost any function.') },
  { id: 'chain', subject: 'math', topic: CALC, name: T('Regla de la cadena', 'Chain rule'), tex: '\\big(f(g(x))\\big)\' = f\'(g(x))\\,g\'(x)', when: T('Para derivar funciones compuestas (una dentro de otra).', 'To differentiate composite functions (one inside another).') },
  { id: 'product', subject: 'math', topic: CALC, name: T('Producto y cociente', 'Product and quotient rules'), tex: '(fg)\' = f\'g + fg\' \\qquad \\left(\\frac{f}{g}\\right)\' = \\frac{f\'g - fg\'}{g^2}', when: T('Para derivar productos y cocientes de funciones.', 'To differentiate products and quotients of functions.') },
  { id: 'tangent', subject: 'math', topic: CALC, name: T('Recta tangente', 'Tangent line'), tex: 'y - f(a) = f\'(a)(x - a)', when: T('La recta que toca la curva en x = a con su misma pendiente.', 'The line touching the curve at x = a with the same slope.') },
  { id: 'ftc', subject: 'math', topic: CALC, name: T('Regla de Barrow', 'Fundamental theorem of calculus'), tex: '\\int_a^b f(x)\\,dx = F(b) - F(a)', when: T('Para calcular integrales definidas (áreas) con una primitiva F.', 'To evaluate definite integrals (areas) with an antiderivative F.') },
  { id: 'parts', subject: 'math', topic: CALC, name: T('Integración por partes', 'Integration by parts'), tex: '\\int u\\,dv = uv - \\int v\\,du', when: T('Para integrales de productos (x·eˣ, x·sen x, ln x…).', 'For integrals of products (x·eˣ, x·sin x, ln x…).') },
  { id: 'combin', subject: 'math', topic: PROB, name: T('Combinaciones y variaciones', 'Combinations and permutations'), tex: T('\\binom{n}{k} = \\frac{n!}{k!\\,(n-k)!} \\qquad V_{n,k} = \\frac{n!}{(n-k)!}', '\\binom{n}{k} = \\frac{n!}{k!\\,(n-k)!} \\qquad P(n,k) = \\frac{n!}{(n-k)!}'), when: T('Combinaciones si no importa el orden; variaciones si importa.', 'Combinations when order doesn\'t matter; permutations when it does.') },
  { id: 'laplace', subject: 'math', topic: PROB, name: T('Regla de Laplace', 'Classical probability'), tex: T('P(A) = \\frac{\\text{casos favorables}}{\\text{casos posibles}}', 'P(A) = \\frac{\\text{favorable outcomes}}{\\text{possible outcomes}}'), when: T('Cuando todos los resultados son igual de probables.', 'When all outcomes are equally likely.') },
  { id: 'union', subject: 'math', topic: PROB, name: T('Unión y condicionada', 'Union and conditional'), tex: 'P(A\\cup B) = P(A) + P(B) - P(A\\cap B) \\qquad P(A\\mid B) = \\frac{P(A\\cap B)}{P(B)}', when: T('Para sucesos que pueden ocurrir a la vez y para probabilidades «sabiendo que».', 'For events that can overlap and for “given that” probabilities.') },
  { id: 'bayes', subject: 'math', topic: PROB, name: T('Teorema de Bayes', 'Bayes\' theorem'), tex: 'P(A\\mid B) = \\frac{P(B\\mid A)\\,P(A)}{P(B)}', when: T('Para «darle la vuelta» a una probabilidad condicionada (pruebas médicas, diagnósticos).', 'To “flip” a conditional probability (medical tests, diagnoses).') },
  { id: 'binomialdist', subject: 'math', topic: PROB, name: T('Distribución binomial', 'Binomial distribution'), tex: 'P(X = k) = \\binom{n}{k} p^k (1-p)^{n-k} \\qquad \\mu = np \\quad \\sigma = \\sqrt{np(1-p)}', when: T('Número de éxitos en n intentos independientes con la misma probabilidad p.', 'Number of successes in n independent trials with the same probability p.') },
  { id: 'zscore', subject: 'math', topic: PROB, name: T('Tipificación', 'z-score'), tex: 'z = \\frac{x - \\mu}{\\sigma}', when: T('Para pasar una normal N(μ, σ) a la N(0, 1) y usar la tabla.', 'To turn a normal N(μ, σ) into N(0, 1) and use the table.') },
  { id: 'stddev', subject: 'math', topic: PROB, name: T('Media y desviación típica', 'Mean and standard deviation'), tex: '\\bar x = \\frac{\\sum x_i}{n} \\qquad s = \\sqrt{\\frac{\\sum (x_i - \\bar x)^2}{n - 1}}', when: T('Centro y dispersión de unos datos (s con n − 1 para una muestra).', 'Center and spread of data (s uses n − 1 for a sample).') },

  // MARK: Física
  { id: 'uniform', subject: 'physics', topic: KIN, name: T('Movimiento uniforme', 'Uniform motion'), tex: 'x = x_0 + v\\,t', when: T('Velocidad constante: sin aceleración.', 'Constant velocity: no acceleration.'), vars: T('x posición, x₀ posición inicial, v velocidad, t tiempo', 'x position, x₀ initial position, v velocity, t time') },
  { id: 'suvat', subject: 'physics', topic: KIN, name: T('Movimiento uniformemente acelerado', 'Constant acceleration'), tex: 'v = v_0 + a t \\qquad x = x_0 + v_0 t + \\tfrac12 a t^2 \\qquad v^2 = v_0^2 + 2a\\,\\Delta x', when: T('Aceleración constante (caída libre con a = −g). La tercera no necesita el tiempo.', 'Constant acceleration (free fall with a = −g). The third one doesn\'t need time.'), vars: T('v₀ velocidad inicial, a aceleración, Δx desplazamiento', 'v₀ initial velocity, a acceleration, Δx displacement') },
  { id: 'projectile', subject: 'physics', topic: KIN, name: T('Tiro parabólico', 'Projectile motion'), tex: 'R = \\frac{v_0^2 \\sin 2\\theta}{g} \\qquad h_{\\max} = \\frac{v_0^2 \\sin^2\\theta}{2g}', when: T('Alcance y altura máxima lanzando desde el suelo y volviendo a él, sin rozamiento.', 'Range and peak height when launched from and landing on the ground, without drag.') },
  { id: 'circular', subject: 'physics', topic: KIN, name: T('Movimiento circular', 'Circular motion'), tex: 'v = \\omega r \\qquad a_c = \\frac{v^2}{r} = \\omega^2 r \\qquad T = \\frac{2\\pi}{\\omega}', when: T('Giros: relaciona la velocidad lineal, la angular y la aceleración hacia el centro.', 'Rotation: links linear speed, angular speed and acceleration toward the center.') },
  { id: 'newton2', subject: 'physics', topic: DYN, name: T('Segunda ley de Newton', 'Newton\'s second law'), tex: '\\sum \\vec F = m\\,\\vec a', when: T('Siempre que haya fuerzas: la resultante da la aceleración.', 'Whenever forces act: the net force gives the acceleration.') },
  { id: 'weight', subject: 'physics', topic: DYN, name: T('Peso y rozamiento', 'Weight and friction'), tex: T('P = m g \\qquad F_r = \\mu N', 'F_g = m g \\qquad F_f = \\mu N'), when: T('Fuerza de la gravedad cerca de la Tierra y rozamiento con la superficie.', 'Gravity near Earth\'s surface and friction with a surface.'), vars: T('μ coeficiente de rozamiento, N fuerza normal', 'μ friction coefficient, N normal force') },
  { id: 'gravity', subject: 'physics', topic: DYN, name: T('Gravitación universal', 'Universal gravitation'), tex: 'F = G\\,\\frac{m_1 m_2}{r^2}', when: T('Atracción entre dos masas cualesquiera (planetas, satélites).', 'Attraction between any two masses (planets, satellites).') },
  { id: 'hooke', subject: 'physics', topic: DYN, name: T('Ley de Hooke', 'Hooke\'s law'), tex: 'F = -k\\,x', when: T('Muelles y gomas mientras no se deformen para siempre.', 'Springs and elastic bands as long as they don\'t deform permanently.') },
  { id: 'momentum', subject: 'physics', topic: DYN, name: T('Momento lineal e impulso', 'Momentum and impulse'), tex: '\\vec p = m\\vec v \\qquad \\vec F\\,\\Delta t = \\Delta \\vec p', when: T('Choques y explosiones: sin fuerzas externas el momento total se conserva.', 'Collisions and explosions: with no external forces, total momentum is conserved.') },
  { id: 'work', subject: 'physics', topic: ENE, name: T('Trabajo y potencia', 'Work and power'), tex: 'W = F\\,d\\cos\\theta \\qquad P = \\frac{W}{t}', when: T('Energía que transmite una fuerza al desplazar algo, y lo rápido que lo hace.', 'Energy a force transfers by moving something, and how fast it does so.') },
  { id: 'energies', subject: 'physics', topic: ENE, name: T('Energías cinética y potencial', 'Kinetic and potential energy'), tex: T('E_c = \\tfrac12 m v^2 \\qquad E_p = m g h \\qquad E_{p,e} = \\tfrac12 k x^2', '\\text{KE} = \\tfrac12 m v^2 \\qquad \\text{PE} = m g h \\qquad \\text{PE}_{\\text{spring}} = \\tfrac12 k x^2'), when: T('Sin rozamiento la suma se conserva: E_c + E_p = constante.', 'Without friction the sum is conserved: KE + PE = constant.') },
  { id: 'workenergy', subject: 'physics', topic: ENE, name: T('Teorema trabajo-energía', 'Work–energy theorem'), tex: T('W_{\\text{total}} = \\Delta E_c', 'W_{\\text{total}} = \\Delta \\text{KE}'), when: T('Cuando quieres la velocidad después de que actúen fuerzas, sin pasar por la aceleración.', 'To get the speed after forces act, without going through acceleration.') },
  { id: 'shm', subject: 'physics', topic: OSC, name: T('Movimiento armónico simple', 'Simple harmonic motion'), tex: 'x(t) = A\\cos(\\omega t + \\varphi) \\qquad \\omega = \\sqrt{\\frac{k}{m}}', when: T('Oscilaciones de un muelle (y de muchas cosas cerca del equilibrio).', 'Spring oscillations (and many things near equilibrium).') },
  { id: 'pendulum', subject: 'physics', topic: OSC, name: T('Periodo del péndulo', 'Pendulum period'), tex: 'T = 2\\pi\\sqrt{\\frac{L}{g}}', when: T('Péndulo simple con ángulos pequeños (menos de unos 15°).', 'Simple pendulum at small angles (under about 15°).') },
  { id: 'wave', subject: 'physics', topic: OSC, name: T('Ondas', 'Waves'), tex: 'v = \\lambda f \\qquad y = A\\sin(kx - \\omega t)', when: T('Relaciona velocidad, longitud de onda y frecuencia de cualquier onda.', 'Relates speed, wavelength and frequency of any wave.') },
  { id: 'snell', subject: 'physics', topic: OSC, name: T('Ley de Snell', 'Snell\'s law'), tex: 'n_1 \\sin\\theta_1 = n_2 \\sin\\theta_2 \\qquad n = \\frac{c}{v}', when: T('Refracción de la luz al cambiar de medio.', 'Refraction of light when it changes medium.') },
  { id: 'lens', subject: 'physics', topic: OSC, name: T('Lentes delgadas', 'Thin lens equation'), tex: '\\frac{1}{f} = \\frac{1}{s\'} - \\frac{1}{s} \\qquad M = \\frac{s\'}{s}', when: T('Dónde se forma la imagen y de qué tamaño (criterio de signos DIN).', 'Where the image forms and how big (Cartesian sign convention).') },
  { id: 'coulomb', subject: 'physics', topic: ELEC, name: T('Ley de Coulomb', 'Coulomb\'s law'), tex: 'F = k\\,\\frac{|q_1 q_2|}{r^2} \\qquad E = k\\,\\frac{|q|}{r^2}', when: T('Fuerza entre cargas puntuales y el campo que crean.', 'Force between point charges and the field they create.') },
  { id: 'ohm', subject: 'physics', topic: ELEC, name: T('Ley de Ohm y potencia', 'Ohm\'s law and power'), tex: 'V = I R \\qquad P = V I = I^2 R', when: T('Circuitos con resistencias: tensión, corriente y energía disipada.', 'Resistor circuits: voltage, current and power dissipated.') },
  { id: 'resistors', subject: 'physics', topic: ELEC, name: T('Resistencias en serie y paralelo', 'Series and parallel resistors'), tex: 'R_s = R_1 + R_2 + \\dots \\qquad \\frac{1}{R_p} = \\frac{1}{R_1} + \\frac{1}{R_2} + \\dots', when: T('Para reducir un circuito a una sola resistencia equivalente.', 'To reduce a circuit to a single equivalent resistance.') },
  { id: 'lorentz', subject: 'physics', topic: ELEC, name: T('Fuerza magnética', 'Magnetic force'), tex: '\\vec F = q\\,\\vec v \\times \\vec B \\qquad F = I L B \\sin\\theta', when: T('Cargas en movimiento y cables con corriente dentro de un campo magnético.', 'Moving charges and current-carrying wires in a magnetic field.') },
  { id: 'faraday', subject: 'physics', topic: ELEC, name: T('Ley de Faraday', 'Faraday\'s law'), tex: '\\varepsilon = -\\frac{d\\Phi_B}{dt} \\qquad \\Phi_B = B A \\cos\\theta', when: T('Corriente inducida al cambiar el flujo magnético (generadores, transformadores).', 'Induced current when the magnetic flux changes (generators, transformers).') },
  { id: 'heat', subject: 'physics', topic: THERMO, name: T('Calor', 'Heat'), tex: 'Q = m c\\,\\Delta T \\qquad Q = m L', when: T('Calentar sin cambiar de estado (c, calor específico) o cambiar de estado (L, calor latente).', 'Heating without a phase change (c, specific heat) or changing phase (L, latent heat).') },
  { id: 'firstlaw', subject: 'physics', topic: THERMO, name: T('Primer principio', 'First law of thermodynamics'), tex: '\\Delta U = Q - W', when: T('Balance de energía de un sistema: el calor que entra menos el trabajo que hace.', 'Energy balance of a system: heat in minus work done by it.') },
  { id: 'efficiency', subject: 'physics', topic: THERMO, name: T('Rendimiento de Carnot', 'Carnot efficiency'), tex: T('\\eta = 1 - \\frac{T_f}{T_c}', '\\eta = 1 - \\frac{T_C}{T_H}'), when: T('El máximo rendimiento posible de una máquina térmica (temperaturas en K).', 'The best possible efficiency of a heat engine (temperatures in K).') },
  { id: 'photon', subject: 'physics', topic: MOD, name: T('Energía del fotón', 'Photon energy'), tex: 'E = h f = \\frac{h c}{\\lambda}', when: T('Luz como partículas: efecto fotoeléctrico, espectros.', 'Light as particles: photoelectric effect, spectra.') },
  { id: 'photoelectric', subject: 'physics', topic: MOD, name: T('Efecto fotoeléctrico', 'Photoelectric effect'), tex: T('h f = W_0 + E_{c,\\max}', 'h f = W_0 + \\text{KE}_{\\max}'), when: T('Electrones arrancados por la luz: solo si hf supera el trabajo de extracción W₀.', 'Electrons ejected by light: only if hf exceeds the work function W₀.') },
  { id: 'debroglie', subject: 'physics', topic: MOD, name: T('Longitud de onda de De Broglie', 'De Broglie wavelength'), tex: '\\lambda = \\frac{h}{p} = \\frac{h}{m v}', when: T('La onda asociada a una partícula en movimiento.', 'The wave associated with a moving particle.') },
  { id: 'emc2', subject: 'physics', topic: MOD, name: T('Equivalencia masa-energía', 'Mass–energy equivalence'), tex: 'E = m c^2', when: T('Defecto de masa y energía en reacciones nucleares.', 'Mass defect and energy in nuclear reactions.') },
  { id: 'decay', subject: 'physics', topic: MOD, name: T('Desintegración radiactiva', 'Radioactive decay'), tex: 'N = N_0\\,e^{-\\lambda t} \\qquad T_{1/2} = \\frac{\\ln 2}{\\lambda}', when: T('Cuántos núcleos quedan tras un tiempo; datación por carbono-14.', 'How many nuclei remain after a time; carbon-14 dating.') },

  // MARK: Química
  { id: 'moles', subject: 'chemistry', topic: STO, name: T('Moles', 'Moles'), tex: 'n = \\frac{m}{M} = \\frac{N}{N_A}', when: T('Para pasar de gramos o de partículas a moles (el idioma de las ecuaciones químicas).', 'To go from grams or particles to moles (the language of chemical equations).'), vars: T('m masa (g), M masa molar (g/mol), N partículas', 'm mass (g), M molar mass (g/mol), N particles') },
  { id: 'yield', subject: 'chemistry', topic: STO, name: T('Rendimiento', 'Percent yield'), tex: T('\\text{rend.} = \\frac{\\text{real}}{\\text{teórico}}\\times 100', '\\text{yield} = \\frac{\\text{actual}}{\\text{theoretical}}\\times 100'), when: T('Cuánto producto se obtuvo frente al que daba la estequiometría.', 'How much product you got compared with the stoichiometric amount.') },
  { id: 'percent', subject: 'chemistry', topic: STO, name: T('Composición centesimal', 'Percent composition'), tex: '\\%\\,X = \\frac{n_X\\,M_X}{M}\\times 100', when: T('Qué parte de la masa de un compuesto es de cada elemento.', 'What share of a compound\'s mass belongs to each element.') },
  { id: 'idealgas', subject: 'chemistry', topic: GAS, name: T('Gases ideales', 'Ideal gas law'), tex: 'PV = nRT', when: T('Gases a presiones normales. T siempre en kelvin; R según las unidades.', 'Gases at ordinary pressures. T always in kelvin; R depends on the units.') },
  { id: 'combined', subject: 'chemistry', topic: GAS, name: T('Ley combinada', 'Combined gas law'), tex: '\\frac{P_1 V_1}{T_1} = \\frac{P_2 V_2}{T_2}', when: T('El mismo gas en dos estados (Boyle, Charles y Gay-Lussac son casos particulares).', 'The same gas in two states (Boyle\'s, Charles\'s and Gay-Lussac\'s laws are special cases).') },
  { id: 'dalton', subject: 'chemistry', topic: GAS, name: T('Presiones parciales de Dalton', 'Dalton\'s partial pressures'), tex: 'P_T = \\sum P_i \\qquad P_i = x_i P_T', when: T('Mezclas de gases: cada uno aporta según su fracción molar.', 'Gas mixtures: each gas contributes by its mole fraction.') },
  { id: 'molarity', subject: 'chemistry', topic: SOL, name: T('Molaridad', 'Molarity'), tex: T('M = \\frac{n_{\\text{soluto}}}{V_{\\text{disolución}}\\,(\\text{L})}', 'M = \\frac{n_{\\text{solute}}}{V_{\\text{solution}}\\,(\\text{L})}'), when: T('La concentración más usada en el laboratorio.', 'The most common concentration in the lab.') },
  { id: 'dilution', subject: 'chemistry', topic: SOL, name: T('Dilución', 'Dilution'), tex: 'C_1 V_1 = C_2 V_2', when: T('Al añadir disolvente: los moles de soluto no cambian.', 'When adding solvent: moles of solute stay the same.') },
  { id: 'molality', subject: 'chemistry', topic: SOL, name: T('Molalidad y fracción molar', 'Molality and mole fraction'), tex: T('m = \\frac{n_{\\text{soluto}}}{\\text{kg disolvente}} \\qquad x_i = \\frac{n_i}{n_T}', 'm = \\frac{n_{\\text{solute}}}{\\text{kg solvent}} \\qquad x_i = \\frac{n_i}{n_T}'), when: T('Concentraciones que no dependen de la temperatura (propiedades coligativas).', 'Concentrations that don\'t depend on temperature (colligative properties).') },
  { id: 'colligative', subject: 'chemistry', topic: SOL, name: T('Propiedades coligativas', 'Colligative properties'), tex: T('\\Delta T_e = i K_e m \\qquad \\Delta T_c = i K_c m \\qquad \\pi = i M R T', '\\Delta T_b = i K_b m \\qquad \\Delta T_f = i K_f m \\qquad \\pi = i M R T'), when: T('Cómo un soluto sube el punto de ebullición, baja el de congelación y crea presión osmótica.', 'How a solute raises boiling point, lowers freezing point and creates osmotic pressure.') },
  { id: 'hess', subject: 'chemistry', topic: TCH, name: T('Entalpía de reacción (Hess)', 'Reaction enthalpy (Hess)'), tex: T('\\Delta H^\\circ_r = \\sum n\\,\\Delta H^\\circ_f(\\text{prod.}) - \\sum n\\,\\Delta H^\\circ_f(\\text{reac.})', '\\Delta H^\\circ_r = \\sum n\\,\\Delta H^\\circ_f(\\text{products}) - \\sum n\\,\\Delta H^\\circ_f(\\text{reactants})'), when: T('Calor de una reacción a partir de las entalpías de formación tabuladas.', 'Heat of reaction from tabulated formation enthalpies.') },
  { id: 'gibbs', subject: 'chemistry', topic: TCH, name: T('Energía de Gibbs', 'Gibbs free energy'), tex: '\\Delta G = \\Delta H - T\\,\\Delta S \\qquad \\Delta G^\\circ = -RT\\ln K', when: T('Si ΔG < 0 la reacción es espontánea; relaciona termodinámica y equilibrio.', 'If ΔG < 0 the reaction is spontaneous; links thermodynamics and equilibrium.') },
  { id: 'kc', subject: 'chemistry', topic: TCH, name: T('Constante de equilibrio', 'Equilibrium constant'), tex: 'aA + bB \\rightleftharpoons cC + dD \\qquad K_c = \\frac{[C]^c[D]^d}{[A]^a[B]^b}', when: T('Cuánto avanza una reacción reversible; sólidos y líquidos puros no aparecen.', 'How far a reversible reaction goes; pure solids and liquids are left out.') },
  { id: 'kp', subject: 'chemistry', topic: TCH, name: T('Kp y Kc', 'Kp and Kc'), tex: 'K_p = K_c\\,(RT)^{\\Delta n}', when: T('Para equilibrios entre gases (Δn: moles de gas de productos menos reactivos).', 'For gas equilibria (Δn: moles of gaseous products minus reactants).') },
  { id: 'ph', subject: 'chemistry', topic: AB, name: T('pH y pOH', 'pH and pOH'), tex: '\\text{pH} = -\\log[\\text{H}_3\\text{O}^+] \\qquad \\text{pH} + \\text{pOH} = 14', when: T('Acidez de una disolución acuosa a 25 °C.', 'Acidity of an aqueous solution at 25 °C.') },
  { id: 'ka', subject: 'chemistry', topic: AB, name: T('Ácido débil', 'Weak acid'), tex: 'K_a = \\frac{[\\text{H}_3\\text{O}^+][\\text{A}^-]}{[\\text{HA}]} \\qquad [\\text{H}_3\\text{O}^+] \\approx \\sqrt{K_a C}', when: T('Ácidos que se disocian poco; la aproximación vale si la ionización es menor del 5 %.', 'Acids that barely dissociate; the approximation holds if ionization is under 5 %.') },
  { id: 'kw', subject: 'chemistry', topic: AB, name: T('Producto iónico del agua', 'Water ion product'), tex: 'K_w = [\\text{H}_3\\text{O}^+][\\text{OH}^-] = 1{,}0\\times10^{-14} \\qquad K_a K_b = K_w', when: T('Relaciona [H₃O⁺] con [OH⁻] y la fuerza de un ácido con la de su base conjugada.', 'Links [H₃O⁺] with [OH⁻], and an acid\'s strength with its conjugate base\'s.') },
  { id: 'henderson', subject: 'chemistry', topic: AB, name: T('Disolución reguladora', 'Buffer (Henderson–Hasselbalch)'), tex: '\\text{pH} = \\text{p}K_a + \\log\\frac{[\\text{A}^-]}{[\\text{HA}]}', when: T('pH de una mezcla de ácido débil y su base conjugada (tampón).', 'pH of a weak acid mixed with its conjugate base (buffer).') },
  { id: 'nernst', subject: 'chemistry', topic: ECH, name: T('Ecuación de Nernst', 'Nernst equation'), tex: T('E = E^\\circ - \\frac{RT}{nF}\\ln Q \\qquad E^\\circ_{\\text{pila}} = E^\\circ_{\\text{cát}} - E^\\circ_{\\text{án}}', 'E = E^\\circ - \\frac{RT}{nF}\\ln Q \\qquad E^\\circ_{\\text{cell}} = E^\\circ_{\\text{cathode}} - E^\\circ_{\\text{anode}}'), when: T('Potencial de una pila fuera de las condiciones estándar.', 'Cell potential away from standard conditions.') },
  { id: 'electrolysis', subject: 'chemistry', topic: ECH, name: T('Leyes de Faraday (electrólisis)', 'Faraday\'s laws (electrolysis)'), tex: 'm = \\frac{M\\,I\\,t}{n F}', when: T('Masa depositada al pasar una corriente I durante un tiempo t.', 'Mass deposited when a current I flows for a time t.') },
  { id: 'rate', subject: 'chemistry', topic: ECH, name: T('Velocidad de reacción', 'Rate law'), tex: T('v = k[A]^m[B]^n', '\\text{rate} = k[A]^m[B]^n'), when: T('Cómo depende la velocidad de las concentraciones (los órdenes se miden, no salen de la ecuación).', 'How the rate depends on concentrations (orders are measured, not read from the equation).') },
  { id: 'arrhenius', subject: 'chemistry', topic: ECH, name: T('Ecuación de Arrhenius', 'Arrhenius equation'), tex: 'k = A\\,e^{-E_a/RT} \\qquad \\ln\\frac{k_2}{k_1} = \\frac{E_a}{R}\\left(\\frac{1}{T_1} - \\frac{1}{T_2}\\right)', when: T('Cómo acelera una reacción al subir la temperatura.', 'How a reaction speeds up as temperature rises.') }
]

export const CONSTANTS: Constant[] = [
  { id: 'c', symbol: 'c', name: T('Velocidad de la luz en el vacío', 'Speed of light in vacuum'), value: '2{,}997\\,924\\,58\\times10^{8}', unit: 'm/s', exact: true },
  { id: 'G', symbol: 'G', name: T('Constante de gravitación', 'Gravitational constant'), value: '6{,}674\\,30\\times10^{-11}', unit: 'N·m²/kg²' },
  { id: 'g', symbol: 'g', name: T('Gravedad estándar', 'Standard gravity'), value: '9{,}806\\,65', unit: 'm/s²', exact: true },
  { id: 'h', symbol: 'h', name: T('Constante de Planck', 'Planck constant'), value: '6{,}626\\,070\\,15\\times10^{-34}', unit: 'J·s', exact: true },
  { id: 'e', symbol: 'e', name: T('Carga elemental', 'Elementary charge'), value: '1{,}602\\,176\\,634\\times10^{-19}', unit: 'C', exact: true },
  { id: 'NA', symbol: 'N_A', name: T('Número de Avogadro', 'Avogadro constant'), value: '6{,}022\\,140\\,76\\times10^{23}', unit: 'mol⁻¹', exact: true },
  { id: 'kB', symbol: 'k_B', name: T('Constante de Boltzmann', 'Boltzmann constant'), value: '1{,}380\\,649\\times10^{-23}', unit: 'J/K', exact: true },
  { id: 'R', symbol: 'R', name: T('Constante de los gases', 'Gas constant'), value: '8{,}314\\,462\\,618', unit: 'J/(mol·K)' },
  { id: 'Ratm', symbol: 'R', name: T('Constante de los gases (L·atm)', 'Gas constant (L·atm)'), value: '0{,}082\\,057\\,366', unit: 'L·atm/(mol·K)' },
  { id: 'F', symbol: 'F', name: T('Constante de Faraday', 'Faraday constant'), value: '96\\,485{,}332\\,12', unit: 'C/mol' },
  { id: 'me', symbol: 'm_e', name: T('Masa del electrón', 'Electron mass'), value: '9{,}109\\,383\\,70\\times10^{-31}', unit: 'kg' },
  { id: 'mp', symbol: 'm_p', name: T('Masa del protón', 'Proton mass'), value: '1{,}672\\,621\\,92\\times10^{-27}', unit: 'kg' },
  { id: 'u', symbol: 'u', name: T('Unidad de masa atómica', 'Atomic mass unit'), value: '1{,}660\\,539\\,07\\times10^{-27}', unit: 'kg' },
  { id: 'eps0', symbol: '\\varepsilon_0', name: T('Permitividad del vacío', 'Vacuum permittivity'), value: '8{,}854\\,187\\,81\\times10^{-12}', unit: 'F/m' },
  { id: 'mu0', symbol: '\\mu_0', name: T('Permeabilidad del vacío', 'Vacuum permeability'), value: '1{,}256\\,637\\,06\\times10^{-6}', unit: 'N/A²' },
  { id: 'k', symbol: 'k', name: T('Constante de Coulomb', 'Coulomb constant'), value: '8{,}987\\,551\\,79\\times10^{9}', unit: 'N·m²/C²' },
  { id: 'sigma', symbol: '\\sigma', name: T('Constante de Stefan-Boltzmann', 'Stefan–Boltzmann constant'), value: '5{,}670\\,374\\,419\\times10^{-8}', unit: 'W/(m²·K⁴)', exact: true },
  { id: 'Vm', symbol: 'V_m', name: T('Volumen molar (0 °C, 1 atm)', 'Molar volume (0 °C, 1 atm)'), value: '22{,}413\\,969', unit: 'L/mol' },
  { id: 'atm', symbol: '\\text{atm}', name: T('Atmósfera estándar', 'Standard atmosphere'), value: '101\\,325', unit: 'Pa', exact: true },
  { id: 'Kw', symbol: 'K_w', name: T('Producto iónico del agua (25 °C)', 'Water ion product (25 °C)'), value: '1{,}0\\times10^{-14}', unit: '' },
  { id: 'RH', symbol: 'R_\\infty', name: T('Constante de Rydberg', 'Rydberg constant'), value: '1{,}097\\,373\\,157\\times10^{7}', unit: 'm⁻¹' }
]
