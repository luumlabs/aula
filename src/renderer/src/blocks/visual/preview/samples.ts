// Ejemplos de los bloques visuales para la página de desarrollo (y para revisar el diseño en capturas). JSON como lo escribe
// la IA, leído con el mismo decodificador que los cursos.
import { decodeBlock, type Block } from '@shared/schema/blocks'

const raw: Record<string, unknown[]> = {
  diagram: [
    {
      id: 'd-flow', type: 'flowchart', title: '¿Es primo un número $n$?', direction: 'tb',
      nodes: [
        { id: 'a', label: 'Empieza con $n \\ge 2$', shape: 'round' },
        { id: 'b', label: '$d = 2$' },
        { id: 'c', label: '¿$d^2 \\le n$?', shape: 'diamond' },
        { id: 'd', label: '¿$d$ divide a $n$?', shape: 'diamond' },
        { id: 'e', label: '$n$ es compuesto', shape: 'round', color: 'red' },
        { id: 'f', label: '$d = d + 1$' },
        { id: 'g', label: '$n$ es primo', shape: 'round', color: 'green' }
      ],
      edges: [
        { from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd', label: 'sí' }, { from: 'c', to: 'g', label: 'no' },
        { from: 'd', to: 'e', label: 'sí' }, { from: 'd', to: 'f', label: 'no' }, { from: 'f', to: 'c', dashed: true }
      ],
      caption: 'Basta probar divisores hasta $\\sqrt{n}$.'
    },
    {
      id: 'd-krebs', type: 'diagram', kind: 'cycle', title: 'Ciclo de Krebs (simplificado)',
      nodes: [
        { id: 'cit', label: 'Citrato', detail: '6 C' },
        { id: 'iso', label: 'Isocitrato', detail: '6 C' },
        { id: 'akg', label: '$\\alpha$-cetoglutarato', detail: '5 C' },
        { id: 'suc', label: 'Succinil-CoA', detail: '4 C' },
        { id: 'sca', label: 'Succinato', detail: '4 C' },
        { id: 'fum', label: 'Fumarato', detail: '4 C' },
        { id: 'mal', label: 'Malato', detail: '4 C' },
        { id: 'oaa', label: 'Oxalacetato', detail: '4 C', color: 'teal' }
      ],
      steps: [
        { title: 'Entra el acetil-CoA', md: 'El acetil-CoA (2 C) se une al **oxalacetato** (4 C) y forma **citrato** (6 C).', nodes: ['oaa', 'cit'] },
        { title: 'Isomerización', md: 'El citrato se reorganiza en isocitrato.', nodes: ['iso'] },
        { title: 'Primera descarboxilación', md: 'Sale un $\\ce{CO2}$ y se forma un $\\ce{NADH}$.', nodes: ['akg'] },
        { title: 'Segunda descarboxilación', md: 'Sale otro $\\ce{CO2}$ y otro $\\ce{NADH}$.', nodes: ['suc'] },
        { title: 'Fosforilación a nivel de sustrato', md: 'Se obtiene un GTP (o ATP).', nodes: ['sca'] },
        { title: 'Oxidación', md: 'Se forma $\\ce{FADH2}$.', nodes: ['fum'] },
        { title: 'Hidratación', md: 'Se añade agua.', nodes: ['mal'] },
        { title: 'Se regenera el oxalacetato', md: 'Último $\\ce{NADH}$: el ciclo vuelve a empezar.', nodes: ['oaa'] }
      ]
    },
    {
      id: 'd-concept', type: 'conceptmap', title: 'La célula', direction: 'lr',
      nodes: [
        { id: 'cel', label: 'Célula', color: 'accent' },
        { id: 'pro', label: 'Procariota' }, { id: 'euk', label: 'Eucariota' },
        { id: 'nuc', label: 'Núcleo', detail: 'Guarda el ADN' }, { id: 'mit', label: 'Mitocondria', detail: 'Respiración celular' },
        { id: 'clo', label: 'Cloroplasto', detail: 'Fotosíntesis', color: 'green' }, { id: 'bac', label: 'Bacterias' }
      ],
      edges: [
        { from: 'cel', to: 'pro', label: 'puede ser' }, { from: 'cel', to: 'euk', label: 'puede ser' }, { from: 'pro', to: 'bac', label: 'p. ej.' },
        { from: 'euk', to: 'nuc', label: 'tiene' }, { from: 'euk', to: 'mit', label: 'tiene' }, { from: 'euk', to: 'clo', label: 'en plantas' }
      ]
    },
    {
      id: 'd-mitosis', type: 'diagram', kind: 'flow', direction: 'lr', title: 'Fases de la mitosis',
      nodes: [{ id: 'p', label: 'Profase' }, { id: 'm', label: 'Metafase' }, { id: 'a', label: 'Anafase' }, { id: 't', label: 'Telofase' }, { id: 'c', label: 'Citocinesis', shape: 'round' }],
      edges: [{ from: 'p', to: 'm' }, { from: 'm', to: 'a' }, { from: 'a', to: 't' }, { from: 't', to: 'c' }],
      steps: [
        { title: 'Profase', md: 'La cromatina se condensa en cromosomas y se forma el huso.', nodes: ['p'] },
        { title: 'Metafase', md: 'Los cromosomas se alinean en el **plano ecuatorial**.', nodes: ['m'] },
        { title: 'Anafase', md: 'Las cromátidas hermanas se separan hacia los polos.', nodes: ['a'] },
        { title: 'Telofase', md: 'Se forman dos núcleos nuevos.', nodes: ['t'] },
        { title: 'Citocinesis', md: 'El citoplasma se divide: dos células hijas.', nodes: ['c'] }
      ]
    }
  ],
  labeled: [
    {
      id: 'l-cell', type: 'labeled', title: 'La célula animal', alt: 'Esquema de una célula animal', labels: 'auto', practice: true,
      drawing: {
        width: 600, height: 400,
        items: [
          { kind: 'ellipse', cx: 300, cy: 200, rx: 272, ry: 176, stroke: 'brown', fill: 'amber', opacity: 0.08, width: 2.5 },
          { kind: 'curve', points: [[190, 250], [215, 330], [290, 310]], stroke: 'teal', width: 1.6 },
          { kind: 'curve', points: [[180, 236], [200, 345], [300, 330]], stroke: 'teal', width: 1.6 },
          { kind: 'circle', cx: 300, cy: 190, r: 72, stroke: 'plum', fill: 'plum', opacity: 0.14, width: 2 },
          { kind: 'circle', cx: 318, cy: 178, r: 20, stroke: 'plum', fill: 'plum', opacity: 0.45, width: 1 },
          { kind: 'ellipse', cx: 140, cy: 160, rx: 46, ry: 20, stroke: 'terracotta', fill: 'terracotta', opacity: 0.18, width: 1.8 },
          { kind: 'polyline', points: [[104, 160], [116, 150], [128, 168], [140, 150], [152, 168], [164, 150], [176, 160]], stroke: 'terracotta', width: 1.2 },
          { kind: 'ellipse', cx: 470, cy: 285, rx: 38, ry: 17, stroke: 'terracotta', fill: 'terracotta', opacity: 0.18, width: 1.8 },
          { kind: 'arc', cx: 470, cy: 170, r: 34, start: 200, end: 320, stroke: 'blue', width: 3 },
          { kind: 'arc', cx: 470, cy: 170, r: 44, start: 205, end: 315, stroke: 'blue', width: 3 },
          { kind: 'arc', cx: 470, cy: 170, r: 54, start: 210, end: 310, stroke: 'blue', width: 3 },
          { kind: 'circle', cx: 180, cy: 292, r: 16, stroke: 'green', fill: 'green', opacity: 0.22, width: 1.6 },
          { kind: 'dot', cx: 400, cy: 330, r: 3, fill: 'gray' }, { kind: 'dot', cx: 420, cy: 120, r: 3, fill: 'gray' }, { kind: 'dot', cx: 230, cy: 110, r: 3, fill: 'gray' }
        ]
      },
      layers: [
        { id: 'org', name: 'Orgánulos', color: 'terracotta', visible: true },
        { id: 'cito', name: 'Citoesqueleto', color: 'gray', visible: false, items: [
          { kind: 'line', x1: 60, y1: 200, x2: 220, y2: 200, stroke: 'gray', dashed: true, width: 1 },
          { kind: 'line', x1: 380, y1: 200, x2: 560, y2: 210, stroke: 'gray', dashed: true, width: 1 },
          { kind: 'line', x1: 300, y1: 40, x2: 300, y2: 110, stroke: 'gray', dashed: true, width: 1 }
        ] }
      ],
      parts: [
        { id: 'mem', name: 'Membrana plasmática', x: 0.06, y: 0.62, detail: 'Bicapa de lípidos que separa la célula del exterior y regula lo que entra y sale.' },
        { id: 'nuc', name: 'Núcleo', x: 0.43, y: 0.38, r: 0.12, detail: 'Guarda el **ADN** y dirige la actividad de la célula.' },
        { id: 'nuo', name: 'Nucléolo', aliases: ['nucleolo'], x: 0.53, y: 0.445, r: 0.034, detail: 'Fabrica los ribosomas.' },
        { id: 'mit', name: 'Mitocondria', layer: 'org', x: 0.233, y: 0.4, rect: [0.155, 0.34, 0.156, 0.12], detail: 'Respiración celular: $\\ce{C6H12O6 + 6O2 -> 6CO2 + 6H2O}$ + ATP.' },
        { id: 'gol', name: 'Aparato de Golgi', layer: 'org', x: 0.75, y: 0.36, polygon: [[0.68, 0.33], [0.79, 0.24], [0.87, 0.33], [0.8, 0.43], [0.7, 0.42]], detail: 'Empaqueta y distribuye proteínas.' },
        { id: 'lis', name: 'Lisosoma', layer: 'org', x: 0.3, y: 0.73, r: 0.03, detail: 'Digiere lo que la célula ya no necesita.' },
        { id: 'ret', name: 'Retículo endoplasmático', x: 0.4, y: 0.79, polygon: [[0.3, 0.6], [0.36, 0.85], [0.5, 0.84], [0.48, 0.76], [0.36, 0.74]], detail: 'Red de membranas donde se fabrican proteínas y lípidos.' },
        { id: 'cit', name: 'Citoplasma', x: 0.66, y: 0.66, detail: 'El medio acuoso donde flotan los orgánulos.' }
      ],
      caption: 'Pasa el ratón por cada parte; luego prueba «Señala» y «Arrastra».'
    },
    {
      id: 'l-eye', type: 'labeled', title: 'El ojo (vista frontal)', alt: 'Ojo', asset: 'demo-eye.svg', aspect: 1.6, labels: 'auto',
      parts: [
        { id: 'pup', name: 'Pupila', x: 0.5, y: 0.5, r: 0.045, detail: 'Orificio por el que entra la luz.' },
        { id: 'iri', name: 'Iris', x: 0.58, y: 0.36, r: 0.13, detail: 'Músculo coloreado que regula el tamaño de la pupila.' },
        { id: 'esc', name: 'Esclerótica', x: 0.2, y: 0.5, rect: [0.06, 0.2, 0.88, 0.6], detail: 'La parte blanca: protege el ojo.' },
        { id: 'pes', name: 'Pestañas', x: 0.5, y: 0.1 }
      ],
      credit: 'Dibujo de ejemplo de Aula (dominio público).'
    }
  ],
  simulation: [
    { id: 's-proj', type: 'simulation', preset: 'projectile' },
    { id: 's-pend', type: 'simulation', preset: 'pendulum' },
    { id: 's-rc', type: 'simulation', preset: 'rc' },
    { id: 's-pk', type: 'simulation', preset: 'pharmacokinetics' },
    { id: 's-enz', type: 'simulation', preset: 'enzyme' },
    { id: 's-sd', type: 'simulation', preset: 'supply-demand' },
    { id: 's-wave', type: 'simulation', preset: 'wave' },
    { id: 's-pop', type: 'simulation', preset: 'population' },
    { id: 's-decay', type: 'simulation', preset: 'decay' },
    { id: 's-spring', type: 'simulation', preset: 'spring' }
  ],
  map: [
    {
      id: 'm-med', type: 'map', title: 'El Mediterráneo antiguo', practice: true,
      markers: [
        { title: 'Roma', lat: 41.9, lon: 12.5, md: 'Capital del Imperio romano. Fundada, según la tradición, en el **753 a. C.**' },
        { title: 'Atenas', lat: 37.98, lon: 23.73, md: 'Cuna de la democracia (siglo V a. C.).' },
        { title: 'Cartago', lat: 36.85, lon: 10.32, md: 'Rival de Roma en las guerras púnicas.', color: 'plum' },
        { title: 'Alejandría', lat: 31.2, lon: 29.92, md: 'Su biblioteca fue la mayor de la Antigüedad.' },
        { title: 'Constantinopla', lat: 41.01, lon: 28.98, md: 'Capital del Imperio romano de Oriente desde el 330.' }
      ],
      regions: [{ name: 'Magna Grecia', color: 'teal', md: 'Colonias griegas del sur de Italia y Sicilia.', points: [[41.0, 15.0], [40.5, 18.5], [38.0, 16.6], [36.6, 15.0], [37.6, 12.4], [38.3, 12.8], [40.0, 15.6]] }],
      routes: [{ label: 'Vía Apia', color: 'terracotta', points: [[41.9, 12.5], [41.4, 13.4], [41.1, 14.5], [40.9, 16.0], [40.63, 17.94]] }],
      caption: 'Pulsa una ciudad para leer sobre ella; luego prueba «¿Dónde está…?».'
    },
    {
      id: 'm-world', type: 'map', title: 'El primer viaje de Colón (1492)',
      markers: [
        { title: 'Palos de la Frontera', lat: 37.23, lon: -6.89, md: 'Sale el **3 de agosto de 1492**.' },
        { title: 'Canarias', lat: 28.1, lon: -15.4, md: 'Escala para reparar la *Pinta*.' },
        { title: 'Guanahaní', lat: 24.05, lon: -74.5, md: 'Llegada el **12 de octubre de 1492**.' }
      ],
      routes: [{ label: 'Ida', color: 'blue', points: [[37.23, -6.89], [28.1, -15.4], [26, -35], [25, -55], [24.05, -74.5]] }, { color: 'gray', dashed: true, label: 'Vuelta', points: [[19.7, -72.2], [35, -50], [38.7, -27.2], [37.23, -6.89]] }]
    }
  ],
  model3d: [
    { id: 'x-water', type: 'molecule', title: 'Molécula de agua', formula: 'H2O', lonePairs: true, caption: 'Los dos pares libres del oxígeno cierran el ángulo hasta 104,5°.' },
    { id: 'x-nh3', type: 'model3d', title: 'Amoniaco', formula: 'NH3', lonePairs: true },
    { id: 'x-ch4', type: 'model3d', title: 'Metano', formula: 'metano' },
    { id: 'x-co2', type: 'model3d', title: 'Dióxido de carbono', formula: 'CO2' },
    { id: 'x-benz', type: 'model3d', title: 'Benceno', formula: 'benceno' },
    { id: 'x-sf6', type: 'model3d', title: 'Hexafluoruro de azufre', formula: 'SF6' },
    { id: 'x-nacl', type: 'model3d', title: 'Red del cloruro de sodio', formula: 'NaCl', atomLabels: false },
    { id: 'x-eth', type: 'model3d', title: 'Etanol (esferas)', formula: 'etanol', style: 'spacefill' },
    { id: 'x-solids', type: 'solid', title: 'Sólidos platónicos', solids: [
      { shape: 'tetrahedron', a: 2, x: -4.2, dims: true, label: 'Tetraedro' },
      { shape: 'cube', a: 2, x: -1.4, dims: true, label: 'Cubo' },
      { shape: 'octahedron', a: 2, x: 1.4, label: 'Octaedro' },
      { shape: 'dodecahedron', a: 1.2, x: 4.4, dims: true, label: 'Dodecaedro' }
    ] },
    { id: 'x-cyl', type: 'solid', title: 'Cilindro y cono', solids: [{ shape: 'cylinder', r: 1, h: 3, x: -1.6, dims: true }, { shape: 'cone', r: 1.2, h: 3, x: 1.8, dims: true, color: 'teal' }] },
    { id: 'x-missing', type: 'model3d', title: 'Corazón (modelo del curso)', asset: 'corazon.usda' },
    { id: 'x-obj', type: 'model3d', title: 'Modelo del curso (OBJ)', asset: 'demo-ring.obj', caption: 'Un anillo cargado desde un archivo OBJ del curso.' }
  ],
  slides: [
    {
      id: 'sl-aula', type: 'slides', title: 'Derivadas', summary: 'Tema 3 · Cálculo I', theme: 'aula', transition: 'fade',
      slides: [
        { layout: 'title', title: 'La derivada', subtitle: 'Ritmo de cambio instantáneo', notes: 'Empieza preguntando qué marca el velocímetro de un coche.' },
        { layout: 'content', title: 'Idea clave', blocks: [{ type: 'text', md: '- La derivada mide **cómo cambia** $f$ cuando cambia $x$.\n- Geométricamente: la **pendiente de la tangente**.\n- Se define como un límite:' }, { type: 'math', tex: "f'(x)=\\lim_{h\\to 0}\\frac{f(x+h)-f(x)}{h}" }], notes: 'Dibuja la secante que se convierte en tangente.' },
        { layout: 'twoColumn', title: 'Reglas básicas', blocks: [{ type: 'text', md: '**Potencia**\n\n$(x^n)\'=n\\,x^{n-1}$' }], right: [{ type: 'text', md: '**Producto**\n\n$(fg)\'=f\'g+fg\'$' }] },
        { layout: 'comparison', title: 'Continua vs. derivable', leftTitle: 'Continua', rightTitle: 'Derivable', blocks: [{ type: 'text', md: '- Sin saltos\n- $|x|$ lo es en 0' }], right: [{ type: 'text', md: '- Sin picos\n- $|x|$ **no** lo es en 0' }] },
        { layout: 'formula', title: 'Regla de la cadena', blocks: [{ type: 'math', tex: "(f\\circ g)'(x)=f'(g(x))\\,g'(x)" }] },
        { layout: 'quote', title: 'Lo que sabemos es una gota de agua; lo que ignoramos es el océano.', subtitle: 'Isaac Newton' },
        { layout: 'section', title: 'Aplicaciones', subtitle: 'Máximos, mínimos y optimización' },
        { layout: 'image', title: 'Una figura', image: 'demo-eye.svg', credit: 'Dibujo de ejemplo (dominio público)' }
      ]
    },
    { id: 'sl-min', type: 'slides', title: 'Minimal', theme: 'minimal', slides: [{ layout: 'content', title: 'Tema «minimal»', blocks: [{ type: 'text', md: '- Fondo de papel claro\n- Raya fina de color arriba\n- Letra sin remates' }] }] },
    { id: 'sl-aca', type: 'slides', title: 'Académico', theme: 'academic', slides: [{ layout: 'content', title: 'Tema «academic»', blocks: [{ type: 'text', md: 'Serif en títulos y cuerpo, con la **doble raya** encima del pie, como un artículo.' }] }] },
    { id: 'sl-mid', type: 'slides', title: 'Medianoche', theme: 'midnight', slides: [{ layout: 'title', title: 'Tema «midnight»', subtitle: 'Oscuro y sereno' }] },
    { id: 'sl-chalk', type: 'slides', title: 'Pizarra', theme: 'chalk', slides: [{ layout: 'focus', title: 'Tema «chalk»', blocks: [{ type: 'math', tex: 'E = mc^2' }] }] }
  ],
  drawing: [
    {
      id: 'dr-1', type: 'drawing', title: 'Teorema de Pitágoras', width: 420, height: 300,
      items: [
        { kind: 'polygon', points: [[70, 240], [330, 240], [70, 70]], stroke: 'ink', fill: 'blue', opacity: 0.1, width: 2 },
        { kind: 'rightAngle', cx: 70, cy: 240, r: 16, stroke: 'ink', width: 1.5 },
        { kind: 'angle', cx: 330, cy: 240, r: 42, start: 147, end: 180, stroke: 'accent', width: 1.5, label: '$\\alpha$' },
        { kind: 'text', x: 200, y: 262, text: '$b$', size: 17 },
        { kind: 'text', x: 50, y: 155, text: '$a$', size: 17 },
        { kind: 'text', x: 214, y: 140, text: '$c$', size: 17 },
        { kind: 'arrow', x1: 340, y1: 80, x2: 220, y2: 150, stroke: 'gray', dashed: true, width: 1.5 },
        { kind: 'text', x: 345, y: 70, text: 'hipotenusa', anchor: 'left', size: 13, stroke: 'gray' },
        { kind: 'dot', cx: 70, cy: 70, r: 4, fill: 'accent' },
        { kind: 'curve', points: [[90, 40], [200, 10], [300, 60]], stroke: 'teal', width: 1.5, dashed: false },
        { kind: 'text', x: 210, y: 290, text: '$a^2 + b^2 = c^2$', size: 15 }
      ],
      caption: 'En un triángulo rectángulo, el cuadrado de la hipotenusa es la suma de los cuadrados de los catetos.'
    }
  ]
}

/** Archivos de ejemplo (en la app vienen del curso por aula-asset://). */
function ringObj(): string {
  const v: string[] = [], f: string[] = []
  const N = 48, M = 16, R = 2, r = 0.6
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const a = (i / N) * Math.PI * 2, b = (j / M) * Math.PI * 2
    v.push(`v ${((R + r * Math.cos(b)) * Math.cos(a)).toFixed(4)} ${(r * Math.sin(b)).toFixed(4)} ${((R + r * Math.cos(b)) * Math.sin(a)).toFixed(4)}`)
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const k = (x: number, y: number): number => ((x % N) * M + (y % M)) + 1
    f.push(`f ${k(i, j)} ${k(i + 1, j)} ${k(i + 1, j + 1)} ${k(i, j + 1)}`)
  }
  return [...v, ...f].join('\n')
}

export const VISUAL_PREVIEW_ASSETS: Record<string, string> = {
  'demo-ring.obj': 'data:text/plain;base64,' + btoa(ringObj()),
  'demo-eye.svg':
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><path d="M50 250 Q400 20 750 250 Q400 480 50 250Z" fill="#fbfaf7" stroke="#3a332c" stroke-width="5"/><circle cx="400" cy="250" r="105" fill="#4f7d8c"/><circle cx="400" cy="250" r="105" fill="none" stroke="#2c4a54" stroke-width="5"/><g stroke="#33616e" stroke-width="3">${Array.from({ length: 24 }, (_, i) => { const a = (i * Math.PI) / 12; return `<line x1="${400 + 42 * Math.cos(a)}" y1="${250 + 42 * Math.sin(a)}" x2="${400 + 98 * Math.cos(a)}" y2="${250 + 98 * Math.sin(a)}"/>` }).join('')}</g><circle cx="400" cy="250" r="36" fill="#1d1a17"/><circle cx="420" cy="232" r="11" fill="#fff" opacity=".85"/><g stroke="#3a332c" stroke-width="4" stroke-linecap="round">${Array.from({ length: 13 }, (_, i) => { const x = 150 + i * 42; return `<line x1="${x}" y1="${118 - Math.sin((i / 12) * Math.PI) * 30 + 30}" x2="${x - 8}" y2="${70 - Math.sin((i / 12) * Math.PI) * 30 + 30}"/>` }).join('')}</g></svg>`
    )
}

export const VISUAL_SAMPLES: Record<string, Block[]> = Object.fromEntries(
  Object.entries(raw).map(([k, list]) => [k, list.map((x) => decodeBlock(x)).filter((b): b is Block => b !== undefined)])
)
