// Área de preparación de «Crear curso» (y de «Materiales» de un curso): los archivos, textos y páginas se leen y trocean en
// `<datos>/Drafts/<borrador>/sources/` ANTES de que exista el curso; al empezar, pasan al curso (`moveSourceToPack`).
// Cada material avisa de su avance ('create.material'): leyendo, OCR, páginas, o el error en el idioma de la interfaz.
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { IDs } from '@engine/base/ids'
import { tr } from '@shared/ai/i18n'
import type { MaterialView } from '@shared/generation/types'
import type { SourceMeta, SourceTrust } from '@shared/schema'
import { AulaError } from '../errors'
import { readJSON, writeJSONAtomic } from '../fs'
import { detectKind, importSourceIntoPack, moveSourceToPack, newSourceID, removeSourceFromPack, type IngestInput } from '../ingest'
import { titleFromFileName } from '../ingest/pipeline'
import { log } from '../log'
import { paths } from '../paths'
import type { PackStore } from '../store'

const DRAFT_FILE = 'draft.json'
/** Lecturas a la vez por borrador (un PDF escaneado con OCR ocupa mucho). */
const READERS = 2
/** Borradores sin tocar más de una semana se borran al arrancar. */
const MAX_AGE_MS = 7 * 24 * 3600_000
const ID_RE = /^[a-z0-9-]{4,40}$/

interface DraftEntry { view: MaterialView; meta?: SourceMeta }
interface DraftFile { id: string; created: string; materials: DraftEntry[] }

export type MaterialListener = (draftId: string, material: MaterialView) => void

/** Una tarea de lectura pendiente. */
interface Job { draftId: string; id: string; input: IngestInput; trust: SourceTrust }

export class DraftStore {
  private readonly queue = new Map<string, Job[]>()
  private readonly active = new Map<string, number>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly waiters = new Map<string, Array<() => void>>()

  constructor(private readonly root: () => string = () => join(paths.root(), 'Drafts'), private readonly onMaterial: MaterialListener = () => {}) {}

  isDraftID(id: unknown): id is string {
    return typeof id === 'string' && ID_RE.test(id)
  }

  directory(id: string): string {
    if (!this.isDraftID(id)) throw new AulaError('invalid_args', tr('Borrador no válido.', 'Invalid draft.'))
    return join(this.root(), id)
  }

  private load(id: string): DraftFile {
    const raw = readJSON<DraftFile>(join(this.directory(id), DRAFT_FILE))
    if (raw && Array.isArray(raw.materials)) return { id, created: typeof raw.created === 'string' ? raw.created : new Date().toISOString(), materials: raw.materials.filter((m) => m && m.view && typeof m.view.id === 'string') }
    return { id, created: new Date().toISOString(), materials: [] }
  }

  private save(d: DraftFile): void {
    mkdirSync(this.directory(d.id), { recursive: true })
    writeJSONAtomic(join(this.directory(d.id), DRAFT_FILE), d)
  }

  private mutate(id: string, body: (d: DraftFile) => void): DraftFile {
    const d = this.load(id)
    body(d)
    this.save(d)
    return d
  }

  /** El borrador existente o uno nuevo. */
  open(id?: string): string {
    if (id !== undefined) {
      if (!this.isDraftID(id)) throw new AulaError('invalid_args', tr('Borrador no válido.', 'Invalid draft.'))
      if (!existsSync(join(this.directory(id), DRAFT_FILE))) this.save({ id, created: new Date().toISOString(), materials: [] })
      return id
    }
    const nid = `draft-${IDs.short(10)}`
    this.save({ id: nid, created: new Date().toISOString(), materials: [] })
    return nid
  }

  materials(id: string): MaterialView[] {
    if (!this.isDraftID(id) || !existsSync(this.directory(id))) return []
    const d = this.load(id)
    // lo que quedó «leyendo» de una sesión anterior (la app se cerró) ya no avanza
    const running = new Set((this.queue.get(id) ?? []).map((j) => j.id))
    return d.materials.map((m) => (m.view.status === 'processing' && !running.has(m.view.id) && !(this.active.get(id) ?? 0) ? { ...m.view, status: 'failed', error: tr('Se interrumpió la lectura: vuelve a añadirlo.', 'Reading was interrupted: add it again.') } : m.view))
  }

  metas(id: string): SourceMeta[] {
    return this.load(id).materials.flatMap((m) => (m.meta && m.view.status === 'ready' ? [m.meta] : []))
  }

  private add(draftId: string, title: string, kind: string, input: IngestInput, trust: SourceTrust): MaterialView {
    let view: MaterialView | undefined
    this.mutate(draftId, (d) => {
      const id = newSourceID(title, d.materials.map((m) => m.view.id))
      view = { id, title, kind, pages: 0, characters: 0, status: 'processing', official: trust === 'official', warnings: [], progress: 0, detail: tr('En cola…', 'Queued…') }
      d.materials.push({ view })
    })
    const v = view as MaterialView
    this.enqueue({ draftId, id: v.id, input, trust })
    return v
  }

  addFiles(draftId: string | undefined, files: string[]): { draftId: string; materials: MaterialView[] } {
    const id = this.open(draftId)
    for (const path of files) {
      let ok = false
      try { ok = statSync(path).isFile() } catch { ok = false }
      const title = titleFromFileName(path)
      if (!ok) {
        this.mutate(id, (d) => {
          d.materials.push({ view: { id: newSourceID(title, d.materials.map((m) => m.view.id)), title: basename(path) || title, kind: 'unknown', pages: 0, characters: 0, status: 'failed', official: false, warnings: [], error: tr('No encuentro el archivo.', "I can't find the file.") } })
        })
        continue
      }
      this.add(id, title, detectKind(path), { type: 'file', path }, 'other')
    }
    return { draftId: id, materials: this.materials(id) }
  }

  addText(draftId: string | undefined, text: string, title?: string): { draftId: string; materials: MaterialView[] } {
    const id = this.open(draftId)
    const clean = text.trim()
    if (!clean) throw new AulaError('invalid_args', tr('El texto está vacío.', 'The text is empty.'))
    const name = title?.trim() || Array.from(clean.split('\n')[0].replace(/^#+\s*/, '')).slice(0, 60).join('') || tr('Texto pegado', 'Pasted text')
    this.add(id, name, 'text', { type: 'text', text: clean, title: name }, 'notes')
    return { draftId: id, materials: this.materials(id) }
  }

  addURL(draftId: string | undefined, url: string): { draftId: string; materials: MaterialView[] } {
    const id = this.open(draftId)
    let u: URL
    try { u = new URL(url.trim()) } catch { throw new AulaError('invalid_args', tr('La dirección no es válida.', 'The address is not valid.')) }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new AulaError('invalid_args', tr('Solo se admiten direcciones http(s).', 'Only http(s) addresses are supported.'))
    this.add(id, u.hostname + (u.pathname.length > 1 ? u.pathname : ''), 'web', { type: 'url', url: u.toString() }, 'web')
    return { draftId: id, materials: this.materials(id) }
  }

  remove(draftId: string, materialId: string): MaterialView[] {
    if (!this.isDraftID(draftId)) throw new AulaError('invalid_args', tr('Borrador no válido.', 'Invalid draft.'))
    this.controllers.get(`${draftId}/${materialId}`)?.abort()
    this.queue.set(draftId, (this.queue.get(draftId) ?? []).filter((j) => j.id !== materialId))
    this.mutate(draftId, (d) => { d.materials = d.materials.filter((m) => m.view.id !== materialId) })
    try { removeSourceFromPack(this.directory(draftId), materialId) } catch { /* no estaba leído */ }
    return this.materials(draftId)
  }

  /** Cambia la vista de un material (y avisa a la interfaz). */
  private update(draftId: string, id: string, patch: Partial<MaterialView>, meta?: SourceMeta): void {
    let view: MaterialView | undefined
    try {
      this.mutate(draftId, (d) => {
        const m = d.materials.find((x) => x.view.id === id)
        if (!m) return
        m.view = { ...m.view, ...patch }
        if (patch.status && patch.status !== 'processing') { delete m.view.progress; delete m.view.detail }
        if (meta) m.meta = meta
        view = m.view
      })
    } catch (err) { log.warn('[drafts] no se pudo guardar el borrador', err) }
    if (view) this.onMaterial(draftId, view)
  }

  private enqueue(job: Job): void {
    const list = this.queue.get(job.draftId) ?? []
    list.push(job)
    this.queue.set(job.draftId, list)
    this.pump(job.draftId)
  }

  private pump(draftId: string): void {
    while ((this.active.get(draftId) ?? 0) < READERS) {
      const job = this.queue.get(draftId)?.shift()
      if (!job) break
      this.active.set(draftId, (this.active.get(draftId) ?? 0) + 1)
      void this.read(job).finally(() => {
        this.active.set(draftId, (this.active.get(draftId) ?? 1) - 1)
        if ((this.active.get(draftId) ?? 0) === 0 && !(this.queue.get(draftId)?.length)) {
          for (const w of this.waiters.get(draftId) ?? []) w()
          this.waiters.delete(draftId)
        }
        this.pump(draftId)
      })
    }
  }

  private async read(job: Job): Promise<void> {
    const key = `${job.draftId}/${job.id}`
    const ctl = new AbortController()
    this.controllers.set(key, ctl)
    let last = 0
    try {
      this.update(job.draftId, job.id, { progress: 0, detail: tr('Leyendo…', 'Reading…') })
      const r = await importSourceIntoPack(this.directory(job.draftId), job.input, {
        sourceID: job.id, trust: job.trust, register: false, signal: ctl.signal,
        onProgress: (f, message) => {
          // como mucho un aviso cada 5 %
          if (f - last < 0.05 && f < 1) return
          last = f
          this.update(job.draftId, job.id, { progress: Math.round(f * 100) / 100, detail: message })
        }
      })
      if (ctl.signal.aborted) return
      const meta = r.meta
      this.update(job.draftId, job.id, { title: meta.title, kind: meta.kind, pages: meta.pages, characters: meta.characters, status: 'ready', warnings: meta.warnings }, meta)
    } catch (err) {
      if (ctl.signal.aborted) return
      const message = err instanceof Error && err.message ? err.message : tr('No se pudo leer el material.', "The material couldn't be read.")
      this.update(job.draftId, job.id, { status: 'failed', error: message })
    } finally {
      this.controllers.delete(key)
    }
  }

  /** Espera a que terminen las lecturas en curso del borrador (antes de pasar sus materiales a un curso). */
  idle(draftId: string): Promise<void> {
    if (!(this.active.get(draftId) ?? 0) && !(this.queue.get(draftId)?.length)) return Promise.resolve()
    return new Promise((resolve) => { const l = this.waiters.get(draftId) ?? []; l.push(resolve); this.waiters.set(draftId, l) })
  }

  /**
   * Pasa los materiales leídos (todos o `only`) al curso. Los de `official` quedan como «oficiales del profesor».
   * Devuelve los que se movieron; el borrador se borra si queda vacío.
   */
  moveToPack(draftId: string, store: PackStore, opts: { only?: readonly string[]; official?: readonly string[] } = {}): SourceMeta[] {
    if (!this.isDraftID(draftId) || !existsSync(this.directory(draftId))) return []
    const d = this.load(draftId)
    const only = opts.only?.length ? new Set(opts.only) : undefined
    const official = new Set(opts.official ?? [])
    const moved: SourceMeta[] = []
    for (const m of d.materials) {
      if (!m.meta || m.view.status !== 'ready' || (only && !only.has(m.view.id))) continue
      const meta: SourceMeta = { ...m.meta, trust: official.has(m.view.id) ? 'official' : m.meta.trust === 'official' && !official.size ? 'official' : m.meta.trust }
      try { moved.push(moveSourceToPack(this.directory(draftId), meta, store.directory, store)) } catch (err) { log.warn(`[drafts] no se pudo pasar «${meta.title}» al curso`, err) }
    }
    const left = d.materials.filter((m) => !moved.some((x) => x.id === m.view.id))
    if (!left.length) this.discard(draftId)
    else this.mutate(draftId, (x) => { x.materials = x.materials.filter((m) => !moved.some((y) => y.id === m.view.id)) })
    return moved
  }

  discard(draftId: string): void {
    if (!this.isDraftID(draftId)) return
    for (const [k, c] of this.controllers) if (k.startsWith(`${draftId}/`)) c.abort()
    this.queue.delete(draftId)
    try { rmSync(this.directory(draftId), { recursive: true, force: true }) } catch { /* nada */ }
  }

  /** Borra los borradores abandonados. */
  sweep(now = Date.now()): void {
    let names: string[] = []
    try { names = readdirSync(this.root()) } catch { return }
    for (const n of names) {
      if (!this.isDraftID(n)) continue
      try { if (now - statSync(join(this.root(), n)).mtimeMs > MAX_AGE_MS) rmSync(join(this.root(), n), { recursive: true, force: true }) } catch { /* nada */ }
    }
  }
}

/** «(borrador draft-abc)» / «(draft draft-abc)» en una petición de cambios: los materiales que se añadieron desde «Materiales». */
export function draftInInstruction(instruction: string): string | undefined {
  return /\((?:borrador|draft) ([a-z0-9-]{4,40})\)/i.exec(instruction)?.[1]
}
