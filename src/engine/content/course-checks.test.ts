// Comprobaciones nuevas del contenido con los casos del juez: tarjeta cloze dentro de \ce (ajr-c4), clave numérica exacta con
// datos aproximados (capand-e14), pistas que dan la respuesta de un hueco y ejercicios repetidos entre habilidades (ccsb-e2 y
// dyrg-e1).
import { describe, expect, it } from 'vitest'
import { decodeExercise, decodeFlashcard, makeSkill, type Exercise, type Skill } from '@shared/schema'
import { ContentValidator } from './validator'
import { approximateDataIssues, approximationIn, containsWord, hintRevealsBlankIssues } from './answer-hygiene'
import { courseDuplicateExercises, duplicateToDrop, exerciseFingerprint } from './duplicates'

function ex(raw: Record<string, unknown>): Exercise {
  const e = decodeExercise({ id: 'e', skill: 's', prompt: ['p'], ...raw })
  if (!e) throw new Error('ejercicio ilegible')
  return e
}

describe('tarjetas cloze con fórmulas', () => {
  const v = new ContentValidator()
  it('ajr-c4 (huecos dentro de \\ce) se dibuja con los huecos ocultos y resueltos', () => {
    const card = decodeFlashcard({ id: 'ajr-c4', kind: 'cloze', front: 'Combustión del propano ajustada: $\\ce{C3H8 + {{c1::5}}O2 -> {{c2::3}}CO2 + {{c3::4}}H2O}$', back: '' })!
    expect(v.checkCard(card, 'cards[ajr-c4]').filter((i) => i.severity === 'error')).toEqual([])
  })
  it('una respuesta que KaTeX no puede dibujar es un error (solo se ve al resolver)', () => {
    const card = decodeFlashcard({ id: 'c', kind: 'cloze', front: 'Seno de 30°: $\\sin 30^\\circ = {{c1::\\frac{1}}}$', back: '' })!
    const errors = v.checkCard(card, 'cards[c]').filter((i) => i.severity === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].path).toBe('cards[c].front')
    expect(errors[0].message).toMatch(/con los huecos resueltos/)
  })
})

describe('datos aproximados y clave sin tolerancia', () => {
  const capand14 = ex({
    id: 'capand-e14',
    prompt: [{ type: 'text', md: 'Compara **Bolivia** y **Ecuador** con las altitudes aproximadas de la lección: La Paz ≈ 3.600 m, Sucre ≈ 2.800 m, Quito ≈ 2.850 m.' }],
    answer: { kind: 'multi', parts: [
      { label: 'a', prompt: '¿Cuántos metros más alta está la sede de gobierno de Bolivia que la capital de Ecuador?', answer: { kind: 'numeric', value: '750', absTol: 0, relTol: 0, unit: 'm' } },
      { label: 'c', prompt: '¿En qué país coinciden capital y sede de gobierno?', answer: { kind: 'short', accepted: ['Ecuador'] } }
    ] }
  })
  it('avisa en la parte numérica de capand-e14', () => {
    const issues = approximateDataIssues(capand14, 'exercises[capand-e14]')
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('warning')
    expect(issues[0].path).toBe('exercises[capand-e14].answer.parts[0].answer')
    expect(issues[0].message).toMatch(/≈ 3\.600 m/)
    // el validador lo incluye
    expect(new ContentValidator().checkExercise(capand14, 'exercises[capand-e14]').some((i) => i.message.includes('tolerancia'))).toBe(true)
  })
  it('con tolerancia, con datos exactos o sin datos aproximados, nada', () => {
    const tol = ex({ prompt: [{ type: 'text', md: 'La Paz está a unos 3600 m y Quito a unos 2850 m. ¿Diferencia?' }], answer: { kind: 'numeric', value: '750', absTol: 50 } })
    expect(approximateDataIssues(tol, 'e')).toEqual([])
    const exact = ex({ prompt: [{ type: 'text', md: 'Un tren recorre 120 km en 2 h. ¿Velocidad media?' }], answer: { kind: 'numeric', value: '60' } })
    expect(approximateDataIssues(exact, 'e')).toEqual([])
    // la grandeza sin número («aproximación lineal») no es un dato aproximado
    const method = ex({ prompt: [{ type: 'text', md: 'Usa la aproximación lineal de $\\sqrt{x}$ en 4 para estimar $\\sqrt{4.1}$.' }], answer: { kind: 'numeric', value: '2.025' } })
    expect(approximateDataIssues(method, 'e')).toEqual([])
  })
  it('«con los datos de la lección» mira la lección', () => {
    const e = ex({ prompt: [{ type: 'text', md: 'Con las altitudes de la lección, ¿cuántos metros separan La Paz de Quito?' }], answer: { kind: 'numeric', value: '750' } })
    expect(approximateDataIssues(e, 'e', 'La Paz está a unos 3.600 m; Quito, a unos 2.850 m.')).toHaveLength(1)
    expect(approximateDataIssues(e, 'e', 'La Paz está a 3.640 m; Quito, a 2.850 m.')).toEqual([])
  })
  it('reconoce las marcas habituales', () => {
    for (const t of ['≈ 3.600 m', 'about 3600 m', 'aproximadamente 25 °C', 'unos 50 m', '~5 km', '$x \\approx 2$', 'around 7 kg']) expect(approximationIn(t), t).toBeDefined()
    for (const t of ['3600 m', 'casi siempre', 'about the war', 'algunos datos']) expect(approximationIn(t), t).toBeUndefined()
  })
})

describe('pistas que dan la respuesta de un hueco', () => {
  it('avisa (palabra entera, sin mayúsculas, con tildes)', () => {
    const e = ex({ answer: { kind: 'cloze', text: '[[1]] [[2]]', blanks: [{ accepted: ['convocar'] }, { accepted: ['nombró'] }] },
      hints: ['Elections are called with *convocar*, not *llamar*.', 'The written accent matters (*nombro* = I appoint).'] })
    const issues = hintRevealsBlankIssues(e, 'exercises[e]')
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toMatch(/hueco 1 \(«convocar»\)/)
    expect(containsWord('Gobierno = president + ministers', 'gobierno')).toBe(true)
    expect(containsWord('desgobierno', 'gobierno')).toBe(false)
  })
  it('también el texto de ayuda que se ve dentro del hueco; los huecos numéricos no', () => {
    const e = ex({ answer: { kind: 'cloze', text: '[[1]] [[2]]', blanks: [{ accepted: ['ganó'], hint: 'ganó' }, { accepted: ['14'], numeric: true }] }, hints: ['Hay 14 H'] })
    const issues = hintRevealsBlankIssues(e, 'exercises[e]')
    expect(issues.map((i) => i.path)).toEqual(['exercises[e].answer.blanks[0].hint'])
  })
})

describe('ejercicios repetidos entre habilidades', () => {
  const skill = (id: string, exercises: Exercise[], tryit: string[] = []): Skill => ({
    ...makeSkill({ id, title: id }), exercises,
    lesson: tryit.length ? [{ id: 't', type: 'tryit', exerciseIDs: tryit, inline: [] }] as Skill['lesson'] : []
  })
  const ccsb2 = ex({ id: 'ccsb-e2', prompt: [{ type: 'text', md: '¿Cuál es la capital de **Paraguay**?' }], answer: { kind: 'short', accepted: ['Asunción', 'Asuncion', 'Nuestra Señora de la Asunción'] } })
  const dyrg1 = ex({ id: 'dyrg-e1', prompt: [{ type: 'text', md: '¿Cuál es la capital de Paraguay?' }], answer: { kind: 'short', accepted: ['Asunción', 'Asuncion'] } })
  const other = ex({ id: 'dyrg-e2', prompt: [{ type: 'text', md: '¿Cuál es la capital de Uruguay?' }], answer: { kind: 'short', accepted: ['Montevideo'] } })

  it('ccsb-e2 y dyrg-e1 son el mismo ejercicio: se queda el primero', () => {
    expect(exerciseFingerprint(ccsb2)).toBe(exerciseFingerprint(dyrg1))
    const d = courseDuplicateExercises([skill('capitales-cono-sur-brasil', [ccsb2]), skill('datos-y-repaso-global', [dyrg1, other])])
    expect(d).toEqual([{ skill: 'datos-y-repaso-global', exercise: 'dyrg-e1', inLesson: false, of: { skill: 'capitales-cono-sur-brasil', exercise: 'ccsb-e2', inLesson: false } }])
    expect(duplicateToDrop(d[0])?.exercise).toBe('dyrg-e1')
  })
  it('la misma pregunta con otra respuesta, o un enunciado corto con figuras distintas, no son repetidos', () => {
    const wrongKey = ex({ id: 'x', prompt: [{ type: 'text', md: '¿Cuál es la capital de Paraguay?' }], answer: { kind: 'short', accepted: ['Ciudad del Este'] } })
    expect(courseDuplicateExercises([skill('a', [ccsb2]), skill('b', [wrongKey])])).toEqual([])
    const fig = (id: string, x: number): Exercise => ex({ id, prompt: [{ type: 'text', md: 'Calcula:' }, { type: 'math', tex: `${x}+1` }], answer: { kind: 'numeric', value: String(x + 1) } })
    expect(courseDuplicateExercises([skill('a', [fig('f1', 1)]), skill('b', [fig('f2', 2)])])).toEqual([])
  })
  it('se quita la copia que no usa ninguna lección; si las dos están en lecciones, ninguna; dentro de una habilidad no cuenta', () => {
    // como en el curso del juez: «Repaso global» enlaza dyrg-e1 en su «Pruébalo»; ccsb-e2 solo estaba en el banco
    const linked = courseDuplicateExercises([skill('a', [ccsb2]), skill('b', [dyrg1], ['dyrg-e1'])])[0]
    expect(linked.inLesson).toBe(true)
    expect(duplicateToDrop(linked)).toEqual({ skill: 'a', exercise: 'ccsb-e2', inLesson: false })
    expect(duplicateToDrop(courseDuplicateExercises([skill('a', [ccsb2], ['ccsb-e2']), skill('b', [dyrg1], ['dyrg-e1'])])[0])).toBeUndefined()
    expect(courseDuplicateExercises([skill('a', [ccsb2, { ...dyrg1, skill: 'a' }])])).toEqual([])
  })
})
