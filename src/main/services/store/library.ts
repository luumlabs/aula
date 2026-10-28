// Biblioteca de cursos (port de Library en StudyModel/Store.swift): lista, crea, abre, borra, exporta e importa cursos.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IDs } from '@engine/base/ids'
import { decodePack, encodePack, packHasExam, type ItemID, type Pack, type PackSummary } from '@shared/schema'
import { tr } from '@shared/ai/i18n'
import { ChangeHistory } from './history/changeHistory'
import { readJSONFile, writeJSONFile } from './jsonFile'
import { copyTree, IMPORTED_MARK, PackStore } from './packStore'
import { extractZip, zipDirectory } from './packZip'
import { SafePath } from './safePath'

export interface LibraryOptions {
  /** ¿Se apuntan en `History/` los cambios que hace Aula en estos cursos? (false en almacenes internos, p. ej. adjuntos). */
  recordsHistory?: boolean
}

export interface ExportOptions {
  /** Incluir el progreso personal (y notas, subrayados y documentos). Por defecto, no. */
  includeProgress?: boolean
}

/** Carpetas del curso con lo personal del estudiante: no se exportan sin el progreso. */
export const PERSONAL_FOLDERS = ['notes', 'annotations', 'documents'] as const

/** Nombres que nunca salen del equipo (claves y secretos), estén donde estén. */
const SECRET_NAME = /^(secrets?(\..*)?|.*\.(pem|key|p12|enc))$/i

/** Qué hacer si el curso que se importa ya está (J2-24): conservar los dos (el nuevo con «(2)»), sustituirlo o no importar. */
export type DuplicateChoice = 'keepBoth' | 'replace' | 'cancel'

export interface ImportOptions {
  /** Se pregunta solo si ya hay un curso igual (mismo id de origen, o mismo título y mismos temas). Sin ella: conservar los dos. */
  onDuplicate?: (existing: { id: ItemID; title: string }) => DuplicateChoice | Promise<DuplicateChoice>
}

/** El estudiante decidió no importar (el curso ya estaba). */
export class ImportCancelled extends Error {
  constructor() {
    super(tr('Importación cancelada', 'Import cancelled'))
    this.name = 'AbortError'
  }
}

export class LibraryError extends Error {
  constructor(readonly code: 'not_found' | 'invalid_pack' | 'invalid_args', message: string) {
    super(message)
    this.name = 'LibraryError'
  }
}

export class Library {
  readonly root: string
  readonly recordsHistory: boolean
  /** Se llama tras cada escritura de un curso desde este proceso. */
  onPackWrite?: (packId: ItemID) => void

  constructor(root: string, opts: LibraryOptions = {}) {
    this.root = root
    this.recordsHistory = opts.recordsHistory ?? true
    mkdirSync(this.packsDirectory, { recursive: true })
  }

  get packsDirectory(): string { return join(this.root, 'Packs') }

  /** El historial de cambios de Aula de esta carpeta (undefined si no se apunta). */
  get history(): ChangeHistory | undefined {
    return this.recordsHistory ? ChangeHistory.at(this.root) : undefined
  }

  packDirectory(id: ItemID): string {
    return join(this.packsDirectory, SafePath.component(id))
  }

  packIDs(): ItemID[] {
    let names: string[]
    try { names = readdirSync(this.packsDirectory) } catch { return [] }
    return names.filter((n) => !n.startsWith('.') && existsSync(join(this.packsDirectory, n, 'pack.json'))).sort()
  }

  /** Los cursos que se pueden leer, del actualizado más recientemente al más antiguo. */
  listPacks(): PackSummary[] {
    const out: PackSummary[] = []
    for (const id of this.packIDs()) {
      const store = this.openPack(id)
      if (!store) continue
      let p: Pack
      try { p = store.loadPack() } catch { continue }
      out.push(summarize(p, id))
    }
    return out.sort((a, b) => b.updated.localeCompare(a.updated))
  }

  /** El almacén de un curso, o undefined si no existe (o el id no sirve como nombre de carpeta). */
  openPack(id: ItemID): PackStore | undefined {
    if (!SafePath.isComponent(id)) return undefined
    const dir = this.packDirectory(id)
    if (!existsSync(join(dir, 'pack.json'))) return undefined
    return this.makeStore(id, dir)
  }

  private makeStore(id: ItemID, dir: string): PackStore {
    const s = new PackStore(id, dir, this.history)
    s.onWrite = (packId) => this.onPackWrite?.(packId)
    return s
  }

  /** Crea un curso con un id único derivado del suyo (o del título). */
  createPack(pack: Pack): PackStore {
    const id = IDs.unique(IDs.slug(pack.id === '' ? pack.title : pack.id), this.packIDs())
    const store = this.makeStore(id, this.packDirectory(id))
    store.createLayout()
    store.savePack({ ...pack, id }, { touch: false })
    return store
  }

  /**
   * Quita un curso. Con `trash` (la papelera del sistema, que da Electron) se puede recuperar; si no hay o falla, va a
   * «<datos>/Eliminados/<id>-<fecha>» (tampoco se pierde).
   */
  async deletePack(id: ItemID, trash?: (dir: string) => Promise<void>): Promise<void> {
    if (!SafePath.isComponent(id)) throw new LibraryError('invalid_args', tr('Curso no válido', 'Invalid course'))
    const dir = this.packDirectory(id)
    if (!existsSync(dir)) return
    if (trash) {
      try { await trash(dir); if (!existsSync(dir)) { this.onPackWrite?.(id); return } } catch { /* a «Eliminados» */ }
    }
    const bin = join(this.root, 'Eliminados')
    mkdirSync(bin, { recursive: true })
    renameSync(dir, join(bin, `${id}-${Math.floor(Date.now() / 1000)}`))
    this.onPackWrite?.(id)
  }

  /** Exporta el curso a un archivo `.aulapack` (ZIP). Por defecto sin el progreso personal, ni registros ni conversaciones. */
  async exportPack(id: ItemID, destination: string, opts: ExportOptions = {}): Promise<void> {
    const store = this.openPack(id)
    if (!store) throw new LibraryError('not_found', tr('Ese curso no existe', 'That course doesn’t exist'))
    const includeProgress = opts.includeProgress ?? false
    await zipDirectory(store.directory, destination, (rel, isDir) => {
      const parts = rel.split('/')
      const name = parts[parts.length - 1]
      // cerrojos, temporales y ocultos; claves; registros de la IA y conversaciones
      if (parts.some((p) => p.startsWith('.')) || name.endsWith('.tmp') || SECRET_NAME.test(name)) return false
      if (parts[0] === 'runs' || parts[0] === 'chats') return false
      if (!includeProgress) {
        // el progreso y sus copias («progress.json.damaged-…», y las de antes «progress.damaged-…json»), y lo que el estudiante anotó
        if (parts.length === 1 && !isDir && name.startsWith('progress')) return false
        if ((PERSONAL_FOLDERS as readonly string[]).includes(parts[0])) return false
      }
      return true
    })
  }

  /** Importa un `.aulapack`. Devuelve el id (único) con el que quedó. Si el curso ya estaba, `onDuplicate` decide (J2-24). */
  async importPack(archive: string, opts: ImportOptions = {}): Promise<ItemID> {
    const tmp = join(tmpdir(), `aula-import-${IDs.short()}`)
    mkdirSync(tmp, { recursive: true })
    try {
      await extractZip(archive, tmp)
      const candidates = existsSync(join(tmp, 'pack.json')) ? [tmp] : readdirSync(tmp).sort().map((n) => join(tmp, n)).filter((d) => existsSync(join(d, 'pack.json')))
      const dir = candidates[0]
      if (!dir) throw new LibraryError('invalid_pack', tr('El archivo no contiene un curso de Aula.', 'The file doesn’t contain an Aula course.'))
      const invalid = (): LibraryError => new LibraryError('invalid_pack', tr('El archivo no contiene un curso de Aula válido.', 'The file doesn’t contain a valid Aula course.'))
      let pack: Pack
      let raw: unknown
      try { raw = readJSONFile(join(dir, 'pack.json')) } catch { throw invalid() }
      // un pack.json sin sentido («title»: 5, «skills»: "x») no se importa como un curso llamado «5» (A3-P2-11)
      if (!plausiblePackJSON(raw)) throw invalid()
      try { pack = decodePack(raw) } catch { throw invalid() }
      // ¿ya está? (importar dos veces el mismo archivo creaba copias idénticas: J2-24)
      const existing = this.findSame(pack)
      let replacing: ItemID | undefined
      if (existing && opts.onDuplicate) {
        const choice = await opts.onDuplicate({ id: existing.id, title: existing.title })
        if (choice === 'cancel') throw new ImportCancelled()
        if (choice === 'replace') replacing = existing.id
      }
      if (existing && !replacing) pack.title = this.copyTitle(pack.title)
      const newID = replacing ?? IDs.unique(IDs.slug(pack.id), this.packIDs())
      pack.id = newID
      sanitizeImported(dir, pack)
      const dest = this.packDirectory(newID)
      const parked = replacing ? this.setAside(replacing, dir) : undefined
      try {
        copyTree(dir, dest)
        writeJSONFile(join(dest, 'pack.json'), encodePack(pack))
      } catch (err) {
        // al sustituir, si no se pudo copiar el nuevo, vuelve el de antes
        if (parked) { rmSync(dest, { recursive: true, force: true }); renameSync(parked, dest) }
        throw err
      }
      // ids de ejercicio y de tarjeta repetidos entre habilidades: cada habilidad con los suyos (el progreso los indexa por id)
      try { this.openPack(newID)?.namespaceDuplicateIDs() } catch { /* el curso se importa igual */ }
      // A2-P2-9: viene de fuera; sus lecciones son texto ajeno para la IA (la memoria pide confirmación tras leerlas)
      try { writeFileSync(join(dest, IMPORTED_MARK), new Date().toISOString() + '\n') } catch { /* el curso se importa igual */ }
      this.onPackWrite?.(newID)
      return newID
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  /** Un curso que ya es este: el mismo id de origen, o el mismo título con los mismos temas. */
  private findSame(pack: Pack): PackSummary | undefined {
    const skills = (p: Pack): string => p.skills.map((s) => s.id).sort().join('|')
    const want = skills(pack)
    for (const s of this.listPacks()) {
      if (s.id === pack.id) return s
      if (s.title !== pack.title) continue
      try { if (skills(this.openPack(s.id)!.loadPack()) === want) return s } catch { /* ilegible: no cuenta */ }
    }
    return undefined
  }

  /** «Título (2)», «Título (3)»…: el primero que no tenga ya otro curso. */
  private copyTitle(title: string): string {
    const used = new Set(this.listPacks().map((p) => p.title))
    const base = title.replace(/\s\(\d+\)$/, '')
    for (let n = 2; ; n++) if (!used.has(`${base} (${n})`)) return `${base} (${n})`
  }

  /** Sustituir: el curso de antes va a «Eliminados» (se puede recuperar) y, si el archivo no trae progreso, el suyo pasa al nuevo. */
  private setAside(id: ItemID, incoming: string): string | undefined {
    const dir = this.packDirectory(id)
    if (!existsSync(dir)) return undefined
    const bin = join(this.root, 'Eliminados')
    mkdirSync(bin, { recursive: true })
    const parked = join(bin, `${id}-${Math.floor(Date.now() / 1000)}`)
    renameSync(dir, parked)
    if (!existsSync(join(incoming, 'progress.json')) && existsSync(join(parked, 'progress.json'))) {
      try { copyFileSync(join(parked, 'progress.json'), join(incoming, 'progress.json')) } catch { /* sin progreso */ }
    }
    return parked
  }
}

/** ¿Tiene forma de pack.json? Un título de texto y, si hay temas, una lista. */
export function plausiblePackJSON(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false
  const o = raw as Record<string, unknown>
  if (typeof o.title !== 'string' || !o.title.trim()) return false
  return o.skills === undefined || Array.isArray(o.skills)
}

/** Resumen de un curso para la lista. */
export function summarize(p: Pack, id: ItemID = p.id): PackSummary {
  let exercises = 0, cards = 0
  for (const s of p.skills) { exercises += s.counts.exercises + s.counts.templates; cards += s.counts.cards }
  const out: PackSummary = {
    id, title: p.title, subject: p.subject, icon: p.icon, hue: p.hue, updated: p.updated, skillCount: p.skills.length,
    exerciseCount: exercises, cardCount: cards, language: p.language, hasExam: packHasExam(p)
  }
  if (p.exam?.date !== undefined) out.examDate = p.exam.date
  if (p.exam?.title !== undefined) out.examTitle = p.exam.title
  if (p.courseCode !== undefined) out.courseCode = p.courseCode
  return out
}

/**
 * Un curso importado viene de fuera: sus ids y nombres de archivo se usan como rutas, así que nada puede salir de su carpeta.
 * Quita los enlaces simbólicos, las conversaciones y los registros de ejecución, los materiales con un id que no sirve como
 * nombre de carpeta y deja cada nombre de archivo en su último componente.
 */
export function sanitizeImported(dir: string, pack: Pack): void {
  const walk = (d: string): void => {
    let names: string[]
    try { names = readdirSync(d) } catch { return }
    for (const n of names) {
      const full = join(d, n)
      const st = lstatSync(full)
      if (st.isSymbolicLink()) rmSync(full, { force: true })
      else if (st.isDirectory()) walk(full)
    }
  }
  walk(dir)
  for (const f of ['chats', 'runs']) rmSync(join(dir, f), { recursive: true, force: true })
  pack.sources = pack.sources.flatMap((s) => {
    if (!SafePath.isComponent(s.id)) return []
    const m = { ...s }
    if (m.filename !== undefined) {
      const last = m.filename.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? ''
      if (SafePath.isComponent(last)) m.filename = last
      else delete m.filename
    }
    return [m]
  })
}
