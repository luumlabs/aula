// Consejos de la auditoría (no invalidan la lección): una gráfica en 3D cuando la lección habla del espacio y una foto
// real cuando el curso trata de cosas que existen y hay web.
import { describe, expect, it } from 'vitest'
import { decodeBlocks } from '@shared/schema/blocks'
import { auditSkill, teachingAdvice } from './audit'
import { aboutRealThings } from './goal'
import { makeSkill } from '@shared/schema'

const blocks = (raw: unknown[]) => decodeBlocks(raw, 0)
const text = (md: string) => ({ type: 'text', md })

describe('consejo: verlo en 3D', () => {
  const surface = [text('Una función $z = f(x, y)$ da una altura a cada punto.'), text('Para $f(x, y) = x^2 + y^2$ el punto $(1, 1, 2)$ está en la superficie.'), text('La silla es $z = x^2 - y^2$.')]
  it('una lección de funciones de dos variables sin ninguna figura 3D recibe el consejo', () => {
    const out = teachingAdvice(blocks([...surface, { type: 'plot', functions: [{ expr: 'x^2' }] }]), { realPictures: false }, 'es')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ advice: true })
    expect(out[0].forAI).toContain('model3d')
    expect(out[0].forUser).toContain('3D')
  })
  it('si ya enseña una gráfica 3D, o habla de otra cosa, no', () => {
    const with3D = blocks([...surface, { type: 'model3d', title: 'Cuenco', alt: 'Paraboloide', graph: { surfaces: ['x^2 + y^2'] } }])
    expect(with3D.some((b) => b.type === 'model3d')).toBe(true)
    expect(teachingAdvice(with3D, { realPictures: false })).toEqual([])
    expect(teachingAdvice(blocks([text('La derivada de $f(x) = x^2$ es $2x$.'), text('El punto $(1, 2)$ está en la recta $y = 2x$.')]), { realPictures: false })).toEqual([])
    // una sola mención de pasada no basta
    expect(teachingAdvice(blocks([text('Más adelante verás funciones $f(x, y)$.')]), { realPictures: false })).toEqual([])
  })
})

describe('consejo: una imagen real', () => {
  const lesson = [text('La mitocondria tiene doble membrana.'), { type: 'labeled', title: 'Partes', alt: 'Esquema', drawing: { width: 100, height: 100, items: [] }, parts: [] }]
  it('solo cuando el curso trata de cosas reales con web: una lección sin foto recibe el consejo', () => {
    expect(teachingAdvice(blocks(lesson), { realPictures: false })).toEqual([])
    const out = teachingAdvice(blocks(lesson), { realPictures: true }, 'en')
    expect(out).toHaveLength(1)
    expect(out[0].advice).toBe(true)
    expect(out[0].forAI).toContain('find_image')
  })
  it('con una imagen del curso (suelta o como figura con partes) ya no', () => {
    expect(teachingAdvice(blocks([...lesson, { type: 'image', asset: 'mito.jpg', alt: 'Micrografía' }]), { realPictures: true })).toEqual([])
    expect(teachingAdvice(blocks([text('x'), { type: 'labeled', asset: 'cell.jpg', alt: 'Célula', parts: [] }]), { realPictures: true })).toEqual([])
  })
  it('llegan por auditSkill marcados como consejo, y solo con la auditoría de enseñanza', () => {
    const skill = makeSkill({ id: 's1', title: 'Mitocondria' })
    skill.lesson = blocks(lesson)
    const teaching = auditSkill(skill, 'quick', [], 'es', { teaching: true, realPictures: true })
    expect(teaching.filter((p) => p.advice)).toHaveLength(1)
    expect(auditSkill(skill, 'quick', [], 'es').some((p) => p.advice)).toBe(false)
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
