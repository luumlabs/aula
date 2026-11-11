// Lo que la lección tiene que enseñar a la vista: una gráfica en 3D cuando trabaja con funciones de dos variables y una
// foto real cuando el curso trata de cosas que existen y hay web. Son fallos de la auditoría, como los demás.
import { describe, expect, it } from 'vitest'
import { decodeBlocks } from '@shared/schema/blocks'
import { auditSkill, nameSkillMentions, showItProblems } from './audit'
import { aboutRealThings } from './goal'
import { makeSkill } from '@shared/schema'

const blocks = (raw: unknown[]) => decodeBlocks(raw, 0)
const text = (md: string) => ({ type: 'text', md })

describe('verlo en 3D', () => {
  const surface = [text('Una función $z = f(x, y)$ da una altura a cada punto.'), text('Para $f(x, y) = x^2 + y^2$ el punto $(1, 1, 2)$ está en la superficie.'), text('La silla es $z = x^2 - y^2$.')]
  it('una lección de funciones de dos variables sin ninguna figura 3D no pasa', () => {
    const out = showItProblems(blocks([...surface, { type: 'plot', functions: [{ expr: 'x^2' }] }]), { realPictures: false }, 'es')
    expect(out).toHaveLength(1)
    expect(out[0].forAI).toContain('model3d')
    expect(out[0].forUser).toContain('3D')
  })
  it('si ya enseña una gráfica 3D, o habla de otra cosa, no', () => {
    const with3D = blocks([...surface, { type: 'model3d', title: 'Cuenco', alt: 'Paraboloide', graph: { surfaces: ['x^2 + y^2'] } }])
    expect(with3D.some((b) => b.type === 'model3d')).toBe(true)
    expect(showItProblems(with3D, { realPictures: false })).toEqual([])
    expect(showItProblems(blocks([text('La derivada de $f(x) = x^2$ es $2x$.'), text('El punto $(1, 2)$ está en la recta $y = 2x$.')]), { realPictures: false })).toEqual([])
    // una sola mención de pasada no basta
    expect(showItProblems(blocks([text('Más adelante verás funciones $f(x, y)$.')]), { realPictures: false })).toEqual([])
  })
})

describe('una imagen real', () => {
  const lesson = [text('La mitocondria tiene doble membrana.'), { type: 'labeled', title: 'Partes', alt: 'Esquema', drawing: { width: 100, height: 100, items: [] }, parts: [] }]
  it('solo cuando el curso trata de cosas reales con web: una lección sin foto no pasa', () => {
    expect(showItProblems(blocks(lesson), { realPictures: false })).toEqual([])
    const out = showItProblems(blocks(lesson), { realPictures: true }, 'en')
    expect(out).toHaveLength(1)
    expect(out[0].forAI).toContain('find_image')
  })
  it('con una imagen del curso (suelta o como figura con partes) ya no', () => {
    expect(showItProblems(blocks([...lesson, { type: 'image', asset: 'mito.jpg', alt: 'Micrografía' }]), { realPictures: true })).toEqual([])
    expect(showItProblems(blocks([text('x'), { type: 'labeled', asset: 'cell.jpg', alt: 'Célula', parts: [] }]), { realPictures: true })).toEqual([])
  })
  it('una terna suelta (un color, una lista) no pide 3D: hace falta una función de dos variables', () => {
    expect(showItProblems(blocks([text('Los puntos $(1, 2, 3)$, $(4, 5, 6)$ y $(7, 8, 9)$ son ternas.'), text('El color (255, 0, 0) es rojo.')]), { realPictures: false })).toEqual([])
  })
  it('llegan por auditSkill solo con la auditoría de enseñanza', () => {
    const skill = makeSkill({ id: 's1', title: 'Mitocondria' })
    skill.lesson = blocks(lesson)
    const teaching = auditSkill(skill, 'quick', [], 'es', { teaching: true, realPictures: true })
    expect(teaching.some((p) => p.forAI.includes('find_image'))).toBe(true)
    expect(auditSkill(skill, 'quick', [], 'es').some((p) => p.forAI.includes('find_image'))).toBe(false)
  })
})

describe('¿el curso trata de cosas reales?', () => {
  it('por la asignatura, el título o los temas', () => {
    expect(aboutRealThings('La célula eucariota', 'Biología')).toBe(true)
    expect(aboutRealThings('Unit 4', 'World History')).toBe(true)
    expect(aboutRealThings('Examen 2', '', 'rocas ígneas, volcanes')).toBe(true)
    expect(aboutRealThings('Anatomía del corazón')).toBe(true)
  })
  it('las asignaturas abstractas no', () => {
    expect(aboutRealThings('Derivadas básicas', 'Matemáticas')).toBe(false)
    expect(aboutRealThings('Funciones de dos variables', 'Cálculo')).toBe(false)
    expect(aboutRealThings('Inglés B2', 'Idiomas')).toBe(false)
    expect(aboutRealThings('Programación en Python', 'Informática')).toBe(false)
    expect(aboutRealThings('Artículos y preposiciones', 'Lengua')).toBe(false)
  })
})

describe('las otras lecciones se citan por su título', () => {
  const others = [{ id: 'reglas-polinomios', title: 'Reglas básicas: constante, potencia y suma' }, { id: 'definicion-derivada', title: 'La derivada como límite' }, { id: 's1', title: 'Esta misma' }]
  it('cambia el identificador interno por el título, en la lección, los ejercicios y las tarjetas', () => {
    const skill = makeSkill({ id: 's1', title: 'Producto y cociente' })
    skill.lesson = blocks([text('En `reglas-polinomios` aprendiste a derivar término a término. En `definicion-derivada` viste el límite.'), { type: 'callout', kind: 'tip', md: 'Repasa `reglas-polinomios`.' }])
    skill.cards = [{ id: 'c1', kind: 'basic', front: '¿Qué viste en `definicion-derivada`?', back: 'El límite', tags: [] }] as unknown as typeof skill.cards
    const out = nameSkillMentions(skill, others, 'es')
    const all = JSON.stringify(out)
    expect(all).toContain('En «Reglas básicas: constante, potencia y suma» aprendiste')
    expect(all).toContain('En «La derivada como límite» viste')
    expect(all).toContain('¿Qué viste en «La derivada como límite»?')
    expect(all).not.toContain('`reglas-polinomios`')
    expect(JSON.stringify(nameSkillMentions(skill, others, 'en'))).toContain('“Reglas básicas: constante, potencia y suma”')
  })
  it('no toca el código, ni lo que no es una lección del curso, ni su propio identificador', () => {
    const skill = makeSkill({ id: 's1', title: 'x' })
    skill.lesson = blocks([text('Usa `print(x)` y la variable `s1`.'), { type: 'code', language: 'python', code: 'reglas = `reglas-polinomios`' }])
    expect(nameSkillMentions(skill, others, 'es')).toBe(skill)
  })
})
