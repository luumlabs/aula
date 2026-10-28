// IPC de Documentos (dominio «documents»): la biblioteca, el lector con sus marcas, Aula en el lector, las tarjetas desde un
// documento y los documentos para estudiar en papel. La lógica vive en `@main/services/documents`; aquí se validan los
// argumentos (ninguna ruta sale de la carpeta de datos: los documentos se piden por referencia, nunca por ruta), se abren los
// diálogos del sistema y se dibuja el PDF en la ventana oculta de impresión.
import { app, BrowserWindow, dialog, shell, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { IDs } from '@engine/base/ids'
import type { DocumentAIAction, DocumentAIRequest, DocumentCardDraft, DocumentFormat, DocumentRef, DocumentRequest } from '@shared/documents'
import { decodeAnnotation, parseDocRef, parseDocumentRequest } from '@shared/documents'
import { AulaError, invalidArgs } from '@main/services/errors'
import { userFiles } from '@main/services/userFiles'
import { resolveActiveModel } from '@main/services/ai'
import { uiLanguage } from '@main/services/settings/uiLanguage'
import { getLibrary, notifyCourseChanged } from '@main/services/store'
import {
  addCourseDocument, annotationStore, cardTargets, DocumentAIJobs, docLang, findInDocument, FORMAT_EXTENSION, importFiles, listLibrary, locate,
  openDocument, originalPath, planFor, removeDocument, renderDocument, saveDocumentCards, searchLibrary, touchRecent, unavailableKinds, writeRendered,
  type RenderedDocument
} from '@main/services/documents'
import { displayTitle, fileBaseName } from '@main/services/documents/planner'
import { registerAssistantTools } from '@main/services/assistant/tools'
import { documentTools } from '@main/services/documents/tools'
import { emit, handle, type RpcContext } from '../rpc'
import { printPlanToPDF } from '../print'
import { tr } from '@shared/ai/i18n'

// MARK: - Validación

type Args = Record<string, unknown>

function obj(args: unknown): Args {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw invalidArgs(tr('Argumentos no válidos', 'Invalid arguments'))
  return args as Args
}

function refArg(args: unknown): DocumentRef {
  const ref = parseDocRef(obj(args).ref)
  if (!ref) throw invalidArgs(tr('Documento no válido', 'Invalid document'))
  return ref
}

function str(a: Args, k: string, max: number, optional = false): string {
  const v = a[k]
  if (v === undefined && optional) return ''
  if (typeof v !== 'string' || v.length > max) throw invalidArgs(tr(`Campo no válido: ${k}`, `Invalid field: ${k}`))
  return v
}

function page(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 100_000) throw invalidArgs(tr('Página no válida', 'Invalid page'))
  return v
}

function action(raw: unknown): DocumentAIAction {
  const a = obj(raw)
  const sel = (): string => str(a, 'selection', 20_000).trim() || ((): never => { throw invalidArgs(tr('Selección vacía', 'Empty selection')) })()
  switch (a.type) {
    case 'summarizePage': return { type: 'summarizePage', page: page(a.page) }
    case 'summarizeChapter': {
      const out: DocumentAIAction = { type: 'summarizeChapter', page: page(a.page) }
      if (a.from !== undefined && a.to !== undefined) { out.from = page(a.from); out.to = Math.max(out.from, page(a.to)) }
      if (typeof a.title === 'string' && a.title.length <= 300) out.title = a.title
      return out
    }
    case 'summarizeDocument': return { type: 'summarizeDocument' }
    case 'examFocus': return { type: 'examFocus' }
    case 'explain': return { type: 'explain', selection: sel(), page: page(a.page) }
    case 'cards': return { type: 'cards', selection: sel(), page: page(a.page) }
    case 'practice': return { type: 'practice', selection: sel(), page: page(a.page) }
    case 'ask': {
      const q = str(a, 'question', 4000).trim()
      if (!q) throw invalidArgs(tr('Pregunta vacía', 'Empty question'))
      return { type: 'ask', question: q }
    }
    default: throw invalidArgs(tr('Acción no válida', 'Invalid action'))
  }
}

function aiRequest(raw: unknown): DocumentAIRequest {
  const a = obj(raw)
  const req: DocumentAIRequest = { ref: refArg(a), action: action(a.action), language: str(a, 'language', 16, true) || uiLang() }
  if (a.pageImage !== undefined) {
    const img = str(a, 'pageImage', 8_000_000)
    if (!/^[A-Za-z0-9+/=]+$/.test(img)) throw invalidArgs(tr('Imagen no válida', 'Invalid image'))
    req.pageImage = img
  }
  return req
}

function cardsArg(raw: unknown): DocumentCardDraft[] {
  if (!Array.isArray(raw) || raw.length > 24) throw invalidArgs(tr('Tarjetas no válidas', 'Invalid flashcards'))
  return raw.map((c) => {
    const o = obj(c)
    return { front: str(o, 'front', 2000), back: str(o, 'back', 4000) }
  })
}

function requestArg(raw: unknown): DocumentRequest {
  try {
    const r = parseDocumentRequest(obj(raw).request)
    if (!r.lang) r.lang = uiLang()
    return r
  } catch (err) {
    throw invalidArgs(err instanceof Error ? err.message : tr('Petición no válida', 'Invalid request'))
  }
}

function uiLang(): 'es' | 'en' {
  return uiLanguage()
}

/** Rutas de archivos para importar: las que soltó o eligió el estudiante (`userFiles`, de `webUtils.getPathForFile`) y que
 *  existan y sean archivos. */
function pathsArg(raw: unknown): string[] {
  const list = obj(raw).paths
  if (!Array.isArray(list) || list.length > 200 || list.some((p) => typeof p !== 'string' || p.length >= 4096)) throw invalidArgs(tr('Archivos no válidos', 'Invalid files'))
  return userFiles.check(list as string[]).filter((p) => isAbsolute(p) && existsSync(p) && statSync(p).isFile())
}

function parent(ctx: RpcContext): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(ctx.sender) ?? undefined
}

// MARK: - PDF ya dibujados (para guardar el mismo que se vio en la vista previa)

const rendered = new Map<string, RenderedDocument>()
/** Lo que se guardó con el diálogo en esta sesión (lo único que «Mostrar» puede abrir fuera de la carpeta de datos). */
const savedPaths = new Set<string>()

function remember(doc: RenderedDocument): string {
  const token = IDs.short(12)
  rendered.set(token, doc)
  while (rendered.size > 4) rendered.delete(rendered.keys().next().value as string)
  return token
}

async function renderPDF(request: DocumentRequest): Promise<RenderedDocument> {
  const { plan } = planFor(request)
  const pdf = await printPlanToPDF(plan)
  return { data: pdf.data, format: 'pdf', pages: pdf.pages, title: displayTitle(plan), kind: plan.request.kind, baseName: fileBaseName(plan), attachments: [], ...(plan.packId ? { courseID: plan.packId } : {}) }
}

async function renderFor(request: DocumentRequest, token?: string): Promise<RenderedDocument> {
  if (request.format === 'pdf') return (token && rendered.get(token)) || renderPDF(request)
  const { plan, course } = planFor(request)
  return renderDocument(plan, course?.store, request.format)
}

const FILTERS: Record<DocumentFormat, { name: string; extensions: string[] }> = {
  pdf: { name: 'PDF', extensions: ['pdf'] },
  docx: { name: 'Word', extensions: ['docx'] },
  markdown: { name: 'Markdown', extensions: ['md'] }
}

const IMPORT_EXTENSIONS = ['pdf', 'docx', 'doc', 'pptx', 'xlsx', 'epub', 'html', 'htm', 'md', 'markdown', 'txt', 'rtf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'tiff']

// MARK: - Registro

export function register(): void {
  // el chat y el tutor pueden leer los documentos (listar, leer por páginas, lo esencial para resumir)
  registerAssistantTools('documents', (env) => documentTools(env.defaultCourseID ? { courseId: env.defaultCourseID } : {}))
  const jobs = new DocumentAIJobs((u) => emit('documents.ai', u))
  const changed = (key?: string): void => emit('documents.changed', key ? { key } : {})
  const doImport = async (paths: string[]): Promise<Awaited<ReturnType<typeof importFiles>>> => {
    const out = await importFiles(paths, { onProgress: (name, fraction, message) => emit('documents.importProgress', { name, fraction, message }), language: uiLang() })
    changed()
    return out
  }

  handle('documents.library', () => listLibrary())
  handle('documents.open', (args) => openDocument(refArg(args)))
  handle('documents.search', (args) => {
    const a = obj(args)
    const opts: { courseId?: string; limit?: number } = {}
    if (typeof a.courseId === 'string') opts.courseId = a.courseId
    if (typeof a.limit === 'number') opts.limit = a.limit
    return searchLibrary(str(a, 'query', 500), opts)
  })
  handle('documents.find', (args) => findInDocument(refArg(args), str(obj(args), 'query', 500)))
  handle('documents.import', (args) => doImport(pathsArg(args)))
  handle('documents.pick', async (_args, ctx) => {
    const opts: OpenDialogOptions = {
      title: uiLang() === 'en' ? 'Add documents' : 'Añadir documentos',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: uiLang() === 'en' ? 'Documents' : 'Documentos', extensions: IMPORT_EXTENSIONS }]
    }
    const win = parent(ctx)
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths.length) return null
    return doImport(res.filePaths)
  })
  handle('documents.remove', (args) => {
    const ref = refArg(args)
    removeDocument(ref)
    if (ref.kind === 'saved') notifyCourseChanged(ref.packId)
    changed()
  })
  handle('documents.fileData', async (args) => {
    const doc = locate(refArg(args))
    if (!doc.filePath) throw new AulaError('not_found', tr('Este documento no tiene archivo.', 'This document has no file.'))
    if (statSync(doc.filePath).size > 400 * 1024 * 1024) throw new AulaError('too_large', tr('El archivo es demasiado grande.', 'The file is too large.'))
    return { data: new Uint8Array(await readFile(doc.filePath)) }
  })
  handle('documents.reveal', (args) => {
    const p = originalPath(refArg(args))
    if (!p) throw new AulaError('not_found', tr('Este documento no tiene archivo.', 'This document has no file.'))
    shell.showItemInFolder(p)
  })
  handle('documents.setPage', (args) => {
    const ref = refArg(args)
    locate(ref)
    touchRecent(ref, page(obj(args).page))
  })

  handle('documents.annotations', (args) => annotationStore(refArg(args)).load())
  handle('documents.annotate', (args) => {
    const ref = refArg(args)
    const a = decodeAnnotation(obj(args).annotation, () => IDs.short(8))
    if (!a) throw invalidArgs(tr('Marca no válida', 'Invalid annotation'))
    const out = annotationStore(ref).upsert(a)
    changed()
    return out
  })
  handle('documents.unannotate', (args) => {
    const ref = refArg(args)
    const out = annotationStore(ref).remove(str(obj(args), 'id', 100))
    changed()
    return out
  })

  handle('documents.aiStatus', async () => {
    try {
      const model = await resolveActiveModel()
      return { available: true, vision: model.capabilities.vision, provider: model.providerName }
    } catch {
      return { available: false, vision: false }
    }
  })
  handle('documents.aiStart', (args) => ({ jobId: jobs.start(aiRequest(args)) }))
  handle('documents.aiCancel', (args) => jobs.cancel(str(obj(args), 'jobId', 40)))

  handle('documents.cardTargets', (args) => {
    const raw = args === undefined || args === null ? undefined : obj(args).ref
    const ref = raw === undefined ? undefined : parseDocRef(raw)
    const course = ref && ref.kind !== 'import' ? ref.packId : undefined
    return cardTargets(course)
  })
  handle('documents.saveCards', (args) => {
    const a = obj(args)
    const store = getLibrary().openPack(str(a, 'courseId', 200))
    if (!store) throw new AulaError('not_found', tr('Ese curso no existe.', 'That course doesn’t exist.'))
    const ref = a.ref === undefined ? undefined : parseDocRef(a.ref)
    const p = a.page === undefined ? undefined : page(a.page)
    const lang = uiLang()
    // la etiqueta se guarda dentro del curso: va en el idioma del curso (si no es español, en inglés)
    let courseLang: 'es' | 'en' = lang
    try { courseLang = store.loadPack().language.toLowerCase().startsWith('es') ? 'es' : 'en' } catch { /* sin curso legible: la interfaz */ }
    let label = courseLang === 'en' ? 'Cards from a document' : 'Tarjetas de un documento'
    let source
    if (ref) {
      const doc = locate(ref)
      label = courseLang === 'en' ? `Cards from “${doc.title}”` : `Tarjetas de «${doc.title}»`
      if (ref.kind === 'source' && ref.packId === store.id) source = { source: ref.sourceId, ...(p ? { page: p } : {}) }
    }
    const saved = saveDocumentCards(store, str(a, 'skillId', 200), cardsArg(a.cards), { label, lang, ...(source ? { source } : {}) })
    return { saved }
  })

  handle('documents.plan', (args) => planFor(requestArg(args)).plan)
  handle('documents.kinds', (args) => ({ unavailable: unavailableKinds(requestArg(args)) }))
  handle('documents.renderPDF', async (args) => {
    const request = { ...requestArg(args), format: 'pdf' as const }
    const doc = await renderPDF(request)
    return { token: remember(doc), pages: doc.pages, data: doc.data, title: doc.title, baseName: doc.baseName }
  })
  handle('documents.save', async (args, ctx) => {
    const a = obj(args)
    const request = requestArg(args)
    const target = a.target === 'course' ? 'course' : a.target === 'file' ? 'file' : ((): never => { throw invalidArgs(tr('Destino no válido', 'Invalid destination')) })()
    const token = typeof a.token === 'string' ? a.token : undefined
    const doc = await renderFor(request, token)
    const lang = docLang(request.lang)
    if (target === 'course') {
      const store = request.courseID ? getLibrary().openPack(request.courseID) : undefined
      if (!store) throw new AulaError('not_found', tr('Ese curso no existe.', 'That course doesn’t exist.'))
      const { saved, path } = addCourseDocument(doc, store, false, lang)
      savedPaths.add(path)
      notifyCourseChanged(store.id)
      changed()
      return { path, savedId: saved.id }
    }
    const opts: SaveDialogOptions = {
      title: lang === 'en' ? 'Save document' : 'Guardar documento',
      defaultPath: join(app.getPath('downloads'), `${doc.baseName}.${FORMAT_EXTENSION[doc.format]}`),
      filters: [FILTERS[doc.format]]
    }
    const win = parent(ctx)
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    // el diálogo ya preguntó si se reemplaza
    const path = writeRendered(doc, dirname(res.filePath), { exactPath: res.filePath, lang })
    savedPaths.add(path)
    return { path }
  })
  handle('documents.revealSaved', (args) => {
    const p = str(obj(args), 'path', 4096)
    if (!savedPaths.has(p)) throw invalidArgs(tr('Ruta no válida', 'Invalid path'))
    shell.showItemInFolder(p)
  })

  app.on('before-quit', () => jobs.cancelAll())
}
