// Almacén de un curso en disco (port de PackStore en StudyModel/Store.swift y de las conversaciones de Chat.swift).
//
//  Packs/<id>/
//    pack.json               el curso: metadatos, unidades, mapa de habilidades, examen, glosario, fuentes
//    skills/<id>.json        contenido de cada habilidad (lección, ejercicios, plantillas, tarjetas, presentaciones)
//    progress.json           progreso del estudiante
//    sources/<id>/           original + chunks.json de cada material
//    assets/                 imágenes y archivos usados por las lecciones
//    runs/<id>.json          registros de las ejecuciones de la IA
//    chats/<id>.json         conversaciones con el tutor
//
// Varios procesos pueden escribir a la vez (la app y el ayudante MCP): las modificaciones usan cerrojo y escritura atómica.
// La API es síncrona, como en Swift: una lectura-modificación-escritura no se intercala con otra del mismo proceso.
// `pack.json`, `skills/*.json` y `progress.json` guardan su versión anterior (`.<nombre>.bak`): si el principal está dañado se
// lee esa, y al reescribirlos se conservan las claves de primer nivel que esta versión no conoce.
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { IDs } from '@engine/base/ids'
import {
  decodeChatThread, decodePack, decodeProgress, decodeSkill, decodeSourceChunk, emptyProgress, encodeChatThread, encodePack, encodeProgress,
  encodeSkill, encodeSourceChunk, makeSkill, makeSkillRef, PACK_SCHEMA, skillCounts, trimAttempts, updateSkillTryIts,
  type ChatThread, type ItemID, type Pack, type Skill, type SourceChunk, type SourceMeta, type StudyProgress
} from '@shared/schema'
import { backupPath, writeFileAtomic } from '../fs'
import { log } from '../log'
import type { ChangeHistory } from './history/changeHistory'
import { ChangeContext } from './history/context'
import { currentJSON, jsonBytes, keepUnknownKeys, readBytesOrNull, readDecodedWithBackup, readJSONFile, writeJSONFile } from './jsonFile'
import { withFileLock } from './lock'
import { SafePath } from './safePath'

/** Lo que cambió `namespaceDuplicateIDs` en una habilidad: id viejo → id nuevo. */
export interface IDRenames {
  /** Ejercicios y plantillas (comparten espacio de nombres: las variantes de una plantilla son «plantilla#semilla»). */
  exercises: Record<string, string>
  cards: Record<string, string>
}

const nowISO = (): string => new Date().toISOString()

/** Un título de verdad (no vacío ni igual al identificador): solo esos sustituyen al título del plan. */
export function isRealTitle(title: string, id: ItemID): boolean {
  const t = title.trim()
  return t !== '' && t !== id
}

/** Nombre de la marca de los cursos importados (oculta: el exportador se salta lo que empieza por «.»). */
export const IMPORTED_MARK = '.imported'

export class PackStore {
  readonly id: ItemID
  readonly directory: string
  /** Dónde se apuntan los cambios que hace Aula (`pack.json` y `skills/*.json`; nunca el progreso). */
  readonly history?: ChangeHistory
  /** Se llama tras cada escritura de este proceso (la biblioteca avisa a la interfaz). */
  onWrite?: (packId: ItemID) => void

  constructor(id: ItemID, directory: string, history?: ChangeHistory) {
    this.id = id
    this.directory = directory
    this.history = history
  }

  get packPath(): string { return join(this.directory, 'pack.json') }
  get skillsDirectory(): string { return join(this.directory, 'skills') }
  get progressPath(): string { return join(this.directory, 'progress.json') }
  get sourcesDirectory(): string { return join(this.directory, 'sources') }
  get assetsDirectory(): string { return join(this.directory, 'assets') }
  get runsDirectory(): string { return join(this.directory, 'runs') }
  get chatsDirectory(): string { return join(this.directory, 'chats') }
  get searchIndexPath(): string { return join(this.sourcesDirectory, 'index.json') }
  /** Marca de un curso que llegó de fuera (un `.aulapack` importado): su texto lo escribió otro (A2-P2-9). No viaja al exportar. */
  get importedMarkPath(): string { return join(this.directory, IMPORTED_MARK) }
  /** ¿El curso se importó de un `.aulapack`? Lo que dicen sus lecciones es dato ajeno, nunca orden para la IA. */
  get wasImported(): boolean { return existsSync(this.importedMarkPath) }
  /** Cerrojo del curso (`pack.json` y `skills/`) y el del progreso. */
  get packLockPath(): string { return join(this.directory, '.aula-lock') }
  get progressLockPath(): string { return join(this.directory, '.aula-progress-lock') }

  createLayout(): void {
    for (const d of [this.directory, this.skillsDirectory, this.sourcesDirectory, this.assetsDirectory, this.runsDirectory, this.chatsDirectory]) mkdirSync(d, { recursive: true })
  }

  /** Escribe (null = borra, también su copia) un archivo del curso, apuntándolo en el historial si lo hace Aula. Siempre dentro
   * del cerrojo. `before` = lo que había (ya leído por quien escribe). */
  private writeTracked(data: Buffer | null, file: string, before: Buffer | null = readBytesOrNull(file)): void {
    const actor = this.history ? ChangeContext.current : undefined
    if (data) writeFileAtomic(file, data, { backup: true })
    else {
      if (existsSync(file)) rmSync(file, { force: true })
      rmSync(backupPath(file), { force: true })
    }
    if (actor && this.history) this.history.record({ file, before, after: data, domain: 'course', courseID: this.id, lockFile: this.packLockPath, actor })
    this.onWrite?.(this.id)
  }

  /** Lo codificado más las claves desconocidas que tenía el archivo. */
  private static keeping(encoded: unknown, before: Buffer | null, roundTrip: (raw: unknown) => unknown): Buffer {
    return jsonBytes(keepUnknownKeys(encoded, currentJSON(before), roundTrip))
  }

  /** Lee un JSON del curso con su copia anterior si está dañado. Sin ninguna de las dos, lanza el error del archivo. */
  private loadWithBackup<T>(file: string, decode: (raw: unknown) => T): T {
    const r = readDecodedWithBackup(file, decode)
    if (!r) return decode(readJSONFile(file))
    if (r.fromBackup) log.warn(`${this.id}: ${file.slice(this.directory.length + 1)} estaba dañado; uso su versión anterior${r.damagedCopy ? ' (copia del dañado al lado)' : ''}`)
    return r.value
  }

  // MARK: Curso

  loadPack(): Pack {
    return this.loadWithBackup(this.packPath, decodePack)
  }

  savePack(pack: Pack, opts: { touch?: boolean } = {}): void {
    withFileLock(this.packLockPath, () => this.writePack(pack, opts.touch ?? true))
  }

  private writePack(pack: Pack, touch: boolean): void {
    const p: Pack = { ...pack, schema: PACK_SCHEMA }
    if (touch) p.updated = nowISO()
    const before = readBytesOrNull(this.packPath)
    this.writeTracked(PackStore.keeping(encodePack(p), before, (raw) => encodePack(decodePack(raw))), this.packPath, before)
  }

  private writeSkill(s: Skill): void {
    const file = this.skillPath(s.id)
    const before = readBytesOrNull(file)
    this.writeTracked(PackStore.keeping(encodeSkill(s), before, (raw) => encodeSkill(decodeSkill(raw))), file, before)
  }

  /** Lee, modifica y guarda el curso de forma atómica (seguro frente a otros procesos). */
  updatePack<T>(body: (pack: Pack) => T): T {
    return withFileLock(this.packLockPath, () => {
      const p = this.loadPack()
      const r = body(p)
      this.writePack(p, true)
      return r
    })
  }

  // MARK: Habilidades

  skillPath(id: ItemID): string {
    return join(this.skillsDirectory, `${IDs.slug(id, 80)}.json`)
  }

  skillIDs(): ItemID[] {
    return listJSONNames(this.skillsDirectory)
  }

  hasSkill(id: ItemID): boolean {
    return existsSync(this.skillPath(id))
  }

  loadSkill(id: ItemID): Skill {
    return this.loadWithBackup(this.skillPath(id), decodeSkill)
  }

  /** Las habilidades que se pueden leer, en el orden dado (las que faltan o están dañadas se saltan). */
  loadSkills(ids: ItemID[] = this.skillIDs()): Skill[] {
    const out: Skill[] = []
    for (const id of ids) {
      if (!this.hasSkill(id)) continue
      try { out.push(this.loadSkill(id)) } catch (err) { log.warn(`Habilidad ilegible ${this.id}/${id}: ${err instanceof Error ? err.message : String(err)}`) }
    }
    return out
  }

  /** Guarda el contenido de una habilidad y mantiene al día su resumen en `pack.json` (recuentos, estado, título). */
  saveSkill(skill: Skill): void {
    withFileLock(this.packLockPath, () => {
      const s: Skill = { ...skill, updated: nowISO() }
      this.writeSkill(s)
      const p = this.loadPack()
      const ref = p.skills.find((r) => r.id === s.id)
      if (ref) {
        if (isRealTitle(s.title, s.id) || ref.title === '') ref.title = s.title
        if (s.summary !== undefined) ref.summary = s.summary
        if (s.objectives.length) ref.objectives = [...s.objectives]
        if (s.prerequisites.length) ref.prerequisites = [...s.prerequisites]
        ref.counts = skillCounts(s)
        ref.status = s.status
      } else {
        p.skills.push(makeSkillRef({ id: s.id, title: s.title, summary: s.summary, objectives: [...s.objectives], prerequisites: [...s.prerequisites], order: p.skills.length, status: s.status, counts: skillCounts(s) }))
      }
      this.writePack(p, true)
    })
  }

  /** Lee-modifica-guarda una habilidad (crea una vacía si no existe). */
  updateSkill<T>(id: ItemID, body: (skill: Skill) => T, opts: { title?: string } = {}): T {
    return withFileLock(this.packLockPath, () => {
      let s: Skill
      try {
        s = this.loadSkill(id)
      } catch {
        // habilidad nueva: hereda título, resumen y objetivos del plan del curso (no el id como título)
        let ref
        try { ref = this.loadPack().skills.find((r) => r.id === id) } catch { ref = undefined }
        s = makeSkill({ id, title: opts.title ?? ref?.title ?? id, status: 'draft' })
        if (ref) { s.summary = ref.summary; s.objectives = [...ref.objectives]; s.prerequisites = [...ref.prerequisites] }
        if (s.summary === undefined) delete s.summary
      }
      const r = body(s)
      s.updated = nowISO()
      s.revision += 1
      this.writeSkill(s)
      const p = this.loadPack()
      const ref = p.skills.find((x) => x.id === s.id)
      if (ref) {
        if (isRealTitle(s.title, s.id) || ref.title === '') ref.title = s.title
        ref.counts = skillCounts(s)
        ref.status = s.status
        if (s.summary !== undefined) ref.summary = s.summary
      } else {
        p.skills.push(makeSkillRef({ id: s.id, title: s.title, summary: s.summary, objectives: [...s.objectives], prerequisites: [...s.prerequisites], order: p.skills.length, status: s.status, counts: skillCounts(s) }))
      }
      this.writePack(p, true)
      return r
    })
  }

  deleteSkill(id: ItemID): void {
    withFileLock(this.packLockPath, () => {
      try { this.writeTracked(null, this.skillPath(id)) } catch { /* ya no estaba */ }
      const p = this.loadPack()
      p.skills = p.skills.filter((s) => s.id !== id)
      for (const u of p.units) u.skillIDs = u.skillIDs.filter((s) => s !== id)
      for (const s of p.skills) s.prerequisites = s.prerequisites.filter((x) => x !== id)
      this.writePack(p, true)
    })
  }

  // MARK: Progreso

  loadProgress(): StudyProgress {
    if (!existsSync(this.progressPath)) return emptyProgress()
    const r = readDecodedWithBackup(this.progressPath, decodeProgress)
    if (r) {
      if (r.fromBackup) log.warn(`${this.id}: progress.json estaba dañado; uso su versión anterior${r.damagedCopy ? ` (copia del dañado en ${basename(r.damagedCopy)})` : ''}`)
      return r.value
    }
    // ni el archivo ni su copia anterior: se empieza de cero, pero el dañado queda copiado al lado (nunca se pierde en silencio)
    log.warn(`${this.id}: progress.json ilegible y sin versión anterior; empiezo de cero (el dañado queda como progress.json.damaged-…)`)
    return emptyProgress()
  }

  /** Escribe el progreso (dentro de su cerrojo), con su copia anterior y sin perder claves desconocidas. */
  private writeProgress(p: StudyProgress): void {
    trimAttempts(p)
    const before = readBytesOrNull(this.progressPath)
    writeFileAtomic(this.progressPath, PackStore.keeping(encodeProgress(p), before, (raw) => encodeProgress(decodeProgress(raw))), { backup: true })
  }

  saveProgress(progress: StudyProgress): void {
    withFileLock(this.progressLockPath, () => this.writeProgress({ ...progress, attempts: [...progress.attempts] }))
    this.onWrite?.(this.id)
  }

  updateProgress<T>(body: (progress: StudyProgress) => T): T {
    const r = withFileLock(this.progressLockPath, () => {
      const p = this.loadProgress()
      const out = body(p)
      this.writeProgress(p)
      return out
    })
    this.onWrite?.(this.id)
    return r
  }

  /** Empezar de cero: también se quita la copia anterior (no debe volver si algún día el archivo se daña). */
  resetProgress(): void {
    withFileLock(this.progressLockPath, () => {
      rmSync(this.progressPath, { force: true })
      rmSync(backupPath(this.progressPath), { force: true })
    })
    this.onWrite?.(this.id)
  }

  // MARK: Fuentes

  /** Carpeta de un material. Un id que no sirve como nombre de carpeta da una carpeta inexistente dentro de `sources/`. */
  sourceDirectory(id: ItemID): string {
    return join(this.sourcesDirectory, SafePath.component(id))
  }

  chunksPath(id: ItemID): string {
    return join(this.sourceDirectory(id), 'chunks.json')
  }

  /** Guarda un material: copia el original (si se da), escribe sus fragmentos y lo registra en el curso. */
  saveSource(meta: SourceMeta, chunks: SourceChunk[], originalPath?: string): SourceMeta {
    const m: SourceMeta = { ...meta }
    const dir = this.sourceDirectory(m.id)
    mkdirSync(dir, { recursive: true })
    if (originalPath) {
      const name = basename(originalPath)
      const dest = join(dir, name)
      if (!existsSync(dest)) copyFileSync(originalPath, dest)
      m.filename = name
    }
    writeJSONFile(this.chunksPath(m.id), chunks.map(encodeSourceChunk), false)
    this.updatePack((p) => {
      const i = p.sources.findIndex((s) => s.id === m.id)
      if (i >= 0) p.sources[i] = m
      else p.sources.push(m)
    })
    return m
  }

  loadChunks(sourceID: ItemID): SourceChunk[] {
    try {
      const raw = readJSONFile(this.chunksPath(sourceID))
      if (!Array.isArray(raw)) return []
      return raw.flatMap((x) => { const c = decodeSourceChunk(x); return c ? [c] : [] })
    } catch {
      return []
    }
  }

  allChunks(): SourceChunk[] {
    let p: Pack
    try { p = this.loadPack() } catch { return [] }
    return p.sources.flatMap((s) => this.loadChunks(s.id))
  }

  /** El original de un material: solo un nombre suelto, y el archivo (sin enlaces simbólicos) dentro de su carpeta. */
  originalPath(source: SourceMeta): string | undefined {
    const f = source.filename
    if (!f || !SafePath.isComponent(f)) return undefined
    const dir = this.sourceDirectory(source.id)
    const u = join(dir, f)
    return existsSync(u) && SafePath.isInside(u, dir) ? u : undefined
  }

  removeSource(id: ItemID): void {
    // solo se borra una carpeta de verdad dentro de `sources/` (nunca `sources/../..` ni el destino de un enlace)
    const dir = this.sourceDirectory(id)
    if (SafePath.isInside(dir, this.sourcesDirectory)) rmSync(dir, { recursive: true, force: true })
    this.updatePack((p) => { p.sources = p.sources.filter((s) => s.id !== id) })
  }

  // MARK: Archivos de apoyo (imágenes de las lecciones)

  /** Guarda un archivo y devuelve su id (huella de TODO el archivo + extensión). Idempotente. */
  addAsset(data: Uint8Array, ext: string): string {
    const e = ext.toLowerCase().replace(/^[. ]+|[. ]+$/g, '')
    const safeExt = /^[\p{L}\p{N}]*$/u.test(e) ? e : ''
    const id = createHash('sha256').update(data).digest('hex').slice(0, 16) + (safeExt ? `.${safeExt}` : '')
    const file = join(this.assetsDirectory, id)
    if (!existsSync(file)) writeFileAtomic(file, data)
    return id
  }

  /** Ruta de un archivo de apoyo (solo el último componente del id; undefined si no existe). */
  assetPath(id: string): string | undefined {
    const name = basename(id.replace(/\\/g, '/'))
    if (!SafePath.isComponent(name)) return undefined
    const file = join(this.assetsDirectory, name)
    return existsSync(file) && SafePath.isInside(file, this.assetsDirectory) ? file : undefined
  }

  // MARK: Registros (ejecuciones de IA y conversaciones)

  private folderFile(folder: string, name: string): string {
    return join(this.directory, SafePath.component(folder), `${IDs.slug(name, 80)}.json`)
  }

  saveJSON(value: unknown, folder: string, name: string): void {
    writeJSONFile(this.folderFile(folder, name), value)
  }

  loadJSON<T>(folder: string, name: string, decode: (raw: unknown) => T): T | undefined {
    try {
      return decode(readJSONFile(this.folderFile(folder, name)))
    } catch {
      return undefined
    }
  }

  listNames(folder: string): string[] {
    return listJSONNames(join(this.directory, SafePath.component(folder)))
  }

  threads(): ChatThread[] {
    return this.listNames('chats')
      .flatMap((n) => { const t = this.loadJSON('chats', n, decodeChatThread); return t ? [t] : [] })
      .sort((a, b) => b.updated.localeCompare(a.updated))
  }

  saveThread(t: ChatThread): void {
    this.saveJSON(encodeChatThread({ ...t, updated: nowISO() }), 'chats', t.id)
  }

  deleteThread(id: string): void {
    // el id viene del archivo de la conversación: se borra el mismo archivo que escribe `saveThread` y solo si queda en `chats/`
    const file = join(this.chatsDirectory, `${IDs.slug(id, 80)}.json`)
    if (!SafePath.isInside(file, this.chatsDirectory)) return
    rmSync(file, { force: true })
  }

  // MARK: Ids únicos en todo el curso

  /**
   * El progreso indexa ejercicios, plantillas y tarjetas por id en TODO el curso, pero dentro del curso solo se exigía que
   * fueran únicos en cada habilidad. Si dos habilidades comparten un id, el de la que va después en el plan pasa a
   * «<habilidad>-<id>» y sus «Pruébalo» apuntan al nuevo. El progreso de esa habilidad pasa al id nuevo.
   */
  namespaceDuplicateIDs(): Record<ItemID, IDRenames> {
    const renames: Record<ItemID, IDRenames> = {}
    withFileLock(this.packLockPath, () => {
      const p = this.loadPack()
      const seenEx = new Set<string>(), seenCards = new Set<string>(), visited = new Set<string>()
      for (const ref of p.skills) {
        if (visited.has(ref.id)) continue
        visited.add(ref.id)
        let s: Skill
        try { s = this.loadSkill(ref.id) } catch { continue }
        const r: IDRenames = { exercises: {}, cards: {} }
        const takenEx = new Set([...seenEx, ...s.exercises.map((e) => e.id), ...s.templates.map((t) => t.id)])
        const rename = (id: string, taken: Set<string>): string => { const n = IDs.unique(`${ref.id}-${id}`, taken); taken.add(n); return n }
        for (const e of s.exercises) if (seenEx.has(e.id)) { const n = rename(e.id, takenEx); r.exercises[e.id] = n; e.id = n }
        for (const t of s.templates) if (seenEx.has(t.id)) { const n = rename(t.id, takenEx); r.exercises[t.id] = n; t.id = n }
        const takenCards = new Set([...seenCards, ...s.cards.map((c) => c.id)])
        for (const c of s.cards) if (seenCards.has(c.id)) { const n = rename(c.id, takenCards); r.cards[c.id] = n; c.id = n }
        for (const e of s.exercises) seenEx.add(e.id)
        for (const t of s.templates) seenEx.add(t.id)
        for (const c of s.cards) seenCards.add(c.id)
        if (!Object.keys(r.exercises).length && !Object.keys(r.cards).length) continue
        const map = r.exercises
        if (Object.keys(map).length) updateSkillTryIts(s, (t) => { t.exerciseIDs = t.exerciseIDs.map((x) => map[x] ?? x) })
        s.updated = nowISO()
        s.revision += 1
        this.writeSkill(s)
        renames[ref.id] = r
      }
    })
    if (!Object.keys(renames).length || !existsSync(this.progressPath)) return renames
    // fuera del cerrojo del curso: el progreso tiene el suyo
    this.updateProgress((p) => migrateProgressIDs(p, renames))
    return renames
  }
}

/** Pasa al id nuevo lo que el progreso guarda de los ejercicios renombrados (solo lo de su habilidad). */
export function migrateProgressIDs(p: StudyProgress, renames: Record<ItemID, IDRenames>): void {
  // «plantilla#semilla» → «plantilla-nueva#semilla»
  const remap = (x: string, map: Record<string, string>): string => {
    if (map[x] !== undefined) return map[x]
    const h = x.indexOf('#')
    if (h >= 0 && map[x.slice(0, h)] !== undefined) return map[x.slice(0, h)] + x.slice(h)
    return x
  }
  const mapFor = (skill: string): Record<string, string> | undefined => {
    const m = renames[skill]?.exercises
    return m && Object.keys(m).length ? m : undefined
  }
  for (const m of p.mistakes) {
    const map = mapFor(m.skill)
    if (!map) continue
    m.id = remap(m.id, map)
    m.exerciseID = remap(m.exerciseID, map)
    if (m.templateID !== undefined) m.templateID = remap(m.templateID, map)
  }
  for (const a of p.attempts) { const map = mapFor(a.skill); if (map) a.exerciseID = remap(a.exerciseID, map) }
  for (const e of p.exams) for (const i of e.items) { const map = mapFor(i.skill); if (map) i.exerciseID = remap(i.exerciseID, map) }
  if (p.examRun) {
    for (const i of p.examRun.items) {
      const map = mapFor(i.skill)
      if (!map) continue
      i.exerciseID = remap(i.exerciseID, map)
      if (i.templateID !== undefined) i.templateID = remap(i.templateID, map)
    }
  }
}

/** Nombres (sin «.json») de los JSON de una carpeta, ordenados. */
export function listJSONNames(dir: string): string[] {
  try {
    return readdirSync(dir).filter((n) => n.endsWith('.json') && !n.startsWith('.')).map((n) => n.slice(0, -5)).sort()
  } catch {
    return []
  }
}

/** Copia recursiva sin enlaces simbólicos. */
export function copyTree(src: string, dest: string): void {
  cpSync(src, dest, { recursive: true, dereference: false, filter: (s) => { try { return !lstatSync(s).isSymbolicLink() } catch { return true } } })
}
