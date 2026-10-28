// Historial de cambios de Aula y «Deshacer lo que cambió Aula» (port de ChangeHistoryTests, ChangeHistoryStudentEditsTests y
// JSONMergeTests de la app Swift anterior: Tests/StudyModelTests).
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IDs } from '@engine/base/ids'
import { parseJSON } from '@engine/base/json'
import { encodeSkill, makeFlashcard, makePack, makeSkill, makeSkillRef, type ChangeActor, type ChangeActorKind } from '@shared/schema'
import { jsonBytes } from '../jsonFile'
import { Library } from '../library'
import { PackStore } from '../packStore'
import { ChangeHistory, HistoryError, type HistoryFileHost } from './changeHistory'
import { ChangeContext } from './context'
import { JSONMerge } from './jsonMerge'

let root: string
let lib: Library
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aula-history-'))
  lib = new Library(root)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const history = (): ChangeHistory => lib.history!
const actor = (label = 'Pedir cambios', kind: ChangeActorKind = 'pipeline', group?: string, course: string | undefined = 'fisica'): ChangeActor =>
  ({ kind, group: group ?? `g-${IDs.short(6)}`, label, ...(course ? { courseID: course } : {}) })
const as = <T>(a: ChangeActor, fn: () => T): T => ChangeContext.run(a, fn)

function makeCourse(withUnit = false): PackStore {
  const p = makePack({ id: 'fisica', title: 'Física' })
  p.skills = [makeSkillRef({ id: 'cinematica', title: 'Cinemática', order: 0 })]
  if (withUnit) p.units = [{ id: 'u1', title: 'Unidad 1', skillIDs: ['cinematica'] }]
  const store = lib.createPack(p)
  store.saveSkill(makeSkill({ id: 'cinematica', title: 'Cinemática', status: 'draft', cards: [makeFlashcard({ id: 'c1', front: 'v', back: 'dx/dt' })] }))
  return store
}

const card = (id: string, front = 'f', back = 'b') => makeFlashcard({ id, front, back })
const read = (file: string): Buffer => readFileSync(file)

function blobs(h: ChangeHistory): Set<string> {
  if (!existsSync(h.blobsPath)) return new Set()
  return new Set(readdirSync(h.blobsPath).flatMap((d) => readdirSync(join(h.blobsPath, d))))
}

function expectHistoryError(fn: () => unknown, code: HistoryError['code']): HistoryError {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(HistoryError)
    expect((err as HistoryError).code).toBe(code)
    return err as HistoryError
  }
  throw new Error(`se esperaba un error ${code}`)
}

describe('apuntar', () => {
  it('solo se apunta lo que cambia Aula (y nunca el progreso)', () => {
    const store = makeCourse() // sin actor: el estudiante
    expect(history().groups()).toEqual([])
    const a = actor('Añade tarjetas')
    as(a, () => {
      store.updateSkill('cinematica', (s) => { s.cards.push(card('c2', 'a', 'dv/dt')) })
      store.updateProgress((p) => { p.xp = 99 })
    })
    const groups = history().groups()
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ id: a.group, label: 'Añade tarjetas', kind: 'pipeline', courseID: 'fisica', isUndone: false })
    expect(new Set(groups[0].files.map((f) => f.path))).toEqual(new Set(['Packs/fisica/skills/cinematica.json', 'Packs/fisica/pack.json']))
    expect(groups[0].files.some((f) => f.path.includes('progress'))).toBe(false)
    expect(history().groups({ courseID: 'fisica' })).toHaveLength(1)
    expect(history().groups({ courseID: 'otro' })).toHaveLength(0)
    const lines = history().describe(groups[0]).map((l) => l.text).join(' | ')
    expect(lines).toContain('1 tarjetas nuevas')
  })

  it('lo silenciado y los almacenes internos no apuntan nada', () => {
    const store = makeCourse()
    as(actor(), () => ChangeContext.suppress(() => store.updatePack((p) => { p.title = 'Física I' })))
    expect(history().groups()).toEqual([])
    // un almacén interno (adjuntos del chat) no apunta nada aunque haya actor
    const hidden = new Library(join(root, 'Assistant'), { recordsHistory: false })
    const other = hidden.createPack(makePack({ id: 'adjuntos', title: 'Adjuntos' }))
    as(actor(), () => other.updatePack((p) => { p.title = 'X' }))
    expect(other.history).toBeUndefined()
    expect(existsSync(join(root, 'Assistant/History'))).toBe(false)
  })

  it('el actor viaja por el entorno al ayudante MCP', () => {
    const a = actor('Desde el ayudante MCP')
    const env = ChangeContext.environment(a)
    expect(ChangeContext.decode(env)).toEqual(a)
    expect(ChangeContext.decode({})).toBeUndefined()
    expect(ChangeContext.decode({ [ChangeContext.environmentKey]: 'no-es-base64%%' })).toBeUndefined()
    expect(ChangeContext.environment(undefined)).toEqual({})
  })

  it('el actor se hereda a través de await', async () => {
    const a = actor('Asíncrono')
    const seen = await ChangeContext.run(a, async () => {
      await new Promise((r) => setTimeout(r, 5))
      return ChangeContext.current?.group
    })
    expect(seen).toBe(a.group)
    expect(ChangeContext.current).toBeUndefined()
  })
})

describe('deshacer', () => {
  it('vuelve byte a byte y el propio deshacer se puede deshacer', () => {
    const store = makeCourse()
    const before = read(store.skillPath('cinematica')), packBefore = read(store.packPath)
    const a = actor('Quita las tarjetas')
    as(a, () => store.updateSkill('cinematica', (s) => { s.cards = [] }))
    expect(store.loadSkill('cinematica').cards).toHaveLength(0)

    const plan = history().plan(a.group)
    expect(plan.canUndo).toBe(true)
    expect(plan.alsoUndo).toEqual([])
    expect(plan.conflicts).toBe(0)
    const result = history().undo(a.group)
    expect(read(store.skillPath('cinematica'))).toEqual(before) // sin cambios después: vuelve byte a byte
    expect(read(store.packPath)).toEqual(packBefore)
    expect(history().group(a.group)?.isUndone).toBe(true)
    expectHistoryError(() => history().undo(a.group), 'already_undone')

    // deshacer el deshacer: vuelve a estar sin tarjetas y el grupo original queda vigente otra vez
    const undoGroup = history().group(result.undoGroupID)!
    expect(undoGroup.kind).toBe('undo')
    expect(undoGroup.undid).toEqual([a.group])
    history().undo(result.undoGroupID)
    expect(store.loadSkill('cinematica').cards).toHaveLength(0)
    expect(history().group(a.group)?.isUndone).toBe(false)
    expect(history().group(result.undoGroupID)?.isUndone).toBe(true)
  })

  it('lo que el estudiante cambió después se conserva', () => {
    const store = makeCourse()
    const a = actor('Añade una tarjeta y cambia el título')
    as(a, () => store.updateSkill('cinematica', (s) => { s.cards.push(card('c2', 'a', 'dv/dt')); s.title = 'Cinemática (IA)' }))
    // el estudiante cambia OTRA tarjeta y la asignatura del curso (sin actor)
    store.updateSkill('cinematica', (s) => { s.cards[0].back = 'dx/dt (mi nota)' })
    store.updatePack((p) => { p.subject = 'Mecánica' })
    expect(history().plan(a.group).conflicts).toBe(0) // partes distintas: sin conflicto
    history().undo(a.group)
    const s = store.loadSkill('cinematica')
    expect(s.cards.map((c) => c.id)).toEqual(['c1']) // la tarjeta de Aula se va
    expect(s.cards[0].back).toBe('dx/dt (mi nota)') // lo del estudiante se queda
    expect(s.title).toBe('Cinemática')
    expect(store.loadPack().subject).toBe('Mecánica')
  })

  it('si el estudiante cambió lo mismo, gana lo suyo y se avisa', () => {
    const store = makeCourse()
    const a = actor('Cambia el reverso')
    as(a, () => store.updateSkill('cinematica', (s) => { s.cards[0].back = 'versión de Aula' }))
    store.updateSkill('cinematica', (s) => { s.cards[0].back = 'versión mía' })
    const plan = history().plan(a.group)
    expect(plan.conflicts).toBeGreaterThan(0)
    expect(plan.files.flatMap((f) => f.conflicts).some((c) => c.includes('cards[id=c1].back'))).toBe(true)
    const r = history().undo(a.group)
    expect(r.keptLaterEdits.length).toBeGreaterThan(0)
    expect(store.loadSkill('cinematica').cards[0].back).toBe('versión mía')

    // sin fusión: exactamente lo de antes
    const b = actor('Otra vez')
    as(b, () => store.updateSkill('cinematica', (s) => { s.cards[0].back = 'Aula 2' }))
    store.updateSkill('cinematica', (s) => { s.cards[0].back = 'mía 2' })
    history().undo(b.group, { keepLaterEdits: false })
    expect(store.loadSkill('cinematica').cards[0].back).toBe('versión mía')
  })

  it('los cambios de Aula posteriores se deshacen también (o se niega)', () => {
    const store = makeCourse()
    const first = actor('Primero'), second = actor('Segundo')
    as(first, () => store.updateSkill('cinematica', (s) => { s.cards.push(card('c2', '1', '1')) }))
    as(second, () => store.updateSkill('cinematica', (s) => { s.cards.push(card('c3', '2', '2')) }))
    expect(history().plan(first.group).alsoUndo.map((g) => g.id)).toEqual([second.group])
    const err = expectHistoryError(() => history().undo(first.group, { includeLater: false }), 'later_changes')
    expect(err.details).toEqual(['Segundo'])
    expect(store.loadSkill('cinematica').cards).toHaveLength(3) // si se niega, no toca nada
    history().undo(first.group)
    expect(store.loadSkill('cinematica').cards.map((c) => c.id)).toEqual(['c1'])
    expect(history().group(second.group)?.isUndone).toBe(true)
  })

  it('las lecciones creadas y borradas vuelven', () => {
    const store = makeCourse()
    const create = actor('Lección nueva')
    as(create, () => store.saveSkill(makeSkill({ id: 'dinamica', title: 'Dinámica', status: 'draft' })))
    expect(store.hasSkill('dinamica')).toBe(true)
    history().undo(create.group)
    expect(store.hasSkill('dinamica')).toBe(false) // Aula la creó: deshacer la quita
    expect(store.loadPack().skills.some((s) => s.id === 'dinamica')).toBe(false)

    const del = actor('Borra cinemática')
    as(del, () => store.deleteSkill('cinematica'))
    expect(store.hasSkill('cinematica')).toBe(false)
    expect(history().plan(del.group).files.some((f) => f.action === 'recreate')).toBe(true)
    history().undo(del.group)
    expect(store.loadSkill('cinematica').cards.map((c) => c.id)).toEqual(['c1'])
    expect(store.loadPack().skills.some((s) => s.id === 'cinematica')).toBe(true)
  })

  it('lo que no existe no se puede deshacer', () => {
    makeCourse()
    expectHistoryError(() => history().undo('no-existe'), 'not_found')
    expectHistoryError(() => history().plan('no-existe'), 'not_found')
  })
})

describe('todo o nada', () => {
  it('un fallo a mitad de deshacer vuelve atrás todo', () => {
    const store = makeCourse()
    const a = actor('Toca dos archivos')
    as(a, () => {
      store.updateSkill('cinematica', (s) => { s.cards = [] })
      store.updatePack((p) => { p.title = 'Física (IA)' })
    })
    const skillNow = read(store.skillPath('cinematica')), packNow = read(store.packPath)
    // pack.json lo «lleva» un dueño que falla al escribir: el deshacer no puede quedar a medias
    const failing: HistoryFileHost = { historyRewrite: () => { throw new Error('sin permiso') } }
    history().registerHost(store.packPath, failing)
    expect(() => history().undo(a.group)).toThrow('sin permiso')
    expect(read(store.skillPath('cinematica'))).toEqual(skillNow) // lo ya escrito se vuelve atrás
    expect(read(store.packPath)).toEqual(packNow)
    expect(history().group(a.group)?.isUndone).toBe(false)
    expect(existsSync(history().journalPath)).toBe(false)
    history().registerHost(store.packPath, null)
  })

  it('un deshacer interrumpido se vuelve atrás al abrir', () => {
    const store = makeCourse()
    as(actor('Algo'), () => store.updatePack((p) => { p.title = 'Física (IA)' }))
    const current = read(store.packPath)
    // un cierre a mitad: diario escrito y un archivo ya cambiado, sin las marcas de «deshecho»
    const next = Buffer.from('{"id":"fisica","title":"a medias"}')
    const prevHash = history().store(current), nextHash = history().store(next)
    history().writeJournalForTesting({ undo: 'undo-x', entries: [{ path: 'Packs/fisica/pack.json', previous: prevHash, next: nextHash }] })
    writeFileSync(store.packPath, next)
    const reopened = new ChangeHistory(root) // al abrir
    expect(read(store.packPath)).toEqual(current) // todo o nada: vuelve a como estaba
    expect(existsSync(reopened.journalPath)).toBe(false)
  })

  // ENG-30: la recuperación espera al cerrojo del archivo (otro proceso lo tiene).
  it('la recuperación de un deshacer interrumpido espera al cerrojo del archivo', async () => {
    const store = makeCourse()
    as(actor('Algo'), () => store.updatePack((p) => { p.title = 'Física (IA)' }))
    const current = read(store.packPath)
    const next = Buffer.from('{"id":"fisica","title":"a medias"}')
    const prevHash = history().store(current), nextHash = history().store(next)
    const lockRel = 'Packs/fisica/.lock-test'
    history().writeJournalForTesting({ undo: 'undo-x', entries: [{ path: 'Packs/fisica/pack.json', previous: prevHash, next: nextHash, lock: lockRel }] })
    writeFileSync(store.packPath, next)
    const lockDir = join(root, lockRel)
    const script = `const fs=require('fs');fs.mkdirSync(${JSON.stringify(lockDir)});fs.writeFileSync(${JSON.stringify(join(lockDir, 'owner'))},process.pid+' '+Date.now());` +
      `process.stdout.write('ok');setTimeout(()=>{fs.rmSync(${JSON.stringify(lockDir)},{recursive:true,force:true});process.exit(0)},400)`
    const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] })
    await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()))
    expect(read(store.packPath)).toEqual(next) // con el cerrojo ocupado todavía no escribe
    const t0 = Date.now()
    const took = await new Promise<number>((resolve) => setImmediate(() => { new ChangeHistory(root); resolve(Date.now() - t0) }))
    expect(took).toBeGreaterThanOrEqual(250)
    expect(read(store.packPath)).toEqual(current)
    await new Promise((r) => child.once('exit', r))
  })

  // ENG-02: el calendario que creó Aula y que solo cambió en claves internas vuelve a no existir, no a «{}».
  it('un contenedor creado por Aula con solo cambios internos vuelve a no existir', () => {
    const file = join(root, 'calendar.json')
    const g = actor('Añade evento', 'chat')
    const after = Buffer.from('{"schema":1,"events":[{"id":"e1","title":"Física"}]}')
    writeFileSync(file, after)
    history().record({ file, before: null, after, domain: 'calendar', actor: g })
    writeFileSync(file, '{"schema":1,"events":[{"id":"e1","title":"Física","updatedAt":"2026-10-19T10:00:00Z"}]}')
    history().undo(g.group)
    expect(existsSync(file)).toBe(false)
    expect(history().describe(history().group(g.group)!).map((l) => l.text)).toEqual(['Evento nuevo: «Física»'])
  })
})

describe('ediciones del estudiante entre cambios de Aula', () => {
  // ENG-01: Aula → estudiante → Aula en el mismo archivo; deshacer el primero (y el segundo con él) conserva la edición.
  it('la edición entre dos grupos de Aula sobrevive', () => {
    const store = makeCourse(true)
    const g1 = actor('Añade c2', 'chat'), g2 = actor('Añade c3', 'chat')
    as(g1, () => store.updateSkill('cinematica', (s) => { s.cards.push(card('c2', 'a', 'dv/dt')) }))
    store.updateSkill('cinematica', (s) => { s.cards[0].back = 'MI NOTA' })
    as(g2, () => store.updateSkill('cinematica', (s) => { s.cards.push(card('c3', 'j', 'da/dt')) }))
    expect(history().plan(g1.group).alsoUndo.map((g) => g.id)).toEqual([g2.group])
    history().undo(g1.group)
    const s = store.loadSkill('cinematica')
    expect(s.cards.map((c) => c.id)).toEqual(['c1'])
    expect(s.cards[0].back).toBe('MI NOTA')
  })

  // ENG-01: un mismo grupo escribe dos veces con una edición del estudiante en medio.
  it('la edición dentro de un mismo grupo sobrevive (y la limpieza no la junta)', () => {
    const store = makeCourse(true)
    const g = actor('Turno largo', 'chat')
    as(g, () => store.updateSkill('cinematica', (s) => { s.cards.push(card('c2', 'a', 'dv/dt')) }))
    store.updateSkill('cinematica', (s) => { s.cards[0].back = 'MI NOTA' })
    as(g, () => store.updateSkill('cinematica', (s) => { s.cards.push(card('c3', 'j', 'da/dt')) }))
    history().undo(g.group)
    let s = store.loadSkill('cinematica')
    expect(s.cards.map((c) => c.id)).toEqual(['c1'])
    expect(s.cards[0].back).toBe('MI NOTA')
    const g2 = actor('Otro turno', 'chat')
    as(g2, () => store.updateSkill('cinematica', (x) => { x.cards.push(card('c4', 's', 'dj/dt')) }))
    store.updateSkill('cinematica', (x) => { x.cards[0].front = 'velocidad' })
    as(g2, () => store.updateSkill('cinematica', (x) => { x.cards.push(card('c5', 'p', 'ds/dt')) }))
    history().collectGarbage()
    expect(history().lines().filter((l) => l.t === 'change' && l.group === g2.group && l.file === 'Packs/fisica/skills/cinematica.json')).toHaveLength(2)
    history().undo(g2.group)
    s = store.loadSkill('cinematica')
    expect(s.cards.map((c) => c.id)).toEqual(['c1'])
    expect(s.cards[0]).toMatchObject({ front: 'velocidad', back: 'MI NOTA' })
  })

  it('sin ediciones en medio sigue saliendo exactamente el archivo de antes', () => {
    const store = makeCourse(true)
    const before = read(store.skillPath('cinematica'))
    const g1 = actor('Uno', 'chat'), g2 = actor('Dos', 'chat')
    as(g1, () => store.updateSkill('cinematica', (s) => { s.cards.push(card('c2')) }))
    as(g2, () => store.updateSkill('cinematica', (s) => { s.cards.push(card('c3')) }))
    history().undo(g1.group)
    expect(read(store.skillPath('cinematica'))).toEqual(before)
  })

  // ENG-11: una lección creada por Aula y editada por el estudiante se queda Y el curso la sigue listando.
  it('una lección creada por Aula y editada por el estudiante se queda en el curso', () => {
    const store = makeCourse(true)
    const g = actor('Crea lección nueva', 'chat')
    as(g, () => {
      store.updateSkill('vectores', (s) => { s.cards = [card('v1', '|v|', 'módulo')] }, { title: 'Vectores' })
      store.updatePack((p) => { p.units[0].skillIDs.push('vectores') })
    })
    store.updateSkill('vectores', (s) => { s.cards[0].back = 'MI NOTA' })
    const plan = history().plan(g.group)
    expect(plan.files.find((f) => f.path === 'Packs/fisica/pack.json')?.conflicts).toContain('$.skills[id=vectores]') // se explica qué no se deshizo
    history().undo(g.group)
    expect(existsSync(store.skillPath('vectores'))).toBe(true)
    const pack = store.loadPack()
    expect(pack.skills.some((s) => s.id === 'vectores')).toBe(true) // el curso sigue listando la lección
    expect(pack.units[0].skillIDs).toContain('vectores') // y sigue en su unidad
    expect(store.loadSkill('vectores').cards[0].back).toBe('MI NOTA')
  })

  it('si nadie la editó, deshacer quita la lección del todo', () => {
    const store = makeCourse(true)
    const g = actor('Crea lección nueva', 'chat')
    as(g, () => store.updateSkill('vectores', (s) => { s.cards = [card('v1', '|v|', 'módulo')] }, { title: 'Vectores' }))
    history().undo(g.group)
    expect(existsSync(store.skillPath('vectores'))).toBe(false)
    expect(store.loadPack().skills.some((s) => s.id === 'vectores')).toBe(false)
  })

  // ENG-29: la limpieza quita un grupo intermedio; deshacer el largo no se lleva lo de ese grupo.
  it('un grupo intermedio quitado por la limpieza se conserva al deshacer', () => {
    const store = makeCourse(true)
    const t0 = new Date(1_800_000_000_000)
    const long = actor('Tubería larga', 'chat'), mid = actor('Chat en medio', 'chat')
    const file = store.skillPath('cinematica')
    const w = (g: ChangeActor, at: Date, body: (s: ReturnType<PackStore['loadSkill']>) => void): void => {
      const before = read(file)
      const s = store.loadSkill('cinematica')
      body(s)
      const after = jsonBytes(encodeSkill(s))
      writeFileSync(file, after)
      new ChangeHistory(root, () => at).record({ file, before, after, domain: 'course', courseID: 'fisica', actor: g })
    }
    w(long, t0, (s) => { s.cards.push(card('L1', 'x', 'x')) })
    w(mid, new Date(t0.getTime() + 3600_000), (s) => { s.cards.push(card('M1', 'y', 'y')) })
    w(long, new Date(t0.getTime() + 20 * 86_400_000), (s) => { s.cards.push(card('L2', 'z', 'z')) })
    const h = new ChangeHistory(root, () => new Date(t0.getTime() + 21 * 86_400_000))
    h.collectGarbage()
    expect(h.group(mid.group)).toBeUndefined() // la limpieza quitó el grupo intermedio
    h.collectGarbage() // una segunda pasada no junta L1 y L2 por encima de M1
    expect(h.lines().filter((l) => l.t === 'change' && l.group === long.group && l.file === 'Packs/fisica/skills/cinematica.json')).toHaveLength(2)
    h.undo(long.group)
    expect(store.loadSkill('cinematica').cards.map((c) => c.id)).toEqual(['c1', 'M1'])
  })
})

describe('concurrencia y limpieza', () => {
  it('muchos escritores intercalados dejan el libro coherente', () => {
    const store = makeCourse()
    const groups = Array.from({ length: 8 }, (_, i) => actor(`Turno ${i}`, 'pipeline', `turno-${i}`))
    for (let k = 0; k < 5; k++) {
      groups.forEach((g, i) => as(g, () => store.updateSkill('cinematica', (s) => { s.cards.push(card(`t${i}-${k}`)) })))
    }
    expect(store.loadSkill('cinematica').cards).toHaveLength(41)
    expect(new Set(history().groups({ limit: 100 }).map((g) => g.id))).toEqual(new Set(groups.map((g) => g.group)))
    const changes = history().lines().filter((l) => l.t === 'change')
    expect(changes).toHaveLength(8 * 5 * 2) // cada escritura: la habilidad y pack.json
    // la cadena de la habilidad es continua: cada «antes» es el «después» anterior
    const chain = changes.filter((l) => l.file === 'Packs/fisica/skills/cinematica.json')
    for (let i = 1; i < chain.length; i++) expect(chain[i].before).toBe(chain[i - 1].after)
    // deshacer el primero arrastra a todos los que vinieron detrás
    history().undo(chain[0].group!)
    expect(store.loadSkill('cinematica').cards.map((c) => c.id)).toEqual(['c1'])
  })

  it('la limpieza quita los grupos viejos y las copias huérfanas', () => {
    const store = makeCourse()
    const old = actor('Viejo'), recent = actor('Reciente')
    let now = new Date(1_800_000_000_000)
    const h = new ChangeHistory(root, () => now)
    const s2 = new PackStore(store.id, store.directory, h)
    as(old, () => s2.updatePack((p) => { p.title = 'A' }))
    expect(h.groups().map((g) => g.id)).toEqual([old.group])
    const blobsAfterOld = blobs(h)
    now = new Date(now.getTime() + 20 * 86_400_000)
    // al apuntar algo nuevo (y como mucho cada 6 h) se limpia lo de hace más de 14 días
    as(recent, () => s2.updatePack((p) => { p.title = 'B' }))
    expect(h.groups().map((g) => g.id)).toEqual([recent.group])
    const referenced = new Set(h.lines().flatMap((l) => [l.before, l.after].filter((x): x is string => !!x)))
    for (const b of blobs(h)) expect(referenced.has(b), 'no quedan copias huérfanas').toBe(true)
    expect([...blobsAfterOld].every((b) => blobs(h).has(b)), 'las copias del grupo viejo que nadie usa se borran').toBe(false)
    // lo que queda se puede deshacer igual
    h.undo(recent.group)
    expect(store.loadPack().title).toBe('A')
    // tope de grupos y de tamaño
    expect(h.collectGarbage({ now, maxGroups: 1 }).removedGroups).toBe(1) // el deshacer queda; el grupo de antes sale
    expect(h.collectGarbage({ now, maxBytes: 0 }).removedGroups).toBe(1)
    expect(h.groups()).toEqual([])
    expect(blobs(h).size).toBe(0)
  })

  it('las escrituras intermedias se juntan, pero no las intercaladas', () => {
    const store = makeCourse()
    const before = read(store.skillPath('cinematica'))
    const pipeline = actor('Crear el curso', 'pipeline', 'pipeline-run1'), chat = actor('Turno', 'chat', 'chat-1')
    as(pipeline, () => { for (let k = 0; k < 5; k++) store.updateSkill('cinematica', (s) => { s.cards.push(card(`p${k}`)) }) })
    as(chat, () => store.updatePack((p) => { p.subject = 'Física I' }))
    as(pipeline, () => store.updatePack((p) => { p.subject = 'Física (IA)' }))
    const blobsBefore = blobs(history())
    history().collectGarbage()
    const changes = history().lines().filter((l) => l.t === 'change')
    expect(changes.filter((l) => l.file === 'Packs/fisica/skills/cinematica.json')).toHaveLength(1) // cinco seguidas: un cambio
    // pack.json: pipeline ×5, chat, pipeline → tres tramos (no se juntan por encima del chat)
    expect(changes.filter((l) => l.file === 'Packs/fisica/pack.json').map((l) => l.group)).toEqual(['pipeline-run1', 'chat-1', 'pipeline-run1'])
    expect(blobs(history()).size).toBeLessThan(blobsBefore.size) // las copias intermedias se borran
    // deshacer sigue funcionando igual (arrastra el turno del chat, que vino después en pack.json)
    expect(history().plan('pipeline-run1').alsoUndo.map((g) => g.id)).toEqual(['chat-1'])
    history().undo('pipeline-run1')
    expect(read(store.skillPath('cinematica'))).toEqual(before)
    expect(store.loadPack().subject).toBe('')
  })

  it('los cursos de antes del historial siguen funcionando y una línea cortada no impide leer', () => {
    const store = makeCourse()
    expect(store.loadPack().title).toBe('Física')
    expect(history().groups()).toEqual([])
    const a = actor('Uno')
    as(a, () => store.updatePack((p) => { p.title = 'F1' }))
    appendFileSync(history().bookPath, '{"t":"change","at":"2026-1')
    const b = actor('Dos')
    as(b, () => store.updatePack((p) => { p.title = 'F2' }))
    expect(new Set(history().groups().map((g) => g.id))).toEqual(new Set([a.group, b.group]))
  })

  it('las copias se guardan sin permisos para otros (0600)', () => {
    if (process.platform === 'win32') return
    const store = makeCourse()
    as(actor(), () => store.updatePack((p) => { p.title = 'X' }))
    const h = history()
    const any = [...blobs(h)][0]
    expect(statSync(h.blobPath(any)).mode & 0o077).toBe(0)
    expect(statSync(h.bookPath).mode & 0o077).toBe(0)
  })
})

describe('JSONMerge', () => {
  const j = (s: string): unknown => parseJSON(s)

  it('sin tocar vuelve y sin cambio de Aula se queda', () => {
    const r = JSONMerge.revert(j('{"a":2}'), j('{"a":2}'), j('{"a":1}'))
    expect(r.value).toEqual({ a: 1 })
    expect(r.conflicts).toEqual([])
    expect(JSONMerge.revert(j('{"a":1,"b":9}'), j('{"a":1,"b":2}'), j('{"a":1,"b":2}')).value).toEqual({ a: 1, b: 9 })
  })

  it('las claves internas no son ediciones', () => {
    const r = JSONMerge.revert(j('{"t":"Aula","updated":"2026-10-13"}'), j('{"t":"Aula","updated":"2026-10-12"}'), j('{"t":"yo","updated":"2026-10-01"}'))
    expect((r.value as { t: string }).t).toBe('yo')
    expect(r.conflicts).toEqual([])
  })

  it('las listas con id devuelven a su sitio lo que Aula quitó', () => {
    const before = j('{"skills":[{"id":"a"},{"id":"b"},{"id":"c"}]}')
    const after = j('{"skills":[{"id":"a"},{"id":"c"},{"id":"n"}]}') // Aula quitó b y añadió n
    const current = j('{"skills":[{"id":"z"},{"id":"a"},{"id":"c"},{"id":"n"}]}') // el estudiante añadió z delante
    const r = JSONMerge.revert(current, after, before)
    expect((r.value as { skills: Array<{ id: string }> }).skills.map((s) => s.id)).toEqual(['z', 'a', 'b', 'c'])
    expect(r.conflicts).toEqual([])
  })

  it('conjuntos de valores sueltos y conflictos', () => {
    expect(JSONMerge.revert(j('["s1","s3","yo"]'), j('["s1","s3"]'), j('["s1","s2"]')).value).toEqual(['s1', 's2', 'yo'])
    // una lista sin id cambiada por los dos: gana lo de ahora y se avisa
    const c = JSONMerge.revert(j('{"lesson":[1,1]}'), j('{"lesson":[2,2]}'), j('{"lesson":[3]}'))
    expect(c.value).toEqual({ lesson: [1, 1] })
    expect(c.conflicts).toEqual(['$.lesson'])
    // un elemento que Aula añadió y el estudiante editó no se quita
    const e = JSONMerge.revert(j('[{"id":"x","v":"mío"}]'), j('[{"id":"x","v":"aula"}]'), j('[]'))
    expect(e.value).toEqual([{ id: 'x', v: 'mío' }])
    expect(e.conflicts).toEqual(['$[id=x]'])
  })

  // ENG-28: deshacer un reordenamiento devuelve el orden de antes; si el orden lo cambió otro, avisa.
  it('deshacer un reordenamiento', () => {
    const o = (id: string, t: string) => ({ id, t })
    const ids = (v: unknown): string[] => (v as Array<{ id: string }>).map((x) => x.id)
    const b = [o('a', '1'), o('b', '1'), o('c', '1')]
    const a = [o('c', '1'), o('b', '1'), o('a', '1')]
    const r = JSONMerge.revert([o('c', '1'), o('b', 'EDIT'), o('a', '1')], a, b)
    expect(ids(r.value)).toEqual(['a', 'b', 'c'])
    expect((r.value as Array<{ t: string }>)[1].t).toBe('EDIT') // la edición se queda
    expect(r.conflicts).toEqual([])
    const r2 = JSONMerge.revert([o('b', '1'), o('c', '1'), o('a', 'EDIT')], a, b)
    expect(ids(r2.value)).toEqual(['b', 'c', 'a'])
    expect(r2.conflicts).toEqual(['$[orden]'])
    expect(ids(JSONMerge.revert([o('c', '1'), o('x', 'nuevo'), o('b', '1'), o('a', 'EDIT')], a, b).value)).toEqual(['a', 'b', 'c', 'x'])
  })
})

describe('frases de los cambios', () => {
  it('describe lo que cambió en el curso y en las lecciones', () => {
    const store = makeCourse()
    const a = actor('Varios')
    as(a, () => {
      store.updatePack((p) => { p.title = 'Física II'; p.glossary = [{ term: 'v', definition: 'velocidad', aliases: [] }] })
      store.saveSkill(makeSkill({ id: 'dinamica', title: 'Dinámica' }))
      store.updateSkill('cinematica', (s) => { s.cards[0].back = 'otra'; s.lesson = [] })
    })
    const text = history().describe(history().group(a.group)!).map((l) => l.text)
    expect(text).toContain('Título del curso: «Física» → «Física II»')
    expect(text).toContain('Lección nueva en el plan: «Dinámica»')
    expect(text).toContain('Glosario: 0 → 1 términos')
    expect(text).toContain('Lección nueva: «Dinámica»')
    expect(text.some((t) => t.startsWith('Lección «Cinemática»') && t.includes('1 tarjetas cambiadas'))).toBe(true)
  })
})

// Un curso de otra carpeta (no dentro de la de datos) no se apunta.
describe('rutas del historial', () => {
  it('solo apunta archivos dentro de la carpeta de datos y nunca los del propio historial', () => {
    const h = history()
    expect(h.relative(join(root, 'Packs/a/pack.json'))).toBe('Packs/a/pack.json')
    expect(h.relative(join(root, 'History/book.jsonl'))).toBeUndefined()
    expect(h.relative(join(tmpdir(), 'fuera.json'))).toBeUndefined()
    h.record({ file: join(tmpdir(), 'fuera.json'), before: null, after: Buffer.from('{}'), domain: 'other', actor: actor() })
    expect(h.groups()).toEqual([])
  })
})
