// Documentos para estudiar en papel con el curso de ejemplo (resources/demo-course): el plan de cada tipo, Markdown y Word.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defaultDocumentStyle, parseDocumentRequest, type DocumentKind, type DocumentRequest } from '@shared/documents'
import { setDataRoot } from '../paths'
import { getLibrary } from '../store'
import { planFor, renderDocument, unavailableKinds } from './compose'
import { cardFaces, DocumentError, stableShuffle } from './planner'
import { addCourseDocument, listCourseDocuments, removeCourseDocument, writeRendered } from './saving'
import { texToMath, texToPlain } from './texMath'
import { hueHex } from './docx'

const COURSE = 'exam-2-math112'
let home: string

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'aula-docs-export-'))
  cpSync(resolve('resources/demo-course/Packs'), join(home, 'Packs'), { recursive: true })
  setDataRoot(home)
})
afterAll(() => rmSync(home, { recursive: true, force: true }))

function request(kind: DocumentKind, extra: Partial<DocumentRequest> = {}): DocumentRequest {
  return { kind, courseID: COURSE, scope: { skillIDs: [], unitIDs: [], onlyDone: false }, style: { ...defaultDocumentStyle(), seed: 7 }, format: 'pdf', lang: 'es', ...extra }
}

describe('Plan de cada tipo de documento', () => {
  it('guía: una lección por sección, con página nueva, hoja de fórmulas y glosario', () => {
    const { plan } = planFor(request('guide'))
    expect(plan.title).toBe('Guía de estudio')
    expect(plan.subtitle).toBe('Exam #2 · MATH 101')
    const lessons = plan.sections.filter((s) => s.role === 'lesson')
    expect(lessons.length).toBe(8)
    expect(lessons[0].eyebrow).toBe('Lección 1 · Angles and their measure')
    expect(lessons.every((s) => s.newPage)).toBe(true)
    // los «Pruébalo» no van en papel
    expect(lessons.flatMap((s) => s.items).some((i) => i.type === 'lessonBlock' && i.block.type === 'tryit')).toBe(false)
  })

  it('resumen, chuleta y tarjetas', () => {
    const summary = planFor(request('summary')).plan
    expect(summary.sections.some((s) => s.items.some((i) => i.type === 'heading' && i.text === 'Lo que debes saber'))).toBe(true)
    const cheat = planFor(request('cheatsheet')).plan
    expect(cheat.sections.every((s) => !s.toc)).toBe(true)
    const cards = planFor(request('flashcards')).plan
    const items = cards.sections[0].items
    expect(items.length).toBeGreaterThan(20)
    expect(items[0].type).toBe('card')
  })

  it('examen: preguntas con puntos y hoja de respuestas aparte, igual con la misma semilla', () => {
    const a = planFor(request('exam', { style: { ...defaultDocumentStyle(), seed: 42, questionCount: 8 } })).plan
    const b = planFor(request('exam', { style: { ...defaultDocumentStyle(), seed: 42, questionCount: 8 } })).plan
    const qs = a.sections.find((s) => s.role === 'questions')!.items.filter((i) => i.type === 'question')
    expect(qs.length).toBe(8)
    expect(a.sections.find((s) => s.role === 'answers')?.newPage).toBe(true)
    expect(a.totalPoints).toBeGreaterThan(0)
    expect(a.minutes).toBeGreaterThanOrEqual(15)
    const ids = (p: typeof a): string[] => p.sections[0].items.flatMap((i) => (i.type === 'question' ? [i.question.exercise.id] : []))
    expect(ids(a)).toEqual(ids(b))
  })

  it('diapositivas: una presentación por lección cuando el curso no tiene', () => {
    const { plan } = planFor(request('slides', { scope: { skillIDs: ['reference-angles'], unitIDs: [], onlyDone: false } }))
    expect(plan.sections).toHaveLength(1)
    const slides = plan.sections[0].items
    expect(slides[0].type === 'slide' && slides[0].slide.slide.layout).toBe('title')
    expect(plan.subtitle).toBe('Reference angles and degrees-minutes · Exam #2 · MATH 101')
  })

  it('el alcance acepta títulos y unidades, y avisa si no coincide nada', () => {
    const byTitle = planFor(request('summary', { scope: { skillIDs: ['exact degree–radian conversion'], unitIDs: [], onlyDone: false } })).plan
    expect(byTitle.sections.map((s) => s.id)).toEqual(['summary-degree-radian-conversion'])
    const byUnit = planFor(request('summary', { scope: { skillIDs: [], unitIDs: ['u3'], onlyDone: false } })).plan
    expect(byUnit.sections.length).toBe(2)
    expect(() => planFor(request('summary', { scope: { skillIDs: ['nada'], unitIDs: [], onlyDone: false } }))).toThrow(DocumentError)
  })

  it('contenido propio en Markdown: secciones por título', () => {
    const { plan } = planFor({ ...request('summary'), courseID: undefined, title: 'Clase del martes', content: '# Clase\n\nIntro.\n\n## Seno\n\n$\\sin^2 x + \\cos^2 x = 1$\n\n## Coseno\n\nTexto.' })
    expect(plan.sections.map((s) => s.title)).toEqual(['Clase', 'Seno', 'Coseno'])
  })

  it('en inglés, los títulos en inglés', () => {
    expect(planFor(request('cheatsheet', { lang: 'en' })).plan.title).toBe('Cheat sheet')
  })
})

describe('Tipos que salen de cada curso', () => {
  it('el curso de ejemplo da todos', () => {
    expect(unavailableKinds(request('guide'))).toEqual({})
  })

  it('un curso solo con texto: sin chuleta, ni tarjetas, ni examen, con el motivo en el idioma del documento', () => {
    // el curso de ejemplo sin fórmulas, glosario, tarjetas, ejercicios ni errores típicos (como un curso de Historia)
    const dir = join(home, 'Packs', 'solo-texto')
    cpSync(join(home, 'Packs', COURSE), dir, { recursive: true })
    const pack = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as Record<string, unknown>
    writeFileSync(join(dir, 'pack.json'), JSON.stringify({ ...pack, id: 'solo-texto', formulaSheet: [], glossary: [], blueprint: null }))
    for (const name of readdirSync(join(dir, 'skills'))) {
      const file = join(dir, 'skills', name)
      const skill = JSON.parse(readFileSync(file, 'utf8')) as { lesson: { type: string }[] }
      writeFileSync(file, JSON.stringify({ ...skill, lesson: skill.lesson.filter((b) => b.type === 'text'), exercises: [], templates: [], cards: [], decks: [], mistakes: [] }))
    }
    const es = unavailableKinds(request('guide', { courseID: 'solo-texto' }))
    expect(Object.keys(es).sort()).toEqual(['cheatsheet', 'exam', 'flashcards'])
    expect(es.flashcards).toBe('Estas lecciones aún no tienen tarjetas de repaso.')
    // lo mismo que dice la vista previa al pedirlo
    expect(() => planFor(request('cheatsheet', { courseID: 'solo-texto' }))).toThrow(es.cheatsheet!)
    expect(unavailableKinds(request('exam', { courseID: 'solo-texto', lang: 'en' })).exam).toBe("These lessons don't have exercises for the exam yet.")
  })

  it('si ninguna lección coincide, ninguno sale (el motivo es el alcance)', () => {
    const out = unavailableKinds(request('guide', { scope: { skillIDs: ['nada'], unitIDs: [], onlyDone: false } }))
    expect(Object.keys(out)).toHaveLength(6)
    expect(new Set(Object.values(out))).toEqual(new Set(['Ninguna lección del curso coincide con lo que pediste.']))
  })
})

describe('Markdown y Word', () => {
  it('Markdown del curso con índice, aviso y la fórmula en LaTeX', async () => {
    const { plan, course } = planFor(request('guide'))
    const doc = await renderDocument(plan, course?.store, 'markdown')
    const text = new TextDecoder().decode(doc.data)
    expect(text.startsWith('# Guía de estudio\n')).toBe(true)
    expect(text).toContain('## Contenido')
    expect(text).toContain('## Reference angles and degrees-minutes')
    expect(text).toContain('$$')
    expect(text).toContain('No es un trabajo para entregar.')
    expect(doc.baseName).toBe('Exam #2 · MATH 101 — Guía de estudio')
    const out = mkdtempSync(join(tmpdir(), 'aula-md-'))
    const path = writeRendered(doc, out)
    expect(path.endsWith('.md')).toBe(true)
    // otro con el mismo nombre no pisa el primero
    expect(writeRendered(doc, out)).not.toBe(path)
    rmSync(out, { recursive: true, force: true })
  })

  it('Markdown del examen: cabecera, opciones con casillas y hoja de respuestas', async () => {
    const { plan, course } = planFor(request('exam', { style: { ...defaultDocumentStyle(), seed: 3, questionCount: 6 } }))
    const text = new TextDecoder().decode((await renderDocument(plan, course?.store, 'markdown')).data)
    expect(text).toContain('**Nombre:**')
    expect(text).toContain('## Hoja de respuestas')
    expect(text).toMatch(/\*\*1\.\*\*/)
  })

  it('Word: un .docx válido con estilos, ecuaciones nativas y pie con número de página', async () => {
    const { plan, course } = planFor(request('guide'))
    const doc = await renderDocument(plan, course?.store, 'docx')
    expect(doc.format).toBe('docx')
    const zip = await JSZip.loadAsync(doc.data)
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('Guía de estudio')
    expect(xml).toContain('<m:oMath')
    expect(xml).toContain('w:pageBreakBefore')
    const styles = await zip.file('word/styles.xml')!.async('string')
    expect(styles).toContain('w:styleId="Heading1"')
    const files = Object.keys(zip.files)
    expect(files.some((f) => f.startsWith('word/footer'))).toBe(true)
    const footer = await zip.file(files.find((f) => f.startsWith('word/footer'))!)!.async('string')
    expect(footer).toContain('PAGE')
  })

  it('Word de cada tipo sin fallar', async () => {
    for (const kind of ['summary', 'cheatsheet', 'flashcards', 'exam', 'slides'] as const) {
      const { plan, course } = planFor(request(kind))
      const doc = await renderDocument(plan, course?.store, 'docx')
      expect(doc.data.length).toBeGreaterThan(2000)
    }
  })

  it('se guarda en el curso (Referencia → Documentos) y se puede quitar', async () => {
    const store = getLibrary().openPack(COURSE)!
    const { plan } = planFor(request('cheatsheet'))
    const doc = await renderDocument(plan, store, 'markdown')
    const { saved, path } = addCourseDocument(doc, store, false)
    expect(existsSync(path)).toBe(true)
    expect(listCourseDocuments(store).map((d) => d.id)).toContain(saved.id)
    removeCourseDocument(saved.id, store)
    expect(existsSync(path)).toBe(false)
    expect(listCourseDocuments(store)).toEqual([])
  })

  it('un índice con un nombre que sale de la carpeta no aparece ni se borra', () => {
    const store = getLibrary().openPack(COURSE)!
    const dir = join(store.directory, 'documents')
    mkdirSync(dir, { recursive: true })
    const outside = join(store.directory, 'pack-copy.txt')
    writeFileSync(outside, 'no tocar')
    writeFileSync(join(dir, 'index.json'), JSON.stringify([{ id: 'x', kind: 'guide', format: 'pdf', title: 'Malo', fileName: '../pack-copy.txt', pages: 1, created: '2026-01-01T00:00:00Z' }]))
    expect(listCourseDocuments(store)).toEqual([])
    removeCourseDocument('x', store)
    expect(readFileSync(outside, 'utf8')).toBe('no tocar')
    expect(readdirSync(dir)).toContain('index.json')
  })
})

describe('Piezas', () => {
  it('las tarjetas de huecos ocultan la respuesta delante', () => {
    expect(cardFaces({ id: 'c', kind: 'cloze', front: 'El seno de {{c1::30°::ángulo}} es {{c2::1/2}}', back: '', tags: [] })).toEqual({
      front: 'El seno de [ángulo…] es […]', back: 'El seno de **30°** es **1/2**'
    })
  })

  it('el barajado estable nunca deja el orden original', () => {
    const xs = ['a', 'b', 'c', 'd']
    for (const key of ['e1', 'e2', 'e3', 'zz']) {
      const s = stableShuffle(xs, key)
      expect(s).not.toEqual(xs)
      expect([...s].sort()).toEqual(xs)
      expect(stableShuffle(xs, key)).toEqual(s)
    }
  })

  it('LaTeX → ecuación de Word y texto plano', () => {
    expect(texToMath('\\frac{a}{b} + x^2_i').length).toBeGreaterThan(1)
    expect(texToMath('\\unknowncommand{')).toBeTruthy()
    expect(texToPlain('30^\\circ \\cdot \\pi')).toBe('30°·π')
  })

  it('el color del curso para Word', () => {
    expect(hueHex(0)).toMatch(/^[0-9A-F]{6}$/)
    expect(hueHex(0.6)).not.toBe(hueHex(0.1))
  })

  it('las peticiones de la interfaz se validan y se acotan', () => {
    const r = parseDocumentRequest({ kind: 'chuleta', style: { fontSize: 99, cardsPerPage: 7, questionCount: 500 }, scope: { skillIDs: ['a', 3] }, format: 'word', courseID: 'x' })
    expect(r).toMatchObject({ kind: 'cheatsheet', format: 'docx', courseID: 'x', scope: { skillIDs: ['a'], unitIDs: [], onlyDone: false } })
    expect(r.style.fontSize).toBe(13)
    expect(r.style.cardsPerPage).toBe(8)
    expect(r.style.questionCount).toBe(60)
    expect(() => parseDocumentRequest({ kind: 'nada' })).toThrow()
  })
})
