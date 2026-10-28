// Clase de meta deducida del nombre y la asignatura (incluye los casos del juez: gentilicios en cursos de historia, «node» en
// anatomía, «Code of Hammurabi», niveles MCER sin idioma) y los de StudyAnythingTests.swift.
import { describe, expect, it } from 'vitest'
import { GUESSED_GOAL_NOTE, goalContextBrief, goalKindIsSure, goalKindOf, goalPedagogy, inferGoal, inferGoalKind, type StudyGoalKind } from './goal'

type Case = [title: string, subject: string, want: StudyGoalKind | undefined]

const CASES: Case[] = [
  // El juez: historia, arte y ciencias con gentilicios o palabras técnicas sueltas
  ['The Spanish Transition to Democracy', 'History', 'subject'],
  ['The French Revolution', 'History', 'subject'],
  ['Russian Revolution 1917', 'History', 'subject'],
  ['Spanish Civil War', 'History', 'subject'],
  ['The Spanish Civil War', '', undefined],
  ['Italian Renaissance art', 'Art history', 'subject'],
  ['Historia del arte chino', '', 'subject'],
  ['Química C1', '', 'subject'],
  ['Lymph node anatomy', 'Biology', 'subject'],
  ['Lymph node anatomy', '', 'subject'],
  ['The Code of Hammurabi', 'History', 'subject'],
  ['The Code of Hammurabi', '', undefined],
  ['English literature: Shakespeare', '', 'subject'],
  ['Historia de la literatura inglesa', '', 'subject'],
  ['German reunification', '', undefined],
  ['Chinese medicine basics', '', 'subject'],
  ['Japanese art history', '', 'subject'],
  ['Arabic numerals history', '', 'subject'],
  ['Cambridge history of philosophy', '', 'subject'],
  ['Vitamina B12 y anemia', 'Biología', 'subject'],
  ['Revolución francesa', 'Historia', 'subject'],
  ['La Revolución Rusa', 'Historia', 'subject'],
  ['Literatura francesa del siglo XIX', 'Literatura', 'subject'],
  ['Literatura española del Siglo de Oro', '', 'subject'],
  ['Lengua castellana y literatura', '', 'subject'],
  ['Historia de España 2º Bachillerato', 'Historia', 'subject'],
  ['Física de 2º de Bachillerato', 'Física', 'subject'],
  ['Código Penal: parte general', 'Derecho', 'subject'],
  ['Angular momentum', 'Physics', 'subject'],
  ['French cuisine techniques', '', 'practicalSkill'],
  ['Cocina mediterránea: historia', '', 'practicalSkill'],
  ['German art for beginners', '', 'topic'],
  ['Learn about the French Revolution', '', 'topic'],
  // Idiomas de verdad
  ['Spanish', '', 'language'],
  ['Inglés', '', 'language'],
  ['Inglés B2', '', 'language'],
  ['Inglés B2 First', '', 'language'],
  ['Learn French', '', 'language'],
  ['Chinese HSK 3', '', 'language'],
  ['Alemán para viajar', '', 'language'],
  ['Francés para viajar', '', 'language'],
  ['Français pour débutants', '', 'language'],
  ['Curso de inglés', '', 'language'],
  ['Gramática inglesa', '', 'language'],
  ['Lengua inglesa', '', 'language'],
  ['Business English', '', 'language'],
  ['Medical English', '', 'language'],
  ['Inglés técnico', '', 'language'],
  ['Inglés técnico para programadores', '', 'language'],
  ['Spanish legal history for beginners', '', 'subject'],
  ['English for Academic Purposes', '', 'language'],
  ['Japanese 101', '', 'language'],
  ['Inglés 2º ESO', '', 'language'],
  ['Spanish B1 grammar: the subjunctive', '', 'language'],
  ['Conversación en italiano', '', 'language'],
  ['Español para extranjeros', '', 'language'],
  ['Español B1', '', 'language'],
  ['Portugués de Brasil', '', 'language'],
  ['Phrasal verbs', 'Inglés', 'language'],
  ['DELE B2', '', 'language'],
  ['Preparar el IELTS', '', 'language'],
  ['Goethe-Zertifikat B1', '', 'language'],
  ['The Spanish Transition to Democracy', 'History (Spanish language through content, CEFR B1 → B2)', 'language'],
  // Programación
  ['Python para análisis de datos', '', 'programming'],
  ['Python desde cero', '', 'programming'],
  ['SQL para analizar datos', '', 'programming'],
  ['Python for biologists', 'Biology', 'programming'],
  ['Learn Rust', '', 'programming'],
  ['React y TypeScript', '', 'programming'],
  ['Pandas DataFrames', '', 'programming'],
  ['Node.js para backend', '', 'programming'],
  ['Lenguaje C', '', 'programming'],
  ['Ruby on Rails', '', 'programming'],
  ['Rust', 'Informática', 'programming'],
  ['Excel VBA', '', 'programming'],
  // Certificaciones, oposiciones, habilidades, asignaturas y temas (StudyAnythingTests.swift)
  ['AWS Certified Cloud Practitioner (CLF-C02)', '', 'certification'],
  ['CompTIA Security+', '', 'certification'],
  ['PMP', '', 'certification'],
  ['CFA nivel 1', '', 'certification'],
  ['Google Data Analytics', '', 'certification'],
  ['Microsoft AZ-900', '', 'certification'],
  ['Oposiciones a auxiliar administrativo', '', 'entranceExam'],
  ['Selectividad: Historia de España', '', 'entranceExam'],
  ['SAT Math', '', 'entranceExam'],
  ['Excel avanzado', '', 'practicalSkill'],
  ['Primeros auxilios', '', 'practicalSkill'],
  ['Parcial 2 de Física', '', 'subject'],
  ['Cálculo I', '', 'subject'],
  ['Introducción a la IA desde cero', '', 'topic'],
  ['Quiero aprender machine learning', '', 'topic'],
  ['Historia del arte', '', 'subject'],
  ['Capitales de Sudamérica', '', undefined],
  ['Go', '', undefined],
  ['Zxqv', '', undefined]
]

describe('inferGoalKind', () => {
  it.each(CASES)('«%s» [%s] → %s', (title, subject, want) => {
    expect(inferGoalKind(title, subject)).toBe(want)
  })

  it('tiene al menos 40 casos en español e inglés', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40)
  })

  it('la asignatura de otra disciplina es una deducción segura; un gentilicio suelto no', () => {
    expect(inferGoal('The Spanish Transition to Democracy', 'History')).toEqual({ kind: 'subject', sure: true })
    expect(inferGoal('Inglés B2', '')).toEqual({ kind: 'language', sure: true })
    expect(inferGoal('Spanish', '')?.sure).toBe(false)
    expect(inferGoal('Lymph node anatomy', '')?.sure).toBe(false)
  })
})

describe('goalKindOf', () => {
  const base = { title: 'Zxqv', subject: '', topics: '', examNotes: '' }
  it('sin examen ni pistas: un tema; con fecha: una asignatura; lo elegido gana', () => {
    expect(goalKindOf(base)).toBe('topic')
    expect(goalKindOf({ ...base, examDate: '2026-12-01T09:00:00Z' })).toBe('subject')
    expect(goalKindOf({ ...base, goalKind: 'language' })).toBe('language')
    expect(goalKindIsSure({ ...base, goalKind: 'language' })).toBe(true)
  })
})

describe('el planificador puede corregir una suposición', () => {
  const guessed = { title: 'Spanish', subject: '', topics: '', examNotes: '' }
  const sure = { title: 'The Spanish Transition to Democracy', subject: 'History', topics: '', examNotes: '' }
  it('la suposición lleva el aviso de que manda lo que escribió el estudiante', () => {
    expect(goalContextBrief(guessed)).toContain(GUESSED_GOAL_NOTE)
    expect(goalPedagogy(guessed)).toContain(GUESSED_GOAL_NOTE)
    expect(GUESSED_GOAL_NOTE).toMatch(/authoritative/)
  })
  it('una meta elegida o segura no lo lleva', () => {
    expect(goalContextBrief(sure)).not.toContain(GUESSED_GOAL_NOTE)
    expect(goalContextBrief({ ...guessed, goalKind: 'language' })).not.toContain(GUESSED_GOAL_NOTE)
    expect(goalPedagogy({ ...guessed, goalKind: 'language' })).not.toContain(GUESSED_GOAL_NOTE)
  })
})
