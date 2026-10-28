// IPC de «Crear curso» (create.*) y del equipo que crea y amplía cursos (generation.*). La lógica vive en
// `@main/services/pipeline`; aquí se validan los argumentos, se avisa a la interfaz y se pone lo que solo tiene Electron: el
// navegador de plataformas (con la sesión del estudiante) y el dibujante de páginas para las herramientas de la IA.
import { app } from 'electron'
import { IDs } from '@engine/base/ids'
import type { GenerationRequest } from '@engine/pipeline'
import type { PageInfo } from '@engine/platforms/page'
import { platformInfo } from '@engine/platforms/model'
import { invalidArgs } from '@main/services/errors'
import { tr } from '@shared/ai/i18n'
import { userFiles } from '@main/services/userFiles'
import { log } from '@main/services/log'
import { createGenerationService, type GenerationService } from '@main/services/pipeline'
import type { BrowserPage, PlatformAccess } from '@main/services/tools'
import { emit, handle } from '../rpc'
import { platformBrowser } from '../browser'
import { electronRasterizer } from '../rasterizer'

type Obj = Record<string, unknown>

function obj(args: unknown): Obj {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw invalidArgs(tr('Argumentos no válidos', 'Invalid arguments'))
  return args as Obj
}

function str(o: Obj, key: string, max: number, required = true): string | undefined {
  const v = o[key]
  if (v === undefined || v === null) {
    if (required) throw invalidArgs(tr(`Falta «${key}»`, `“${key}” is missing`))
    return undefined
  }
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) throw invalidArgs(tr(`«${key}» no es válido`, `“${key}” isn’t valid`))
  return v
}

/** Rutas de archivos que soltó o eligió el estudiante (las demás se rechazan: `userFiles`). */
function paths(o: Obj): string[] {
  const v = o.paths
  if (!Array.isArray(v) || v.length > 200 || v.some((p) => typeof p !== 'string' || !p || p.length > 4096)) throw invalidArgs(tr('Archivos no válidos', 'Invalid files'))
  return userFiles.check(v as string[])
}

/** El navegador de Aula visto por las herramientas: una pestaña propia por ejecución, con las cuentas del estudiante. */
function platformAccess(request: GenerationRequest): PlatformAccess | undefined {
  let browser: ReturnType<typeof platformBrowser>
  try { browser = platformBrowser() } catch { return undefined }
  const wanted = request.gather?.accountId
  const accounts = browser.listAccounts().filter((a) => (wanted ? a.id === wanted : request.mode.kind === 'extend' ? a.status === 'signedIn' : true))
  if (!accounts.length) return undefined
  const tab = `aula-gen-${IDs.short(6)}`
  const toPage = (info: PageInfo): BrowserPage => {
    const p: BrowserPage = { url: info.url, title: info.title, needsLogin: info.needsLogin }
    if (info.httpStatus !== undefined) p.httpStatus = info.httpStatus
    if (info.wall) p.wall = info.wall
    const acc = browser.accountForURL(info.url)
    if (acc) p.platform = platformInfo(acc.kind).aiName
    return p
  }
  return {
    places: accounts.map((a) => ({ name: a.label, kind: a.kind, aiName: platformInfo(a.kind).aiName, url: a.baseURL, ...(a.notes ? { notes: a.notes } : {}) })),
    open: async (url, signal) => toPage(await browser.open(url, { tab, signal })),
    read: async (offset, maxCharacters, signal) => {
      const r = await browser.read(null, { tab, offset, maxCharacters, signal })
      const out: { page: BrowserPage; text: string; nextOffset?: number } = { page: toPage(r.page), text: r.elementsFenced ? `${r.fenced}\n\n${r.elementsFenced}` : r.fenced }
      if (r.nextOffset !== null) out.nextOffset = r.nextOffset
      return out
    },
    links: async (signal) => (await browser.links(null, { tab, signal })).links.map((l) => ({ text: l.text, url: l.url })),
    click: async (target, signal) => toPage((await browser.click(target, { tab, signal })).page),
    screenshot: async (signal) => {
      const s = await browser.screenshot({ tab, signal, format: 'jpeg', quality: 75 })
      return { base64: s.data.toString('base64'), mediaType: s.mimeType }
    },
    signIn: (url) => browser.signInForURL(url, { tab, accountIds: accounts.map((a) => a.id) }),
    download: async (url, signal) => {
      const d = await browser.download(url, { signal })
      return { path: d.path, filename: d.filename }
    },
    readAll: async (signal) => {
      const r = await browser.read(null, { tab, full: true, offset: 0, maxCharacters: 400_000, signal })
      return { page: toPage(r.page), text: r.markdown }
    }
  }
}

let service: GenerationService | null = null

/** El servicio de generación de la app (lo crea `register`). */
export function generationService(): GenerationService | null {
  return service
}

export function register(): void {
  const s = createGenerationService({
    emit: (view) => emit('generation.update', view),
    onMaterial: (draftId, material) => emit('create.material', { draftId, material }),
    services: { browser: platformAccess, rasterizer: electronRasterizer }
  })
  service = s
  try { s.drafts.sweep() } catch { /* nada */ }

  handle('create.addFiles', (args) => {
    const o = obj(args)
    return s.drafts.addFiles(str(o, 'draftId', 64, false), paths(o))
  })
  handle('create.addText', (args) => {
    const o = obj(args)
    return s.drafts.addText(str(o, 'draftId', 64, false), str(o, 'text', 2_000_000) as string, str(o, 'title', 300, false))
  })
  handle('create.addURL', (args) => {
    const o = obj(args)
    return s.drafts.addURL(str(o, 'draftId', 64, false), str(o, 'url', 2048) as string)
  })
  handle('create.removeMaterial', (args) => {
    const o = obj(args)
    return s.drafts.remove(str(o, 'draftId', 64) as string, str(o, 'materialId', 200) as string)
  })
  handle('create.draft', (args) => s.drafts.materials(str(obj(args), 'draftId', 64) as string))
  handle('create.discardDraft', (args) => {
    const id = str(obj(args), 'draftId', 64) as string
    if (!s.drafts.isDraftID(id)) throw invalidArgs(tr('Borrador no válido.', 'Invalid draft.'))
    s.drafts.discard(id)
  })
  handle('create.attachToCourse', (args) => {
    const o = obj(args)
    return s.attachMaterials(str(o, 'packId', 200), str(o, 'draftId', 64))
  })
  handle('create.start', (args) => {
    const o = obj(args)
    return s.start(str(o, 'draftId', 64, false), o.request)
  })

  handle('generation.extend', (args) => {
    const o = obj(args)
    return s.extend(str(o, 'packId', 200), str(o, 'instruction', 4000), str(o, 'skillId', 200, false))
  })
  handle('generation.runs', () => s.runs())
  handle('generation.run', (args) => s.run(str(obj(args), 'id', 100)))
  handle('generation.cancel', (args) => { s.cancel(str(obj(args), 'id', 100)) })
  handle('generation.resume', (args) => s.resume(str(obj(args), 'id', 100)))
  handle('generation.keep', (args) => s.keep(str(obj(args), 'id', 100)))
  handle('generation.answer', (args) => {
    const o = obj(args)
    s.answer(str(o, 'id', 100), str(o, 'questionId', 100), str(o, 'answer', 4000))
  })

  // al salir, lo que estaba en marcha queda en pausa (se reanuda desde el monitor)
  app.once('before-quit', () => { void s.shutdown().catch((err) => log.warn('[generation] al cerrar', err)) })
}
