// «Crear curso» de punta a punta con la IA simulada (`AULA_FAKE_AI`) sobre una carpeta de datos temporal: el área de
// preparación lee .txt/.md, el curso se crea al momento («en preparación»), el equipo lo escribe y verifica, el registro se
// guarda y se reanuda, «Pedir cambios» se deshace con el historial y recoge la petición de «Preparar más ejercicios».
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { learningContentRequest } from '@engine/study/content-request'
import type { MaterialView, RunView } from '@shared/generation/types'
import { createFakeModel, setModelOverride } from '../ai'
import { isPreparing } from '../calendar/preparation'
import { writeJSONAtomic } from '../fs'
import { setDataRoot } from '../paths'
import { getLibrary, type PackStore } from '../store'
import { boundValidator } from '../study/assets'
import { scriptedAgents } from './agents'
import { DraftStore, draftInInstruction } from './drafts'
import { fakeTeamScript } from './fakeTeam'
import { createGenerationService, GenerationService, validateCreateRequest } from './index'
import { hasWrittenSkill } from './service'

let home: string
let files: string
let svc: GenerationService
const views: RunView[] = []
const materials: MaterialView[] = []

const BASE = { depth: 'quick', lessonMode: 'stepByStep', allowWeb: false, verify: true, materialIds: [], officialIds: [] }

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'aula-home-'))
  files = mkdtempSync(join(tmpdir(), 'aula-files-'))
  setDataRoot(home)
  setModelOverride(createFakeModel)
  process.env.AULA_FAKE_TEAM_DELAY_MS = '0'
  svc = createGenerationService({ emit: (v) => views.push(v), onMaterial: (_d, m) => materials.push(m) })
})
afterAll(() => {
  setModelOverride(null)
  rmSync(home, { recursive: true, force: true })
  rmSync(files, { recursive: true, force: true })
})

function store(packId: string): PackStore {
  const s = getLibrary().openPack(packId)
  if (!s) throw new Error('sin curso')
  return s
}

describe('crear un curso', () => {
  let packId = ''
  let runId = ''

  it('el área de preparación lee textos, .md y .txt (y avisa del avance o del error)', async () => {
    writeFileSync(join(files, 'apuntes.md'), '# Fracciones\n\nUna **fracción** es una parte de un todo: $\\frac{a}{b}$.\n\n## Suma\n\nCon el mismo denominador se suman los numeradores.\n')
    writeFileSync(join(files, 'resumen.txt'), 'Para restar fracciones con distinto denominador, primero se busca un denominador común.\n')
    const a = svc.drafts.addText(undefined, 'Ejemplo: 1/4 + 2/4 = 3/4. Las fracciones equivalentes representan la misma cantidad.', 'Pizarra')
    expect(a.draftId).toMatch(/^draft-[a-z0-9]{10}$/)
    expect(a.materials).toHaveLength(1)
    const b = svc.drafts.addFiles(a.draftId, [join(files, 'apuntes.md'), join(files, 'resumen.txt'), join(files, 'no-existe.pdf')])
    expect(b.draftId).toBe(a.draftId)
    expect(b.materials).toHaveLength(4)
    const missing = b.materials.find((m) => m.title === 'no-existe.pdf')
    expect(missing).toMatchObject({ status: 'failed', error: 'No encuentro el archivo.' })
    await svc.drafts.idle(a.draftId)
    const list = svc.drafts.materials(a.draftId)
    const ready = list.filter((m) => m.status === 'ready')
    expect(ready.map((m) => m.kind).sort()).toEqual(['markdown', 'text', 'text'])
    expect(ready.every((m) => m.characters > 20 && m.pages >= 1 && m.progress === undefined)).toBe(true)
    expect(materials.some((m) => m.status === 'processing' && typeof m.detail === 'string')).toBe(true)
    expect(materials.filter((m) => m.status === 'ready')).toHaveLength(3)
    // quitar un material
    const left = svc.drafts.remove(a.draftId, missing!.id)
    expect(left).toHaveLength(3)

    const r = await svc.start(a.draftId, { ...BASE, title: 'Fracciones', topics: 'Suma de fracciones, resta de fracciones', materialIds: ready.map((m) => m.id), officialIds: [ready[0].id] })
    packId = r.packId
    runId = r.runId
    // el curso existe al momento y está «en preparación»
    const s = store(packId)
    expect(s.loadPack().title).toBe('Fracciones')
    expect(isPreparing(s)).toBe(true)
    expect(svc.run(runId)?.state).toBe('running')
    expect(svc.runs().some((x) => x.id === runId && x.packId === packId)).toBe(true)
    // los materiales pasaron al curso (el oficial, como tal) y el borrador desapareció
    const sources = s.loadPack().sources
    expect(sources.map((x) => x.id).sort()).toEqual(ready.map((m) => m.id).sort())
    expect(sources.find((x) => x.id === ready[0].id)?.trust).toBe('official')
    expect(existsSync(join(home, 'Drafts', a.draftId))).toBe(false)
  })

  it('el equipo termina: curso válido, con ejercicios verificados, tarjetas y registro guardado', async () => {
    const st = await svc.whenFinished(runId)
    expect(st?.aula2.state, st?.failure).toBe('done')
    const s = store(packId)
    const pack = s.loadPack()
    expect(pack.skills).toHaveLength(2)
    expect(pack.blueprint).toBeDefined()
    for (const ref of pack.skills) {
      expect(ref.status).toBe('ready')
      const k = s.loadSkill(ref.id)
      expect(boundValidator(s).checkSkill(k, pack).filter((i) => i.severity === 'error')).toEqual([])
      expect(k.exercises.length).toBeGreaterThanOrEqual(8)
      expect(k.cards.length).toBeGreaterThanOrEqual(5)
      expect(k.lesson.some((b) => b.type === 'tryit')).toBe(true)
      expect(k.exercises.every((e) => e.review?.state === 'verified')).toBe(true)
    }
    expect(isPreparing(s)).toBe(false)
    // el registro (formato Swift) está en runs/ y el monitor dice la verdad
    expect(existsSync(join(s.runsDirectory, `${runId}.json`))).toBe(true)
    const raw = JSON.parse(readFileSync(join(s.runsDirectory, `${runId}.json`), 'utf8')) as Record<string, unknown>
    expect((raw.request as Record<string, unknown>).mode).toEqual({ create: {} })
    const v = svc.run(runId)
    expect(v).toMatchObject({ state: 'done', progress: 1, mode: 'create', packId })
    expect(v?.report).toMatchObject({ skillsReady: 2, skillsNeedingReview: 0, skillsFailed: 0, exercises: 16, cards: 10, verified: 16, flagged: 0 })
    expect(v?.lanes.every((l) => l.status === 'done')).toBe(true)
    expect(v?.provider).toContain('IA simulada')
    // los avisos al monitor: el avance nunca retrocede y termina en 1
    const mine = views.filter((x) => x.id === runId).map((x) => x.progress)
    expect(mine.length).toBeGreaterThan(2)
    expect(mine[mine.length - 1]).toBe(1)
    for (let i = 1; i < mine.length; i++) expect(mine[i]).toBeGreaterThanOrEqual(mine[i - 1] - 0.05)
    expect(svc.runs().find((x) => x.id === runId)).toMatchObject({ state: 'done', stageLabel: 'Terminado' })
  })

  it('«Pedir cambios» recoge la petición de «Preparar más ejercicios», amplía solo esa habilidad y se deshace', async () => {
    const s = store(packId)
    const pack = s.loadPack()
    const skill = s.loadSkill(pack.skills[0].id)
    const before = skill.exercises.length
    const req = learningContentRequest(pack, skill, undefined, 'practice-20261026120000-abcd', new Date(), 'es')
    writeJSONAtomic(join(s.runsDirectory, `${req.id}.practice-request.json`), req)
    const r = await svc.extend(packId, req.instruction, skill.id)
    const st = await svc.whenFinished(r.runId)
    expect(st?.aula2.state, st?.failure).toBe('done')
    expect(st?.request.depth).toBe('quick')
    expect(st?.request.allowWeb).toBe(false)
    expect(st?.request.userNotes).toContain('Guided learning needs fresh')
    expect(st?.aula2.practiceRequest).toBe(req.id)
    const consumed = JSON.parse(readFileSync(join(s.runsDirectory, `${req.id}.practice-request.json`), 'utf8')) as Record<string, unknown>
    expect(consumed).toMatchObject({ status: 'consumed', runId: r.runId })
    expect(s.loadSkill(skill.id).exercises.length).toBe(before + 3)
    // solo se verificó lo nuevo de esa habilidad
    expect(st?.aula2.lanes.filter((l) => l.role === 'verifier').map((l) => l.skill)).toEqual([skill.id])
    expect(svc.run(r.runId)).toMatchObject({ mode: 'extend', state: 'done' })
    // un solo grupo del historial, que se deshace entero
    const history = getLibrary().history!
    const group = history.groups({ courseID: packId }).find((g) => g.id === `pipeline-${r.runId}`)
    expect(group?.label).toContain('Pedir cambios')
    history.undo(`pipeline-${r.runId}`)
    expect(s.loadSkill(skill.id).exercises.length).toBe(before)
    // y la creación tampoco vuelve a estar «en preparación»
    expect(isPreparing(s)).toBe(false)
  })

  it('«Materiales» del curso: el borrador nombrado en la petición pasa al curso antes de ampliar', async () => {
    const d = svc.drafts.addText(undefined, 'Las fracciones impropias tienen el numerador mayor que el denominador. Ejemplo: 7/4.', 'Impropias')
    await svc.drafts.idle(d.draftId)
    const instruction = `Lee los materiales nuevos «Impropias» (borrador ${d.draftId}) y amplía el curso con lo que aporten: lecciones, ejercicios y tarjetas.`
    expect(draftInInstruction(instruction)).toBe(d.draftId)
    const r = await svc.extend(packId, instruction)
    await svc.whenFinished(r.runId)
    expect(store(packId).loadPack().sources.some((x) => x.title === 'Impropias')).toBe(true)
  })

  it('«Materiales» del curso: lo ya leído pasa al curso al momento, sin ampliar (J2-7)', async () => {
    const d = svc.drafts.addText(undefined, 'Una fracción unitaria tiene numerador 1. Ejemplo: 1/5.', 'Unitarias')
    await svc.drafts.idle(d.draftId)
    expect(svc.attachMaterials(packId, d.draftId)).toEqual({ moved: 1 })
    const s = store(packId)
    const src = s.loadPack().sources.find((x) => x.title === 'Unitarias')
    expect(src).toBeDefined()
    expect(existsSync(join(s.directory, 'sources', src!.id, 'chunks.json'))).toBe(true)
    // el borrador ya no tiene nada: volver a pedirlo no duplica
    expect(svc.attachMaterials(packId, d.draftId)).toEqual({ moved: 0 })
    expect(s.loadPack().sources.filter((x) => x.title === 'Unitarias')).toHaveLength(1)
    // lo que aún se está leyendo pasa en cuanto termina (aunque nadie mire la pestaña)
    const e = svc.drafts.addText(undefined, 'Las fracciones mixtas combinan un entero y una fracción: 2 1/3.', 'Mixtas')
    svc.attachMaterials(packId, e.draftId)
    await svc.drafts.idle(e.draftId)
    await new Promise((r) => setTimeout(r, 20))
    expect(store(packId).loadPack().sources.some((x) => x.title === 'Mixtas')).toBe(true)
    expect(() => svc.attachMaterials('no-existe', d.draftId)).toThrow()
    expect(() => svc.attachMaterials(packId, '../x')).toThrow()
  })

  it('la hora del examen elegida al crear (9:00) no pasa a las 8:00 cuando el plan manda solo el día (J2-12)', async () => {
    const exam = new Date(2026, 10, 8, 9, 0)
    const r = await svc.start(undefined, { ...BASE, title: 'Ángulos', topics: 'Ángulos complementarios', examDate: exam.toISOString() })
    await svc.whenFinished(r.runId)
    const date = store(r.packId).loadPack().exam?.date
    expect(date).toBeDefined()
    const d = new Date(date!)
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 8, 9, 0])
  })

  it('valida la petición antes de crear nada', async () => {
    const count = getLibrary().packIDs().length
    await expect(svc.start(undefined, { ...BASE, title: '  ' })).rejects.toMatchObject({ code: 'invalid_args' })
    await expect(svc.start(undefined, { ...BASE, title: 'Nada' })).rejects.toMatchObject({ code: 'generation_no_material' })
    await expect(svc.start('../../etc', { ...BASE, title: 'X', topics: 'a' })).rejects.toMatchObject({ code: 'invalid_args' })
    expect(() => validateCreateRequest({ ...BASE, title: 'X', examDate: 'mañana' })).toThrow()
    expect(validateCreateRequest({ ...BASE, title: 'X', lessonMode: 'nope', depth: 'nope' })).toMatchObject({ depth: 'standard', lessonMode: 'stepByStep' })
    expect(getLibrary().packIDs().length).toBe(count)
    await expect(svc.extend('no-existe', 'algo')).rejects.toMatchObject({ code: 'not_found' })
    await expect(svc.extend(packId, '')).rejects.toMatchObject({ code: 'invalid_args' })
  })
})

describe('detener, reanudar y quedarse con lo que hay', () => {
  it('detener deja la creación en pausa; reanudar la termina sin repetir el plan', async () => {
    process.env.AULA_FAKE_TEAM_DELAY_MS = '40'
    const r = await svc.start(undefined, { ...BASE, title: 'Porcentajes', topics: 'Porcentajes, descuentos y aumentos', verify: false })
    // en cuanto hay plan, se detiene
    for (let i = 0; i < 200 && !store(r.packId).loadPack().skills.length; i++) await new Promise((x) => setTimeout(x, 10))
    svc.cancel(r.runId)
    const paused = await svc.whenFinished(r.runId)
    expect(paused?.aula2.state).toBe('paused')
    expect(svc.run(r.runId)?.state).toBe('paused')
    expect(isPreparing(store(r.packId))).toBe(true)
    process.env.AULA_FAKE_TEAM_DELAY_MS = '0'
    await svc.resume(r.runId)
    const done = await svc.whenFinished(r.runId)
    expect(done?.aula2.state, done?.failure).toBe('done')
    expect(done?.aula2.lanes.filter((l) => l.role === 'planner')).toHaveLength(1)
    expect(store(r.packId).loadPack().skills.every((x) => x.status === 'ready')).toBe(true)
    expect(isPreparing(store(r.packId))).toBe(false)
  })

  it('«Quedarme con lo que hay» convierte un curso a medias en un curso normal', async () => {
    process.env.AULA_FAKE_TEAM_DELAY_MS = '40'
    const r = await svc.start(undefined, { ...BASE, title: 'Decimales', topics: 'Decimales, redondeo', verify: false })
    // con algún tema ya escrito (sin ninguno no se puede: ver la prueba de abajo)
    for (let i = 0; i < 400 && !hasWrittenSkill(store(r.packId)); i++) await new Promise((x) => setTimeout(x, 10))
    await svc.keep(r.runId)
    process.env.AULA_FAKE_TEAM_DELAY_MS = '0'
    const s = store(r.packId)
    expect(isPreparing(s)).toBe(false)
    expect(existsSync(join(s.runsDirectory, `${r.runId}.kept.json`))).toBe(true)
    expect(svc.run(r.runId)?.state).toBe('done')
  })

  it('A3-P2-8: sin ningún tema escrito no se ofrece un curso «listo» con 0 temas', async () => {
    process.env.AULA_FAKE_TEAM_DELAY_MS = '40'
    const r = await svc.start(undefined, { ...BASE, title: 'Vacío', topics: 'Nada todavía', verify: false })
    for (let i = 0; i < 200 && !store(r.packId).loadPack().skills.length; i++) await new Promise((x) => setTimeout(x, 10))
    svc.cancel(r.runId)
    await svc.whenFinished(r.runId)
    process.env.AULA_FAKE_TEAM_DELAY_MS = '0'
    // como si el modelo no hubiera escrito nada (el plan sí está)
    const s = store(r.packId)
    for (const ref of s.loadPack().skills) rmSync(join(s.directory, 'skills', `${ref.id}.json`), { force: true })
    expect(hasWrittenSkill(s)).toBe(false)
    await expect(svc.keep(r.runId)).rejects.toMatchObject({ code: 'generation_nothing_to_keep' })
    expect(svc.run(r.runId)?.state).toBe('paused')
    expect(isPreparing(s)).toBe(true)
  })

  it('una ejecución que quedó «trabajando» al cerrar la app se ve en pausa y se puede reanudar', async () => {
    const r = await svc.start(undefined, { ...BASE, title: 'Potencias', topics: 'Potencias', verify: false })
    await svc.whenFinished(r.runId)
    const s = store(r.packId)
    // simula un cierre a medias: el registro dice «running» y no terminó
    const file = join(s.runsDirectory, `${r.runId}.json`)
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    delete raw.finishedAt
    ;(raw.aula2 as Record<string, unknown>).state = 'running'
    ;(raw.stages as Record<string, unknown>).polish = 'running'
    writeFileSync(file, JSON.stringify(raw))
    const fresh = createGenerationService({})
    expect(fresh.run(r.runId)?.state).toBe('paused')
    await fresh.resume(r.runId)
    const done = await fresh.whenFinished(r.runId)
    expect(done?.aula2.state).toBe('done')
    expect(done?.stages.polish).toBe('done')
  })
})

describe('varias ejecuciones', () => {
  it('como mucho `maxRuns` a la vez; las demás esperan turno', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aula-lib-'))
    try {
      let running = 0
      let peak = 0
      const service = new GenerationService({
        library: getLibrary, drafts: new DraftStore(() => join(root, 'Drafts')), maxRuns: 1,
        agents: async (req) => {
          const script = fakeTeamScript(req)
          return scriptedAgents(async (task, call) => {
            if (task.role === 'planner') { running++; peak = Math.max(peak, running) }
            try { return await script(task, call) } finally { if (task.role === 'planner') { await new Promise((x) => setTimeout(x, 30)); running-- } }
          })
        }
      })
      const a = await service.start(undefined, { ...BASE, title: 'Uno', topics: 'Uno', verify: false })
      const b = await service.start(undefined, { ...BASE, title: 'Dos', topics: 'Dos', verify: false })
      expect(service.run(b.runId)?.state).toBe('running')
      const [sa, sb] = await Promise.all([service.whenFinished(a.runId), service.whenFinished(b.runId)])
      expect(sa?.aula2.state).toBe('done')
      expect(sb?.aula2.state).toBe('done')
      expect(peak).toBe(1)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})

describe('idioma del curso y forma de las lecciones', () => {
  it('lo elegido al crear llega al curso, al progreso y al registro', async () => {
    process.env.AULA_FAKE_TEAM_DELAY_MS = '0'
    expect(validateCreateRequest({ ...BASE, title: 'X', language: 'fr', lessonMode: 'explore' })).toMatchObject({ language: 'fr', lessonMode: 'explore' })
    const r = await svc.start(undefined, { ...BASE, title: 'Révolution française', topics: '1789, la Terreur', language: 'fr', lessonMode: 'read', verify: false })
    const st = await svc.whenFinished(r.runId)
    expect(st?.aula2.state, st?.failure).toBe('done')
    const s = store(r.packId)
    expect(s.loadPack().language).toBe('fr')
    expect(s.loadProgress().settings.lessonMode).toBe('reading')
    const raw = JSON.parse(readFileSync(join(s.runsDirectory, `${r.runId}.json`), 'utf8')) as { request: Record<string, unknown> }
    expect(raw.request).toMatchObject({ language: 'fr', lessonMode: 'reading' })
  })
})
