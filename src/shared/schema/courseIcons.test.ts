// Pruebas del catálogo de iconos pixel-art de los cursos (port de CourseIconCatalogTests de
// la app Swift anterior: Tests/StudyModelTests).
import { describe, expect, it } from 'vitest'
import { CourseIconCatalog, ICON_CATEGORIES } from './courseIcons'

describe('CourseIconCatalog', () => {
  it('el catálogo está bien formado', () => {
    const ids = CourseIconCatalog.ids
    expect(ids.length).toBeGreaterThanOrEqual(32)
    expect(new Set(ids).size).toBe(ids.length) // sin identificadores repetidos
    expect(ids).toContain(CourseIconCatalog.fallback)
    for (const id of ids) {
      expect(CourseIconCatalog.resolve(id), id).toBe(id) // un identificador conocido se queda igual
      expect(CourseIconCatalog.hue(id), id).toBeDefined()
    }
    for (const c of ICON_CATEGORIES) expect(CourseIconCatalog.entries(c).length, c).toBeGreaterThan(0)
    expect(CourseIconCatalog.promptList).toContain('chemistry')
  })

  it('adivina por la asignatura y el título', () => {
    const cases: Array<[string, string, string]> = [
      ['Matemáticas (MATH112)', 'Trigonometría · Círculo unidad', 'trigonometry'],
      ['Matemáticas', 'Funciones cuadráticas', 'algebra'],
      ['Matemáticas', 'Repaso general', 'math'],
      ['', 'Cálculo I — derivadas', 'calculus'],
      ['Química', 'Química orgánica · Parcial 2', 'chemistry'],
      ['', 'Educación Física', 'sports'],
      ['', 'Física II', 'physics'],
      ['', 'Historia del arte', 'art'],
      ['', 'Historia de España', 'history'],
      ['Inglés', 'Examen de inglés B2 First', 'language-exam'],
      ['', 'Inglés · Unit 4', 'english'],
      ['', 'Lengua castellana y literatura', 'spanish'],
      ['', 'Francés A2', 'french'],
      ['', 'Preparación DELE C1', 'language-exam'],
      ['', 'Alemán para principiantes', 'german'],
      ['', 'Teórico del carnet de conducir (DGT)', 'driving'],
      ['', 'Oposiciones Auxiliar Administrativo', 'civil-service'],
      ['', 'Derecho constitucional', 'law'],
      ['', 'Contabilidad financiera', 'accounting'],
      ['', 'Programación en Python', 'programming'],
      ['', 'Ingeniería informática: estructuras de datos', 'programming'],
      ['', 'Dibujo técnico', 'geometry'],
      ['', 'Anatomía humana', 'anatomy'],
      ['', 'Enfermería: cuidados básicos', 'medicine'],
      ['', 'Psicología del desarrollo', 'psychology'],
      ['', 'Filosofía · Ética', 'philosophy'],
      ['', 'Biología celular', 'biology'],
      ['', 'Astronomía', 'astronomy'],
      ['', 'Geografía de Europa', 'geography'],
      ['', 'Música · Solfeo', 'music'],
      ['', 'Examen final', 'exam'],
      ['Biology', 'AP Biology — Unit 3', 'biology'],
      ['', 'Chemistry 101 midterm', 'chemistry']
    ]
    for (const [subject, title, expected] of cases) expect(CourseIconCatalog.guess(subject, title), `${subject} / ${title}`).toBe(expected)
    expect(CourseIconCatalog.guess('', 'Mi curso')).toBeUndefined()
    // palabras que contienen otras: «parte» no es arte; «martes» tampoco
    expect(CourseIconCatalog.guess('', 'Segunda parte, martes')).toBeUndefined()
  })

  it('los SF Symbols antiguos se traducen a iconos pixel-art', () => {
    expect(CourseIconCatalog.resolve('flask')).toBe('chemistry')
    expect(CourseIconCatalog.resolve('atom')).toBe('physics')
    expect(CourseIconCatalog.resolve('book.closed')).toBe('study')
    expect(CourseIconCatalog.resolve('chevron.left.forwardslash.chevron.right')).toBe('programming')
    expect(CourseIconCatalog.resolve('paintpalette')).toBe('art')
    expect(CourseIconCatalog.resolve('sparkles')).toBe('idea')
    // «function» se usaba para todas las matemáticas: la asignatura concreta manda
    expect(CourseIconCatalog.resolve('function', 'Matemáticas', 'Trigonometría · Examen 2')).toBe('trigonometry')
    expect(CourseIconCatalog.resolve('function', '', 'Mi curso')).toBe('algebra')
    expect(CourseIconCatalog.resolve('paintpalette', 'Música', 'Armonía')).toBe('music')
    // nombres inventados o en otro idioma
    expect(CourseIconCatalog.resolve('química')).toBe('chemistry')
    expect(CourseIconCatalog.resolve('Chemistry')).toBe('chemistry')
    expect(CourseIconCatalog.resolve('civil_service')).toBe('civil-service')
    expect(CourseIconCatalog.resolve('sparkly.unicorn', 'Historia')).toBe('history')
    expect(CourseIconCatalog.resolve('sparkly.unicorn')).toBe('study')
    expect(CourseIconCatalog.resolve('')).toBe('study')
  })

  it('busca por lo que escribe el estudiante', () => {
    expect(CourseIconCatalog.search('quim').has('chemistry')).toBe(true)
    expect(CourseIconCatalog.search('ingl').has('english')).toBe(true)
    expect(CourseIconCatalog.search('conducir').has('driving')).toBe(true)
    expect(CourseIconCatalog.search('').size).toBe(CourseIconCatalog.ids.length)
  })
})
