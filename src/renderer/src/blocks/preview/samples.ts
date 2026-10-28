// Muestras escritas a mano de cada tipo de bloque (en el JSON que escribe la IA), para la página de desarrollo: cubren lo
// que el curso de ejemplo no trae (gráficos, línea de tiempo, imagen, código, cita…) y los casos difíciles de cada uno.
import type { JSONObject } from '@engine/base/json'

/** Ilustración de muestra (una célula vegetal esquemática) para el bloque de imagen, sin archivos del curso. */
const CELL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 460">
<rect width="800" height="460" fill="#f3ede2"/>
<rect x="90" y="50" width="620" height="360" rx="70" fill="#dfe8cf" stroke="#68742a" stroke-width="10"/>
<rect x="112" y="72" width="576" height="316" rx="54" fill="#eef2e2" stroke="#a9b65a" stroke-width="4"/>
<ellipse cx="520" cy="230" rx="130" ry="110" fill="#d6e4ef" stroke="#7fa3d2" stroke-width="5"/>
<circle cx="300" cy="200" r="64" fill="#e9c9b6" stroke="#b24f35" stroke-width="6"/>
<circle cx="312" cy="190" r="20" fill="#b24f35"/>
<g fill="#7db693" stroke="#3b7555" stroke-width="4">
<ellipse cx="210" cy="320" rx="38" ry="20" transform="rotate(-18 210 320)"/>
<ellipse cx="360" cy="330" rx="38" ry="20" transform="rotate(12 360 330)"/>
<ellipse cx="640" cy="110" rx="34" ry="18" transform="rotate(25 640 110)"/>
<ellipse cx="180" cy="130" rx="34" ry="18" transform="rotate(-30 180 130)"/>
</g>
<g fill="#e3a54e"><circle cx="420" cy="120" r="6"/><circle cx="440" cy="360" r="6"/><circle cx="250" cy="250" r="5"/><circle cx="660" cy="330" r="6"/></g>
</svg>`

export const SAMPLE_ASSETS: Record<string, string> = {
  'muestras/celula.svg': `data:image/svg+xml;charset=utf-8,${encodeURIComponent(CELL_SVG)}`
}

export interface SampleSection {
  id: string
  title: string
  blocks: JSONObject[]
}

export const SAMPLE_SECTIONS: SampleSection[] = [
  {
    id: 'texto',
    title: 'Texto, fórmulas y avisos',
    blocks: [
      { id: 's-text', type: 'text', md: 'La **derivada** mide cómo cambia una función: si $f(x)=x^2$, entonces $f\'(x)=2x$. En química, la combustión del metano es $\\ce{CH4 + 2O2 -> CO2 + 2H2O}$.\n\n- Primero, *identifica* la variable.\n- Después, aplica la regla de la cadena.\n\nY una fórmula en pantalla dentro del texto:\n\n$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$' },
      { id: 's-text2', type: 'text', md: 'Un segundo párrafo seguido se acerca al anterior, como en un libro.' },
      { id: 's-math', type: 'math', tex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', label: 'Fórmula general', note: 'Vale para cualquier $ax^2+bx+c=0$ con $a\\neq 0$.' },
      { id: 's-math2', type: 'math', tex: '\\begin{aligned} (a+b)^2 &= (a+b)(a+b) \\\\ &= a^2 + 2ab + b^2 \\end{aligned}', label: '(1)' },
      { id: 's-c1', type: 'callout', kind: 'definition', title: 'Función continua', md: 'Una función $f$ es **continua** en $a$ si $\\lim_{x\\to a} f(x) = f(a)$.' },
      { id: 's-c2', type: 'callout', kind: 'theorem', title: 'Teorema de Bolzano', md: 'Si $f$ es continua en $[a,b]$ y $f(a)\\,f(b)<0$, existe $c\\in(a,b)$ con $f(c)=0$.' },
      { id: 's-c3', type: 'callout', kind: 'warning', md: 'No confundas $\\sin^2 x$ con $\\sin(x^2)$.' },
      { id: 's-c4', type: 'callout', kind: 'mistake', md: 'Escribir $\\sqrt{a+b}=\\sqrt a+\\sqrt b$. Prueba con $a=b=1$: $\\sqrt 2\\neq 2$.' },
      { id: 's-c5', type: 'callout', kind: 'tip', md: 'Dibuja siempre el círculo unidad antes de buscar un ángulo de referencia.' },
      { id: 's-c6', type: 'callout', kind: 'examTip', md: 'En el examen piden el resultado **exacto**: deja $\\frac{\\sqrt3}{2}$, no $0{,}866$.' },
      { id: 's-c7', type: 'callout', kind: 'note', md: 'Los radianes no tienen unidades.' },
      { id: 's-c8', type: 'callout', kind: 'question', md: '¿Por qué el seno de $\\pi$ es cero?' },
      { id: 's-c9', type: 'callout', kind: 'remember', md: '$\\sin^2\\theta + \\cos^2\\theta = 1$ para cualquier $\\theta$.' },
      { id: 's-quote', type: 'quote', md: 'La matemática es el alfabeto con el cual Dios ha escrito el universo.', author: 'Galileo Galilei', source: { source: 'apuntes', page: 12 } }
    ]
  },
  {
    id: 'pasos',
    title: 'Ejemplos, pasos, tablas y comparaciones',
    blocks: [
      {
        id: 's-ex', type: 'example', title: 'Resolver $x^2 - 5x + 6 = 0$', problem: 'Encuentra las soluciones de $x^2 - 5x + 6 = 0$.',
        steps: [
          { md: 'Busca dos números que multiplicados den $6$ y sumados $-5$: son $-2$ y $-3$.', note: 'Prueba primero con los divisores de $6$.' },
          { md: 'Factoriza: $(x-2)(x-3)=0$.' },
          { md: 'Un producto es cero si lo es algún factor: $x-2=0$ o $x-3=0$.' }
        ],
        answer: '$x=2$ y $x=3$'
      },
      { id: 's-steps', type: 'steps', title: 'Cómo pasar de grados a radianes', steps: [{ title: 'Escribe el ángulo', md: 'Por ejemplo, $150^\\circ$.' }, { title: 'Multiplica por $\\frac{\\pi}{180}$', md: '$150\\cdot\\frac{\\pi}{180}$.' }, { title: 'Simplifica', md: '$\\frac{150\\pi}{180}=\\frac{5\\pi}{6}$.' }] },
      {
        id: 's-table', type: 'table', headers: ['Ángulo', 'Radianes', '$\\sin\\theta$', '$\\cos\\theta$', 'Decimal'],
        rows: [['$30^\\circ$', '$\\frac{\\pi}{6}$', '$\\frac12$', '$\\frac{\\sqrt3}{2}$', '0,866'], ['$45^\\circ$', '$\\frac{\\pi}{4}$', '$\\frac{\\sqrt2}{2}$', '$\\frac{\\sqrt2}{2}$', '0,707'], ['$60^\\circ$', '$\\frac{\\pi}{3}$', '$\\frac{\\sqrt3}{2}$', '$\\frac12$', '0,5'], ['$90^\\circ$', '$\\frac{\\pi}{2}$', '$1$', '$0$', '0']],
        highlightRows: [1], firstColumnIsHeader: true, caption: 'Los ángulos notables del primer cuadrante.'
      },
      {
        id: 's-compare', type: 'compare', title: 'Mitosis frente a meiosis', leftTitle: 'Mitosis', rightTitle: 'Meiosis',
        rows: [{ label: 'Divisiones', left: 'Una', right: 'Dos' }, { label: 'Células hijas', left: '2, idénticas', right: '4, distintas' }, { label: 'Cromosomas', left: 'Diploides ($2n$)', right: 'Haploides ($n$)' }, { label: 'Para qué', left: 'Crecer y reparar tejidos', right: 'Formar gametos' }]
      },
      {
        id: 's-formulas', type: 'formulas', title: 'Movimiento uniformemente acelerado',
        items: [
          { name: 'Velocidad', tex: 'v = v_0 + a t', when: 'Si conoces la aceleración y el tiempo.', vars: [{ symbol: 'v_0', meaning: 'velocidad inicial', unit: 'm/s' }, { symbol: 'a', meaning: 'aceleración', unit: 'm/s²' }, { symbol: 't', meaning: 'tiempo', unit: 's' }] },
          { name: 'Posición', tex: 'x = x_0 + v_0 t + \\tfrac12 a t^2', when: 'Para saber dónde está en cada instante.', vars: [{ symbol: 'x_0', meaning: 'posición inicial', unit: 'm' }] },
          { name: 'Sin tiempo', tex: 'v^2 = v_0^2 + 2a\\,\\Delta x', when: 'Cuando el tiempo no aparece en el problema.', vars: [{ symbol: '\\Delta x', meaning: 'desplazamiento', unit: 'm' }] }
        ]
      }
    ]
  },
  {
    id: 'juego',
    title: 'Predice, encuentra el error, pruébalo y lo esencial',
    blocks: [
      { id: 's-predict', type: 'predict', question: 'Si duplicas el radio de un círculo, ¿qué le pasa a su área?', options: [{ md: 'Se duplica', why: 'El área depende de $r^2$, no de $r$.' }, { md: 'Se multiplica por $4$', correct: true, why: '$\\pi(2r)^2 = 4\\pi r^2$.' }, { md: 'Se multiplica por $\\pi$' }, { md: 'No cambia' }], explanation: 'Al escalar las longitudes por $k$, las áreas se escalan por $k^2$.' },
      { id: 's-spot', type: 'spot', intro: 'Un compañero resolvió $2(x+3) = 10$ así:', lines: ['$2(x+3) = 10$', '$2x + 3 = 10$', '$2x = 7$', '$x = 3{,}5$'], wrongIndex: 1, explanation: 'Al quitar el paréntesis hay que multiplicar **los dos** términos: $2x + 6 = 10$, así que $x=2$.' },
      { id: 's-tryit', type: 'tryit', title: 'Practica la factorización', exerciseIDs: ['e1', 'e2', 'e3', 'e4'] },
      { id: 's-recap', type: 'recap', points: ['La derivada es la pendiente de la tangente.', 'La regla de la cadena: $(f\\circ g)\'=f\'(g)\\,g\'$.', 'Un punto crítico cumple $f\'(x)=0$ o $f\'$ no existe.'] }
    ]
  },
  {
    id: 'graficas',
    title: 'Gráficas, explora y recta numérica',
    blocks: [
      {
        id: 's-plot1', type: 'plot', title: 'La tangente y sus asíntotas', xPi: true, xMin: -4.8, xMax: 4.8, yMin: -4, yMax: 4,
        curves: [{ expr: 'tan(x)', label: 'y = \\tan x' }],
        lines: [{ kind: 'vertical', x: 'pi/2', label: 'x = \\frac{\\pi}{2}' }, { kind: 'vertical', x: '-pi/2' }],
        points: [{ x: 'pi/4', y: '1', label: '$(\\frac{\\pi}{4}, 1)$' }],
        caption: 'Las rectas discontinuas son asíntotas: la curva se acerca sin tocarlas.'
      },
      {
        id: 's-plot2', type: 'plot', title: 'Área entre dos curvas', xMin: -0.5, xMax: 2.5, yMin: -0.5, yMax: 4.5, xLabel: 'x', yLabel: 'y',
        curves: [{ expr: '2x', label: 'y = 2x', color: 'blue' }, { expr: 'x^2', label: 'y = x^2', color: 'accent' }],
        regions: [{ upper: '2x', lower: 'x^2', from: '0', to: '2', color: 'accent', opacity: 0.16 }],
        labels: [{ x: '1.1', y: '1.6', tex: 'A=\\tfrac43', color: 'ink' }],
        points: [{ x: '0', y: '0' }, { x: '2', y: '4', label: '(2, 4)' }]
      },
      {
        id: 's-plot3', type: 'plot', title: 'Paramétrica, polar y a trozos', equalAspect: true, xMin: -3, xMax: 3,
        parametric: [{ x: '2cos(t)', y: '2sin(t)', tMin: 0, tMax: 6.2832, color: 'teal' }],
        polar: [{ r: '1 + cos(theta)', color: 'plum' }],
        curves: [{ expr: 'sqrt(x)', domainMin: 0, domainMax: 2.5, color: 'accent', label: 'y = \\sqrt{x}' }, { expr: '-1', domainMin: -3, domainMax: 0, domainMaxOpen: true, color: 'gray' }]
      },
      {
        id: 's-explore', type: 'explore', title: 'Amplitud y periodo de $y = a\\sin(bx)$',
        plot: { xPi: true, xMin: 0, xMax: 6.2832, curves: [{ expr: 'a*sin(b*x)', label: 'y = a\\sin(bx)' }, { expr: 'sin(x)', color: 'gray', dashed: true }] },
        params: [{ name: 'a', label: 'Amplitud $a$', min: -3, max: 3, step: 0.1, value: 1.5 }, { name: 'b', label: 'Frecuencia $b$', min: 0.5, max: 4, step: 0.5, value: 2 }],
        prompts: ['¿Qué pasa con la curva cuando $a$ es negativo?', 'Pon $b=2$: ¿cuántas ondas caben en $[0, 2\\pi]$?']
      },
      { id: 's-nl', type: 'numberline', min: -5, max: 5, intervals: [{ from: '-3', to: '1', fromOpen: false, toOpen: true, label: '$[-3, 1)$' }, { from: '3', fromOpen: true, label: '$x>3$', color: 'blue' }], points: [{ value: '-4.5', label: '$a$', color: 'gray', open: true }], caption: 'Solución de la inecuación: $[-3,1)\\cup(3,\\infty)$.' },
      { id: 's-nl2', type: 'numberline', min: -0.5, max: 6.6, pi: true, points: [{ value: 'pi/2', label: '$\\frac{\\pi}{2}$' }, { value: '3pi/2', label: '$\\frac{3\\pi}{2}$', color: 'blue' }] }
    ]
  },
  {
    id: 'datos',
    title: 'Gráficos de datos',
    blocks: [
      { id: 's-bar', type: 'chart', kind: 'bar', title: 'Horas de estudio por semana', yLabel: 'horas', series: [{ name: 'Horas', points: [{ label: 'Lun', y: 2 }, { label: 'Mar', y: 3.5 }, { label: 'Mié', y: 1 }, { label: 'Jue', y: 4 }, { label: 'Vie', y: 2.5 }, { label: 'Sáb', y: 5 }, { label: 'Dom', y: 0.5 }] }] },
      { id: 's-bar2', type: 'chart', kind: 'bar', title: 'Notas por trimestre', series: [{ name: 'Matemáticas', points: [{ label: '1.º', y: 6.5 }, { label: '2.º', y: 7.2 }, { label: '3.º', y: 8.1 }] }, { name: 'Física', points: [{ label: '1.º', y: 5.8 }, { label: '2.º', y: 6.9 }, { label: '3.º', y: 7.4 }] }, { name: 'Química', points: [{ label: '1.º', y: 7 }, { label: '2.º', y: 6.4 }, { label: '3.º', y: 7.9 }] }], caption: 'Tres series: leyenda arriba y la paleta validada en orden.' },
      { id: 's-line', type: 'chart', kind: 'line', title: 'Población de bacterias', xLabel: 'tiempo (h)', yLabel: 'colonias', showValues: true, series: [{ name: 'Cultivo A', points: [{ x: 0, y: 10 }, { x: 1, y: 18 }, { x: 2, y: 35 }, { x: 3, y: 66 }, { x: 4, y: 120 }, { x: 5, y: 210 }] }, { name: 'Cultivo B', points: [{ x: 0, y: 10 }, { x: 1, y: 14 }, { x: 2, y: 21 }, { x: 3, y: 30 }, { x: 4, y: 44 }, { x: 5, y: 63 }] }] },
      { id: 's-area', type: 'chart', kind: 'area', title: 'Energía consumida', unit: 'kWh', series: [{ name: 'Consumo', points: [{ label: 'Ene', y: 320 }, { label: 'Feb', y: 290 }, { label: 'Mar', y: 260 }, { label: 'Abr', y: 210 }, { label: 'May', y: 180 }, { label: 'Jun', y: 230 }] }], showValues: false },
      { id: 's-pie', type: 'chart', kind: 'pie', title: 'Composición del aire', unit: '%', series: [{ name: 'Aire', points: [{ label: 'Nitrógeno', y: 78 }, { label: 'Oxígeno', y: 21 }, { label: 'Argón', y: 0.93 }, { label: 'Otros', y: 0.07 }] }] },
      { id: 's-scatter', type: 'chart', kind: 'scatter', title: 'Altura y masa', xLabel: 'altura (cm)', yLabel: 'masa (kg)', series: [{ name: 'Alumnos', points: [{ x: 152, y: 48 }, { x: 158, y: 55 }, { x: 161, y: 52 }, { x: 165, y: 60 }, { x: 168, y: 63 }, { x: 170, y: 61 }, { x: 173, y: 70 }, { x: 176, y: 68 }, { x: 180, y: 75 }, { x: 184, y: 79 }] }] },
      { id: 's-hist', type: 'chart', kind: 'histogram', title: 'Notas del examen', xLabel: 'nota', series: [{ name: 'Alumnos', points: [{ label: '0–2', y: 1 }, { label: '2–4', y: 4 }, { label: '4–6', y: 9 }, { label: '6–8', y: 12 }, { label: '8–10', y: 5 }] }] }
    ]
  },
  {
    id: 'historia',
    title: 'Línea de tiempo, imagen y código',
    blocks: [
      {
        id: 's-tl', type: 'timeline', title: 'De la Revolución a Waterloo',
        periods: [{ from: '1789', to: '1799', title: 'Revolución' }, { from: '1799', to: '1804', title: 'Consulado' }, { from: '1804', to: '1815', title: 'Imperio' }],
        events: [
          { when: '1789-07-14', title: 'Toma de la Bastilla', md: 'El pueblo de París asalta la fortaleza: empieza la Revolución.', category: 'Política' },
          { when: '1793', title: 'Ejecución de Luis XVI', category: 'Política' },
          { when: '1799', title: 'Golpe de Brumario', md: 'Napoleón toma el poder.', category: 'Política' },
          { when: '1804', title: 'Código Civil', category: 'Leyes' },
          { when: '1805', title: 'Austerlitz', category: 'Guerra' },
          { when: '1812', end: '1813', title: 'Campaña de Rusia', category: 'Guerra' },
          { when: '1815', title: 'Waterloo', md: 'Derrota final de Napoleón.', category: 'Guerra' }
        ],
        caption: 'Del asalto a la Bastilla (1789) a la derrota de Waterloo (1815).'
      },
      { id: 's-tl2', type: 'timeline', layout: 'vertical', title: 'Origen de la vida (lista)', events: [{ when: '4600 Ma', title: 'Se forma la Tierra' }, { when: '3800 Ma', title: 'Primeras células', md: 'Procariotas en los océanos.' }, { when: '540 Ma', title: 'Explosión cámbrica' }] },
      { id: 's-img', type: 'image', asset: 'muestras/celula.svg', alt: 'Célula vegetal esquemática', caption: 'Partes de una célula vegetal. Ilustración de Aula, dominio público.', hotspots: [{ x: 0.375, y: 0.43, label: '**Núcleo**: guarda el ADN.' }, { x: 0.65, y: 0.5, label: '**Vacuola**: almacena agua y sales.' }, { x: 0.26, y: 0.7, label: '**Cloroplasto**: hace la fotosíntesis.' }, { x: 0.12, y: 0.2, label: '**Pared celular**: da forma y protege.' }] },
      { id: 's-img2', type: 'image', asset: 'falta.png', alt: 'Mapa del Imperio napoleónico' },
      { id: 's-code', type: 'code', language: 'python', code: 'def factorial(n: int) -> int:\n    """Producto de 1·2·…·n."""\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n\nprint(factorial(5))  # 120', output: '120', caption: 'Una función recursiva.' }
    ]
  },
  {
    id: 'visual',
    title: 'Bloques visuales y desconocidos',
    blocks: [
      { id: 's-diagram', type: 'diagram', kind: 'flow', title: 'Ciclo del agua', direction: 'lr', nodes: [{ id: 'e', label: 'Evaporación' }, { id: 'c', label: 'Condensación' }, { id: 'p', label: 'Precipitación' }], edges: [{ from: 'e', to: 'c' }, { from: 'c', to: 'p' }, { from: 'p', to: 'e' }] },
      { id: 's-drawing', type: 'drawing', title: 'Triángulo rectángulo', width: 300, height: 200, items: [{ kind: 'polygon', points: [[40, 160], [260, 160], [40, 40]] }] },
      { id: 's-labeled', type: 'labeled', title: 'Partes del corazón', alt: 'Corazón', labels: [] },
      { id: 's-model', type: 'model3d', title: 'Molécula de agua', formula: 'H2O' },
      { id: 's-sim', type: 'simulation', title: 'Tiro parabólico', preset: 'projectile' },
      { id: 's-map', type: 'map', title: 'Ríos de la península' },
      { id: 's-unknown', type: 'hologram', md: 'De una versión futura.' }
    ]
  }
]
