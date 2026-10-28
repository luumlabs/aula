// Memoria · disco (port de MemoryStore.swift). `<datos>/Memory/` (0700; cada archivo 0600, como la app Swift):
//   memories.json   los recuerdos (activos, caducados y sustituidos)       { "schema": 1, "records": [...] }
//   vectors.json    sus vectores (int8 en base64) con la etiqueta del modelo { "tag": "...", "vectors": { id: b64 } }
//   state.json      interruptor, pausa, última revisión de la práctica, lo ya aprendido de cada conversación
//   pending.json    conversaciones que esperan a que Aula aprenda de ellas (sin datos con forma de secreto)
// Escrituras atómicas con fsync; `memories.json` guarda además su versión anterior (`.memories.json.bak`). Si está dañado, se
// deja una copia del dañado (`memories.json.damaged-<huella>`) y se lee la versión anterior; sin ella se empieza de cero (nunca
// se pierde el arranque). Olvidar algo lo quita también de esas copias. Varias instancias (o procesos) sobre la misma carpeta:
// cada cambio se hace con el cerrojo `.aula-lock` y releyendo antes si el archivo cambió por fuera (`recordsStamp`).
// Lo que cambia Aula (no el estudiante a mano) se apunta en el historial de cambios para poder deshacerlo.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { contentHash } from '@engine/assistant/memoryText'
import { backupPath, readWithBackup, writeFileAtomic, type AtomicWriteOptions } from '../fs'
import { log } from '../log'
import type { ChangeHistory } from '../store/history/changeHistory'
import { ChangeContext } from '../store/history/context'
import { decodeRecord, encodeRecord, type MemoryRecord } from './models'
import type { PendingConversation } from './extractor'

export interface MemoryState {
  enabled: boolean
  pausedUntil?: string
  lastPracticeScan?: string
  /** Turnos ya aprendidos de cada conversación (para no volver a leerlos). */
  learnedTurns: Record<string, number>
}

export interface VectorsFile { tag?: string; vectors: Record<string, string> }

function stringify(v: unknown, pretty = true): string {
  return JSON.stringify(v, sortedReplacer, pretty ? 2 : 0) + (pretty ? '\n' : '')
}

/** Claves ordenadas (como `sortedKeys` de Swift): así un archivo igual da los mismos bytes y el historial no apunta ruido. */
function sortedReplacer(_k: string, v: unknown): unknown {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

export class MemoryDisk {
  readonly folder: string
  history?: ChangeHistory

  constructor(folder: string, history?: ChangeHistory) {
    this.folder = folder
    this.history = history
  }

  get recordsPath(): string { return join(this.folder, 'memories.json') }
  get vectorsPath(): string { return join(this.folder, 'vectors.json') }
  get statePath(): string { return join(this.folder, 'state.json') }
  get pendingPath(): string { return join(this.folder, 'pending.json') }
  get lockPath(): string { return join(this.folder, '.aula-lock') }

  /** Huella de `memories.json` en disco (cambia con cada escritura atómica, sea de quien sea). */
  recordsStamp(): string {
    try {
      const st = statSync(this.recordsPath)
      return `${st.ino}:${st.size}:${st.mtimeMs}`
    } catch {
      return 'none'
    }
  }

  ensureFolder(): void {
    mkdirSync(this.folder, { recursive: true, mode: 0o700 })
    try { chmodSync(this.folder, 0o700) } catch { /* nada */ }
  }

  /** Escribe (null = borra, también su copia anterior) con permisos 0600. */
  writeData(data: string | Buffer | null, path: string, opts: AtomicWriteOptions = {}): void {
    this.ensureFolder()
    if (data === null) {
      rmSync(path, { force: true })
      rmSync(backupPath(path), { force: true })
      return
    }
    writeFileAtomic(path, data, { ...opts, mode: 0o600 })
    try { chmodSync(path, 0o600) } catch { /* nada */ }
  }

  private read(path: string): string | null {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  }

  // MARK: Recuerdos

  /** Lee los recuerdos de unos bytes (los recuerdos ilegibles se saltan; un archivo que no es JSON lanza). */
  decodeRecords(text: string | null): MemoryRecord[] {
    if (text === null) return []
    const raw = JSON.parse(text) as unknown
    const list = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).records : Array.isArray(raw) ? raw : undefined
    if (!Array.isArray(list)) throw new Error('memories.json sin «records»')
    return list.flatMap((r) => {
      const d = decodeRecord(r)
      return d ? [d] : []
    })
  }

  encodeRecords(records: readonly MemoryRecord[]): string {
    return stringify({ schema: 1, records: records.map(encodeRecord) })
  }

  loadRecords(): MemoryRecord[] {
    if (!existsSync(this.recordsPath) && !existsSync(backupPath(this.recordsPath))) return []
    const r = readWithBackup(this.recordsPath, (text) => this.decodeRecords(text))
    if (r?.fromBackup) log.warn('Memoria: memories.json estaba dañado; uso su versión anterior (copia del dañado al lado)')
    else if (!r && existsSync(this.recordsPath)) log.warn('Memoria: memories.json ilegible y sin versión anterior; empiezo de cero (copia del dañado al lado)')
    return r?.value ?? []
  }

  /** Guarda los recuerdos (y lo apunta en el historial si lo hace Aula). */
  saveRecords(records: readonly MemoryRecord[]): void {
    const data = this.encodeRecords(records)
    const actor = this.history ? ChangeContext.current : undefined
    const before = actor ? this.read(this.recordsPath) : null
    this.writeData(data, this.recordsPath, { backup: true })
    if (actor && this.history) {
      this.history.record({ file: this.recordsPath, before: before === null ? null : Buffer.from(before, 'utf8'), after: Buffer.from(data, 'utf8'), domain: 'memory', actor })
    }
  }

  // MARK: Vectores, estado y pendientes

  loadVectors(): VectorsFile {
    const text = this.read(this.vectorsPath)
    if (text === null) return { vectors: {} }
    try {
      const raw = JSON.parse(text) as { tag?: unknown; vectors?: unknown }
      const vectors: Record<string, string> = {}
      if (raw.vectors && typeof raw.vectors === 'object') for (const [k, v] of Object.entries(raw.vectors as Record<string, unknown>)) if (typeof v === 'string') vectors[k] = v
      return typeof raw.tag === 'string' ? { tag: raw.tag, vectors } : { vectors }
    } catch {
      return { vectors: {} }
    }
  }

  /** Los vectores se pueden recalcular: sin forzar a disco. */
  saveVectors(v: VectorsFile): void {
    this.writeData(stringify(v, false), this.vectorsPath, { durable: false })
  }

  loadState(): MemoryState {
    const text = this.read(this.statePath)
    const state: MemoryState = { enabled: true, learnedTurns: {} }
    if (text === null) return state
    try {
      const raw = JSON.parse(text) as Record<string, unknown>
      if (typeof raw.enabled === 'boolean') state.enabled = raw.enabled
      if (typeof raw.pausedUntil === 'string' && Number.isFinite(Date.parse(raw.pausedUntil))) state.pausedUntil = raw.pausedUntil
      if (typeof raw.lastPracticeScan === 'string' && Number.isFinite(Date.parse(raw.lastPracticeScan))) state.lastPracticeScan = raw.lastPracticeScan
      if (raw.learnedTurns && typeof raw.learnedTurns === 'object') {
        for (const [k, v] of Object.entries(raw.learnedTurns as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) state.learnedTurns[k] = v
      }
    } catch { /* estado por defecto */ }
    return state
  }

  saveState(s: MemoryState): void {
    this.writeData(stringify(s), this.statePath)
  }

  loadPending(): PendingConversation[] {
    const text = this.read(this.pendingPath)
    if (text === null) return []
    try {
      const raw = JSON.parse(text) as unknown
      if (!Array.isArray(raw)) return []
      return raw.flatMap((p): PendingConversation[] => {
        if (!p || typeof p !== 'object') return []
        const o = p as Record<string, unknown>
        if (typeof o.id !== 'string' || !Array.isArray(o.turns)) return []
        const turns = o.turns.flatMap((t): PendingConversation['turns'] => {
          if (!t || typeof t !== 'object') return []
          const x = t as Record<string, unknown>
          return typeof x.text === 'string' ? [{ student: x.student === true, text: x.text, date: typeof x.date === 'string' ? x.date : new Date().toISOString() }] : []
        })
        const source = ['student', 'tutor', 'assistant', 'practice', 'course'].includes(o.source as string) ? (o.source as PendingConversation['source']) : 'assistant'
        const out: PendingConversation = { id: o.id, source, turns, updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : new Date().toISOString(), attempts: typeof o.attempts === 'number' ? o.attempts : 0 }
        if (typeof o.courseID === 'string') out.courseID = o.courseID
        if (typeof o.courseTitle === 'string') out.courseTitle = o.courseTitle
        return [out]
      })
    } catch {
      return []
    }
  }

  savePending(p: readonly PendingConversation[]): void {
    if (!p.length) {
      if (existsSync(this.pendingPath)) rmSync(this.pendingPath, { force: true })
      return
    }
    this.writeData(stringify(p, false), this.pendingPath)
  }

  /**
   * Quita lo olvidado de las copias de la propia carpeta: la versión anterior (`.memories.json.bak`, que pasa a ser igual que la
   * actual) y las copias de archivos dañados que lo contengan (o todas, con «Borrar todo»). `texts` = textos olvidados.
   */
  scrubCopies(texts: readonly string[], all: boolean): void {
    const bak = backupPath(this.recordsPath)
    if (existsSync(this.recordsPath)) {
      try { writeFileAtomic(bak, readFileSync(this.recordsPath), { mode: 0o600 }) } catch { rmSync(bak, { force: true }) }
    } else rmSync(bak, { force: true })
    let names: string[] = []
    try { names = readdirSync(this.folder) } catch { return }
    // también las de antes («memories.json.ab12.damaged»)
    const damaged = names.filter((n) => /^memories\.json\.(damaged-[0-9a-f]+|.+\.damaged)$/.test(n))
    const needles = texts.flatMap((t) => [t, JSON.stringify(t).slice(1, -1)]).filter((t) => t.length >= 3)
    for (const n of damaged) {
      const path = join(this.folder, n)
      const text = all ? '' : this.read(path) ?? ''
      if (all || needles.some((x) => text.includes(x))) rmSync(path, { force: true })
    }
  }

  /** Quita los recuerdos olvidados de las copias del historial de cambios (que no quede su texto en ningún sitio). */
  redactHistory(forgotten: ReadonlySet<string>, all: boolean, forgottenHashes: ReadonlySet<string> = new Set()): void {
    const history = this.history
    if (!history || (!forgotten.size && !all)) return
    const rel = history.relative(this.recordsPath)
    if (!rel) return
    const hashes = new Set<string>()
    for (const line of history.lines()) {
      if (line.t !== 'change' || line.file !== rel) continue
      for (const h of [line.before, line.after]) if (h && h !== '-' && h !== '!') hashes.add(h)
    }
    for (const h of hashes) {
      const path = history.blobPath(h)
      const text = this.read(path)
      if (text === null) continue
      try {
        const records = this.decodeRecords(text)
        // por id y por contenido: una versión anterior del mismo recuerdo (deshecha y vuelta a guardar) tampoco se queda
        const kept = all ? [] : records.filter((r) => !forgotten.has(r.id) && !forgottenHashes.has(contentHash(r.text)))
        if (kept.length === records.length && !all) continue
        writeFileAtomic(path, this.encodeRecords(kept), 0o600)
      } catch {
        // una copia que no se entiende y podría llevar texto de recuerdos: fuera
        rmSync(path, { force: true })
      }
    }
  }
}
