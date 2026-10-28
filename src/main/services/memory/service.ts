// Memoria del estudiante · servicio (port de MemoryService.swift, adaptado de Luna). Un único camino de escritura (puerta de
// credenciales → idéntico refuerza → misma clave actualiza → casi idéntico se fusiona → una corrección sustituye sin borrar →
// nuevo), caducidad de lo perecedero, búsqueda híbrida (vectores opcionales + palabras), inyección compacta y el repaso al cerrar
// una conversación. Todo vive en `<datos>/Memory/`. Sin modelo de vectores (`Embedder`), busca y deduplica por palabras.
// Cada cambio se hace con el cerrojo de la carpeta y releyendo antes si otro proceso (u otra instancia) cambió el archivo: nunca
// se pisa lo que escribió otro. Lo que llega a la IA pasa otra vez por la puerta de credenciales (como `_model_safe_row` de
// Luna): un recuerdo antiguo con forma de clave se ve y se edita en el panel, pero nunca sale hacia el modelo.
import { readFileSync } from 'node:fs'
import { contentHash, isCorrection, isPerishable, lexicalSimilarity, mergeDecision, cleanText, cosine, decodeVector, encodeVector, privacyCheck, redactForExtraction, secretReason, sensitiveReason } from '@engine/assistant'
import { tr } from '@shared/ai/i18n'
import { settingsPath } from '@shared/settings/sections'
import type { ChatModel } from '../ai/model'
import { withAIUse } from '../costs'
import type { Embedder } from '../search/hybrid'
import type { ChangeHistory, HistoryFileHost } from '../store/history/changeHistory'
import { ChangeContext } from '../store/history/context'
import type { Library } from '../store/library'
import { withFileLock } from '../store/lock'
import { log } from '../log'
import { MemoryDisk, type MemoryState } from './disk'
import { runExtraction, parseDay, type PendingConversation } from './extractor'
import {
  isActive, isCoreKind, isMultiValued, isSaved, matchesSearch, modelSafe, newRecordID, purposeCourse, type MemoryConversation, type MemoryDraft, type MemoryHit, type MemoryKind,
  type MemoryPurpose, type MemoryRecord, type MemoryWriteResult
} from './models'
import { assembleMemory } from './prompts'
import { diversify, rankMemories, recency } from './ranker'
import { deriveInsights, PRACTICE_KEY_PREFIX } from './practice'

export class MemoryError extends Error {
  constructor(readonly code: 'secret' | 'empty' | 'not_found', message: string) {
    super(message)
    this.name = 'MemoryError'
  }
}

export interface MemoryServiceOptions {
  folder: string
  /** Para deducir de la práctica (sin ella, no). */
  library?: Library
  /** Vectores opcionales (EmbeddingGemma…); sin él, la memoria busca por palabras. */
  embedder?: Embedder | (() => Embedder | undefined)
  /** La IA con la que aprende al cerrar una conversación (undefined = no aprende). */
  model?: () => Promise<ChatModel | undefined>
  /** Silencio tras el que una conversación se da por terminada (8 min). */
  idleDelayMs?: number
  history?: ChangeHistory
  clock?: () => Date
}

type WriteIntent = 'requested' | 'automatic' | 'legacyPractice'
const protectsStudentEdits = (i: WriteIntent): boolean => i !== 'requested'

/** Lo caducado o sustituido se borra del todo pasado este tiempo. */
const RETENTION_MS = 60 * 86_400_000
/** Tope de recuerdos (los más viejos y menos usados salen primero). */
const CAPACITY = 600
const PRACTICE_INTERVAL_MS = 30 * 60_000
/** Conversaciones pendientes de aprender: como mucho estas, y ninguna más vieja que esto (sin IA no se acumulan sin fin). */
const PENDING_MAX = 40
const PENDING_MAX_AGE_MS = 30 * 86_400_000
/** Lo que se guarda de cada turno pendiente (para aprender basta con eso). */
const PENDING_TURN_CHARS = 4000
/** Conversaciones de las que se recuerda cuánto se aprendió. */
const LEARNED_MAX = 2000

/** Mensajes que no piden nada que buscar («ok», «gracias», «vale»): no se buscan recuerdos «relevantes» para ellos. */
export function isTrivialQuery(q: string): boolean {
  const t = q.trim().toLowerCase().replace(/[.!?¡¿,;:…\s]+/g, ' ').trim()
  if (Array.from(t).length < 4) return true
  return /^(ok|okay|okey|vale|va|gracias|muchas gracias|thanks|thank you|thx|si|sí|no|yes|yep|nope|perfecto|genial|bien|de acuerdo|entendido|listo|hecho|claro|cool|nice|great|got it|sounds good)( (gracias|thanks))?$/.test(t)
}

export class MemoryService implements HistoryFileHost {
  readonly folder: string
  readonly disk: MemoryDisk
  private readonly library?: Library
  private readonly embedderSource?: Embedder | (() => Embedder | undefined)
  private readonly modelSource?: () => Promise<ChatModel | undefined>
  private readonly idleDelayMs: number
  private readonly clock: () => Date
  private all: MemoryRecord[] = []
  private vectors = new Map<string, number[]>()
  private vectorTag?: string
  private state: MemoryState
  private pending = new Map<string, PendingConversation>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private learning = new Set<string>()
  private listeners = new Set<() => void>()
  private practiceRunning = false
  private backfillRunning = false
  /** Sube con «Borrar todo», al apagar o pausar y al descartar: lo que una extracción en curso traiga después no se guarda. */
  private generation = 0
  /** Huella de `memories.json` la última vez que se leyó o escribió desde aquí. */
  private diskStamp = ''

  constructor(opts: MemoryServiceOptions) {
    this.folder = opts.folder
    this.library = opts.library
    this.embedderSource = opts.embedder
    this.modelSource = opts.model
    this.idleDelayMs = opts.idleDelayMs ?? 8 * 60_000
    this.clock = opts.clock ?? (() => new Date())
    this.disk = new MemoryDisk(opts.folder, opts.history)
    if (opts.history) opts.history.registerHost(this.disk.recordsPath, this)
    this.state = this.disk.loadState()
    this.reload()
    for (const p of this.disk.loadPending()) this.pending.set(p.id, p)
    if (this.trimPending()) this.disk.savePending([...this.pending.values()])
    try {
      this.mutate(() => { if (this.purgeOld(this.clock())) this.persistRecords(true) })
    } catch (err) {
      log.warn('Memoria: no pude ordenar lo caducado', err)
    }
  }

  /** Si `memories.json` cambió por fuera (otro proceso, otra instancia, a mano), se relee. */
  private syncFromDisk(): void {
    if (this.disk.recordsStamp() !== this.diskStamp) this.reload()
  }

  /** Un cambio de los recuerdos: con el cerrojo de la carpeta y sobre lo último que hay en disco. */
  private mutate<T>(body: () => T): T {
    this.disk.ensureFolder()
    return withFileLock(this.disk.lockPath, () => {
      this.syncFromDisk()
      return body()
    })
  }

  private reload(): void {
    this.diskStamp = this.disk.recordsStamp()
    this.all = this.disk.loadRecords()
    const vf = this.disk.loadVectors()
    this.vectorTag = vf.tag
    const ids = new Set(this.all.map((r) => r.id))
    this.vectors = new Map()
    for (const [k, v] of Object.entries(vf.vectors)) {
      const d = ids.has(k) ? decodeVector(v) : undefined
      if (d) this.vectors.set(k, d)
    }
  }

  private get embedder(): Embedder | undefined {
    const e = this.embedderSource
    return typeof e === 'function' ? e() : e
  }

  // MARK: Estado

  get isEnabled(): boolean { return this.state.enabled }

  get pausedUntil(): Date | undefined {
    const p = this.state.pausedUntil ? Date.parse(this.state.pausedUntil) : NaN
    return Number.isFinite(p) && p > this.clock().getTime() ? new Date(p) : undefined
  }

  get isLearning(): boolean { return this.isEnabled && this.pausedUntil === undefined }

  setEnabled(on: boolean): void {
    if (this.state.enabled === on) return
    this.state.enabled = on
    if (!on) this.dropPending()
    this.disk.saveState(this.state)
    this.notify()
  }

  /** `until` undefined reanuda; una fecha muy lejana = hasta que el estudiante la reanude. */
  pause(until: Date | undefined): void {
    if (until) this.state.pausedUntil = until.toISOString()
    else delete this.state.pausedUntil
    // lo que estaba por aprender tampoco se aprende: quien pausa no quiere que se apunte lo de ahora
    if (until) this.dropPending()
    this.disk.saveState(this.state)
    this.notify()
  }

  private dropPending(): void {
    this.generation++
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    for (const [id, p] of this.pending) this.state.learnedTurns[id] = p.turns.length
    this.pending.clear()
    this.disk.savePending([])
  }

  // MARK: Ver y gestionar

  records(includeInactive = false): MemoryRecord[] {
    this.syncFromDisk()
    const now = this.clock()
    return this.all.filter((r) => includeInactive || isActive(r, now)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((r) => ({ ...r }))
  }

  /** Lo que coincide con el buscador del panel (todas las palabras, sin acentos). */
  filter(query: string, includeInactive = true): MemoryRecord[] {
    return this.records(includeInactive).filter((r) => matchesSearch(r, query))
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify(): void {
    for (const fn of [...this.listeners]) {
      try { fn() } catch (err) { log.warn('Memoria: aviso', err) }
    }
  }

  private persistRecords(suppress = false): void {
    if (suppress) ChangeContext.suppress(() => this.disk.saveRecords(this.all))
    else this.disk.saveRecords(this.all)
    this.diskStamp = this.disk.recordsStamp()
  }

  private saveVectors(): void {
    const vectors: Record<string, string> = {}
    for (const [k, v] of this.vectors) vectors[k] = encodeVector(v)
    this.disk.saveVectors(this.vectorTag ? { tag: this.vectorTag, vectors } : { vectors })
  }

  /** Corrige un recuerdo (lo escribe el estudiante: queda como suyo y lo automático no lo pisa). */
  async edit(id: string, text: string, kind?: MemoryKind): Promise<MemoryRecord> {
    const clean = cleanText(text)
    if (Array.from(clean).length < 2) throw new MemoryError('empty', tr('Escribe algo que Aula deba recordar.', 'Write something Aula should remember.'))
    const why = secretReason(clean)
    if (why) throw new MemoryError('secret', secretMessage(why))
    const out = this.mutate(() => {
      const r = this.all.find((x) => x.id === id)
      if (!r) throw new MemoryError('not_found', tr('Ese recuerdo ya no existe.', 'That memory no longer exists.'))
      if (r.text !== clean) this.vectors.delete(id)
      r.text = clean
      if (kind) r.kind = kind
      r.editedByStudent = true
      r.confidence = 1
      r.updatedAt = this.clock().toISOString()
      r.sensitive = sensitiveReason(clean) !== undefined
      this.persistRecords()
      return { ...r }
    })
    this.notify()
    this.scheduleBackfill()
    return out
  }

  /** Olvida para siempre (también su vector y sus copias en el historial). No se apunta en el historial: es irreversible. */
  forget(ids: readonly string[]): string[] {
    if (!ids.length) return []
    return this.erase(new Set(ids), false)
  }

  forgetAll(): string[] {
    return this.erase(new Set(), true)
  }

  private erase(ids: Set<string>, everything: boolean): string[] {
    this.generation++
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    const out = this.mutate(() => this.eraseLocked(ids, everything))
    this.notify()
    return out
  }

  private eraseLocked(ids: Set<string>, everything: boolean): string[] {
    const live = new Set(this.all.map((r) => r.id))
    const selected = everything ? live : new Set([...ids].filter((id) => live.has(id)))
    const texts = this.all.filter((r) => selected.has(r.id)).map((r) => r.text)
    const hashes = new Set(texts.map((t) => contentHash(t)))
    this.all = everything ? [] : this.all.filter((r) => !selected.has(r.id))
    // lo que sustituían ya no está: vuelven a contar los sustituidos por ellos
    for (const r of this.all) if (r.supersededBy && selected.has(r.supersededBy)) { delete r.supersededBy; delete r.supersededAt }
    for (const id of selected) this.vectors.delete(id)
    if (everything) {
      this.vectors.clear()
      this.pending.clear()
      this.disk.savePending([])
    }
    ChangeContext.suppress(() => {
      if (everything) this.disk.writeData(null, this.disk.recordsPath)
      else this.disk.saveRecords(this.all)
    })
    this.diskStamp = this.disk.recordsStamp()
    this.saveVectors()
    try {
      this.disk.scrubCopies(texts, everything)
    } catch (err) {
      log.warn('Memoria: no se pudieron limpiar las copias de la carpeta', err)
    }
    try {
      this.disk.redactHistory(selected, everything, hashes)
    } catch (err) {
      log.warn('Memoria: no se pudieron limpiar las copias del historial', err)
    }
    return [...selected].sort()
  }

  /** Devuelve a la memoria activa un recuerdo caducado o sustituido. */
  restore(id: string): void {
    const done = this.mutate(() => {
      const r = this.all.find((x) => x.id === id)
      if (!r) return false
      const now = this.clock()
      delete r.supersededBy
      delete r.supersededAt
      if (r.expiresAt && Date.parse(r.expiresAt) <= now.getTime()) delete r.expiresAt
      r.updatedAt = now.toISOString()
      this.persistRecords()
      return true
    })
    if (done) this.notify()
  }

  /** Todo lo que Aula recuerda (para «Exportar»), sin vectores. */
  exportJSON(): string {
    return JSON.stringify({ exportedAt: this.clock().toISOString(), records: this.records(true) }, null, 2) + '\n'
  }

  // MARK: Escribir (el único camino)

  async remember(draft: MemoryDraft): Promise<MemoryWriteResult> {
    // `.practice` protegía las ediciones del estudiante antes de separar la intención (compatibilidad con Swift)
    return this.write(draft, draft.source === 'practice' ? 'legacyPractice' : 'requested', this.generation)
  }

  private async write(draft: MemoryDraft, intent: WriteIntent, generation: number): Promise<MemoryWriteResult> {
    const now = this.clock()
    if (!this.isEnabled) return result('disabled', tr(`La memoria está apagada en ${settingsPath('memory', 'es')}.`, `Memory is turned off in ${settingsPath('memory', 'en')}.`))
    if (draft.source !== 'student' && this.pausedUntil) return result('paused', tr('El aprendizaje está en pausa: no se guardó.', 'Learning is paused: nothing was saved.'))
    const text = cleanText(draft.text)
    if (Array.from(text).length < 3) return result('rejectedEmpty', tr('Escribe algo que Aula deba recordar.', 'Write something Aula should remember.'))
    let sensitive = false
    const verdict = privacyCheck(text)
    if (verdict.kind === 'secret') return result('rejectedSecret', secretMessage(verdict.why))
    if (verdict.kind === 'sensitive' || draft.sensitive) {
      if (!draft.confirmedByStudent && draft.source !== 'student') {
        return result('rejectedSensitive', verdict.kind === 'sensitive' ? tr(`No se guardó sin tu permiso: ${verdict.why}`, `Not saved without your permission: ${verdict.why}`)
          : tr('No se guardó sin tu permiso: es un dato delicado.', 'Not saved without your permission: it is sensitive.'))
      }
      sensitive = true
    }
    const expires = draft.expiresAt ?? defaultExpiry(draft.kind, text, now)
    const vec = await this.embedOne(text, 'document')
    if (generation !== this.generation) return result('cancelled', tr('La memoria cambió mientras tanto: no se guardó.', 'Memory changed meanwhile: nothing was saved.'))
    let r: MemoryWriteResult
    try {
      r = this.mutate(() => {
        const before = this.all.map((x) => ({ ...x }))
        const out = this.writeLocked(draft, intent, text, sensitive, expires, vec, now)
        if (!isSaved(out)) return out
        this.enforceCapacity()
        try {
          this.persistRecords()
        } catch (err) {
          this.all = before
          return result('failed', err instanceof Error ? err.message : String(err))
        }
        return out
      })
    } catch (err) {
      return result('failed', err instanceof Error ? err.message : String(err))
    }
    if (isSaved(r)) {
      this.saveVectors()
      this.notify()
      if (!vec) this.scheduleBackfill()
    }
    return r
  }

  private writeLocked(draft: MemoryDraft, intent: WriteIntent, text: string, sensitive: boolean, expires: string | undefined, vector: number[] | undefined, now: Date): MemoryWriteResult {
    const hash = contentHash(text)
    const nowISO = now.toISOString()
    const confidence = Math.min(1, draft.confidence ?? 0.8)
    // una propuesta automática no cambia una ficha del estudiante ni crea otra versión del mismo hecho junto a ella
    if (protectsStudentEdits(intent)) {
      const protectedRec = this.protectedRecord(draft, text, hash, vector, now)
      if (protectedRec) return { status: 'cancelled', record: { ...protectedRec }, replaced: [], message: '' }
    }
    // 1) exactamente lo mismo: refuerza (y si estaba caducado o sustituido, vuelve: lo último que se dice manda)
    const same = this.all.find((r) => contentHash(r.text) === hash)
    if (same) {
      const wasInactive = !isActive(same, now)
      if (draft.source === 'student') same.editedByStudent = true
      same.confirmations += 1
      same.confidence = Math.max(same.confidence, confidence)
      same.updatedAt = nowISO
      if (expires) same.expiresAt = !same.expiresAt || Date.parse(expires) > Date.parse(same.expiresAt) ? expires : same.expiresAt
      else if (wasInactive) delete same.expiresAt
      let replaced: MemoryRecord[] = []
      if (same.supersededBy !== undefined) {
        delete same.supersededBy
        delete same.supersededAt
        replaced = this.supersedeCorrected(same, intent, vector ?? this.vectors.get(same.id), now)
      }
      if (!this.vectors.has(same.id) && vector) this.vectors.set(same.id, vector)
      return { status: 'reinforced', record: { ...same }, replaced, message: tr('Ya lo sabía: lo he reforzado.', 'I already knew it: I reinforced it.') }
    }
    // 2) misma clave: es la versión nueva del mismo hecho
    const byKey = draft.key ? this.all.find((r) => r.key === draft.key && isActive(r, now)) : undefined
    if (byKey) {
      const old = { ...byKey }
      byKey.text = text
      byKey.kind = draft.kind
      byKey.updatedAt = nowISO
      byKey.confidence = confidence
      if (expires) byKey.expiresAt = expires
      else delete byKey.expiresAt
      byKey.sensitive = sensitive
      if (!old.editedByStudent) byKey.source = draft.source
      if (draft.courseID) byKey.courseID = draft.courseID
      if (draft.courseTitle) byKey.courseTitle = draft.courseTitle
      if (draft.source === 'student') byKey.editedByStudent = true
      if (vector) this.vectors.set(byKey.id, vector)
      else this.vectors.delete(byKey.id)
      return { status: 'updated', record: { ...byKey }, replaced: old.text === text ? [] : [old], message: tr('Actualizado.', 'Updated.') }
    }
    // 3) casi idéntico: se fusiona; una corrección sustituye al viejo
    const candidates = this.all.filter((r) => isActive(r, now)).map((r) => {
      const ov = this.vectors.get(r.id)
      const sem = vector && ov ? cosine(vector, ov) : undefined
      return { r, sem, lex: lexicalSimilarity(text, r.text) }
    }).sort((a, b) => (b.sem ?? b.lex) - (a.sem ?? a.lex)).slice(0, 6)
    for (const { r, sem, lex } of candidates) {
      // del mismo tipo (o casi el mismo texto con otra etiqueta): un parecido solo de vectores no cruza tipos
      const sameKind = r.kind === draft.kind || lex >= 0.95
      const keep = sameKind ? mergeDecision(text, r.text, sem, lex) : undefined
      if (keep === undefined) continue
      if (draft.source === 'student') r.editedByStudent = true
      if (keep !== r.text) {
        r.text = keep
        if (keep === text && vector) this.vectors.set(r.id, vector)
      }
      r.confirmations += 1
      r.confidence = Math.max(r.confidence, confidence)
      r.updatedAt = nowISO
      if (expires) r.expiresAt = expires
      if (draft.key && !r.key) r.key = draft.key
      return { status: 'merged', record: { ...r }, replaced: [], message: tr('Lo junté con algo casi igual que ya sabía.', 'I merged it with something almost identical I already knew.') }
    }
    // 4) nuevo
    const rec: MemoryRecord = {
      id: newRecordID(), kind: draft.kind, text, source: draft.source, confidence: Math.min(1, Math.max(0.1, draft.confidence ?? 0.8)), createdAt: nowISO, updatedAt: nowISO,
      uses: 0, confirmations: 0, sensitive, editedByStudent: draft.source === 'student'
    }
    if (draft.key) rec.key = draft.key
    if (draft.courseID) rec.courseID = draft.courseID
    if (draft.courseTitle) rec.courseTitle = draft.courseTitle
    if (draft.conversationID) rec.conversationID = draft.conversationID
    if (expires) rec.expiresAt = expires
    this.all.push(rec)
    if (vector) this.vectors.set(rec.id, vector)
    const replaced = intent === 'legacyPractice' ? [] : this.supersedeCorrected(rec, intent, vector, now)
    return {
      status: 'created', record: { ...rec }, replaced,
      message: replaced.length ? tr('Guardado; sustituye a lo que sabía antes.', 'Saved; it replaces what I knew before.') : tr('Guardado.', 'Saved.')
    }
  }

  /** Una propuesta automática no cambia una ficha del estudiante (se recorren todas las protegidas). */
  private protectedRecord(draft: MemoryDraft, text: string, hash: string, vector: number[] | undefined, now: Date): MemoryRecord | undefined {
    for (const rec of this.all) {
      if (!rec.editedByStudent) continue
      if (contentHash(rec.text) === hash) return rec
      if (!isActive(rec, now)) continue
      if (draft.key && rec.key === draft.key) return rec
      const ov = this.vectors.get(rec.id)
      const sem = vector && ov ? cosine(vector, ov) : undefined
      const lex = lexicalSimilarity(text, rec.text)
      if ((rec.kind === draft.kind || lex >= 0.95) && mergeDecision(text, rec.text, sem, lex) !== undefined) return rec
      if (rec.kind === draft.kind && isCorrection(text, rec.text, sem, lex, isMultiValued(rec.kind))) return rec
    }
    return undefined
  }

  /** Marca como sustituidos los recuerdos que `rec` corrige (mismo tipo, mismo hecho, dato distinto o polaridad contraria). */
  private supersedeCorrected(rec: MemoryRecord, intent: WriteIntent, vector: number[] | undefined, now: Date): MemoryRecord[] {
    const out: MemoryRecord[] = []
    for (const r of this.all) {
      if (r.id === rec.id || r.kind !== rec.kind || !isActive(r, now)) continue
      if (protectsStudentEdits(intent) && r.editedByStudent) continue
      const ov = this.vectors.get(r.id)
      const sem = vector && ov ? cosine(vector, ov) : undefined
      const lex = lexicalSimilarity(rec.text, r.text)
      if (!isCorrection(rec.text, r.text, sem, lex, isMultiValued(rec.kind))) continue
      out.push({ ...r })
      r.supersededBy = rec.id
      r.supersededAt = now.toISOString()
    }
    return out
  }

  /** Por encima del tope sale lo inactivo más viejo y, después, lo activo menos útil (nunca lo que escribió el estudiante). */
  private enforceCapacity(): void {
    if (this.all.length <= CAPACITY) return
    const now = this.clock()
    const keepScore = (r: MemoryRecord): number => (isActive(r, now) ? 10 : 0) + (r.editedByStudent ? 100 : 0) + recency(r.lastUsedAt ?? r.updatedAt, now) + r.confidence + Math.min(r.uses, 10) / 10
    const drop = new Set([...this.all].sort((a, b) => keepScore(a) - keepScore(b)).slice(0, this.all.length - CAPACITY).map((r) => r.id))
    this.all = this.all.filter((r) => !drop.has(r.id))
    for (const id of drop) this.vectors.delete(id)
  }

  /** Borra del todo lo caducado o sustituido hace mucho. Devuelve si cambió algo. */
  private purgeOld(now: Date): boolean {
    const before = this.all.length
    this.all = this.all.filter((r) => {
      const s = r.supersededAt ? Date.parse(r.supersededAt) : NaN
      if (Number.isFinite(s) && now.getTime() - s > RETENTION_MS) return false
      const e = r.expiresAt ? Date.parse(r.expiresAt) : NaN
      if (Number.isFinite(e) && now.getTime() - e > RETENTION_MS) return false
      return true
    })
    const ids = new Set(this.all.map((r) => r.id))
    for (const k of [...this.vectors.keys()]) if (!ids.has(k)) this.vectors.delete(k)
    return this.all.length !== before
  }

  // MARK: Vectores

  private async embedOne(text: string, role: 'document' | 'query'): Promise<number[] | undefined> {
    const e = this.embedder
    if (!e) return undefined
    // otro modelo: los vectores viejos no sirven (se recalculan en segundo plano)
    if (this.vectorTag !== e.modelID) {
      this.vectors.clear()
      this.vectorTag = e.modelID
    }
    try {
      const [v] = await e.embed([text], role)
      return v && v.length ? Array.from(v) : undefined
    } catch {
      return undefined
    }
  }

  private scheduleBackfill(): void {
    if (!this.embedder || this.backfillRunning) return
    this.backfillRunning = true
    void this.backfill().finally(() => { this.backfillRunning = false })
  }

  /** Calcula los vectores que falten (recuerdos nuevos sin modelo, otro modelo…). */
  async backfill(limit = 128): Promise<void> {
    const e = this.embedder
    if (!e) return
    if (this.vectorTag !== e.modelID) { this.vectors.clear(); this.vectorTag = e.modelID }
    const missing = this.all.filter((r) => !this.vectors.has(r.id)).slice(0, limit).map((r) => [r.id, r.text] as const)
    let done = 0
    for (let i = 0; i < missing.length; i += 32) {
      const chunk = missing.slice(i, i + 32)
      let vs: Float32Array[]
      try { vs = await e.embed(chunk.map((c) => c[1]), 'document') } catch { break }
      if (vs.length !== chunk.length) break
      chunk.forEach(([id, text], k) => {
        if (this.all.some((r) => r.id === id && r.text === text)) { this.vectors.set(id, Array.from(vs[k])); done++ }
      })
    }
    if (done > 0) this.saveVectors()
  }

  private async ensureVectors(queryVector: number[] | undefined): Promise<void> {
    if (!queryVector) return
    const missing = this.all.filter((r) => !this.vectors.has(r.id)).length
    if (!missing) return
    if (missing <= 32) await this.backfill(32)
    else this.scheduleBackfill()
  }

  // MARK: Buscar e inyectar

  /** Búsqueda híbrida: significado (si hay vectores) + palabras + recencia + confianza. */
  /** Para la IA (herramienta `memory_search`): solo lo que puede llegar al modelo, variado (sin cinco frases iguales). */
  async search(query: string, limit = 8, kinds?: ReadonlySet<MemoryKind>): Promise<MemoryHit[]> {
    const q = query.trim()
    if (!this.isEnabled || !q) return []
    const qv = await this.embedOne(Array.from(q).slice(0, 2000).join(''), 'query')
    await this.ensureVectors(qv)
    this.syncFromDisk()
    const now = this.clock()
    const recs = this.all.filter((r) => isActive(r, now) && modelSafe(r) && (!kinds || kinds.has(r.kind)))
    const hits = diversify(rankMemories(q, recs, this.vectors, qv, now), this.vectors, Math.max(1, limit))
    this.markUsed(hits.map((h) => h.record.id))
    return hits.map((h) => ({ ...h, record: { ...h.record } }))
  }

  /** Lo activo que puede llegar a la IA (para listarlo en `memory_search` sin consulta). */
  modelRecords(): MemoryRecord[] {
    return this.records(false).filter(modelSafe)
  }

  /** Bloque compacto para el prompt de la IA (lo esencial + lo relevante para `query` + exámenes próximos). "" si no hay nada. */
  async context(query: string, purpose: MemoryPurpose, budget: number): Promise<string> {
    if (!this.isEnabled) return ''
    this.refreshPracticeIfStale()
    const q = query.trim()
    const qv = q ? await this.embedOne(Array.from(q).slice(0, 2000).join(''), 'query') : undefined
    await this.ensureVectors(qv)
    return this.assemble(q, purpose, budget, qv)
  }

  /** Igual, sin esperar a los vectores (solo palabras): para quien no puede esperar (crear un curso). */
  briefing(query: string, purpose: MemoryPurpose, budget: number): string {
    if (!this.isEnabled) return ''
    return this.assemble(query, purpose, budget, undefined)
  }

  private assemble(query: string, purpose: MemoryPurpose, budget: number, queryVector: number[] | undefined): string {
    this.syncFromDisk()
    const now = this.clock()
    // nunca hacia el modelo: lo que tenga forma de clave (aunque sea de antes de la puerta) ni, al crear un curso, lo delicado
    // (el contenido de un curso se puede exportar y compartir: un dato de salud no debe acabar escrito en una lección)
    const active = this.all.filter((r) => isActive(r, now) && modelSafe(r) && !(purpose.kind === 'courseCreation' && r.sensitive))
    if (!active.length || budget <= 80) return ''
    const course = purposeCourse(purpose)
    const chosen: MemoryRecord[] = []
    const seen = new Set<string>()
    const take = (rs: MemoryRecord[]): void => { for (const r of rs) if (!seen.has(r.id)) { seen.add(r.id); chosen.push(r) } }
    const strength = (r: MemoryRecord): number => r.confidence * 0.6 + recency(r.updatedAt, now) * 0.4 + (r.editedByStudent ? 0.2 : 0)
    const byStrength = (a: MemoryRecord, b: MemoryRecord): number => strength(b) - strength(a)
    // 1) cómo es y cómo quiere que le expliquen
    take(active.filter((r) => isCoreKind(r.kind)).sort(byStrength).slice(0, 5))
    // 2) lo relevante para lo que pregunta (variado; con «ok» o «gracias» no hay nada que buscar)
    if (query && !isTrivialQuery(query)) take(diversify(rankMemories(query, active, this.vectors, queryVector, now, course), this.vectors, 6).map((h) => h.record))
    // 3) lo de este curso (lo que le cuesta, sus errores)
    if (course) take(active.filter((r) => r.courseID === course && ['difficulty', 'mistake', 'goal', 'exam'].includes(r.kind)).sort(byStrength).slice(0, 3))
    // 4) exámenes próximos (los del curso primero)
    const exams = active.filter((r) => r.kind === 'exam').sort((a, b) => {
      if ((a.courseID === course) !== (b.courseID === course)) return a.courseID === course ? -1 : 1
      return (a.expiresAt ? Date.parse(a.expiresAt) : Infinity) - (b.expiresAt ? Date.parse(b.expiresAt) : Infinity)
    })
    take(exams.slice(0, purpose.kind === 'assistant' ? 4 : 2))
    // 5) si aún hay sitio: objetivos, horarios y plataforma
    take(active.filter((r) => r.kind === 'goal' || r.kind === 'schedule' || r.kind === 'platform').sort(byStrength).slice(0, 3))
    const { text, used } = assembleMemory(chosen, purpose, budget)
    this.markUsed(used)
    return text
  }

  private markUsed(ids: string[]): void {
    if (!ids.length) return
    const now = this.clock().toISOString()
    const set = new Set(ids)
    // contar usos no es un cambio de contenido: no va al historial (y si el cerrojo tarda, el contador no es importante)
    try {
      this.mutate(() => {
        let changed = false
        for (const r of this.all) if (set.has(r.id)) { r.uses += 1; r.lastUsedAt = now; changed = true }
        if (changed) this.persistRecords(true)
      })
    } catch { /* nada */ }
  }

  // MARK: Aprender de las conversaciones

  /** Aula aprende de una conversación: al terminar (`finished`) o cuando lleva unos minutos en silencio. */
  observe(conversation: MemoryConversation, finished: boolean): void {
    if (!this.isLearning) return
    const id = conversation.id
    const learned = this.state.learnedTurns[id] ?? 0
    if (conversation.turns.length <= learned) return
    const prev = this.pending.get(id)
    const p: PendingConversation = {
      id, source: conversation.source,
      turns: conversation.turns.map((t) => ({ student: t.speaker === 'student', text: Array.from(redactForExtraction(t.text)).slice(0, PENDING_TURN_CHARS).join(''), date: t.date ?? this.clock().toISOString() })),
      updatedAt: this.clock().toISOString(), attempts: prev?.attempts ?? 0
    }
    if (conversation.courseID) p.courseID = conversation.courseID
    if (conversation.courseTitle) p.courseTitle = conversation.courseTitle
    this.pending.delete(id)
    this.pending.set(id, p)
    if (this.trimPending()) this.disk.saveState(this.state)
    this.disk.savePending([...this.pending.values()])
    const old = this.timers.get(id)
    if (old) clearTimeout(old)
    const delay = finished ? 200 : this.idleDelayMs
    const t = setTimeout(() => {
      this.timers.delete(id)
      void this.learn(id)
    }, delay)
    t.unref?.()
    this.timers.set(id, t)
  }

  /**
   * Límites de lo pendiente y de lo ya aprendido (sin IA configurada, las conversaciones no se acumulan sin fin): fuera lo
   * pendiente de hace más de un mes y lo que pase de `PENDING_MAX` (lo más viejo), como si ya se hubiera aprendido; y se
   * olvida cuánto se aprendió de las conversaciones más antiguas por encima de `LEARNED_MAX`. Devuelve si cambió el estado.
   */
  private trimPending(): boolean {
    const now = this.clock().getTime()
    let stateChanged = false
    const drop = (p: PendingConversation): void => {
      const t = this.timers.get(p.id)
      if (t) { clearTimeout(t); this.timers.delete(p.id) }
      this.pending.delete(p.id)
      this.state.learnedTurns[p.id] = p.turns.length
      stateChanged = true
    }
    for (const p of [...this.pending.values()]) {
      const at = Date.parse(p.updatedAt)
      if (Number.isFinite(at) && now - at > PENDING_MAX_AGE_MS) drop(p)
    }
    const byAge = [...this.pending.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    while (byAge.length > PENDING_MAX) drop(byAge.shift()!)
    const learned = Object.keys(this.state.learnedTurns)
    if (learned.length > LEARNED_MAX) {
      // se conserva el orden de inserción: los primeros son los más antiguos
      for (const k of learned.slice(0, learned.length - LEARNED_MAX)) if (!this.pending.has(k)) delete this.state.learnedTurns[k]
      stateChanged = true
    }
    return stateChanged
  }

  /** El estudiante borró la conversación: no se aprende de ella. */
  discardConversation(id: string): void {
    this.generation++
    const t = this.timers.get(id)
    if (t) clearTimeout(t)
    this.timers.delete(id)
    this.pending.delete(id)
    delete this.state.learnedTurns[id]
    this.disk.savePending([...this.pending.values()])
    this.disk.saveState(this.state)
  }

  /** Lo que quedó pendiente de otra vez (la app se cerró antes de aprender): se aprende con la IA de ahora. */
  learnLeftovers(): void {
    const now = this.clock().getTime()
    for (const p of this.pending.values()) {
      if (this.timers.has(p.id) || now - Date.parse(p.updatedAt) < this.idleDelayMs) continue
      void this.learn(p.id)
    }
  }

  /** Aprende de una conversación pendiente (una llamada a la IA con lo nuevo). Devuelve lo que guardó. */
  async learn(id: string): Promise<MemoryWriteResult[]> {
    const course = this.pending.get(id)?.courseID
    const actor = ChangeContext.newActor('memory', tr('Aula aprendió de una conversación', 'Aula learned from a conversation'), course)
    return ChangeContext.run(actor, () => withAIUse({ purpose: 'memory', courseID: course }, () => this.learnNow(id)))
  }

  private async learnNow(id: string): Promise<MemoryWriteResult[]> {
    if (!this.isLearning || this.learning.has(id)) return []
    const conv = this.pending.get(id)
    if (!conv) return []
    const generation = this.generation
    this.learning.add(id)
    try {
      const learned = Math.min(this.state.learnedTurns[id] ?? 0, conv.turns.length)
      const finish = (markLearned: boolean): void => {
        if (generation !== this.generation) return
        if (markLearned) {
          const n = Math.max(this.state.learnedTurns[id] ?? 0, conv.turns.length)
          // al final: así los más recientes son los últimos en olvidarse
          delete this.state.learnedTurns[id]
          this.state.learnedTurns[id] = n
        }
        // si mientras tanto llegó algo nuevo, se queda pendiente para la próxima
        const now = this.pending.get(id)
        if (now && now.turns.length <= conv.turns.length) this.pending.delete(id)
        this.disk.savePending([...this.pending.values()])
        this.disk.saveState(this.state)
      }
      const fresh = conv.turns.slice(learned).filter((t) => t.student).map((t) => t.text).join('\n')
      if (fresh.trim().length < 24) { finish(true); return [] }
      const model = this.modelSource ? await this.modelSource().catch(() => undefined) : undefined
      if (!model) return []
      // lo que ya sabe y viene al caso (para que la IA no repita y pueda decir qué cambió)
      const now = this.clock()
      const qv = await this.embedOne(fresh.slice(0, 2000), 'query')
      await this.ensureVectors(qv)
      if (generation !== this.generation) return []
      const active = this.all.filter((r) => isActive(r, now) && modelSafe(r))
      const saved = rankMemories(fresh + ' ' + (conv.courseTitle ?? ''), active, this.vectors, qv, now, conv.courseID).slice(0, 18).map((h) => h.record)
      for (const r of active.filter((x) => isCoreKind(x.kind) || x.kind === 'exam').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8)) {
        if (!saved.some((s) => s.id === r.id)) saved.push(r)
      }
      const res = await runExtraction(model, conv, learned, saved, now)
      if (!res) {
        if (generation !== this.generation) return []
        const p = this.pending.get(id)
        if (p) p.attempts += 1
        const n = p?.attempts ?? 3
        this.disk.savePending([...this.pending.values()])
        if (n >= 3) finish(true)
        return []
      }
      // se apagó, se pausó, se borró todo o se descartó la conversación mientras pensaba: no se guarda nada
      if (!this.isLearning || generation !== this.generation) return []
      const out: MemoryWriteResult[] = []
      for (const item of res.memories) {
        if (item.sensitive) continue // lo delicado nunca entra sin preguntar
        const draft: MemoryDraft = { kind: item.kind, text: item.text, source: conv.source, conversationID: conv.id, confidence: item.confidence }
        if (item.key) draft.key = item.key
        if (conv.courseID) draft.courseID = conv.courseID
        if (conv.courseTitle) draft.courseTitle = conv.courseTitle
        if (item.expires) draft.expiresAt = item.expires
        out.push(await this.write(draft, 'automatic', generation))
      }
      if (res.outdated.length && generation === this.generation) {
        const ids = new Set(res.outdated)
        const stamp = this.clock().toISOString()
        const changed = this.mutate(() => {
          let any = false
          for (const r of this.all) {
            if (ids.has(r.id) && !r.editedByStudent && r.supersededBy === undefined) { r.supersededBy = 'conversation:' + conv.id; r.supersededAt = stamp; any = true }
          }
          if (any) this.persistRecords()
          return any
        })
        if (changed) this.notify()
      }
      finish(true)
      return out
    } finally {
      this.learning.delete(id)
    }
  }

  /** ¿Hay una conversación esperando para aprender? */
  hasPending(id?: string): boolean {
    return id ? this.pending.has(id) : this.pending.size > 0
  }

  // MARK: Aprender de la práctica

  private refreshPracticeIfStale(): void {
    if (!this.library || this.practiceRunning) return
    const last = this.state.lastPracticeScan ? Date.parse(this.state.lastPracticeScan) : NaN
    if (Number.isFinite(last) && this.clock().getTime() - last < PRACTICE_INTERVAL_MS) return
    setTimeout(() => void this.refreshPracticeInsights(false), 0).unref?.()
  }

  async refreshPracticeInsights(force: boolean): Promise<void> {
    if (!this.library || !this.isLearning || this.practiceRunning) return
    const now = this.clock()
    const last = this.state.lastPracticeScan ? Date.parse(this.state.lastPracticeScan) : NaN
    if (!force && Number.isFinite(last) && now.getTime() - last < PRACTICE_INTERVAL_MS) return
    this.practiceRunning = true
    try {
      const insights = deriveInsights(this.library, now)
      const keys = new Set(insights.map((i) => i.key))
      const changed = this.mutate(() => this.applyInsights(insights, keys, now))
      this.state.lastPracticeScan = now.toISOString()
      this.disk.saveState(this.state)
      if (changed) {
        this.saveVectors()
        this.notify()
        this.scheduleBackfill()
      }
    } finally {
      this.practiceRunning = false
    }
  }

  /** Aplica lo deducido de la práctica (con el cerrojo tomado). Devuelve si cambió algo. */
  private applyInsights(insights: ReturnType<typeof deriveInsights>, keys: Set<string>, now: Date): boolean {
    const before = JSON.stringify(this.all)
    // lo que ya no es verdad (ya domina lo que le costaba, resolvió el error) sale solo, salvo lo que tocó el estudiante
    this.all = this.all.filter((r) => !(r.source === 'practice' && !r.editedByStudent && (r.key ?? '').startsWith(PRACTICE_KEY_PREFIX) && !keys.has(r.key ?? '')))
    const nowISO = now.toISOString()
    for (const ins of insights) {
      const d = ins.draft
      const r = this.all.find((x) => x.key === ins.key)
      if (r) {
        if (r.editedByStudent) continue
        if (r.text !== d.text) { r.text = d.text; this.vectors.delete(r.id); r.updatedAt = nowISO }
        r.confidence = d.confidence ?? r.confidence
        if (d.expiresAt) r.expiresAt = d.expiresAt
        if (d.courseTitle) r.courseTitle = d.courseTitle
        delete r.supersededBy
        delete r.supersededAt
      } else if (secretReason(d.text) === undefined) {
        const rec: MemoryRecord = { id: newRecordID(), kind: d.kind, text: d.text, key: ins.key, source: 'practice', confidence: d.confidence ?? 0.7, createdAt: nowISO, updatedAt: nowISO, uses: 0, confirmations: 0, sensitive: false, editedByStudent: false }
        if (d.courseID) rec.courseID = d.courseID
        if (d.courseTitle) rec.courseTitle = d.courseTitle
        if (d.expiresAt) rec.expiresAt = d.expiresAt
        this.all.push(rec)
      }
    }
    const ids = new Set(this.all.map((r) => r.id))
    for (const k of [...this.vectors.keys()]) if (!ids.has(k)) this.vectors.delete(k)
    if (JSON.stringify(this.all) === before) return false
    this.enforceCapacity()
    this.persistRecords(true)
    return true
  }

  // MARK: Deshacer desde el historial

  /** «Deshacer lo que cambió Aula» en la memoria: el historial reescribe `memories.json` a través de aquí y la memoria se recarga. */
  historyRewrite(file: string, transform: (current: Buffer | null) => Buffer | null): void {
    let current: Buffer | null = null
    try { current = readFileSync(file) } catch { current = null }
    const next = transform(current)
    const records = this.disk.decodeRecords(next === null ? null : next.toString('utf8'))
    if (next === null) this.disk.writeData(null, file)
    else this.disk.writeData(next, file, { backup: true })
    this.diskStamp = this.disk.recordsStamp()
    this.all = records
    const ids = new Set(records.map((r) => r.id))
    for (const k of [...this.vectors.keys()]) if (!ids.has(k)) this.vectors.delete(k)
    this.saveVectors()
    this.notify()
    this.scheduleBackfill()
  }

  /** Solo para pruebas: sustituye los recuerdos por estos (sin vectores). */
  debugReplace(records: MemoryRecord[]): void {
    this.all = records.map((r) => ({ ...r }))
    this.vectors.clear()
    this.persistRecords(true)
    this.saveVectors()
    this.notify()
  }
}

function result(status: MemoryWriteResult['status'], message: string): MemoryWriteResult {
  return { status, replaced: [], message }
}

function secretMessage(why: string): string {
  return tr(`No se guardó: ${why} Aula nunca guarda contraseñas, claves ni números de documentos.`, `Not saved: ${why} Aula never stores passwords, keys or ID numbers.`)
}

/** Caducidad por defecto: lo pasajero («esta semana») 14 días; un examen, el día después de la fecha que diga el texto. */
export function defaultExpiry(kind: MemoryKind, text: string, now: Date): string | undefined {
  if (kind === 'exam') {
    const d = firstFutureDate(text, now)
    if (d) {
      const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 23, 59, 59)
      return end.toISOString()
    }
    return new Date(now.getTime() + 120 * 86_400_000).toISOString()
  }
  if (isPerishable(text)) return new Date(now.getTime() + 14 * 86_400_000).toISOString()
  return undefined
}

const MONTHS: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11, ene: 0, abr: 3, ago: 7, dic: 11
}

/** La primera fecha futura del texto: ISO primero (lo que escribe la IA) y, si no, «14 de octubre», «October 14», «14/10/2026». */
export function firstFutureDate(text: string, now: Date): Date | undefined {
  const iso = /\d{4}-\d{2}-\d{2}/.exec(text)
  if (iso) {
    const s = parseDay(iso[0])
    if (s && Date.parse(s) > now.getTime()) return new Date(s)
  }
  const lower = text.toLowerCase()
  const candidates: Date[] = []
  const year = now.getFullYear()
  const mk = (y: number, m: number, d: number): void => {
    const x = new Date(y, m, d, 12)
    if (x.getMonth() !== m || x.getDate() !== d) return
    // sin año: el próximo que caiga
    candidates.push(x)
  }
  let m: RegExpExecArray | null
  const es = /(\d{1,2})\s+de\s+([a-zé]+)(?:\s+(?:de|del)\s+(\d{4}))?/g
  while ((m = es.exec(lower))) {
    const mo = MONTHS[m[2]]
    if (mo === undefined) continue
    const y = m[3] ? Number(m[3]) : year
    mk(y, mo, Number(m[1]))
    if (!m[3]) mk(y + 1, mo, Number(m[1]))
  }
  const en = /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/g
  while ((m = en.exec(lower))) {
    const mo = MONTHS[m[1]]
    if (mo === undefined) continue
    const y = m[3] ? Number(m[3]) : year
    mk(y, mo, Number(m[2]))
    if (!m[3]) mk(y + 1, mo, Number(m[2]))
  }
  const slash = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g
  while ((m = slash.exec(lower))) {
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3])
    mk(y, Number(m[2]) - 1, Number(m[1]))
  }
  const lastNight = now.getTime() - 86_400_000
  return candidates.filter((d) => d.getTime() > lastNight).sort((a, b) => a.getTime() - b.getTime())[0]
}
