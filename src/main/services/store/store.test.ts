// Pruebas del almacén de cursos (port de StoreTests, AuditContentFixTests y DamagedProgressTests de
// la app Swift anterior: Tests/StudyModelTests): biblioteca, curso, habilidades, progreso, fuentes, archivos, exportar e importar.
import { spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseJSON } from '@engine/base/json'
import {
  decodeAnswer, emptyProgress, encodePack, makeAttempt, makeChatThread, makeExercise, makeFlashcard, makePack, makeSkill, makeSkillProgress, makeSkillRef,
  textBlock, type Exercise, type Skill
} from '@shared/schema'
import { jsonBytes } from './jsonFile'
import { ImportCancelled, Library, LibraryError, plausiblePackJSON } from './library'
import { LockTimeoutError, withFileLock } from './lock'
import { PackStore } from './packStore'
import { PackZipError } from './packZip'
import { SafePath } from './safePath'
import { isNoise, watchPacks } from './watcher'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'aula-store-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

const lib = (): Library => new Library(root)
const tf = (id: string, skill: string): Exercise =>
  makeExercise({ id, skill, prompt: [textBlock(`¿${id}?`)], answer: decodeAnswer({ kind: 'truefalse', value: true })! })
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('biblioteca y curso', () => {
  it('crear, guardar y leer una habilidad mantiene al día el resumen del curso', () => {
    const l = lib()
    const store = l.createPack(makePack({ id: '', title: 'Biología Celular', subject: 'Biología' }))
    expect(store.id).toBe('biologia-celular')
    const ex = makeExercise({ id: 'e1', skill: 'mito', prompt: [textBlock('¿Qué produce la mitocondria?')], answer: decodeAnswer({ kind: 'short', accepted: ['ATP'] })! })
    store.saveSkill(makeSkill({ id: 'mito', title: 'Mitocondria', summary: 'Respiración celular', lesson: [textBlock('hola'), textBlock('adiós')], exercises: [ex], status: 'ready' }))
    const pack = store.loadPack()
    expect(pack.skills).toHaveLength(1)
    expect(pack.skills[0].counts).toMatchObject({ exercises: 1, lessonBlocks: 2 })
    expect(pack.skills[0].status).toBe('ready')
    expect(pack.skills[0].summary).toBe('Respiración celular')
    expect(store.loadSkill('mito').exercises[0].id).toBe('e1')
    // actualizar
    store.updateSkill('mito', (s) => { s.cards.push(makeFlashcard({ front: 'ATP', back: 'energía' })) })
    expect(store.loadPack().skills[0].counts.cards).toBe(1)
    expect(store.loadSkill('mito').revision).toBe(2)
    // lista
    const list = l.listPacks()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'biologia-celular', skillCount: 1, exerciseCount: 1, cardCount: 1, language: 'es', hasExam: true })
    // borrar la habilidad limpia unidades y prerrequisitos
    store.updatePack((p) => { p.units = [{ id: 'u', title: 'U', skillIDs: ['mito'] }] })
    store.deleteSkill('mito')
    expect(store.loadPack().units[0].skillIDs).toEqual([])
    expect(store.hasSkill('mito')).toBe(false)
  })

  // Regresión: el primer `updateSkill` de una habilidad del plan creaba el archivo con el id como título.
  it('una habilidad nueva conserva el título del plan', () => {
    const store = lib().createPack(makePack({ id: '', title: 'Trigo' }))
    store.updatePack((p) => { p.skills = [makeSkillRef({ id: 'grados-radianes', title: 'Convertir entre grados y radianes', summary: 'π/180', objectives: ['Convertir 225° a radianes'] })] })
    store.updateSkill('grados-radianes', (s) => { s.cards.push(makeFlashcard({ front: '180°', back: 'π' })) })
    expect(store.loadPack().skills[0].title).toBe('Convertir entre grados y radianes')
    const s = store.loadSkill('grados-radianes')
    expect(s.title).toBe('Convertir entre grados y radianes')
    expect(s.objectives).toEqual(['Convertir 225° a radianes'])
    // un título «vacío» (el id) nunca pisa el del plan
    store.saveSkill({ ...s, title: 'grados-radianes' })
    expect(store.loadPack().skills[0].title).toBe('Convertir entre grados y radianes')
    // un título de verdad sí lo actualiza
    store.updateSkill('grados-radianes', (x) => { x.title = 'Grados ↔ radianes' })
    expect(store.loadPack().skills[0].title).toBe('Grados ↔ radianes')
  })

  it('ids únicos al crear', () => {
    const l = lib()
    expect(l.createPack(makePack({ id: '', title: 'Álgebra' })).id).toBe('algebra')
    expect(l.createPack(makePack({ id: '', title: 'Álgebra' })).id).toBe('algebra-2')
    expect(l.packIDs()).toEqual(['algebra', 'algebra-2'])
  })

  it('dos almacenes sobre la misma carpeta no pierden escrituras', () => {
    const store = lib().createPack(makePack({ id: '', title: 'Concurrencia' }))
    const other = new PackStore(store.id, store.directory)
    for (let n = 0; n < 40; n++) (n % 2 === 0 ? store : other).saveSkill(makeSkill({ id: `skill-${n}`, title: `Habilidad ${n}`, lesson: [textBlock('x')] }))
    expect(store.loadPack().skills).toHaveLength(40)
    expect(store.skillIDs()).toHaveLength(40)
  })

  it('el progreso se actualiza y uno dañado no revienta (y se guarda una copia)', () => {
    const store = lib().createPack(makePack({ id: '', title: 'P' }))
    expect(store.loadProgress()).toEqual(emptyProgress())
    store.updateProgress((p) => { p.skills.s = makeSkillProgress({ alpha: 4, beta: 1, attempts: 3 }) })
    expect(store.loadProgress().skills.s.attempts).toBe(3)
    writeFileSync(store.progressPath, '{ esto no es json')
    expect(store.loadProgress().skills).toEqual({})
    expect(readdirSync(store.directory).filter((n) => n.startsWith('progress.json.damaged-'))).toHaveLength(1)
    store.resetProgress()
    expect(existsSync(store.progressPath)).toBe(false)
  })

  it('el progreso guardado recorta los intentos', () => {
    const store = lib().createPack(makePack({ id: '', title: 'P' }))
    const p = emptyProgress()
    p.attempts = Array.from({ length: 2600 }, (_, i) => makeAttempt({ exerciseID: `e${i}`, skill: 's', credit: 1 }))
    store.saveProgress(p)
    expect(p.attempts).toHaveLength(2600) // no toca el que se le pasa
    expect(store.loadProgress().attempts).toHaveLength(2500)
    expect(store.loadProgress().attempts[0].exerciseID).toBe('e100')
  })

  it('fuentes y archivos de apoyo', () => {
    const store = lib().createPack(makePack({ id: '', title: 'Fuentes' }))
    const file = join(root, 'apuntes.txt')
    writeFileSync(file, 'hola')
    const chunks = [
      { id: 'c1', sourceID: 'src1', ordinal: 0, page: 1, heading: 'Intro', text: 'texto uno' },
      { id: 'c2', sourceID: 'src1', ordinal: 1, page: 2, text: 'texto dos' }
    ]
    store.saveSource({ id: 'src1', title: 'Apuntes', kind: 'text', addedAt: new Date().toISOString(), pages: 2, characters: 18, status: 'ready', trust: 'notes', warnings: [] }, chunks, file)
    expect(store.loadChunks('src1')).toEqual(chunks)
    expect(store.allChunks()).toHaveLength(2)
    const meta = store.loadPack().sources[0]
    expect(meta.filename).toBe('apuntes.txt')
    expect(store.originalPath(meta)).toBe(join(store.sourceDirectory('src1'), 'apuntes.txt'))
    const id1 = store.addAsset(new Uint8Array([1, 2, 3, 4]), 'PNG'), id2 = store.addAsset(new Uint8Array([1, 2, 3, 4]), '.png')
    expect(id1).toBe(id2)
    expect(id1.endsWith('.png')).toBe(true)
    expect(store.assetPath(id1)).toBeDefined()
    expect(store.assetPath('../../etc/passwd')).toBeUndefined() // sin escapar de la carpeta
    store.removeSource('src1')
    expect(store.loadPack().sources).toEqual([])
    expect(existsSync(store.sourceDirectory('src1'))).toBe(false)
  })

  it('el id de un archivo de apoyo usa todo el archivo y la extensión no puede ser una ruta', () => {
    const store = lib().createPack(makePack({ id: '', title: 'Curso' }))
    // misma cabecera larga y mismo tamaño, distinto final: antes compartían id
    const x = new Uint8Array(10_000).fill(7), y = new Uint8Array(10_000).fill(7)
    x[9_999] = 1; y[9_999] = 2
    expect(store.addAsset(x, 'jpg')).not.toBe(store.addAsset(y, 'jpg'))
    expect(store.addAsset(x, 'jpg')).toBe(store.addAsset(x, '.JPG')) // idempotente
    expect(store.addAsset(x, 'png/../../x')).not.toContain('/')
  })

  it('conversaciones y registros', () => {
    const store = lib().createPack(makePack({ id: '', title: 'Chat' }))
    const t = makeChatThread('Dudas')
    store.saveThread(t)
    expect(store.threads().map((x) => x.id)).toEqual([t.id])
    store.saveJSON({ ok: true }, 'runs', 'run-1')
    expect(store.listNames('runs')).toEqual(['run-1'])
    expect(store.loadJSON('runs', 'run-1', (raw) => raw)).toEqual({ ok: true })
    store.deleteThread(t.id)
    expect(store.threads()).toEqual([])
  })

  it('avisa de cada escritura de este proceso', () => {
    const l = lib()
    const seen: string[] = []
    l.onPackWrite = (id) => seen.push(id)
    const store = l.createPack(makePack({ id: '', title: 'Avisos' }))
    store.saveSkill(makeSkill({ id: 'a', title: 'A' }))
    store.updateProgress((p) => { p.xp = 1 })
    expect(seen.length).toBeGreaterThanOrEqual(3)
    expect(new Set(seen)).toEqual(new Set(['avisos']))
  })

  it('borrar manda el curso a la papelera o, si falla, a «Eliminados»', async () => {
    const l = lib()
    const a = l.createPack(makePack({ id: '', title: 'A' })), b = l.createPack(makePack({ id: '', title: 'B' }))
    const trashed: string[] = []
    await l.deletePack(a.id, async (dir) => { trashed.push(dir); rmSync(dir, { recursive: true }) })
    expect(trashed).toEqual([a.directory])
    await l.deletePack(b.id, async () => { throw new Error('sin papelera') })
    expect(l.packIDs()).toEqual([])
    expect(readdirSync(join(root, 'Eliminados'))[0]).toMatch(/^b-\d+$/)
    await expect(l.deletePack('../..')).rejects.toBeInstanceOf(LibraryError)
    await l.deletePack('no-existe') // no hace nada
  })

  it('la biblioteca lista un curso dañado', () => {
    // antes: recuentos de Int.max en pack.json desbordaban la suma al listar
    const l = lib()
    const dir = l.packDirectory('roto')
    mkdirSync(dir, { recursive: true })
    const big = '9223372036854775807'
    writeFileSync(join(dir, 'pack.json'), `{"id":"roto","title":"Roto","skills":[{"id":"a","counts":{"exercises":${big},"templates":${big},"cards":${big}}},{"id":"b","counts":{"exercises":${big}}}]}`)
    // y uno que no es JSON se salta sin romper la lista
    mkdirSync(l.packDirectory('basura'), { recursive: true })
    writeFileSync(join(l.packDirectory('basura'), 'pack.json'), 'no es json')
    const list = l.listPacks()
    expect(list.map((p) => p.id)).toEqual(['roto'])
    expect(list[0].exerciseCount).toBeLessThan(Number.MAX_SAFE_INTEGER / 2)
    expect(l.openPack('../Packs')).toBeUndefined()
  })

  it('el resumen cuenta el examen', () => {
    const l = lib()
    l.createPack(makePack({ id: 'a', title: 'Con examen', courseCode: 'X-1', exam: { title: 'Final', date: '2027-01-15T08:00:00.000Z' } }))
    l.createPack(makePack({ id: 'b', title: 'A su ritmo', selfPaced: true }))
    const byId = Object.fromEntries(l.listPacks().map((s) => [s.id, s]))
    expect(byId.a).toMatchObject({ hasExam: true, examDate: '2027-01-15T08:00:00.000Z', examTitle: 'Final', courseCode: 'X-1' })
    expect(byId.b.hasExam).toBe(false)
    expect(byId.b.examDate).toBeUndefined()
  })
})

describe('rutas seguras', () => {
  it('componentes de ruta', () => {
    for (const ok of ['apuntes-ab12', 'Tema 1: intro.pdf', 'a.b']) expect(SafePath.isComponent(ok), ok).toBe(true)
    for (const bad of ['', '.', '..', '../..', 'a/b', '/etc/passwd', 'a\\b', 'x\0y']) expect(SafePath.isComponent(bad), bad).toBe(false)
    expect(SafePath.component('../..').startsWith('invalid-')).toBe(true)
    const dir = join(root, 'd')
    expect(SafePath.isInside(join(dir, 'x'), dir)).toBe(true)
    expect(SafePath.isInside(join(dir, '../x'), dir)).toBe(false)
    expect(SafePath.isInside(dir, dir)).toBe(false)
  })

  it('un enlace simbólico no saca de la carpeta', () => {
    const dir = join(root, 'd')
    mkdirSync(dir)
    symlinkSync(tmpdir(), join(dir, 'fuera'))
    expect(SafePath.isInside(join(dir, 'fuera', 'x'), dir)).toBe(false)
  })

  it('quitar o abrir un material malicioso nunca sale del curso', () => {
    const l = lib()
    const store = l.createPack(makePack({ id: '', title: 'Curso' }))
    const other = l.createPack(makePack({ id: '', title: 'Otro' }))
    store.updatePack((p) => {
      p.sources = [
        { id: '../..', title: 'malo', kind: 'pdf', addedAt: new Date().toISOString(), pages: 0, characters: 0, status: 'ready', trust: 'other', warnings: [] },
        { id: 'bueno', title: 'x', kind: 'pdf', filename: '../../../pack.json', addedAt: new Date().toISOString(), pages: 0, characters: 0, status: 'ready', trust: 'other', warnings: [] }
      ]
    })
    // «Quitar material» con id «../..» borraba toda la carpeta Packs
    store.removeSource('../..')
    expect(existsSync(other.packPath)).toBe(true)
    expect(existsSync(store.packPath)).toBe(true)
    // el lector no abre un archivo de fuera de la carpeta del material
    const meta = store.loadPack().sources.find((s) => s.id === 'bueno')!
    expect(store.originalPath(meta)).toBeUndefined()
    // borrar una conversación con id «../pack» borraba pack.json
    store.deleteThread('../pack')
    expect(existsSync(store.packPath)).toBe(true)
  })
})

describe('exportar e importar', () => {
  it('ida y vuelta (sin el progreso personal por defecto)', async () => {
    const l = lib()
    const store = l.createPack(makePack({ id: '', title: 'Exportable' }))
    store.saveSkill(makeSkill({ id: 'a', title: 'A', lesson: [textBlock('x')] }))
    store.updateProgress((p) => { p.xp = 99 })
    const zip = join(root, 'curso.aulapack')
    await l.exportPack(store.id, zip)
    expect(existsSync(zip)).toBe(true)
    const newID = await l.importPack(zip)
    expect(newID).toBe('exportable-2')
    const imported = l.openPack(newID)!
    expect(imported.loadSkill('a').lesson).toHaveLength(1)
    expect(imported.loadPack().id).toBe('exportable-2')
    expect(imported.loadProgress().xp).toBe(0) // el progreso personal no se exporta por defecto
    // con el progreso, sí
    const zip2 = join(root, 'con-progreso.aulapack')
    await l.exportPack(store.id, zip2, { includeProgress: true })
    expect(l.openPack(await l.importPack(zip2))!.loadProgress().xp).toBe(99)
  })

  it('sin el progreso deja fuera notas, marcas, documentos, registros, conversaciones y secretos', async () => {
    const l = lib()
    const store = l.createPack(makePack({ id: '', title: 'Curso' }))
    for (const f of ['notes', 'annotations', 'documents', 'runs', 'chats']) {
      mkdirSync(join(store.directory, f), { recursive: true })
      writeFileSync(join(store.directory, f, 'mio.json'), '{}')
    }
    store.saveProgress(emptyProgress())
    writeFileSync(join(store.directory, 'progress.damaged-1.json'), '{}')
    writeFileSync(join(store.directory, 'secrets.json'), '{"key":"sk-123"}')
    writeFileSync(join(store.directory, '.DS_Store'), 'x')
    const listing = async (includeProgress: boolean): Promise<string[]> => {
      const zip = join(root, `c-${includeProgress}.aulapack`)
      await l.exportPack(store.id, zip, { includeProgress })
      return Object.keys((await JSZip.loadAsync(readFileSync(zip))).files)
    }
    const without = await listing(false)
    for (const f of ['notes/', 'annotations/', 'documents/', 'progress.json', 'progress.damaged', 'runs/', 'chats/', 'secrets', '.DS_Store', '.aula-lock']) {
      expect(without.some((n) => n.includes(f)), `no debe ir ${f}: ${without.join(', ')}`).toBe(false)
    }
    expect(without).toContain('curso/pack.json') // la carpeta del curso es la raíz del ZIP
    const withProgress = await listing(true)
    for (const f of ['notes/mio.json', 'annotations/mio.json', 'documents/mio.json', 'progress.json']) expect(withProgress, f).toContain(`curso/${f}`)
    for (const f of ['runs/', 'chats/', 'secrets']) expect(withProgress.some((n) => n.includes(f)), f).toBe(false)
  })

  it('importar limpia ids, nombres de archivo, enlaces y conversaciones', async () => {
    const l = lib()
    const pack = makePack({ id: 'hostil', title: 'Hostil' })
    pack.sources = [
      { id: '../..', title: 'malo', kind: 'pdf', addedAt: new Date().toISOString(), pages: 0, characters: 0, status: 'ready', trust: 'other', warnings: [] },
      { id: 'bueno', title: 'bueno', kind: 'pdf', filename: '../../../../Documents/tesis.pdf', addedAt: new Date().toISOString(), pages: 0, characters: 0, status: 'ready', trust: 'other', warnings: [] }
    ]
    const zip = new JSZip()
    zip.file('hostil/pack.json', jsonBytes(encodePack(pack)))
    zip.file('hostil/chats/x.json', 'x')
    zip.file('hostil/runs/r.json', '{}')
    zip.file('hostil/sources/bueno/chunks.json', '[]')
    zip.file('hostil/assets/foto.png', '/etc/hosts', { unixPermissions: 0o120777 }) // enlace simbólico
    zip.file('hostil/assets/ok.png', new Uint8Array([1, 2, 3]))
    const file = join(root, 'hostil.aulapack')
    writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }))

    const id = await l.importPack(file)
    const store = l.openPack(id)!
    const sources = store.loadPack().sources
    expect(sources.map((s) => s.id)).toEqual(['bueno']) // el material con id «../..» no se importa
    expect(sources[0].filename).toBe('tesis.pdf') // solo el último componente del nombre
    expect(existsSync(join(store.chatsDirectory, 'x.json'))).toBe(false) // las conversaciones no se importan
    expect(existsSync(join(store.runsDirectory, 'r.json'))).toBe(false)
    expect(existsSync(join(store.assetsDirectory, 'foto.png'))).toBe(false) // sin enlaces simbólicos
    expect(lstatSync(join(store.assetsDirectory, 'ok.png')).isFile()).toBe(true)
  })

  it('J2-24 / A3-P2-11: importar dos veces el mismo curso pregunta; «conservar los dos» le pone «(2)» y «sustituir» guarda el progreso', async () => {
    const l = lib()
    const store = l.createPack(makePack({ id: '', title: 'Exam #2 · MATH 101' }))
    store.saveSkill(makeSkill({ id: 'a', title: 'A', lesson: [textBlock('x')] }))
    store.updateProgress((p) => { p.xp = 42 })
    const zip = join(root, 'exam.aulapack')
    await l.exportPack(store.id, zip)
    const asked: string[] = []
    // cancelar: nada cambia
    await expect(l.importPack(zip, { onDuplicate: (e) => { asked.push(e.id); return 'cancel' } })).rejects.toBeInstanceOf(ImportCancelled)
    expect(asked).toEqual([store.id])
    expect(l.packIDs()).toEqual([store.id])
    // conservar los dos: otro id y «(2)», «(3)» en el título (ya no salen iguales en la barra lateral)
    const second = await l.importPack(zip, { onDuplicate: () => 'keepBoth' })
    const third = await l.importPack(zip, { onDuplicate: () => 'keepBoth' })
    expect(new Set([store.id, second, third]).size).toBe(3)
    expect(l.listPacks().map((p) => p.title).sort()).toEqual(['Exam #2 · MATH 101', 'Exam #2 · MATH 101 (2)', 'Exam #2 · MATH 101 (3)'])
    // sustituir: mismo id, el contenido nuevo, el progreso del que había y el anterior en «Eliminados»
    const replaced = await l.importPack(zip, { onDuplicate: () => 'replace' })
    expect(replaced).toBe(store.id)
    expect(l.openPack(replaced)!.loadProgress().xp).toBe(42)
    expect(l.packIDs()).toHaveLength(3)
    expect(readdirSync(join(root, 'Eliminados')).some((n) => n.startsWith(store.id))).toBe(true)
  })

  it('A3-P2-11: un pack.json sin sentido no se importa', async () => {
    const l = lib()
    for (const bad of [{ title: 5, skills: 'x' }, { title: '  ' }, { title: 'Bien', skills: 'x' }, ['no'], 'texto']) {
      const zip = new JSZip()
      zip.file('raro/pack.json', JSON.stringify(bad))
      const file = join(root, 'raro.aulapack')
      writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }))
      await expect(l.importPack(file), JSON.stringify(bad)).rejects.toMatchObject({ code: 'invalid_pack' })
    }
    expect(l.packIDs()).toEqual([])
    expect(plausiblePackJSON({ title: 'Curso', skills: [] })).toBe(true)
    expect(plausiblePackJSON({ title: 'Curso' })).toBe(true)
  })

  it('un archivo que no es un curso se rechaza', async () => {
    const l = lib()
    const notZip = join(root, 'no.aulapack')
    writeFileSync(notZip, 'hola')
    await expect(l.importPack(notZip)).rejects.toBeInstanceOf(PackZipError)
    const zip = new JSZip()
    zip.file('algo/otro.json', '{}')
    const noPack = join(root, 'sin-curso.aulapack')
    writeFileSync(noPack, await zip.generateAsync({ type: 'nodebuffer' }))
    await expect(l.importPack(noPack)).rejects.toMatchObject({ code: 'invalid_pack' })
    expect(l.packIDs()).toEqual([])
    await expect(l.exportPack('no-existe', join(root, 'x.aulapack'))).rejects.toMatchObject({ code: 'not_found' })
  })

  it('el curso de demostración se importa tal cual', async () => {
    const l = lib()
    const { zipDirectory } = await import('./packZip')
    const zip = join(root, 'demo.aulapack')
    await zipDirectory(join(__dirname, '../../../../resources/demo-course/Packs/exam-2-math112'), zip)
    const id = await l.importPack(zip)
    expect(id).toBe('exam-2-math112')
    const store = l.openPack(id)!
    expect(store.loadSkills(store.loadPack().skills.map((s) => s.id))).toHaveLength(8)
    expect(store.loadPack().sources.length).toBeGreaterThan(0)
    expect(store.allChunks().length).toBeGreaterThan(0)
  })
})

describe('ids repetidos entre habilidades', () => {
  it('se renombran por habilidad y el progreso los sigue', () => {
    const l = lib()
    const pack = makePack({ id: '', title: 'Curso' })
    pack.skills = [makeSkillRef({ id: 'a', title: 'A' }), makeSkillRef({ id: 'b', title: 'B', order: 1 })]
    const store = l.createPack(pack)
    const a: Skill = makeSkill({ id: 'a', title: 'A', exercises: [tf('e1', 'a')], cards: [makeFlashcard({ id: 'c1', front: 'f', back: 'b' })] })
    const b: Skill = makeSkill({ id: 'b', title: 'B', exercises: [tf('e1', 'b'), tf('e2', 'b')], cards: [makeFlashcard({ id: 'c1', front: 'g', back: 'h' })] })
    b.lesson = [{ id: 'try', type: 'tryit', exerciseIDs: ['e1', 'e2'], inline: [] }]
    store.saveSkill(a)
    store.saveSkill(b)
    const p = emptyProgress()
    const now = new Date().toISOString()
    p.mistakes = [
      { id: 'e1', exerciseID: 'e1', skill: 'b', count: 1, due: now, firstSeen: now, lastSeen: now, stage: 0, resolved: false },
      { id: 'e1', exerciseID: 'e1', skill: 'a', count: 1, due: now, firstSeen: now, lastSeen: now, stage: 0, resolved: false }
    ] as typeof p.mistakes
    p.attempts = [makeAttempt({ exerciseID: 'e1', skill: 'b', credit: 0 }), makeAttempt({ exerciseID: 'e1', skill: 'a', credit: 1 })]
    store.saveProgress(p)

    const renames = store.namespaceDuplicateIDs()
    expect(renames.b?.exercises).toEqual({ e1: 'b-e1' })
    expect(renames.b?.cards).toEqual({ c1: 'b-c1' })
    expect(renames.a).toBeUndefined()
    const a2 = store.loadSkill('a'), b2 = store.loadSkill('b')
    expect(a2.exercises.map((e) => e.id)).toEqual(['e1'])
    expect(b2.exercises.map((e) => e.id)).toEqual(['b-e1', 'e2'])
    expect(b2.cards.map((c) => c.id)).toEqual(['b-c1'])
    const t = b2.lesson[0]
    expect(t.type === 'tryit' && t.exerciseIDs).toEqual(['b-e1', 'e2']) // el «Pruébalo» apunta al renombrado
    const q = store.loadProgress()
    expect(new Set(q.mistakes.map((m) => `${m.skill}/${m.exerciseID}`))).toEqual(new Set(['b/b-e1', 'a/e1'])) // los errores siguen a su habilidad
    expect(new Set(q.attempts.map((x) => `${x.skill}/${x.exerciseID}`))).toEqual(new Set(['b/b-e1', 'a/e1']))
    expect(store.namespaceDuplicateIDs()).toEqual({}) // idempotente
  })
})

describe('cerrojo entre procesos', () => {
  it('espera a que otro proceso suelte el cerrojo', async () => {
    const lockDir = join(root, '.aula-lock')
    // otro proceso toma el cerrojo (carpeta + dueño) y lo suelta al cabo de 400 ms
    const script = `const fs=require('fs');fs.mkdirSync(${JSON.stringify(lockDir)});fs.writeFileSync(${JSON.stringify(join(lockDir, 'owner'))},process.pid+' '+Date.now());` +
      `process.stdout.write('ok');setTimeout(()=>{fs.rmSync(${JSON.stringify(lockDir)},{recursive:true,force:true});process.exit(0)},400)`
    const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] })
    await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()))
    const t0 = Date.now()
    // el cerrojo de este proceso es síncrono: se ejecuta en otro tic para no bloquear la lectura del hijo
    const took = await new Promise<number>((resolve) => setImmediate(() => resolve(withFileLock(lockDir, () => Date.now() - t0))))
    expect(took).toBeGreaterThanOrEqual(250)
    expect(existsSync(lockDir)).toBe(false)
    await new Promise((r) => child.once('exit', r))
  })

  it('un cerrojo abandonado (dueño muerto) se rompe y uno vivo caduca con error', () => {
    const lockDir = join(root, '.aula-lock')
    mkdirSync(lockDir)
    writeFileSync(join(lockDir, 'owner'), `999999999 ${Date.now()}`)
    expect(withFileLock(lockDir, () => 'hecho')).toBe('hecho')
    // un dueño vivo (este mismo proceso, desde fuera del cerrojo reentrante) y poco tiempo de espera
    mkdirSync(lockDir)
    writeFileSync(join(lockDir, 'owner'), `${process.ppid} ${Date.now()}`)
    expect(() => withFileLock(lockDir, () => 1, { timeoutMs: 100 })).toThrow(LockTimeoutError)
    rmSync(lockDir, { recursive: true })
  })

  it('es reentrante dentro del proceso', () => {
    const lockDir = join(root, '.aula-lock')
    expect(withFileLock(lockDir, () => withFileLock(lockDir, () => 2))).toBe(2)
    expect(existsSync(lockDir)).toBe(false)
  })
})

describe('vigilancia de Packs/', () => {
  it('ignora cerrojos, temporales y ocultos', () => {
    expect(isNoise('curso/.aula-lock/owner')).toBe(true)
    expect(isNoise('curso/.pack.json.ab12.tmp')).toBe(true)
    expect(isNoise('curso/skills/a.json')).toBe(false)
    expect(isNoise('')).toBe(true)
  })

  it('ve una escritura de otro proceso y agrupa las ráfagas', async () => {
    const l = lib()
    const store = l.createPack(makePack({ id: '', title: 'Vigilado' }))
    const seen: string[] = []
    const w = watchPacks(l.packsDirectory, (id) => seen.push(id), 150)
    try {
      await wait(200)
      // «otro proceso»: un almacén aparte sobre la misma carpeta
      const other = new PackStore(store.id, store.directory)
      other.saveSkill(makeSkill({ id: 'nuevo', title: 'Nuevo' }))
      other.saveSkill(makeSkill({ id: 'otro', title: 'Otro' }))
      for (let i = 0; i < 50 && !seen.length; i++) await wait(100)
      expect(seen[0]).toBe('vigilado')
      await wait(400)
      expect(seen.length).toBeLessThanOrEqual(2) // agrupado (como mucho una ráfaga más por el renombrado atómico)
    } finally {
      w.stop()
    }
  })

  it('ve los cursos nuevos', async () => {
    const l = lib()
    const seen = new Set<string>()
    const w = watchPacks(l.packsDirectory, (id) => seen.add(id), 100)
    try {
      await wait(150)
      new Library(root).createPack(makePack({ id: 'recien', title: 'Recién llegado' }))
      for (let i = 0; i < 50 && !seen.has('recien'); i++) await wait(100)
      expect(seen.has('recien')).toBe(true)
    } finally {
      w.stop()
    }
  })
})

describe('JSON del curso en disco', () => {
  it('se escribe con claves ordenadas y legible, como Swift', () => {
    const store = lib().createPack(makePack({ id: '', title: 'Orden', subject: 'Z' }))
    const text = readFileSync(store.packPath, 'utf8')
    const keys = Object.keys(parseJSON(text) as object)
    expect(keys).toEqual([...keys].sort())
    expect(text).toContain('\n  "id": "orden"')
  })
})
