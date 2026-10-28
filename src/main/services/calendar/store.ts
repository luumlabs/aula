// `<datos>/calendar.json` en disco (la parte de archivo de StudyCalendar.swift): lectura tolerante, escrituras atómicas con
// cerrojo entre procesos (la app y el ayudante MCP pueden escribir a la vez) y, si lo cambia Aula (chat, tutor), una entrada
// en el historial para poder deshacerlo. Cada escritura deja la versión anterior en `.calendar.json.bak` (A3-P2-9): si el
// archivo se daña, se lee de ahí; si tampoco se puede, se aparta una copia (`calendar.json.damaged-…`) y se avisa ya al leer,
// en vez de enseñar un calendario vacío sin decir nada. Uno de una versión más nueva de Aula no se toca.
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseJSON } from '@engine/base/json'
import {
  CALENDAR_FILE_SCHEMA, CalendarError, CalendarMessages, calendarFileText, decodeCalendarFile, emptyCalendarFile, type CalendarFile
} from '@engine/calendar'
import { keepDamagedCopy, readWithBackup, writeFileAtomic } from '../fs'
import { log } from '../log'
import type { ChangeHistory } from '../store/history/changeHistory'
import { ChangeContext } from '../store/history/context'
import { withFileLock } from '../store/lock'

export interface CalendarStoreOptions {
  /** Dónde se apunta lo que cambia Aula (sin él, no se apunta). */
  history?: () => ChangeHistory | undefined
  now?: () => Date
}

export class CalendarStore {
  readonly root: string
  private readonly history: () => ChangeHistory | undefined
  private readonly now: () => Date
  /** Se llama tras cada escritura de este proceso. */
  onWrite?: () => void

  constructor(root: string, opts: CalendarStoreOptions = {}) {
    this.root = root
    this.history = opts.history ?? (() => undefined)
    this.now = opts.now ?? (() => new Date())
  }

  get fileURL(): string { return join(this.root, 'calendar.json') }
  /** Cerrojo del calendario (`.calendar.lock` de Swift). */
  get lockPath(): string { return join(this.root, '.calendar.aula-lock') }

  private parse(text: string): CalendarFile {
    return decodeCalendarFile(parseJSON(text), this.now)
  }

  /** Si el calendario no se pudo leer (ni su copia anterior): la frase para el estudiante. La interfaz la enseña al abrirlo. */
  problem: string | undefined

  /** El archivo; si está dañado, su versión anterior (`.bak`); vacío si no existe o no hay nada legible (con `problem`). */
  read(): CalendarFile {
    this.problem = undefined
    if (!existsSync(this.fileURL)) return emptyCalendarFile()
    const r = readWithBackup(this.fileURL, (text) => this.parse(text))
    if (r) {
      if (r.fromBackup) log.warn('Calendario: calendar.json no se podía leer; uso su copia anterior')
      return r.value
    }
    const copy = this.keepDamaged()
    this.problem = copy ? CalendarMessages.unreadable(copy) : undefined
    return emptyCalendarFile()
  }

  /** Copia del archivo dañado al lado (una por contenido); su nombre. */
  private keepDamaged(): string | undefined {
    try {
      const copy = keepDamagedCopy(this.fileURL, readFileSync(this.fileURL, 'utf8'))
      return copy ? basename(copy) : undefined
    } catch {
      return undefined
    }
  }

  /** Para escribir: un archivo dañado se recupera de su copia anterior; si no hay, se aparta y se avisa. Uno de una versión
   * más nueva no se toca. */
  private readForWrite(): CalendarFile {
    if (!existsSync(this.fileURL)) return emptyCalendarFile()
    const r = readWithBackup(this.fileURL, (text) => this.parse(text))
    if (!r) {
      const name = this.keepDamaged() ?? 'calendar.json.damaged'
      // su copia ya está aparte: el siguiente intento empieza uno vacío
      rmSync(this.fileURL, { force: true })
      log.warn(`Calendario: calendar.json no se podía leer; se apartó como ${name}`)
      throw CalendarError.invalid(CalendarMessages.damaged(name))
    }
    const f = r.value
    if (f.schema > CALENDAR_FILE_SCHEMA) throw CalendarError.invalid(CalendarMessages.newerVersion)
    // el dañado ya tiene su copia aparte; se quita para que la escritura no lo guarde como la «versión anterior» buena
    if (r.fromBackup) rmSync(this.fileURL, { force: true })
    return f
  }

  /** Lee, modifica y guarda de forma atómica (seguro frente a otros procesos). Si `body` lanza, no se escribe nada. */
  modify<T>(body: (f: CalendarFile) => T): T {
    mkdirSync(this.root, { recursive: true })
    return withFileLock(this.lockPath, () => {
      const f = this.readForWrite()
      const out = body(f)
      f.schema = CALENDAR_FILE_SCHEMA
      const data = Buffer.from(calendarFileText(f), 'utf8')
      // lo que cambia Aula (chat, tutor) va al historial; lo del estudiante, no
      const history = ChangeContext.current ? this.history() : undefined
      let before: Buffer | null = null
      if (history) {
        try { before = readFileSync(this.fileURL) } catch { before = null }
      }
      writeFileAtomic(this.fileURL, data, { backup: true })
      history?.record({ file: this.fileURL, before, after: data, domain: 'calendar', lockFile: this.lockPath })
      this.onWrite?.()
      return out
    })
  }
}
