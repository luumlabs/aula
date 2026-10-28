// Almacén de las automatizaciones (AutomationStore.swift), en `<datos>/Automations/`:
//     automations.json   definiciones (las del estudiante, las rutinas y los seguimientos de la IA)
//     proactive.json     «Aula siempre activa»
//     state.json         estado de cada una + uso de IA por día + avisos
//     inbox.json         bandeja «Novedades» (leído, archivado, pospuesto)
//     runs/<id>.json     historial (las 60 más recientes)
//     reminders.json     Electron: recordatorios de estudio ya avisados (la app Swift los dejaba al sistema)
// A prueba de cortes: lo importante se escribe en un temporal con fsync, se guarda la versión anterior como `.bak` y se cambia
// de nombre de golpe. Lectura tolerante: un archivo ilegible se aparta como `.damaged` y se usa el `.bak` (o se empieza de cero).
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { randomBytes } from 'node:crypto'
import { IDs } from '@engine/base/ids'
import type { Automation, AutomationBook, AutomationRun, InboxEntry, ProactiveSettings } from '@shared/automations'
import { log } from '../log'
import { decodeAutomation, decodeBook, decodeInboxEntry, decodeProactive, decodeRun, isObj } from './codec'

/** Historial por automatización. */
export const RUNS_KEPT = 60

/** Escritura a prueba de cortes: temporal + fsync + copia de la versión anterior (`.bak`) + cambio de nombre atómico. */
export function durableWrite(file: string, data: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = join(dirname(file), `.${basename(file)}.${randomBytes(3).toString('hex')}.tmp`)
  const fd = openSync(tmp, 'w', 0o644)
  try {
    const buf = Buffer.from(data, 'utf8')
    let off = 0
    while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off)
    try { fsyncSync(fd) } catch { /* sistemas de archivos sin fsync */ }
  } finally {
    closeSync(fd)
  }
  try {
    if (existsSync(file)) copyFileSync(file, file + '.bak')
    renameSync(tmp, file)
  } catch (err) {
    try { rmSync(tmp, { force: true }) } catch { /* nada */ }
    throw err
  }
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

export class AutomationStore {
  readonly root: string

  /** `dataRoot` = la carpeta de datos de Aula (la de `settings.json`). */
  constructor(dataRoot: string) {
    this.root = join(dataRoot, 'Automations')
  }

  get automationsFile(): string { return join(this.root, 'automations.json') }
  get proactiveFile(): string { return join(this.root, 'proactive.json') }
  get bookFile(): string { return join(this.root, 'state.json') }
  get inboxFile(): string { return join(this.root, 'inbox.json') }
  get remindersFile(): string { return join(this.root, 'reminders.json') }
  get runsDirectory(): string { return join(this.root, 'runs') }

  // MARK: Lectura y escritura

  private parse(file: string): unknown {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown
  }

  /** Lee un JSON; si está roto lo aparta (`.damaged`) y usa la copia anterior. `undefined` = no hay nada que leer. */
  private read(file: string): unknown {
    const backup = file + '.bak'
    if (!existsSync(file)) {
      if (!existsSync(backup)) return undefined
      try { return this.parse(backup) } catch { return undefined }
    }
    try {
      return this.parse(file)
    } catch (err) {
      const aside = file + '.damaged'
      try { rmSync(aside, { force: true }); renameSync(file, aside) } catch { /* nada */ }
      try {
        const good = this.parse(backup)
        log.warn(`Automatizaciones: ${basename(file)} no se pudo leer (${String(err)}); uso la copia anterior`)
        return good
      } catch {
        log.warn(`Automatizaciones: ${basename(file)} no se pudo leer (${String(err)}); apartado como .damaged`)
        return undefined
      }
    }
  }

  private write(file: string, value: unknown, durable = true): void {
    try {
      if (durable) durableWrite(file, json(value))
      else {
        mkdirSync(dirname(file), { recursive: true })
        const tmp = join(dirname(file), `.${basename(file)}.${randomBytes(3).toString('hex')}.tmp`)
        writeFileSync(tmp, json(value))
        renameSync(tmp, file)
      }
    } catch (err) {
      log.warn(`Automatizaciones: no pude guardar ${basename(file)}`, err)
    }
  }

  automations(): Automation[] {
    const raw = this.read(this.automationsFile)
    if (!isObj(raw)) return []
    return (Array.isArray(raw.automations) ? raw.automations : []).map((a) => decodeAutomation(a)).filter((a): a is Automation => !!a)
  }

  saveAutomations(list: readonly Automation[]): void {
    this.write(this.automationsFile, { version: 1, automations: list })
  }

  /** `null` = aún no hay `proactive.json`. */
  proactive(): ProactiveSettings | null {
    const raw = this.read(this.proactiveFile)
    return raw === undefined ? null : decodeProactive(raw)
  }

  saveProactive(p: ProactiveSettings): void {
    this.write(this.proactiveFile, p)
  }

  book(): AutomationBook {
    return decodeBook(this.read(this.bookFile))
  }

  saveBook(b: AutomationBook): void {
    this.write(this.bookFile, b)
  }

  /** `null` = aún no hay bandeja. */
  inbox(): InboxEntry[] | null {
    const raw = this.read(this.inboxFile)
    if (!isObj(raw)) return null
    return (Array.isArray(raw.entries) ? raw.entries : []).map(decodeInboxEntry).filter((e): e is InboxEntry => !!e)
  }

  saveInbox(entries: readonly InboxEntry[]): void {
    this.write(this.inboxFile, { version: 1, entries })
  }

  /** Datos sueltos de esta versión (recordatorios de estudio). */
  readExtra(file: string): unknown {
    return this.read(file)
  }

  writeExtra(file: string, value: unknown): void {
    this.write(file, value)
  }

  // MARK: Historial

  runsFile(automationID: string): string {
    return join(this.runsDirectory, `${IDs.slug(automationID, 64)}.json`)
  }

  /** Las ejecuciones de una automatización, de la más reciente a la más antigua. */
  runs(automationID: string): AutomationRun[] {
    const raw = this.read(this.runsFile(automationID))
    return (Array.isArray(raw) ? raw : []).map(decodeRun).filter((r): r is AutomationRun => !!r)
  }

  /** Añade o actualiza una ejecución (la más reciente primero, como mucho `RUNS_KEPT`). */
  record(run: AutomationRun): void {
    const list = this.runs(run.automationID).filter((r) => r.id !== run.id)
    list.unshift(run)
    this.write(this.runsFile(run.automationID), list.slice(0, RUNS_KEPT), false)
  }

  /** Las más recientes de todas. */
  recentRuns(limit = 30): AutomationRun[] {
    let files: string[] = []
    try { files = readdirSync(this.runsDirectory).filter((f) => f.endsWith('.json')) } catch { return [] }
    const all = files.flatMap((f) => {
      const raw = this.read(join(this.runsDirectory, f))
      return (Array.isArray(raw) ? raw : []).map(decodeRun).filter((r): r is AutomationRun => !!r)
    })
    return all.sort((a, b) => Date.parse(b.started) - Date.parse(a.started)).slice(0, limit)
  }

  /** Borra el historial de una automatización. */
  deleteData(automationID: string): void {
    for (const f of [this.runsFile(automationID), this.runsFile(automationID) + '.bak']) {
      try { rmSync(f, { force: true }) } catch { /* nada */ }
    }
  }
}
