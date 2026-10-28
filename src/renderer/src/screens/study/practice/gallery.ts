// Galería de tipos de ejercicio (solo en modo demostración: `skill: '__all-types'`), para revisar cada control.
import { makeExercise, textBlock, type Exercise } from '@shared/schema'

export const GALLERY_SKILL = '__all-types'

const p = (md: string): ReturnType<typeof textBlock>[] => [textBlock(md)]

export function galleryExercises(skill: string): Exercise[] {
  const mk = (id: string, e: Omit<Parameters<typeof makeExercise>[0], 'id' | 'skill'>): Exercise => makeExercise({ id: `g-${id}`, skill, ...e })
  return [
    mk('choice', { level: 1, prompt: p('¿Cuál es el ángulo de referencia de $150^\\circ$?'), answer: { kind: 'choice', multi: false, shuffle: false, options: [
      { id: 'a', md: '$30^\\circ$', correct: true, why: '$180^\\circ-150^\\circ=30^\\circ$.' }, { id: 'b', md: '$60^\\circ$', correct: false, why: 'Ese es el ángulo con el eje $y$.' },
      { id: 'c', md: '$150^\\circ$', correct: false }, { id: 'd', md: '$-30^\\circ$', correct: false }] }, hints: ['¿En qué cuadrante está?'], solution: p('$\\theta\'=180^\\circ-150^\\circ=30^\\circ$.') }),
    mk('multi-choice', { level: 2, prompt: p('Marca las funciones **negativas** en el segundo cuadrante.'), answer: { kind: 'choice', multi: true, shuffle: true, options: [
      { id: 'a', md: '$\\cos\\theta$', correct: true }, { id: 'b', md: '$\\sin\\theta$', correct: false }, { id: 'c', md: '$\\tan\\theta$', correct: true }, { id: 'd', md: '$\\csc\\theta$', correct: false }] } }),
    mk('numeric', { level: 2, points: 2, prompt: p('Halla la longitud del arco con $r = 4$ cm y $\\theta = \\frac{\\pi}{3}$.'), answer: { kind: 'numeric', value: '4*pi/3', alternatives: [], absTol: 0.01, relTol: 0, form: 'any', unit: 'cm', unitMode: 'optional', angle: 'radians', prefix: '$s =$' },
      hints: ['$s = r\\theta$', 'Multiplica $4$ por $\\frac{\\pi}{3}$.'], solution: p('$s = r\\theta = 4\\cdot\\frac{\\pi}{3} = \\frac{4\\pi}{3}\\approx 4{,}19$ cm.'), wrongs: [{ input: '240', why: 'Usaste los grados: con $s=r\\theta$ el ángulo va en **radianes**.' }] }),
    mk('expression', { level: 2, prompt: p('Simplifica $\\sin^2 x + \\cos^2 x + \\tan x \\cos x$.'), answer: { kind: 'expression', expected: '1 + sin(x)', domainMin: -1, domainMax: 1, form: 'any', forbidden: [], angle: 'radians' }, hints: ['Identidad pitagórica.'] }),
    mk('equation', { level: 2, prompt: p('Escribe la ecuación de la recta que pasa por $(0, 1)$ con pendiente $2$.'), answer: { kind: 'equation', expected: 'y = 2x + 1' } }),
    mk('set', { level: 2, prompt: p('Resuelve $\\sin\\theta = \\frac{1}{2}$ en $[0^\\circ, 360^\\circ)$.'), answer: { kind: 'set', expected: ['30', '150'], ordered: false } }),
    mk('interval', { level: 2, prompt: p('¿En qué intervalo de $[0, 2\\pi]$ es $\\cos x < 0$?'), answer: { kind: 'interval', expected: '(pi/2, 3pi/2)' } }),
    mk('point', { level: 1, prompt: p('Punto terminal de $t = \\frac{\\pi}{4}$ en la circunferencia unidad.'), answer: { kind: 'point', expected: ['sqrt(2)/2', 'sqrt(2)/2'], absTol: 0.001 } }),
    mk('short', { level: 1, prompt: p('¿Cómo se llama el ángulo agudo entre el lado terminal y el eje $x$?'), answer: { kind: 'short', accepted: ['ángulo de referencia', 'angulo de referencia'], keywords: [], typoTolerance: true, aiGrade: false } }),
    mk('cloze', { level: 1, prompt: [], answer: { kind: 'cloze', text: 'Un radián es el ángulo que subtiende un arco de longitud igual al [[1]]. Una vuelta completa mide [[2]] radianes.', blanks: [{ accepted: ['radio'], numeric: false }, { accepted: ['2π', '2pi'], numeric: true, hint: '2π' }] } }),
    mk('ordering', { level: 2, prompt: p('Ordena los pasos para hallar el ángulo de referencia de $-210^\\circ$.'), answer: { kind: 'ordering', items: ['Sumar $360^\\circ$: $150^\\circ$', 'Ver que está en el cuadrante II', 'Restar de $180^\\circ$', 'El ángulo de referencia es $30^\\circ$'] } }),
    mk('matching', { level: 2, prompt: p('Relaciona cada ángulo con su ángulo de referencia.'), answer: { kind: 'matching', pairs: [{ left: '$135^\\circ$', right: '$45^\\circ$' }, { left: '$240^\\circ$', right: '$60^\\circ$' }, { left: '$330^\\circ$', right: '$30^\\circ$' }], extraRights: ['$10^\\circ$'] } }),
    mk('truefalse', { level: 1, prompt: p('Verdadero o falso: el ángulo de referencia de $300^\\circ$ es $60^\\circ$.'), answer: { kind: 'truefalse', value: true, explainWhy: false } }),
    mk('locate', { level: 2, prompt: p('Señala en la circunferencia el punto terminal de cada ángulo.'), answer: { kind: 'label', mode: 'locate', alt: 'Circunferencia unidad', wordBank: [], aspect: 1,
      drawing: { width: 300, height: 300, items: [{ kind: 'circle', cx: 150, cy: 150, r: 110 }, { kind: 'line', x1: 20, y1: 150, x2: 280, y2: 150, opacity: 0.5 }, { kind: 'line', x1: 150, y1: 20, x2: 150, y2: 280, opacity: 0.5 }] },
      spots: [{ x: 0.5 + 110 / 300, y: 0.5, accepted: ['$0$'], r: 0.06 }, { x: 0.5, y: 0.5 - 110 / 300, accepted: ['$\\frac{\\pi}{2}$'], r: 0.06 }] } }),
    mk('drag', { level: 2, prompt: p('Arrastra cada etiqueta a su cuadrante.'), answer: { kind: 'label', mode: 'drag', alt: 'Cuadrantes', aspect: 1, wordBank: ['I', 'II', 'III', 'IV'],
      drawing: { width: 300, height: 300, items: [{ kind: 'arrow', x1: 20, y1: 150, x2: 285, y2: 150 }, { kind: 'arrow', x1: 150, y1: 280, x2: 150, y2: 15 }] },
      spots: [{ x: 0.75, y: 0.25, accepted: ['I'] }, { x: 0.25, y: 0.25, accepted: ['II'] }, { x: 0.25, y: 0.75, accepted: ['III'] }, { x: 0.75, y: 0.75, accepted: ['IV'] }] } }),
    mk('chem', { level: 2, prompt: p('Ajusta la combustión del metano.'), answer: { kind: 'chem', mode: 'equation', expected: 'CH4 + 2 O2 -> CO2 + 2 H2O' } }),
    mk('open', { level: 3, points: 4, prompt: p('Explica por qué $\\sin(180^\\circ-\\theta)=\\sin\\theta$.'), answer: { kind: 'open', modelAnswer: 'Los ángulos $\\theta$ y $180^\\circ-\\theta$ tienen el mismo ángulo de referencia y sus puntos terminales están a la misma altura: la coordenada $y$ (el seno) es igual.', rubric: [{ text: 'Menciona el ángulo de referencia', points: 2 }, { text: 'Relaciona el seno con la coordenada $y$', points: 2 }] } }),
    mk('multi', { level: 3, points: 3, prompt: p('Un sector circular tiene radio $6$ y ángulo $\\frac{\\pi}{3}$.'), answer: { kind: 'multi', parts: [
      { label: 'a', prompt: p('Longitud del arco.'), answer: { kind: 'numeric', value: '2*pi', alternatives: [], absTol: 0.01, relTol: 0, form: 'any', unitMode: 'ignore', angle: 'radians' }, points: 1, hints: ['$s = r\\theta$'] },
      { label: 'b', prompt: p('Área del sector.'), answer: { kind: 'numeric', value: '6*pi', alternatives: [], absTol: 0.01, relTol: 0, form: 'any', unitMode: 'ignore', angle: 'radians' }, points: 2, hints: ['$A = \\frac{1}{2}r^2\\theta$'] }] } })
  ]
}
