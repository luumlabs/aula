// Cursos de ejemplo (port de SampleCourses.swift) y punto de entrada del almacén (biblioteca compartida y avisos de cambios).
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { blockTypeName, makePack, type Skill } from '@shared/schema'
import { setDataRoot } from '../paths'
import { getLibrary, notifyCourseChanged, onCourseChanged, startCourseWatcher, stopCourseWatcher } from './index'
import { Library } from './library'
import { DEMO_MATH_ID, installSampleCourses, migrateWelcomeTone, sampleExamDate, WELCOME_HUE, WELCOME_IDS } from './samples'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'aula-samples-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('el tono de la bienvenida (nada violeta)', () => {
  it('se instala en ámbar, no en ciruela', () => {
    const lib = new Library(root)
    installSampleCourses(lib)
    expect(lib.openPack(WELCOME_IDS[0])!.loadPack().hue).toBe(WELCOME_HUE)
    expect(WELCOME_HUE).toBe(0.09)
  })

  it('la bienvenida antigua en ciruela (0,78) pasa a ámbar; un tono elegido a mano no se toca', () => {
    const lib = new Library(root)
    installSampleCourses(lib)
    lib.openPack(WELCOME_IDS[0])!.updatePack((p) => { p.hue = 0.78 })
    expect(migrateWelcomeTone(lib)).toEqual([WELCOME_IDS[0]])
    expect(lib.openPack(WELCOME_IDS[0])!.loadPack().hue).toBe(WELCOME_HUE)
    expect(migrateWelcomeTone(lib)).toEqual([])
    lib.openPack(WELCOME_IDS[0])!.updatePack((p) => { p.hue = 0.8 })
    expect(migrateWelcomeTone(lib)).toEqual([])
    expect(lib.openPack(WELCOME_IDS[0])!.loadPack().hue).toBe(0.8)
  })
})

describe('cursos de ejemplo', () => {
  const bundledCourseDir = fileURLToPath(new URL('../../../../resources/demo-course/Packs/exam-2-math112', import.meta.url))

  it('en inglés: la bienvenida traducida y el curso de trigonometría que viene con la app', () => {
    const lib = new Library(root)
    const now = new Date(2026, 9, 26, 15, 30)
    expect(installSampleCourses(lib, { language: 'en-US', bundledCourseDir, now })).toEqual(['exam-2-math112', WELCOME_IDS[1]])
    const trig = lib.openPack('exam-2-math112')!
    const pack = trig.loadPack()
    expect(pack.language).toBe('en')
    // con sus materiales, sin el progreso de quien lo preparó, y con el examen en unos días
    expect(existsSync(join(lib.packDirectory('exam-2-math112'), 'sources'))).toBe(true)
    expect(existsSync(join(lib.packDirectory('exam-2-math112'), 'progress.json'))).toBe(false)
    expect(new Date(pack.exam!.date!).getDate()).toBe(4)
    expect(trig.loadSkills().length).toBe(pack.skills.length)
    const welcome = lib.openPack(WELCOME_IDS[1])!.loadPack()
    expect(welcome).toMatchObject({ title: 'Welcome to Aula', language: 'en' })
    // el mismo curso que en español: mismos bloques, ejercicios y tarjetas
    const es = new Library(mkdtempSync(join(tmpdir(), 'aula-samples-es-')))
    installSampleCourses(es)
    const shape = (l: Library, id: string) => l.openPack(id)!.loadSkills().map((s) => [s.lesson.map((b) => b.type), s.exercises.map((e) => e.answer.kind), s.cards.length])
    expect(shape(lib, WELCOME_IDS[1])).toEqual(shape(es, WELCOME_IDS[0]))
    for (const s of lib.openPack(WELCOME_IDS[1])!.loadSkills()) {
      expect(s.exercises.filter((e) => e.answer.kind === 'unknown')).toEqual([])
      for (const e of s.exercises) expect(e.skill).toBe(s.id)
    }
    // en otro idioma tampoco se duplican
    expect(installSampleCourses(lib, { onlyIfEmpty: false, language: 'es' })).toEqual([DEMO_MATH_ID])
  })

  it('en inglés sin el curso de la app: el de funciones y la bienvenida en inglés', () => {
    const lib = new Library(root)
    expect(installSampleCourses(lib, { language: 'en', bundledCourseDir: join(root, 'no-existe') })).toEqual([DEMO_MATH_ID, WELCOME_IDS[1]])
  })

  it('se instalan en una biblioteca vacía y solo una vez', () => {
    const lib = new Library(root)
    expect(installSampleCourses(lib)).toEqual([DEMO_MATH_ID, WELCOME_IDS[0]])
    expect(installSampleCourses(lib)).toEqual([]) // ya no está vacía
    expect(installSampleCourses(lib, { onlyIfEmpty: false })).toEqual([]) // ya existen: no se duplican
    expect(lib.packIDs()).toEqual([WELCOME_IDS[0], DEMO_MATH_ID].sort())
  })

  it('no duplican la bienvenida de las versiones anteriores', () => {
    const lib = new Library(root)
    lib.createPack(makePack({ id: WELCOME_IDS[1], title: 'Bienvenida' }))
    expect(installSampleCourses(lib, { onlyIfEmpty: false })).toEqual([DEMO_MATH_ID])
  })

  it('no se instalan si ya hay cursos', () => {
    const lib = new Library(root)
    lib.createPack(makePack({ id: 'mio', title: 'Mi curso' }))
    expect(installSampleCourses(lib)).toEqual([])
  })

  it('el contenido es el de la app Swift y es coherente', () => {
    const lib = new Library(root)
    installSampleCourses(lib, { now: new Date(2026, 9, 26, 15, 30) })
    const demo = lib.openPack(DEMO_MATH_ID)!
    const pack = demo.loadPack()
    expect(pack).toMatchObject({ title: 'Funciones cuadráticas', subject: 'Matemáticas', courseCode: 'ÁLG-101', icon: 'algebra', hue: 0.62, language: 'es' })
    // el parcial: dentro de 9 días a las 9:00 (hora local)
    const exam = new Date(pack.exam!.date!)
    expect([exam.getFullYear(), exam.getMonth(), exam.getDate(), exam.getHours(), exam.getMinutes()]).toEqual([2026, 10, 4, 9, 0])
    expect(pack.blueprint?.sections.map((s) => s.count)).toEqual([4, 5])
    expect(pack.glossary.map((g) => g.term)).toEqual(['Vértice', 'Discriminante', 'Concavidad'])
    expect(pack.formulaSheet.flatMap((g) => g.items.map((i) => i.name))).toEqual(['Vértice (coordenada x)', 'Fórmula general', 'Discriminante'])
    const counts = Object.fromEntries(pack.skills.map((s) => [s.id, s.counts]))
    expect(counts.parabola).toMatchObject({ lessonBlocks: 11, exercises: 10, templates: 1, cards: 4 })
    expect(counts['formula-general']).toMatchObject({ lessonBlocks: 7, exercises: 5, templates: 1, cards: 2 })
    expect(pack.skills.every((s) => s.status === 'ready')).toBe(true)
    expect(pack.skills.find((s) => s.id === 'formula-general')?.prerequisites).toEqual(['parabola'])

    const welcome = lib.openPack(WELCOME_IDS[0])!
    const wp = welcome.loadPack()
    expect(wp).toMatchObject({ title: 'Bienvenida a Aula', icon: 'idea', hue: WELCOME_HUE })
    const wcounts = Object.fromEntries(wp.skills.map((s) => [s.id, s.counts]))
    expect(wcounts.memoria).toMatchObject({ lessonBlocks: 7, exercises: 4, cards: 2 })
    expect(wcounts.recuperacion).toMatchObject({ lessonBlocks: 5, exercises: 2, cards: 1 })

    const skills: Skill[] = [...demo.loadSkills(), ...welcome.loadSkills()]
    expect(skills).toHaveLength(4)
    for (const s of skills) {
      // ningún bloque ni respuesta desconocidos (un error de clave se habría leído así)
      const blocks = [...s.lesson, ...s.exercises.flatMap((e) => [...e.prompt, ...e.solution]), ...s.templates.flatMap((t) => [...t.prompt, ...t.solution])]
      expect(blocks.filter((b) => b.type === 'unknown').map(blockTypeName), s.id).toEqual([])
      expect([...s.exercises, ...s.templates].filter((e) => e.answer.kind === 'unknown').map((e) => e.id), s.id).toEqual([])
      // cada «Pruébalo» apunta a ejercicios que existen
      const ids = new Set(s.exercises.map((e) => e.id))
      for (const b of s.lesson) if (b.type === 'tryit') for (const id of b.exerciseIDs) expect(ids.has(id), `${s.id}: ${id}`).toBe(true)
      for (const e of s.exercises) expect(e.skill).toBe(s.id)
      for (const c of s.cards) expect(c.skill).toBe(s.id)
    }
    const parabola = skills.find((s) => s.id === 'parabola')!
    expect(parabola.lesson.map((b) => b.type)).toEqual(['text', 'predict', 'explore', 'callout', 'math', 'example', 'callout', 'spot', 'tryit', 'table', 'recap'])
    expect(Object.fromEntries(parabola.exercises.map((e) => [e.id, e.answer.kind]))).toMatchObject({
      'p-e1': 'choice', 'p-e2': 'numeric', 'p-e4': 'point', 'p-e5': 'set', 'p-e6': 'cloze', 'p-e7': 'truefalse', 'p-e8': 'ordering', 'p-e9': 'matching'
    })
    expect(parabola.exercises.find((e) => e.id === 'p-e10')).toMatchObject({ points: 2, level: 3 })
    expect(parabola.templates[0].vars.map((v) => v.name)).toEqual(['a', 'h', 'b', 'c'])
    expect(parabola.cards[2].kind).toBe('cloze')
    expect(parabola.mistakes).toHaveLength(1)
    const recup = skills.find((s) => s.id === 'recuperacion')!
    expect(recup.exercises.map((e) => e.answer.kind)).toEqual(['short', 'open'])
  })

  it('la fecha del parcial es a las 9:00 del noveno día', () => {
    const d = new Date(sampleExamDate(new Date(2026, 11, 28, 23, 59)))
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2027, 0, 6, 9])
  })
})

describe('biblioteca compartida y avisos', () => {
  afterEach(() => stopCourseWatcher())

  it('getLibrary sigue a la carpeta de datos', () => {
    setDataRoot(root)
    const a = getLibrary()
    expect(a.root).toBe(root)
    expect(getLibrary()).toBe(a)
    const other = mkdtempSync(join(tmpdir(), 'aula-samples-otra-'))
    try {
      setDataRoot(other)
      expect(getLibrary().root).toBe(other)
    } finally {
      setDataRoot(root)
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('agrupa los avisos de un mismo curso', async () => {
    const seen: string[] = []
    const off = onCourseChanged((id) => seen.push(id))
    notifyCourseChanged('a')
    notifyCourseChanged('a')
    notifyCourseChanged('b')
    await wait(250)
    expect(seen.sort()).toEqual(['a', 'b'])
    off()
    notifyCourseChanged('a')
    await wait(250)
    expect(seen).toHaveLength(2)
  })

  it('avisa de lo que escribe este proceso y de lo que escribe otro', async () => {
    setDataRoot(root)
    const seen = new Set<string>()
    const off = onCourseChanged((id) => seen.add(id))
    try {
      getLibrary().createPack(makePack({ id: 'propio', title: 'Propio' }))
      await wait(250)
      expect(seen.has('propio')).toBe(true)
      startCourseWatcher()
      await wait(200)
      // «otro proceso»: escribe directamente en el disco
      const ext = new Library(root)
      ext.createPack(makePack({ id: 'ajeno', title: 'Ajeno' }))
      writeFileSync(join(ext.packDirectory('ajeno'), 'progress.json'), '{}')
      for (let i = 0; i < 50 && !seen.has('ajeno'); i++) await wait(100)
      expect(seen.has('ajeno')).toBe(true)
    } finally {
      off()
    }
  })
})
