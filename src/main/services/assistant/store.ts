// Conversaciones del chat con Aula y del tutor en disco (port de AssistantStore.swift):
//
//     <datos>/Assistant/threads/<id>.json          una conversación del chat (mensajes, menciones, tarjetas…)
//     <datos>/Assistant/threads/.index.json        resumen de cada conversación para la lista (solo se relee lo que cambió)
//     <datos>/Assistant/threads/.partial-<id>.draft  lo que ya había llegado de una respuesta (si la app se cierra a mitad)
//     <datos>/Assistant/Packs/<id>/                sus adjuntos como un «curso» oculto: sources/ (texto, OCR…) y assets/ (imágenes)
//     <datos>/Packs/<curso>/chats/<id>.json        las conversaciones del tutor de un curso (las antiguas «student»/«tutor» se
//                                                  leen y se convierten al guardarse)
// Nunca se guardan claves: los mensajes pasan por `redactSecrets` antes de llegar aquí. Cada conversación guarda su versión
// anterior (`.<id>.json.bak`): si el archivo se daña, se lee esa (y queda una copia del dañado al lado).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { IDs } from '@engine/base/ids'
import { titleFrom, oneLine, plainText } from '@engine/assistant'
import { tr } from '@shared/ai/i18n'
import type { AssistantAttachment, AssistantMessage, AssistantThread } from '@shared/assistant/types'
import { makePack } from '@shared/schema/pack'
import { backupPath, readWithBackup, writeFileAtomic } from '../fs'
import { log } from '../log'
import { Library } from '../store/library'
import { PackStore } from '../store/packStore'
import { convertLegacyTutor, decodeMessage, decodeThread, encodeMessage, encodeThread, expirePending, isLegacyTutor, newMessage } from './models'

interface IndexEntry { stamp: number; thread: AssistantThread }
interface PartialReply { threadID: string; after: string; message: AssistantMessage }

const json = (v: unknown, pretty = true): string => JSON.stringify(v, null, pretty ? 2 : 0) + (pretty ? '\n' : '')

/** Título para la lista: el que tenga o el principio del primer mensaje del estudiante. */
export function displayTitle(t: AssistantThread): string {
  const title = t.title.trim()
  if (title) return title
  const first = t.messages.find((m) => m.role === 'user')
  if (first) return titleFrom(first.text || (first.attachments[0]?.name ?? ''))
  return tr('Conversación nueva', 'New conversation')
}

/** Texto breve del último mensaje (para la lista de conversaciones). */
export function threadPreview(t: AssistantThread): string {
  const last = [...t.messages].reverse().find((m) => m.text !== '')
  if (!last) return ''
  return oneLine(plainText(last.text).replace(/\*\*/g, '').replace(/__/g, ''), 90)
}

export const orderThreads = (a: AssistantThread, b: AssistantThread): number => (Number(b.pinned) - Number(a.pinned)) || b.updated.localeCompare(a.updated)

export class AssistantStore {
  /** `<datos>/Assistant` (el almacén de adjuntos y de objetivos es siempre este). */
  readonly root: string
  /** Curso del tutor (undefined = chat global). */
  readonly courseID?: string
  private readonly chatsFolder?: string

  constructor(root: string, course?: PackStore) {
    this.root = root
    if (course) {
      this.courseID = course.id
      this.chatsFolder = course.chatsDirectory
    }
  }

  get threadsDirectory(): string { return this.chatsFolder ?? join(this.root, 'threads') }
  get indexPath(): string { return join(this.threadsDirectory, '.index.json') }
  private get filesLibrary(): Library { return new Library(this.root, { recordsHistory: false }) }

  safe(id: string): string { return IDs.slug(id, 64) }
  path(id: string): string { return join(this.threadsDirectory, `${this.safe(id)}.json`) }

  private jsonFiles(): string[] {
    try {
      return readdirSync(this.threadsDirectory).filter((n) => n.endsWith('.json') && !n.startsWith('.')).map((n) => join(this.threadsDirectory, n))
    } catch {
      return []
    }
  }

  /** Lee una conversación; las del tutor con el formato anterior se convierten. */
  load(path: string): AssistantThread | undefined {
    const read = readWithBackup(path, (text) => {
      const v = JSON.parse(text) as unknown
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('no es una conversación')
      return v
    })
    if (!read) return undefined
    if (read.fromBackup) log.warn(`Chat: ${path.slice(this.threadsDirectory.length + 1)} estaba dañada; uso su versión anterior`)
    const raw = read.value
    const t = this.courseID && isLegacyTutor(raw) ? convertLegacyTutor(raw as Record<string, unknown>, this.courseID, tr('Basado en', 'Based on')) : decodeThread(raw)
    if (this.courseID) t.courseID = this.courseID
    else if (t.courseID) delete t.courseID
    return t
  }

  /** Todas las conversaciones completas (pruebas y herramientas; la lista usa `summaries()`). */
  threads(): AssistantThread[] {
    return this.jsonFiles().flatMap((p) => { const t = this.load(p); return t ? [t] : [] }).sort(orderThreads)
  }

  thread(id: string): AssistantThread | undefined {
    return this.load(this.path(id))
  }

  save(thread: AssistantThread, touch = true): void {
    const t = { ...thread }
    if (touch) t.updated = new Date().toISOString()
    if (this.courseID) t.courseID = this.courseID
    mkdirSync(this.threadsDirectory, { recursive: true })
    writeFileAtomic(this.path(t.id), json(encodeThread(t)), { backup: true })
  }

  /** Borra la conversación (y su versión anterior) y sus archivos adjuntos. */
  delete(id: string): void {
    rmSync(this.path(id), { force: true })
    rmSync(backupPath(this.path(id)), { force: true })
    rmSync(this.filesLibrary.packDirectory(this.safe(id)), { recursive: true, force: true })
    this.clearPartial(id)
  }

  /** Copia ligera de una conversación (para la lista): el primer mensaje del estudiante, el último con texto y los que llevan
   * botones que aún se pueden pulsar (mensajes automáticos). */
  static light(t: AssistantThread): AssistantThread {
    const stripped = (m: AssistantMessage): AssistantMessage => newMessage(m.role, Array.from(m.text).slice(0, 600).join(''), { id: m.id, date: m.date })
    const keep: AssistantMessage[] = []
    const first = t.messages.find((m) => m.role === 'user')
    if (first) keep.push(stripped(first))
    const actionable = t.messages.filter((m) => m.cards.some((c) => (c.kind === 'actions' || c.kind === 'automation') && c.state === 'pending')).slice(-50)
    for (const m of actionable) {
      if (!keep.some((k) => k.id === m.id)) keep.push(newMessage(m.role, '', { id: m.id, date: m.date, cards: m.cards.filter((c) => c.kind === 'actions' || c.kind === 'automation') }))
    }
    const last = [...t.messages].reverse().find((m) => m.text !== '')
    if (last && !keep.some((k) => k.id === last.id)) keep.push(stripped(last))
    return { ...t, messages: keep }
  }

  /** Conversaciones ligeras para la lista, con un índice por fecha de archivo: con cientos solo se relee lo que cambió. */
  summaries(): AssistantThread[] {
    const files = this.jsonFiles()
    let index: Record<string, IndexEntry> = {}
    try {
      const raw = JSON.parse(readFileSync(this.indexPath, 'utf8')) as Record<string, { stamp?: unknown; thread?: unknown }>
      for (const [k, v] of Object.entries(raw)) if (typeof v?.stamp === 'number' && v.thread) index[k] = { stamp: v.stamp, thread: decodeThread(v.thread) }
    } catch {
      index = {}
    }
    let changed = false
    const out: AssistantThread[] = []
    const alive = new Set<string>()
    for (const path of files) {
      const name = path.slice(this.threadsDirectory.length + 1, -5)
      alive.add(name)
      let stamp = 0
      try { stamp = statSync(path).mtimeMs } catch { continue }
      const e = index[name]
      if (e && e.stamp === stamp) {
        if (this.courseID) e.thread.courseID = this.courseID
        out.push(e.thread)
        continue
      }
      const full = this.load(path)
      if (!full) continue
      const light = AssistantStore.light(full)
      index[name] = { stamp, thread: light }
      changed = true
      out.push(light)
    }
    for (const k of Object.keys(index)) if (!alive.has(k)) { delete index[k]; changed = true }
    if (changed) {
      try {
        const enc: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(index)) enc[k] = { stamp: v.stamp, thread: encodeThread(v.thread) }
        // un índice se rehace: sin forzar a disco
        writeFileAtomic(this.indexPath, json(enc, false), { durable: false })
      } catch (err) {
        log.debug('Chat: no se pudo guardar el índice', err)
      }
    }
    return out.sort(orderThreads)
  }

  // MARK: Respuesta en curso (si la app se cierra a mitad, no se pierde lo que ya había llegado)

  partialPath(threadID: string): string { return join(this.threadsDirectory, `.partial-${this.safe(threadID)}.draft`) }

  /** Guarda lo que ya ha llegado de la respuesta en curso (archivo oculto y con otra extensión: nadie lo confunde con una conversación). */
  savePartial(threadID: string, after: string, message: AssistantMessage): void {
    try {
      mkdirSync(this.threadsDirectory, { recursive: true })
      writeFileAtomic(this.partialPath(threadID), json({ threadID, after, message: encodeMessage(message) }, false))
    } catch (err) {
      log.debug('Chat: no se pudo guardar la respuesta en curso', err)
    }
  }

  clearPartial(threadID: string): void {
    rmSync(this.partialPath(threadID), { force: true })
  }

  /** Al abrir: lo que quedó a medias pasa a su conversación como «Respuesta interrumpida», solo si la conversación sigue justo donde
   * estaba (así nunca se duplica una respuesta que sí llegó a guardarse). Devuelve las conversaciones recuperadas. */
  recoverInterrupted(): string[] {
    let names: string[]
    try { names = readdirSync(this.threadsDirectory).filter((n) => n.startsWith('.partial-') && n.endsWith('.draft')) } catch { return [] }
    const out: string[] = []
    for (const name of names) {
      const path = join(this.threadsDirectory, name)
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<PartialReply>
        const t = typeof raw.threadID === 'string' ? this.thread(raw.threadID) : undefined
        const m = decodeMessage(raw.message)
        if (!t || !m || t.messages.at(-1)?.id !== raw.after) continue
        if (!m.text.trim() && !m.cards.length) continue
        if (t.messages.some((x) => x.id === m.id)) continue
        m.interrupted = true
        expirePending(m)
        t.messages.push(m)
        this.save(t, false)
        out.push(t.id)
      } catch {
        /* borrador ilegible */
      } finally {
        rmSync(path, { force: true })
      }
    }
    return out
  }

  // MARK: Archivos adjuntos

  /** Almacén de los adjuntos de una conversación (lo crea si hace falta). */
  files(threadID: string): PackStore {
    const lib = this.filesLibrary
    const id = this.safe(threadID)
    const open = lib.openPack(id)
    if (open) return open
    const store = new PackStore(id, lib.packDirectory(id))
    store.createLayout()
    if (!existsSync(store.packPath)) store.savePack(makePack({ id, title: tr('Archivos de la conversación', 'Conversation files'), icon: 'paperclip' }), { touch: false })
    return store
  }

  /** El almacén de adjuntos SIN crearlo (para leer: si no hay nada, las herramientas lo dicen y no queda una carpeta vacía). */
  filesHandle(threadID: string): PackStore {
    const lib = this.filesLibrary
    const id = this.safe(threadID)
    return lib.openPack(id) ?? new PackStore(id, lib.packDirectory(id))
  }

  hasFiles(threadID: string): boolean {
    const s = this.filesLibrary.openPack(this.safe(threadID))
    if (!s) return false
    try {
      return s.loadPack().sources.length > 0 || (existsSync(s.assetsDirectory) && readdirSync(s.assetsDirectory).length > 0)
    } catch {
      return false
    }
  }

  /** Quita el texto de un adjunto descartado (así no acaba como material de un curso creado desde el chat). */
  discard(a: AssistantAttachment, threadID: string): void {
    const s = this.filesLibrary.openPack(this.safe(threadID))
    if (!s || !a.sourceID) return
    try { s.removeSource(a.sourceID) } catch { /* ya no estaba */ }
  }
}
