// IPC de cursos, progreso e historial de cambios (dominio «courses»). La lógica vive en `@main/services/store`; aquí solo se
// validan los argumentos, se abren los diálogos de guardar/abrir y se avisa a la interfaz de los cambios.
import { app, BrowserWindow, dialog, shell, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { extname, isAbsolute, join } from 'node:path'
import { parseJSON, stringifyJSON } from '@engine/base/json'
import {
  applyCourseMetaPatch, decodeProgress, encodeProgress, orderedSkills, parseCourseMetaPatch,
  type ChangeGroupSummary, type ItemID, type Pack, type StudyProgress, type UndoOptions
} from '@shared/schema'
import { AulaError, invalidArgs } from '@main/services/errors'
import { userFiles } from '@main/services/userFiles'
import { log } from '@main/services/log'
import { uiLanguage } from '@main/services/settings/uiLanguage'
import {
  getLibrary, HistoryError, ImportCancelled, installSampleCourses, LibraryError, migrateWelcomeTone, LockTimeoutError, notifyCourseChanged, onCourseChanged, PackZipError,
  SafePath, startCourseWatcher, groupCourseIDs, type DuplicateChoice, type PackStore
} from '@main/services/store'
import { emit, handle, type RpcContext } from '../rpc'
import { tr } from '@shared/ai/i18n'

const PACK_EXTENSIONS = ['aulapack', 'zip']

/** En la app empaquetada, `resources/` también está fuera del asar (asarUnpack): copiar carpetas desde ahí es seguro. */
function unpackedPath(p: string): string {
  const unpacked = p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
  return unpacked !== p && existsSync(unpacked) ? unpacked : p
}

export function register(): void {
  const lib = getLibrary()
  // primer arranque: la biblioteca vacía recibe los cursos de ejemplo
  try {
    // en el idioma de la interfaz: en español, los de siempre; en inglés, la bienvenida traducida y el de trigonometría
    const installed = installSampleCourses(lib, {
      onlyIfEmpty: true,
      language: uiLanguage(),
      bundledCourseDir: unpackedPath(join(__dirname, '../../resources/demo-course/Packs/exam-2-math112'))
    })
    if (installed.length) log.info(`Cursos de ejemplo instalados: ${installed.join(', ')}`)
    // la bienvenida de versiones anteriores era ciruela (violeta): pasa a ámbar
    const retoned = migrateWelcomeTone(lib)
    if (retoned.length) log.info(`Bienvenida en ámbar: ${retoned.join(', ')}`)
  } catch (err) {
    log.warn('No se pudieron instalar los cursos de ejemplo', err)
  }
  onCourseChanged((packId) => emit('courses.changed', { packId }))
  startCourseWatcher()

  handle('courses.list', () => getLibrary().listPacks())

  handle('courses.get', (args) => {
    const store = getLibrary().openPack(packIdArg(args))
    return store ? guard(() => store.loadPack()) : null
  })

  handle('courses.getSkill', (args) => {
    const store = getLibrary().openPack(packIdArg(args))
    const skillId = idField(args, 'skillId')
    if (!store || !store.hasSkill(skillId)) return null
    return guard(() => store.loadSkill(skillId))
  })

  handle('courses.getSkills', (args) => {
    const store = requireStore(packIdArg(args))
    const pack = guard(() => store.loadPack())
    // en el orden del plan; las que no están en el plan (archivos sueltos), al final
    const planned = orderedSkills(pack).map((s) => s.id)
    const rest = store.skillIDs().filter((id) => !planned.includes(id))
    return store.loadSkills([...planned, ...rest])
  })

  handle('courses.update', (args) => {
    const store = requireStore(packIdArg(args))
    const parsed = parseCourseMetaPatch((args as { patch?: unknown } | undefined)?.patch)
    if (!parsed.ok) throw invalidArgs(parsed.error)
    return guard((): Pack => {
      store.updatePack((p) => { applyCourseMetaPatch(p, parsed.patch) })
      return store.loadPack()
    })
  })

  handle('courses.delete', async (args) => {
    const id = packIdArg(args)
    requireStore(id)
    await guardAsync(() => getLibrary().deletePack(id, (dir) => shell.trashItem(dir)))
  })

  handle('courses.export', async (args, ctx) => {
    const store = requireStore(packIdArg(args))
    const includeProgress = optionalBool(args, 'includeProgress') ?? false
    const title = guard(() => store.loadPack()).title
    const opts: SaveDialogOptions = {
      title: words().exportTitle,
      defaultPath: join(app.getPath('documents'), `${safeFileName(title) || store.id}.aulapack`),
      filters: [{ name: words().packFilter, extensions: ['aulapack'] }]
    }
    const win = windowOf(ctx)
    const choice = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (choice.canceled || !choice.filePath) return null
    const path = extname(choice.filePath) ? choice.filePath : `${choice.filePath}.aulapack`
    await guardAsync(() => getLibrary().exportPack(store.id, path, { includeProgress }))
    return { path }
  })

  handle('courses.import', async (args, ctx) => {
    let path = optionalString(args, 'path')
    if (path !== undefined) {
      if (!isAbsolute(path) || !PACK_EXTENSIONS.includes(extname(path).slice(1).toLowerCase())) throw invalidArgs(tr('Elige un archivo .aulapack', 'Choose an .aulapack file'))
      if (!existsSync(path) || !statSync(path).isFile()) throw new AulaError('not_found', tr('Ese archivo no existe', 'That file doesn’t exist'))
      userFiles.check([path]) // solo uno que soltó o eligió el estudiante
    } else {
      const opts: OpenDialogOptions = {
        title: words().importTitle, properties: ['openFile'],
        filters: [{ name: words().packFilter, extensions: PACK_EXTENSIONS }]
      }
      const win = windowOf(ctx)
      const choice = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (choice.canceled || !choice.filePaths[0]) return null
      path = choice.filePaths[0]
    }
    const file = path
    // el curso ya está (J2-24): se pregunta si conservar los dos o sustituirlo (o lo que diga `ifDuplicate`)
    const given = duplicateChoiceArg(args)
    const win = windowOf(ctx)
    const ask = async (existing: { title: string }): Promise<DuplicateChoice> => {
      const w = words()
      const box = { type: 'question' as const, message: w.duplicate(existing.title), detail: w.duplicateDetail(existing.title), buttons: [w.keepBoth, w.replace, w.cancel], defaultId: 0, cancelId: 2, noLink: true }
      const r = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box)
      return (['keepBoth', 'replace', 'cancel'] as const)[r.response] ?? 'cancel'
    }
    try {
      const id = await guardAsync(() => getLibrary().importPack(file, { onDuplicate: given ? () => given : ask }))
      return { id }
    } catch (err) {
      if (err instanceof ImportCancelled) return null
      throw err
    }
  })

  handle('progress.get', (args) => requireStore(packIdArg(args)).loadProgress())

  handle('progress.save', (args) => {
    const store = requireStore(packIdArg(args))
    const progress = progressArg((args as { progress?: unknown } | undefined)?.progress)
    guard(() => store.saveProgress(progress))
  })

  handle('history.list', (args) => {
    const history = getLibrary().history
    if (!history) return []
    const courseID = args === undefined || args === null ? undefined : optionalId(args, 'courseId')
    const rawLimit = args === undefined || args === null ? undefined : optionalNumber(args, 'limit')
    const limit = Math.min(Math.max(Math.round(rawLimit ?? 50), 1), 200)
    return history.groups({ courseID, limit }).map((g): ChangeGroupSummary => ({ ...g, lines: history.describe(g) }))
  })

  handle('history.plan', (args) => {
    const history = requireHistory()
    const { groupId, options } = undoArgs(args)
    return guard(() => history.plan(groupId, options))
  })

  handle('history.undo', (args) => {
    const history = requireHistory()
    const { groupId, options } = undoArgs(args)
    const result = guard(() => history.undo(groupId, options))
    // deshacer escribe directamente en los archivos: avisar de los cursos tocados
    const courses = new Set<string>()
    for (const g of [groupId, result.undoGroupID]) {
      const group = history.group(g)
      if (group) for (const c of groupCourseIDs(group)) courses.add(c)
    }
    for (const c of courses) notifyCourseChanged(c)
    return result
  })
}

// MARK: Argumentos

/** «x» no es válido / “x” isn’t valid. */
function notValid(key: string): string {
  return tr(`«${key}» no es válido`, `“${key}” isn’t valid`)
}

function field(args: unknown, key: string): unknown {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw invalidArgs(tr('Argumentos no válidos', 'Invalid arguments'))
  return (args as Record<string, unknown>)[key]
}

/** Un id que se usa como nombre de carpeta o de archivo: texto corto y sin rutas. */
function idField(args: unknown, key: string): ItemID {
  const v = field(args, key)
  if (typeof v !== 'string' || v.length > 200 || !SafePath.isComponent(v)) throw invalidArgs(notValid(key))
  return v
}

const packIdArg = (args: unknown): ItemID => idField(args, 'id')

function optionalId(args: unknown, key: string): ItemID | undefined {
  return field(args, key) === undefined ? undefined : idField(args, key)
}

function optionalString(args: unknown, key: string): string | undefined {
  if (args === undefined || args === null) return undefined
  const v = field(args, key)
  if (v === undefined) return undefined
  if (typeof v !== 'string' || v.length > 4096) throw invalidArgs(notValid(key))
  return v
}

function optionalBool(args: unknown, key: string): boolean | undefined {
  const v = field(args, key)
  if (v === undefined) return undefined
  if (typeof v !== 'boolean') throw invalidArgs(notValid(key))
  return v
}

function optionalNumber(args: unknown, key: string): number | undefined {
  const v = field(args, key)
  if (v === undefined) return undefined
  if (typeof v !== 'number' || !Number.isFinite(v)) throw invalidArgs(notValid(key))
  return v
}

function undoArgs(args: unknown): { groupId: string; options: UndoOptions } {
  const groupId = field(args, 'groupId')
  if (typeof groupId !== 'string' || !groupId || groupId.length > 300) throw invalidArgs(notValid('groupId'))
  const options: UndoOptions = {}
  const includeLater = optionalBool(args, 'includeLater'), keepLaterEdits = optionalBool(args, 'keepLaterEdits')
  if (includeLater !== undefined) options.includeLater = includeLater
  if (keepLaterEdits !== undefined) options.keepLaterEdits = keepLaterEdits
  return { groupId, options }
}

/** El progreso que manda la interfaz pasa por el mismo decodificador tolerante que `progress.json` (acota y completa). */
function progressArg(raw: unknown): StudyProgress {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw invalidArgs(tr('Progreso no válido', 'Invalid progress'))
  try {
    return decodeProgress(parseJSON(stringifyJSON(encodeProgress(raw as StudyProgress), { pretty: false })))
  } catch {
    throw invalidArgs(tr('Progreso no válido', 'Invalid progress'))
  }
}

// MARK: Ayudas

function requireStore(id: ItemID): PackStore {
  const store = getLibrary().openPack(id)
  if (!store) throw new AulaError('not_found', tr('Ese curso no existe', 'That course doesn’t exist'))
  return store
}

function requireHistory(): NonNullable<ReturnType<typeof getLibrary>['history']> {
  const history = getLibrary().history
  if (!history) throw new AulaError('not_found', tr('No hay historial de cambios', 'There’s no change history'))
  return history
}

/** Los errores del almacén llegan a la interfaz con su código estable. */
function toAulaError(err: unknown): unknown {
  if (err instanceof AulaError) return err
  if (err instanceof LibraryError || err instanceof PackZipError) return new AulaError(err.code, err.message)
  if (err instanceof HistoryError) return new AulaError(`history_${err.code}`, err.message, err.details)
  if (err instanceof LockTimeoutError) return new AulaError('busy', tr('El curso está ocupado por otro proceso. Vuelve a intentarlo.', 'The course is busy with another process. Try again.'))
  if (err instanceof Error && err.name === 'SchemaError') return new AulaError('invalid_pack', err.message)
  return err
}

function guard<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    throw toAulaError(err)
  }
}

async function guardAsync<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw toAulaError(err)
  }
}

function windowOf(ctx: RpcContext): BrowserWindow | null {
  return BrowserWindow.fromWebContents(ctx.sender)
}

/** Nombre de archivo a partir del título del curso (sin caracteres que los sistemas no admiten). */
function safeFileName(title: string): string {
  return Array.from(title.replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ').replace(/\s+/g, ' ').trim()).slice(0, 80).join('')
}

/** Textos de los diálogos del sistema (el proceso principal no usa i18next: el idioma de la interfaz). */
function words(): {
  exportTitle: string; importTitle: string; packFilter: string; duplicate: (t: string) => string; duplicateDetail: (t: string) => string
  keepBoth: string; replace: string; cancel: string
} {
  return uiLanguage() === 'es'
    ? {
        exportTitle: 'Exportar curso', importTitle: 'Importar curso', packFilter: 'Curso de Aula',
        duplicate: (t) => `«${t}» ya está en Aula`,
        duplicateDetail: (t) => `«Conservar los dos» lo añade como «${t} (2)». «Sustituir» cambia el que tienes por este: tu progreso se mantiene y el anterior se guarda en la carpeta de datos de Aula.`,
        keepBoth: 'Conservar los dos', replace: 'Sustituir', cancel: 'Cancelar'
      }
    : {
        exportTitle: 'Export course', importTitle: 'Import course', packFilter: 'Aula course',
        duplicate: (t) => `“${t}” is already in Aula`,
        duplicateDetail: (t) => `“Keep both” adds it as “${t} (2)”. “Replace” swaps the one you have for this one: your progress is kept and the old one is saved in Aula’s data folder.`,
        keepBoth: 'Keep both', replace: 'Replace', cancel: 'Cancel'
      }
}

function duplicateChoiceArg(args: unknown): DuplicateChoice | undefined {
  const v = typeof args === 'object' && args !== null ? (args as { ifDuplicate?: unknown }).ifDuplicate : undefined
  if (v === undefined) return undefined
  if (v === 'keepBoth' || v === 'replace' || v === 'cancel') return v
  throw invalidArgs(tr('Opción no válida', 'Invalid option'))
}
