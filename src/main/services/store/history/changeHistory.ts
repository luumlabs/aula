// Historial de cambios de Aula y «Deshacer lo que cambió Aula» (port pragmático de StudyModel/History/ChangeHistory.swift).
//
//  <carpeta de Aula>/History/
//    book.jsonl            libro: grupos (quién, qué se pidió), cambios (archivo, antes, después) y deshechos
//    blobs/ab/<sha256>     el contenido de cada versión, sin repetir (0600)
//    undo-journal.json     solo mientras se deshace: si la app se cierra a mitad, al abrir se vuelve atrás (todo o nada)
//
// Qué se apunta: lo que escribe Aula (con `ChangeContext.current`) en los cursos (`pack.json` y `skills/*.json`), en el
// calendario y en la memoria. El progreso, las notas y lo que hace el estudiante a mano NUNCA se apuntan ni se deshacen.
//
// Deshacer un grupo devuelve cada archivo que tocó al estado de antes, aplicando la diferencia al revés sobre lo de ahora,
// tramo a tramo y del último al primero (lo que editó el estudiante ENTRE dos cambios de Aula también se conserva):
//   · si después hubo otros cambios de Aula en esos archivos, se deshacen también (`alsoUndo`; con `includeLater: false`
//     no se hace nada y se dice);
//   · lo que cambió el estudiante después se respeta (`conflicts` dice dónde ganó lo suyo);
//   · es atómico: todos los archivos o ninguno (cerrojos + diario), y deshacer también se puede deshacer.
// Simplificaciones frente a Swift: sin la barrera de privacidad de la memoria (la memoria la lleva su propio módulo, que
// puede registrarse como dueño de su archivo con `registerHost`) y el libro se relee entero cuando cambia.
import { createHash } from 'node:crypto'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeSync } from 'node:fs'
import { join, relative as relPath, resolve, sep } from 'node:path'
import { isJSONObject, parseJSON, stringifyJSON } from '@engine/base/json'
import { tr } from '@shared/ai/i18n'
import {
  CHANGE_ACTOR_KINDS, CHANGE_DOMAINS, type ChangeActor, type ChangeActorKind, type ChangeDomain, type ChangeGroup, type ChangeLine, type FileChange,
  type UndoOptions, type UndoPlan, type UndoPlanFile, type UndoResult
} from '@shared/schema/history'
import { writeFileAtomic } from '../../fs'
import { log } from '../../log'
import { lockDirFor, withFileLock, withFileLocks } from '../lock'
import { actorKindTitle, ChangeContext } from './context'
import { describeChange } from './describer'
import { revert, same, VOLATILE_KEYS } from './jsonMerge'

export class HistoryError extends Error {
  constructor(
    readonly code: 'not_found' | 'already_undone' | 'later_changes' | 'cannot_undo' | 'changed_meanwhile',
    message: string,
    readonly details?: string[]
  ) {
    super(message)
    this.name = 'HistoryError'
  }
}

/** Una línea del libro (mismas claves que la app Swift). */
export interface BookLine {
  /** group | change | undone */
  t: string
  at: string
  id?: string
  kind?: ChangeActorKind
  label?: string
  course?: string
  group?: string
  file?: string
  domain?: ChangeDomain
  /** Huella; "-" = no existía; "!" = demasiado grande (sin copia). */
  before?: string
  after?: string
  /** Cerrojo del archivo (relativo). */
  lock?: string
  /** En «undone»: el deshacer. */
  by?: string
}

interface Journal {
  undo: string
  entries: Array<{ path: string; previous: string; next: string; lock?: string }>
}

/** Quien lleva un archivo en memoria: deshacer le pide que lea y escriba él (con su cerrojo) y que se recargue. */
export interface HistoryFileHost {
  historyRewrite(file: string, transform: (current: Buffer | null) => Buffer | null): void
}

export interface RecordOptions {
  file: string
  before: Buffer | null
  after: Buffer | null
  domain: ChangeDomain
  courseID?: string
  /** Cerrojo con el que se escribe el archivo (deshacer lo toma también). */
  lockFile?: string
  actor?: ChangeActor
}

export interface GarbageReport { removedGroups: number; removedBlobs: number; bytes: number }

const ABSENT = '-'
const TOO_BIG = '!'

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex')
const hashOf = (data: Buffer | null): string => (data ? sha256(data) : ABSENT)
const bytesEqual = (a: Buffer | null, b: Buffer | null): boolean => (a === null || b === null ? a === b : a.equals(b))

function readOrNull(file: string): Buffer | null {
  try {
    return readFileSync(file)
  } catch {
    return null
  }
}

function parseJSONData(d: Buffer | null): { ok: true; value: unknown } | { ok: false } {
  if (d === null) return { ok: true, value: undefined }
  try {
    return { ok: true, value: parseJSON(d.toString('utf8')) }
  } catch {
    return { ok: false }
  }
}

const encodePretty = (v: unknown): Buffer => Buffer.from(stringifyJSON(v, { pretty: true, sortKeys: true }), 'utf8')

function decodeLine(raw: unknown): BookLine | undefined {
  if (!isJSONObject(raw)) return undefined
  const t = raw.t, at = raw.at
  if (typeof t !== 'string' || typeof at !== 'string' || Number.isNaN(Date.parse(at))) return undefined
  const line: BookLine = { t, at }
  for (const k of ['id', 'label', 'course', 'group', 'file', 'before', 'after', 'lock', 'by'] as const) {
    const v = raw[k]
    if (v === undefined || v === null) continue
    if (typeof v !== 'string') return undefined
    line[k] = v
  }
  if (raw.kind !== undefined && raw.kind !== null) line.kind = (CHANGE_ACTOR_KINDS as readonly string[]).includes(raw.kind as string) ? (raw.kind as ChangeActorKind) : 'other'
  if (raw.domain !== undefined && raw.domain !== null) line.domain = (CHANGE_DOMAINS as readonly string[]).includes(raw.domain as string) ? (raw.domain as ChangeDomain) : 'other'
  return line
}

function encodeLine(l: BookLine): string {
  return stringifyJSON(l, { pretty: false, sortKeys: true })
}

interface Book {
  groups: Map<string, { line: BookLine; order: number }>
  changes: Array<{ line: BookLine; order: number }>
  undoers: Map<string, string[]>
  memo: Map<string, boolean>
}

function isUndone(b: Book, g: string, depth = 0): boolean {
  const m = b.memo.get(g)
  if (m !== undefined) return m
  if (depth >= 64) return false
  const r = (b.undoers.get(g) ?? []).some((u) => !isUndone(b, u, depth + 1))
  b.memo.set(g, r)
  return r
}

/** «Packs/<curso>/…» → el curso. */
export function courseIDOfPath(path: string): string | undefined {
  const parts = path.split('/').filter(Boolean)
  return parts.length >= 3 && parts[0] === 'Packs' ? parts[1] : undefined
}

/** ¿Un contenedor (calendario, memoria) sin nada propio? Solo claves internas o listas y objetos vacíos. */
function isEmptyContainer(v: unknown): boolean {
  if (!isJSONObject(v)) return false
  return Object.entries(v).every(([k, x]) => VOLATILE_KEYS.has(k) || (Array.isArray(x) && x.length === 0) || (isJSONObject(x) && Object.keys(x).length === 0) || x === null)
}

const registry = new Map<string, ChangeHistory>()

export class ChangeHistory {
  /** Un archivo más grande no se copia (no se podrá deshacer y se dice). */
  static maxFileBytes = 16 * 1024 * 1024
  static retentionDays = 14
  static maxStoreBytes = 256 * 1024 * 1024
  static maxGroups = 400

  readonly root: string
  private readonly clock: () => Date
  private knownGroups = new Set<string>()
  private cache: { key: string; lines: BookLine[] } | null = null
  private hosts = new Map<string, HistoryFileHost>()
  private lastGC: number | null = null

  constructor(root: string, clock: () => Date = () => new Date()) {
    this.root = resolve(root)
    this.clock = clock
    this.recoverInterruptedUndo()
  }

  /** El historial de una carpeta de datos (un objeto por carpeta en todo el proceso). */
  static at(root: string): ChangeHistory {
    const key = resolve(root)
    let h = registry.get(key)
    if (!h) { h = new ChangeHistory(key); registry.set(key, h) }
    return h
  }

  get directory(): string { return join(this.root, 'History') }
  get bookPath(): string { return join(this.directory, 'book.jsonl') }
  get blobsPath(): string { return join(this.directory, 'blobs') }
  get journalPath(): string { return join(this.directory, 'undo-journal.json') }
  private get lockPath(): string { return join(this.directory, '.aula-lock') }
  private get undoLockPath(): string { return join(this.directory, '.aula-undo-lock') }

  /** Quien lleva un archivo en memoria (ver `HistoryFileHost`). */
  registerHost(file: string, host: HistoryFileHost | null): void {
    const rel = this.relative(file)
    if (!rel) return
    if (host) this.hosts.set(rel, host)
    else this.hosts.delete(rel)
  }

  relative(file: string): string | undefined {
    const rel = relPath(this.root, resolve(file))
    if (!rel || rel.startsWith('..') || rel.startsWith(sep) || /^[A-Za-z]:/.test(rel)) return undefined
    const posix = rel.split(sep).join('/')
    return posix.startsWith('History/') ? undefined : posix
  }

  absolute(rel: string): string {
    return join(this.root, ...rel.split('/'))
  }

  // MARK: Libro

  private appendLines(lines: BookLine[]): void {
    if (!lines.length) return
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    let data = lines.map(encodeLine).join('\n') + '\n'
    const fd = openSync(this.bookPath, 'a+', 0o600)
    try {
      // una línea cortada por un cierre a lo bruto no se pega a la siguiente
      const size = statSync(this.bookPath).size
      if (size > 0) {
        const last = Buffer.alloc(1)
        readSync(fd, last, 0, 1, size - 1)
        if (last[0] !== 0x0a) data = '\n' + data
      }
      writeSync(fd, data)
    } finally {
      closeSync(fd)
    }
  }

  /** Todas las líneas del libro (las ilegibles se saltan). */
  lines(): BookLine[] {
    let st
    try { st = statSync(this.bookPath) } catch { this.cache = null; return [] }
    const key = `${st.ino}:${st.size}:${st.mtimeMs}`
    if (this.cache?.key === key) return this.cache.lines
    const text = readFileSync(this.bookPath, 'utf8')
    const end = text.lastIndexOf('\n')
    const out: BookLine[] = []
    if (end >= 0) {
      for (const raw of text.slice(0, end).split('\n')) {
        if (!raw.trim()) continue
        try { const l = decodeLine(JSON.parse(raw)); if (l) out.push(l) } catch { /* línea cortada */ }
      }
    }
    this.cache = { key, lines: out }
    return out
  }

  private rewriteBook(lines: BookLine[]): void {
    writeFileAtomic(this.bookPath, lines.map((l) => encodeLine(l) + '\n').join(''), 0o600)
    this.cache = null
  }

  // MARK: Copias

  blobPath(hash: string): string {
    return join(this.blobsPath, hash.slice(0, 2), hash)
  }

  /** Guarda una versión y devuelve su huella ("-" si no existe; "!" si es demasiado grande). */
  store(data: Buffer | null): string {
    if (!data) return ABSENT
    if (data.length > ChangeHistory.maxFileBytes) return TOO_BIG
    const hash = sha256(data)
    const file = this.blobPath(hash)
    if (!existsSync(file)) {
      mkdirSync(join(this.blobsPath, hash.slice(0, 2)), { recursive: true, mode: 0o700 })
      writeFileAtomic(file, data, 0o600)
      try { chmodSync(file, 0o600) } catch { /* nada */ }
    }
    return hash
  }

  /** El contenido de una huella (null si no existía; lanza si falta la copia). */
  load(hash: string): Buffer | null {
    if (hash === ABSENT) return null
    const d = hash === TOO_BIG ? null : readOrNull(this.blobPath(hash))
    if (!d) throw new HistoryError('cannot_undo', tr('Falta la copia de un archivo: ese cambio ya no se puede deshacer.', 'A file backup is missing: that change can no longer be undone.'))
    return d
  }

  private static blobHash(data: Buffer | null): string {
    if (!data) return ABSENT
    return data.length > ChangeHistory.maxFileBytes ? TOO_BIG : sha256(data)
  }

  // MARK: Apuntar

  /**
   * Apunta que `actor` cambió `file` de `before` a `after` (null = no existe). Lo llama quien escribe, DENTRO de su cerrojo.
   * Sin actor no apunta nada. Nunca lanza: el historial no puede impedir guardar.
   */
  record(opts: RecordOptions): void {
    const actor = 'actor' in opts ? opts.actor : ChangeContext.current
    const rel = this.relative(opts.file)
    if (!actor || !rel || bytesEqual(opts.before, opts.after)) return
    try {
      withFileLock(this.lockPath, () => {
        const b = this.store(opts.before), a = this.store(opts.after)
        if (b === a) return
        const now = this.clock().toISOString()
        const out: BookLine[] = []
        if (!this.knownGroups.has(actor.group)) {
          out.push(prune({ t: 'group', at: now, id: actor.group, kind: actor.kind, label: actor.label, course: actor.courseID }))
        }
        out.push(prune({ t: 'change', at: now, group: actor.group, file: rel, domain: opts.domain, before: b, after: a, lock: opts.lockFile ? this.relativeAny(opts.lockFile) : undefined }))
        this.appendLines(out)
        this.knownGroups.add(actor.group)
      })
    } catch (err) {
      log.warn(`Historial: no se pudo apuntar el cambio de ${rel}: ${err instanceof Error ? err.message : String(err)}`)
    }
    this.collectGarbageIfDue()
  }

  private relativeAny(file: string): string | undefined {
    const rel = relPath(this.root, resolve(file))
    return !rel || rel.startsWith('..') ? undefined : rel.split(sep).join('/')
  }

  // MARK: Leer el historial

  private book(): Book {
    const b: Book = { groups: new Map(), changes: [], undoers: new Map(), memo: new Map() }
    this.lines().forEach((l, i) => {
      switch (l.t) {
        case 'group': if (l.id && !b.groups.has(l.id)) b.groups.set(l.id, { line: l, order: i }); break
        case 'change': if (l.group && l.file) b.changes.push({ line: l, order: i }); break
        case 'undone': if (l.group && l.by) b.undoers.set(l.group, [...(b.undoers.get(l.group) ?? []), l.by]); break
      }
    })
    return b
  }

  private makeGroup(id: string, b: Book): ChangeGroup | undefined {
    const mine = b.changes.filter((c) => c.line.group === id)
    if (!mine.length) return undefined
    const meta = b.groups.get(id)?.line
    const files = new Map<string, FileChange>()
    for (const { line } of mine) {
      const path = line.file!
      const existing = files.get(path)
      const after = line.after && line.after !== ABSENT ? line.after : undefined
      if (existing) {
        if (after === undefined) delete existing.after
        else existing.after = after
        existing.at = line.at
      } else {
        files.set(path, prune({
          path, domain: line.domain ?? 'other', courseID: courseIDOfPath(path), before: line.before && line.before !== ABSENT ? line.before : undefined, after, at: line.at
        }))
      }
    }
    const undid = [...b.undoers.entries()].filter(([, by]) => by.includes(id)).map(([g]) => g).sort()
    return prune({
      id, kind: meta?.kind ?? (id.startsWith('undo-') ? 'undo' : 'other'), label: meta?.label ?? '', courseID: meta?.course,
      startedAt: meta?.at ?? mine[0].line.at, updatedAt: mine[mine.length - 1].line.at, files: [...files.values()], isUndone: isUndone(b, id), undid
    }) as ChangeGroup
  }

  /** Los grupos, del más reciente al más antiguo. `courseID`: solo los que tocaron ese curso (o se hicieron para él). */
  groups(opts: { courseID?: string; domain?: ChangeDomain; limit?: number } = {}): ChangeGroup[] {
    const b = this.book()
    const ids: string[] = []
    const seen = new Set<string>()
    for (let k = b.changes.length - 1; k >= 0; k--) {
      const g = b.changes[k].line.group!
      if (!seen.has(g)) { seen.add(g); ids.push(g) }
    }
    const out: ChangeGroup[] = []
    for (const id of ids) {
      const g = this.makeGroup(id, b)
      if (!g) continue
      if (opts.courseID !== undefined && !groupCourseIDs(g).has(opts.courseID)) continue
      if (opts.domain !== undefined && !g.files.some((f) => f.domain === opts.domain)) continue
      out.push(g)
      if (out.length >= (opts.limit ?? 100)) break
    }
    return out
  }

  group(id: string): ChangeGroup | undefined {
    return this.makeGroup(id, this.book())
  }

  /** Lo que cambió un grupo, en frases. */
  describe(group: ChangeGroup): ChangeLine[] {
    return group.files.flatMap((f) => {
      const load = (h?: string): Buffer | null => { try { return h ? this.load(h) : null } catch { return null } }
      return describeChange(f.path, f.domain, load(f.before), load(f.after))
    })
  }

  // MARK: Deshacer

  /** Lo que haría deshacer `groupID` (sin tocar nada). */
  plan(groupID: string, options: UndoOptions = {}): UndoPlan {
    return this.makePlan(groupID, options).plan
  }

  private makePlan(groupID: string, options: UndoOptions): { plan: UndoPlan; undoIDs: string[]; targets: Target[] } {
    const includeLater = options.includeLater ?? true
    const keepLaterEdits = options.keepLaterEdits ?? true
    const b = this.book()
    const group = this.makeGroup(groupID, b)
    if (!group) throw new HistoryError('not_found', tr('Ese cambio ya no está en el historial.', 'That change is no longer in the history.'))
    if (group.isUndone) throw new HistoryError('already_undone', tr('Ese cambio ya se deshizo.', 'That change was already undone.'))
    // cierre: los grupos posteriores (y vigentes) que tocaron los mismos archivos, hasta que no salga ninguno más
    const set = new Set([groupID])
    let firstLine = new Map<string, number>()
    let changed = true
    while (changed) {
      changed = false
      firstLine = new Map()
      for (const { line, order } of b.changes) if (set.has(line.group!) && !firstLine.has(line.file!)) firstLine.set(line.file!, order)
      for (const { line, order } of b.changes) {
        const start = firstLine.get(line.file!)
        const g = line.group!
        if (start === undefined || order <= start || set.has(g) || isUndone(b, g)) continue
        set.add(g)
        changed = true
      }
    }
    const later = [...set].filter((g) => g !== groupID).map((g) => this.makeGroup(g, b)!).filter(Boolean)
      .sort((x, y) => x.startedAt.localeCompare(y.startedAt))
    if (later.length && !includeLater) {
      const labels = later.map((g) => g.label || actorKindTitle(g.kind))
      throw new HistoryError('later_changes', tr(`Después hubo otros cambios de Aula en lo mismo (${labels.join('; ')}). Deshazlos también o empieza por el último.`, `Aula changed the same things again later (${labels.join('; ')}). Undo those too, or start with the latest.`), labels)
    }
    // los ya deshechos que quedan entre medias también se marcan (así deshacer este deshacer los deja como estaban)
    const marks = new Set(set)
    for (const { line, order } of b.changes) { const start = firstLine.get(line.file!); if (start !== undefined && order > start) marks.add(line.group!) }

    const files: UndoPlanFile[] = []
    const targets: Target[] = []
    const keptCreatedSkills = new Map<string, Set<string>>()
    for (const [path, start] of [...firstLine.entries()].sort((x, y) => x[1] - y[1])) {
      const onFile = b.changes.filter((c) => c.line.file === path)
      const undoing = onFile.filter((c) => c.order >= start).map((c) => c.line)
      const domain = undoing[0].domain ?? 'other'
      const lockRel = [...onFile].reverse().map((c) => c.line.lock).find((l) => l !== undefined)
      const current = readOrNull(this.absolute(path))
      const file: UndoPlanFile = { path, domain, action: 'restore', conflicts: [] }
      // Tramos seguidos (el «después» de uno es el «antes» del siguiente). Entre dos tramos alguien que no es Aula cambió el
      // archivo: cada tramo se deshace por separado y en orden inverso, así lo de en medio se conserva.
      const runs: Array<{ before: string; after: string }> = []
      for (const l of undoing) {
        const bh = l.before ?? ABSENT, ah = l.after ?? ABSENT
        const last = runs[runs.length - 1]
        if (last && last.after === bh) last.after = ah
        else runs.push({ before: bh, after: ah })
      }
      let steps: Array<{ before: Buffer | null; after: Buffer | null }>
      try {
        steps = runs.map((r) => ({ before: this.load(r.before), after: this.load(r.after) }))
      } catch (err) {
        file.problem = err instanceof Error ? err.message : String(err)
        files.push(file)
        continue
      }
      const originalBefore = steps[0].before
      const isContainer = domain === 'calendar' || domain === 'memory'
      let result: Buffer | null
      if (!keepLaterEdits || (steps.length === 1 && bytesEqual(current, steps[0].after))) {
        result = originalBefore
      } else {
        let state = current
        for (const step of [...steps].reverse()) {
          if (bytesEqual(state, step.after)) { state = step.before; continue }
          // el calendario y la memoria son contenedores: sin archivo es lo mismo que vacío
          const base = isContainer && step.before === null ? { ok: true as const, value: {} } : parseJSONData(step.before)
          const c = parseJSONData(state), a = parseJSONData(step.after)
          if (c.ok && a.ok && base.ok) {
            const r = revert(c.value, a.value, base.value, '$')
            for (const k of r.conflicts) if (!file.conflicts.includes(k)) file.conflicts.push(k)
            if (!same(r.value, c.value)) state = r.value === undefined ? null : encodePretty(r.value)
          } else if (!file.conflicts.includes('$')) {
            // no es JSON: si cambió después, se queda como está
            file.conflicts.push('$')
          }
        }
        result = state
        // Un contenedor que no existía y se queda vacío vuelve a no existir: «{}» no es un archivo válido.
        if (isContainer && originalBefore === null && result) {
          const v = parseJSONData(result)
          if (v.ok && isEmptyContainer(v.value)) result = null
        }
      }
      const course = courseIDOfPath(path)
      if (domain === 'course' && originalBefore === null && result && course && path.startsWith(`Packs/${course}/skills/`)) {
        const v = parseJSONData(result)
        if (v.ok && isJSONObject(v.value) && typeof v.value.id === 'string') {
          const set2 = keptCreatedSkills.get(course) ?? new Set<string>()
          set2.add(v.value.id)
          keptCreatedSkills.set(course, set2)
        }
      }
      if (current !== null && result === null) file.action = 'remove'
      else if (current === null && result !== null) file.action = 'recreate'
      else if (current === null && result === null) file.action = 'keep'
      else file.action = bytesEqual(result, current) ? 'keep' : 'restore'
      files.push(file)
      targets.push({ path, domain, lock: lockRel, currentHash: hashOf(current), result })
    }
    // Una lección creada por Aula que se queda porque el estudiante la editó sigue en el curso: `pack.json` conserva su entrada
    // (y su sitio en la unidad), si no el archivo quedaría en disco sin que el curso lo liste.
    for (const [course, ids] of keptCreatedSkills) {
      const packPath = `Packs/${course}/pack.json`
      const ti = targets.findIndex((t) => t.path === packPath), fi = files.findIndex((f) => f.path === packPath)
      if (ti < 0 || fi < 0 || !targets[ti].result) continue
      const out = parseJSONData(targets[ti].result), nowData = readOrNull(this.absolute(packPath)), now = parseJSONData(nowData)
      if (!out.ok || !now.ok || !isJSONObject(out.value) || !isJSONObject(now.value)) continue
      const o = out.value as Record<string, unknown>, n = now.value as Record<string, unknown>
      let changedPack = false
      const sortedIDs = [...ids].sort()
      if (Array.isArray(o.skills) && Array.isArray(n.skills)) {
        const skills = [...o.skills]
        for (const id of sortedIDs) {
          if (skills.some((s) => isJSONObject(s) && s.id === id)) continue
          const ref = n.skills.find((s) => isJSONObject(s) && s.id === id)
          if (ref) { skills.push(ref); changedPack = true }
        }
        o.skills = skills
      }
      if (Array.isArray(o.units) && Array.isArray(n.units)) {
        o.units = o.units.map((unit) => {
          if (!isJSONObject(unit) || typeof unit.id !== 'string' || !Array.isArray(unit.skillIDs)) return unit
          const nowUnit = (n.units as unknown[]).find((u) => isJSONObject(u) && u.id === unit.id) as Record<string, unknown> | undefined
          if (!nowUnit || !Array.isArray(nowUnit.skillIDs)) return unit
          const uids = [...unit.skillIDs]
          for (const id of sortedIDs) if (nowUnit.skillIDs.includes(id) && !uids.includes(id)) { uids.push(id); changedPack = true }
          return { ...unit, skillIDs: uids }
        })
      }
      if (!changedPack) continue
      targets[ti].result = encodePretty(o)
      for (const id of sortedIDs) files[fi].conflicts.push(`$.skills[id=${id}]`)
      if (files[fi].action === 'keep' && !bytesEqual(targets[ti].result, nowData)) files[fi].action = 'restore'
    }
    const lines = [group, ...later].flatMap((g) => this.describe(g))
    const conflicts = files.reduce((n, f) => n + f.conflicts.length, 0)
    const problems = files.flatMap((f) => (f.problem ? [f.problem] : []))
    const plan: UndoPlan = { group, alsoUndo: later, files, lines, conflicts, problems, canUndo: !problems.length && !group.isUndone && files.length > 0 }
    return { plan, undoIDs: [...marks].sort(), targets }
  }

  /** Deshace un grupo (ver el plan con `plan`). Atómico: o todos los archivos o ninguno. */
  undo(groupID: string, options: UndoOptions = {}): UndoResult {
    return withFileLock(this.undoLockPath, () => {
      this.recoverInterruptedUndoLocked()
      const work = this.makePlan(groupID, options)
      if (!work.plan.canUndo) throw new HistoryError('cannot_undo', work.plan.problems[0] ?? tr('Ese cambio no se puede deshacer.', "That change can't be undone."), work.plan.problems)
      const g = work.plan.group
      const actor = ChangeContext.newActor('undo', tr(`Deshacer: ${g.label || actorKindTitle(g.kind)}`, `Undo: ${g.label || actorKindTitle(g.kind)}`), g.courseID ?? [...groupCourseIDs(g)].sort()[0], this.clock())
      const locks = [...new Set(work.targets.flatMap((t) => (t.lock ? [this.absolute(lockDirFor(t.lock))] : [])))]
      withFileLocks(locks, () => this.applyUndo(work.targets, work.undoIDs, actor))
      return {
        undoGroupID: actor.group, undoneGroups: work.undoIDs, files: work.targets.map((t) => t.path),
        keptLaterEdits: work.plan.files.flatMap((f) => f.conflicts.map((c) => `${f.path} ${c}`))
      }
    })
  }

  private applyUndo(targets: Target[], undoIDs: string[], actor: ChangeActor): void {
    // 1. lo de ahora sigue siendo lo que se planeó (con los cerrojos ya tomados)
    for (const t of targets) {
      if (this.hosts.has(t.path)) continue
      if (hashOf(readOrNull(this.absolute(t.path))) !== t.currentHash) {
        throw new HistoryError('changed_meanwhile', tr(`«${t.path}» cambió mientras se deshacía. Vuelve a intentarlo.`, `“${t.path}” changed while undoing. Try again.`))
      }
    }
    // 2. diario: lo de antes y lo de después de cada archivo (primero el diario, después las copias)
    const entries: Journal['entries'] = []
    const contents: Array<[Buffer | null, Buffer | null]> = []
    for (const t of targets) {
      const current = readOrNull(this.absolute(t.path))
      entries.push(prune({ path: t.path, previous: ChangeHistory.blobHash(current), next: ChangeHistory.blobHash(t.result), lock: t.lock }))
      contents.push([current, t.result])
    }
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    withFileLock(this.lockPath, () => {
      writeFileAtomic(this.journalPath, encodePretty({ undo: actor.group, entries }), 0o600)
      for (const [prev, next] of contents) { this.store(prev); this.store(next) }
    })
    // 3. escribir; si algo falla, se vuelve atrás lo ya escrito
    const attempted: Array<[Target, Journal['entries'][number]]> = []
    try {
      targets.forEach((t, i) => {
        attempted.push([t, entries[i]])
        this.put(t.result, t.path, t.currentHash)
      })
    } catch (err) {
      let rolledBack = true
      for (const [t, e] of attempted.reverse()) {
        try {
          const now = hashOf(readOrNull(this.absolute(t.path)))
          if (now === e.previous) continue
          // no pisar una edición ajena hecha después de planear: si hay dudas, se deja el diario
          if (now !== e.next) { rolledBack = false; continue }
          this.put(this.load(e.previous), t.path, now)
        } catch {
          rolledBack = false
        }
      }
      if (rolledBack) rmSync(this.journalPath, { force: true })
      throw err
    }
    // 4. el propio deshacer queda en el libro (se puede deshacer) y los grupos, marcados; después se borra el diario
    withFileLock(this.lockPath, () => {
      const now = this.clock().toISOString()
      const out: BookLine[] = [prune({ t: 'group', at: now, id: actor.group, kind: 'undo' as ChangeActorKind, label: actor.label, course: actor.courseID })]
      targets.forEach((t, i) => {
        const e = entries[i]
        if (e.previous !== e.next) out.push(prune({ t: 'change', at: now, group: actor.group, file: t.path, domain: t.domain, before: e.previous, after: e.next, lock: t.lock }))
      })
      for (const g of undoIDs) out.push({ t: 'undone', at: now, group: g, by: actor.group })
      this.appendLines(out)
      this.knownGroups.add(actor.group)
    })
    rmSync(this.journalPath, { force: true })
  }

  /** Escribe (o borra) un archivo: por su dueño si lo lleva en memoria; si no, directamente (ya con su cerrojo tomado). */
  private put(data: Buffer | null, path: string, expecting?: string): void {
    const file = this.absolute(path)
    const host = this.hosts.get(path)
    if (host) {
      host.historyRewrite(file, (current) => {
        if (expecting !== undefined && hashOf(current) !== expecting) throw new HistoryError('changed_meanwhile', tr(`«${path}» cambió mientras se deshacía. Vuelve a intentarlo.`, `“${path}” changed while undoing. Try again.`))
        return data
      })
      return
    }
    if (data) writeFileAtomic(file, data)
    else rmSync(file, { force: true })
  }

  /** Si la app se cerró a mitad de un deshacer: si llegó a apuntarse, se da por hecho; si no, se vuelve atrás lo escrito. */
  recoverInterruptedUndo(): void {
    if (!existsSync(this.journalPath)) return
    try {
      withFileLock(this.undoLockPath, () => this.recoverInterruptedUndoLocked())
    } catch (err) {
      log.warn(`Historial: no se pudo recuperar un deshacer interrumpido: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private recoverInterruptedUndoLocked(): void {
    if (!existsSync(this.journalPath)) return
    const raw = parseJSONData(readOrNull(this.journalPath))
    if (!raw.ok || !isJSONObject(raw.value) || typeof raw.value.undo !== 'string' || !Array.isArray(raw.value.entries)) {
      rmSync(this.journalPath, { force: true })
      return
    }
    const j = raw.value as unknown as Journal
    const finished = this.lines().some((l) => l.t === 'undone' && l.by === j.undo)
    if (!finished) {
      // con los mismos cerrojos que el deshacer: otro proceso no puede escribir entre la comprobación y la escritura
      const locks = j.entries.flatMap((e) => (typeof e.lock === 'string' ? [this.absolute(lockDirFor(e.lock))] : []))
      withFileLocks(locks, () => {
        for (const e of j.entries) {
          if (typeof e.path !== 'string' || typeof e.previous !== 'string' || typeof e.next !== 'string') continue
          const now = hashOf(readOrNull(this.absolute(e.path)))
          if (now !== e.next || now === e.previous) continue
          this.put(this.load(e.previous), e.path, now)
        }
      })
    }
    rmSync(this.journalPath, { force: true })
  }

  /** Escribe un diario de deshacer (solo para pruebas de recuperación). */
  writeJournalForTesting(journal: Journal): void {
    writeFileAtomic(this.journalPath, encodePretty(journal), 0o600)
  }

  // MARK: Limpieza

  /**
   * Junta las escrituras seguidas de un mismo grupo en un archivo (el «antes» de cada una es el «después» de la anterior)
   * en un solo cambio, y así las copias intermedias se pueden borrar. Un cambio que deja el archivo como estaba desaparece.
   */
  static compactLines(lines: BookLine[]): BookLine[] {
    const byFile = new Map<string, number[]>()
    lines.forEach((l, i) => { if (l.t === 'change' && l.file) byFile.set(l.file, [...(byFile.get(l.file) ?? []), i]) })
    const remove = new Set<number>()
    const replace = new Map<number, BookLine>()
    for (const idxs of byFile.values()) {
      let run: number[] = []
      const flush = (): void => {
        const first = run[0], last = run[run.length - 1]
        if (first !== undefined && (run.length > 1 || lines[first].before === lines[first].after)) {
          const merged: BookLine = { ...lines[last], before: lines[first].before }
          for (const i of run.slice(0, -1)) remove.add(i)
          if (merged.before === merged.after) remove.add(last)
          else replace.set(last, merged)
        }
        run = []
      }
      for (const i of idxs) {
        // solo si son seguidas de verdad: si entre medias el archivo cambió (el estudiante), juntarlas perdería ese cambio
        const last = run[run.length - 1]
        if (last !== undefined && lines[last].group === lines[i].group && lines[last].after === lines[i].before) run.push(i)
        else { flush(); run = [i] }
      }
      flush()
    }
    return lines.flatMap((l, i) => (remove.has(i) ? [] : [replace.get(i) ?? l]))
  }

  /**
   * Quita los grupos de hace más de `retentionDays` días y, si las copias pasan de `maxBytes` (o hay más de `maxGroups`),
   * los más antiguos hasta que quepan; junta las escrituras intermedias y borra las copias que ya nadie usa.
   */
  collectGarbage(opts: { now?: Date; retentionDays?: number; maxBytes?: number; maxGroups?: number } = {}): GarbageReport {
    const now = opts.now ?? this.clock()
    const retentionDays = opts.retentionDays ?? ChangeHistory.retentionDays
    const maxBytes = opts.maxBytes ?? ChangeHistory.maxStoreBytes
    const maxGroups = opts.maxGroups ?? ChangeHistory.maxGroups
    if (!existsSync(this.bookPath)) return { removedGroups: 0, removedBlobs: 0, bytes: 0 }
    try {
      return withFileLock(this.lockPath, () => {
        const original = this.lines()
        const all = ChangeHistory.compactLines(original)
        const lastAt = new Map<string, number>()
        const blobsOf = new Map<string, Set<string>>()
        for (const l of all) {
          if (l.t !== 'change' || !l.group) continue
          lastAt.set(l.group, Math.max(lastAt.get(l.group) ?? -Infinity, Date.parse(l.at)))
          for (const h of [l.before, l.after]) if (h && h !== ABSENT && h !== TOO_BIG) blobsOf.set(l.group, (blobsOf.get(l.group) ?? new Set()).add(h))
        }
        const cutoff = now.getTime() - retentionDays * 86_400_000
        const drop = new Set([...lastAt.entries()].filter(([, t]) => t < cutoff).map(([g]) => g))
        const keep = [...lastAt.keys()].filter((g) => !drop.has(g)).sort((x, y) => lastAt.get(x)! - lastAt.get(y)!)
        const size = (h: string): number => { try { return statSync(this.blobPath(h)).size } catch { return 0 } }
        const totalOf = (gs: string[]): number => [...new Set(gs.flatMap((g) => [...(blobsOf.get(g) ?? [])]))].reduce((n, h) => n + size(h), 0)
        let total = totalOf(keep)
        while (keep.length && (total > maxBytes || keep.length > maxGroups)) {
          drop.add(keep.shift()!)
          total = totalOf(keep)
        }
        if (drop.size || all.length !== original.length) {
          const kept = all.filter((l) => {
            switch (l.t) {
              case 'group': return !drop.has(l.id ?? '')
              case 'change': return !drop.has(l.group ?? '')
              case 'undone': return !drop.has(l.group ?? '') && !drop.has(l.by ?? '')
              default: return false
            }
          })
          this.rewriteBook(kept)
          for (const g of drop) this.knownGroups.delete(g)
        }
        // copias huérfanas (también las de un deshacer que no llegó a apuntarse)
        const used = new Set(keep.flatMap((g) => [...(blobsOf.get(g) ?? [])]))
        const journal = parseJSONData(readOrNull(this.journalPath))
        if (journal.ok && isJSONObject(journal.value) && Array.isArray(journal.value.entries)) {
          for (const e of journal.value.entries) if (isJSONObject(e)) for (const k of ['previous', 'next']) if (typeof e[k] === 'string') used.add(e[k] as string)
        }
        let removed = 0
        for (const dir of safeList(this.blobsPath)) {
          for (const f of safeList(join(this.blobsPath, dir))) {
            if (used.has(f)) continue
            try { rmSync(join(this.blobsPath, dir, f)); removed++ } catch { /* nada */ }
          }
        }
        return { removedGroups: drop.size, removedBlobs: removed, bytes: total }
      })
    } catch {
      return { removedGroups: 0, removedBlobs: 0, bytes: 0 }
    }
  }

  private collectGarbageIfDue(): void {
    const now = this.clock().getTime()
    if (this.lastGC !== null && now - this.lastGC < 6 * 3600_000) return
    this.lastGC = now
    this.collectGarbage({ now: new Date(now) })
  }
}

interface Target {
  path: string
  domain: ChangeDomain
  lock?: string
  /** Lo que había al planear. */
  currentHash: string
  /** Lo que se escribirá (null = borrar). */
  result: Buffer | null
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** Cursos de un grupo (los de sus archivos y el suyo). */
export function groupCourseIDs(g: ChangeGroup): Set<string> {
  const s = new Set(g.files.flatMap((f) => (f.courseID ? [f.courseID] : [])))
  if (g.courseID) s.add(g.courseID)
  return s
}

function prune<T extends object>(o: T): T {
  for (const k of Object.keys(o) as Array<keyof T>) if (o[k] === undefined) delete o[k]
  return o
}
