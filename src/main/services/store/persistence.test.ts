// Persistencia del almacén: escrituras atómicas con copia anterior, recuperación de archivos dañados o a medias, claves que
// esta versión no conoce, el curso de ejemplo real (tests/fixtures/demo-course) abierto y guardado sin perder nada, datos con
// otra forma y el orden de la carpeta de datos.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isJSONObject, parseJSON, RawNumber } from '@engine/base/json'
import { makePack, makeSkill, makeSkillProgress } from '@shared/schema'
import { backupPath, keepDamagedCopy, readWithBackup, writeFileAtomic } from '../fs'
import { keepUnknownKeys } from './jsonFile'
import { Library } from './library'
import { tidyDataFolder } from './maintenance'

const FIXTURE = join(__dirname, '../../../../tests/fixtures/demo-course/exam-2-math112')

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'aula-persist-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

const raw = (file: string): unknown => parseJSON(readFileSync(file, 'utf8'))

/** Claves o valores del original que faltan o cambian en lo escrito (las claves nuevas no cuentan). */
function lost(original: unknown, written: unknown, path = '$'): string[] {
  if (original instanceof RawNumber || written instanceof RawNumber) return String(original) === String(written) ? [] : [`${path}`]
  if (Array.isArray(original)) {
    if (!Array.isArray(written) || written.length !== original.length) return [`${path}: lista`]
    return original.flatMap((x, i) => lost(x, written[i], `${path}[${i}]`))
  }
  if (isJSONObject(original)) {
    if (!isJSONObject(written)) return [`${path}: objeto`]
    return Object.keys(original).flatMap((k) => (k in written ? lost(original[k], written[k], `${path}.${k}`) : [`${path}.${k}: falta`]))
  }
  return original === written ? [] : [path]
}

describe('escritura atómica', () => {
  it('no deja temporales, respeta los permisos y guarda la versión anterior como copia oculta', () => {
    const f = join(root, 'a', 'datos.json')
    writeFileAtomic(f, '{"v":1}', { mode: 0o600, backup: true })
    expect(existsSync(backupPath(f))).toBe(false)
    writeFileAtomic(f, '{"v":2}', { mode: 0o600, backup: true })
    expect(readFileSync(f, 'utf8')).toBe('{"v":2}')
    expect(readFileSync(backupPath(f), 'utf8')).toBe('{"v":1}')
    expect(statSync(f).mode & 0o777).toBe(0o600)
    writeFileAtomic(f, '{"v":3}', { backup: true })
    expect(readFileSync(backupPath(f), 'utf8')).toBe('{"v":2}')
    expect(readdirSync(join(root, 'a')).sort()).toEqual(['.datos.json.bak', 'datos.json'])
  })

  it('si falla, el archivo anterior queda intacto y no queda el temporal', () => {
    const dir = join(root, 'b')
    const f = join(dir, 'x.json')
    writeFileAtomic(f, 'bien')
    mkdirSync(join(dir, 'carpeta'))
    // escribir «encima» de una carpeta falla en el rename
    expect(() => writeFileAtomic(join(dir, 'carpeta'), 'no')).toThrow()
    expect(readFileSync(f, 'utf8')).toBe('bien')
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  it('un archivo a medias se lee de su copia anterior y la copia del dañado es una sola por contenido', () => {
    const f = join(root, 'c.json')
    writeFileAtomic(f, JSON.stringify({ n: 1 }), { backup: true })
    writeFileAtomic(f, JSON.stringify({ n: 2 }), { backup: true })
    writeFileSync(f, '{"n": 2, "trunc') // un apagón a mitad (sin fsync)
    for (let i = 0; i < 3; i++) {
      const r = readWithBackup(f, (t) => JSON.parse(t) as { n: number })
      expect(r?.value.n).toBe(1)
      expect(r?.fromBackup).toBe(true)
    }
    expect(readdirSync(root).filter((n) => n.includes('.damaged-'))).toHaveLength(1)
    expect(keepDamagedCopy(f, 'otro contenido')).not.toBe(keepDamagedCopy(f, '{"n": 2, "trunc'))
    // sin copia anterior ni archivo: nada (no lanza)
    expect(readWithBackup(join(root, 'nada.json'), JSON.parse)).toBeUndefined()
  })
})

describe('claves desconocidas', () => {
  it('se conservan las de primer nivel que no conoce y no vuelven las que se quitaron a propósito', () => {
    const roundTrip = (v: unknown): unknown => {
      const o = v as Record<string, unknown>
      const out: Record<string, unknown> = { id: o.id }
      if (o.exam !== undefined) out.exam = o.exam
      return out
    }
    const prev = { id: 'a', exam: { date: 'x' }, futuro: [1, 2] }
    expect(keepUnknownKeys({ id: 'a' }, prev, roundTrip)).toEqual({ id: 'a', futuro: [1, 2] })
    expect(keepUnknownKeys({ id: 'a', futuro: 'nuevo' }, prev, roundTrip)).toEqual({ id: 'a', futuro: 'nuevo' })
    expect(keepUnknownKeys({ id: 'a' }, 'no es un objeto', roundTrip)).toEqual({ id: 'a' })
  })

  it('abrir y guardar un curso de una versión más nueva no pierde lo que esta no entiende', () => {
    const store = new Library(root).createPack(makePack({ id: 'nuevo', title: 'Nuevo' }))
    store.saveSkill(makeSkill({ id: 's1', title: 'Uno' }))
    store.updateProgress((p) => { p.xp = 5 })
    for (const [file, key] of [[store.packPath, 'futuroCurso'], [store.skillPath('s1'), 'futuraHabilidad'], [store.progressPath, 'futuroProgreso']] as const) {
      const o = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      o[key] = { versión: 9 }
      writeFileSync(file, JSON.stringify(o))
    }
    store.updatePack((p) => { p.title = 'Cambiado' })
    store.updateSkill('s1', (s) => { s.title = 'Uno bis' })
    store.updateProgress((p) => { p.xp += 1 })
    expect((raw(store.packPath) as Record<string, unknown>).futuroCurso).toEqual({ versión: 9 })
    expect((raw(store.skillPath('s1')) as Record<string, unknown>).futuraHabilidad).toBeDefined()
    expect((raw(store.progressPath) as Record<string, unknown>).futuroProgreso).toBeDefined()
    expect(store.loadPack().title).toBe('Cambiado')
    expect(store.loadProgress().xp).toBe(6)
  })
})

describe('archivos del curso dañados', () => {
  it('pack.json dañado: se lee la versión anterior y el curso sigue en la lista', () => {
    const l = new Library(root)
    const store = l.createPack(makePack({ id: 'quimica', title: 'Química' }))
    store.updatePack((p) => { p.subject = 'Química orgánica' })
    writeFileSync(store.packPath, '{"id": "quimica", "title": "Quím') // a medias
    expect(l.listPacks().map((p) => p.id)).toEqual(['quimica'])
    expect(store.loadPack().title).toBe('Química')
    // guardar arregla el archivo principal
    store.updatePack((p) => { p.subject = 'Química' })
    expect((raw(store.packPath) as Record<string, unknown>).subject).toBe('Química')
  })

  it('progress.json dañado no vuelve a cero si hay versión anterior; empezar de cero quita también la copia', () => {
    const store = new Library(root).createPack(makePack({ id: 'p', title: 'P' }))
    store.updateProgress((p) => { p.skills.s = makeSkillProgress({ alpha: 4, beta: 1, attempts: 3 }) })
    store.updateProgress((p) => { p.xp = 40 })
    writeFileSync(store.progressPath, '')
    const p = store.loadProgress()
    expect(p.skills.s.attempts).toBe(3)
    // la siguiente escritura parte de lo recuperado
    store.updateProgress((q) => { q.xp += 1 })
    expect(store.loadProgress().xp).toBeGreaterThanOrEqual(1)
    expect(store.loadProgress().skills.s.attempts).toBe(3)
    store.resetProgress()
    expect(existsSync(store.progressPath)).toBe(false)
    expect(existsSync(backupPath(store.progressPath))).toBe(false)
  })

  it('una habilidad dañada se lee de su versión anterior; borrarla quita también la copia', () => {
    const store = new Library(root).createPack(makePack({ id: 'h', title: 'H' }))
    store.saveSkill(makeSkill({ id: 's1', title: 'Primera' }))
    store.updateSkill('s1', (s) => { s.title = 'Segunda' })
    writeFileSync(store.skillPath('s1'), '[')
    expect(store.loadSkills().map((s) => s.title)).toEqual(['Primera'])
    store.deleteSkill('s1')
    expect(existsSync(backupPath(store.skillPath('s1')))).toBe(false)
  })

  it('lo oculto (copias y temporales) no se exporta con el curso', async () => {
    const l = new Library(root)
    const store = l.createPack(makePack({ id: 'e', title: 'E' }))
    store.updatePack((p) => { p.subject = 'x' })
    expect(existsSync(backupPath(store.packPath))).toBe(true)
    const out = join(root, 'e.aulapack')
    await l.exportPack('e', out)
    const id = await l.importPack(out)
    expect(existsSync(backupPath(join(l.packDirectory(id), 'pack.json')))).toBe(false)
  })
})

describe('el curso de ejemplo (formato real en disco)', () => {
  const install = (): Library => {
    const l = new Library(root)
    cpSync(FIXTURE, l.packDirectory('exam-2-math112'), { recursive: true })
    return l
  }

  it('se abre entero', () => {
    const l = install()
    expect(l.listPacks().map((p) => p.id)).toEqual(['exam-2-math112'])
    const store = l.openPack('exam-2-math112')!
    expect(store.loadSkills()).toHaveLength(8)
    expect(store.loadPack().sources.length).toBeGreaterThan(0)
    expect(store.allChunks().length).toBeGreaterThan(0)
    expect(store.loadProgress().schema).toBe(1)
  })

  it('guardarlo sin cambios no pierde ninguna clave ni valor (curso, habilidades y progreso)', () => {
    const l = install()
    const store = l.openPack('exam-2-math112')!
    const before = {
      pack: raw(store.packPath),
      progress: raw(store.progressPath),
      skills: Object.fromEntries(store.skillIDs().map((id) => [id, raw(store.skillPath(id))]))
    }
    store.updatePack(() => undefined)
    store.updateProgress(() => undefined)
    for (const id of store.skillIDs()) store.updateSkill(id, () => undefined)
    // `updated` y `revision` cambian a propósito al guardar
    const ignore = (v: unknown): unknown => {
      if (!isJSONObject(v)) return v
      const { updated: _u, revision: _r, ...rest } = v as Record<string, unknown>
      return rest
    }
    expect(lost(ignore(before.pack), ignore(raw(store.packPath)))).toEqual([])
    expect(lost(before.progress, raw(store.progressPath))).toEqual([])
    for (const [id, s] of Object.entries(before.skills)) expect(lost(ignore(s), ignore(raw(store.skillPath(id)))), id).toEqual([])
  })

  it('con datos de otra forma (listas que no son listas, números en texto, campos de más) abre y guarda sin romperse', () => {
    const l = install()
    const store = l.openPack('exam-2-math112')!
    const pack = JSON.parse(readFileSync(store.packPath, 'utf8')) as Record<string, unknown>
    pack.units = 'no es una lista'
    pack.hue = '0.3'
    pack.extraDeOtraApp = { a: 1 }
    writeFileSync(store.packPath, JSON.stringify(pack))
    const prog = JSON.parse(readFileSync(store.progressPath, 'utf8')) as Record<string, unknown>
    prog.attempts = { roto: true }
    prog.xp = 'mucho'
    writeFileSync(store.progressPath, JSON.stringify(prog))
    expect(() => l.listPacks()).not.toThrow()
    const p = store.loadPack()
    expect(p.skills).toHaveLength(8)
    expect(Array.isArray(p.units)).toBe(true)
    const pr = store.loadProgress()
    expect(Array.isArray(pr.attempts)).toBe(true)
    expect(Number.isFinite(pr.xp)).toBe(true)
    store.updatePack((x) => { x.title = x.title + ' ' })
    expect((raw(store.packPath) as Record<string, unknown>).extraDeOtraApp).toBeDefined()
  })
})

describe('orden de la carpeta de datos', () => {
  const old = (path: string, days: number): void => {
    const t = new Date(Date.now() - days * 86_400_000)
    utimesSync(path, t, t)
    for (const n of existsSync(path) && statSync(path).isDirectory() ? readdirSync(path) : []) utimesSync(join(path, n), t, t)
  }

  it('quita la papelera vieja, los adjuntos sin conversación y la depuración antigua; nunca lo demás', () => {
    const l = new Library(root)
    const store = l.createPack(makePack({ id: 'c', title: 'C' }))
    store.updateProgress((p) => { p.xp = 1 })
    // papelera: una vieja y una reciente
    mkdirSync(join(root, 'Eliminados', 'viejo-1'), { recursive: true })
    writeFileSync(join(root, 'Eliminados', 'viejo-1', 'pack.json'), '{}')
    old(join(root, 'Eliminados', 'viejo-1'), 40)
    mkdirSync(join(root, 'Eliminados', 'nuevo-2'), { recursive: true })
    // adjuntos: uno con conversación (del chat), uno del tutor, uno huérfano viejo y uno huérfano reciente
    const files = join(root, 'Assistant', 'Packs')
    for (const n of ['con-chat', 'con-tutor', 'huerfano', 'huerfano-reciente']) { mkdirSync(join(files, n, 'sources'), { recursive: true }); writeFileSync(join(files, n, 'pack.json'), '{}') }
    mkdirSync(join(root, 'Assistant', 'threads'), { recursive: true })
    writeFileSync(join(root, 'Assistant', 'threads', 'con-chat.json'), '{}')
    writeFileSync(join(store.chatsDirectory, 'con-tutor.json'), '{}')
    for (const n of ['con-chat', 'con-tutor', 'huerfano']) old(join(files, n), 10)
    // depuración de ejecuciones
    mkdirSync(join(store.runsDirectory, 'run-1.args'), { recursive: true })
    writeFileSync(join(store.runsDirectory, 'run-1.args', 'x.json'), '{}')
    writeFileSync(join(store.runsDirectory, 'run-1.errores.log'), 'x')
    writeFileSync(join(store.runsDirectory, 'run-1.json'), '{}')
    for (const n of ['run-1.args', 'run-1.errores.log', 'run-1.json']) old(join(store.runsDirectory, n), 60)

    const r = tidyDataFolder(root)
    expect(r).toEqual({ trash: 1, orphanFiles: 1, runDebug: 2 })
    expect(readdirSync(join(root, 'Eliminados'))).toEqual(['nuevo-2'])
    expect(readdirSync(files).sort()).toEqual(['con-chat', 'con-tutor', 'huerfano-reciente'])
    expect(readdirSync(store.runsDirectory)).toEqual(['run-1.json'])
    expect(store.loadProgress().xp).toBe(1)
    // una segunda pasada no hace nada
    expect(tidyDataFolder(root)).toEqual({ trash: 0, orphanFiles: 0, runDebug: 0 })
  })
})
