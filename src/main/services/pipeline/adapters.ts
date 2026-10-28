// Los servicios reales que reciben las herramientas de la generación: búsqueda en los materiales (BM25), importar materiales
// nuevos al curso (páginas web guardadas, archivos de la plataforma) y las fechas de los calendarios conectados.
import type { CalendarEvent } from '@engine/calendar/model'
import type { SourceMeta } from '@shared/schema'
import { calendarService } from '../calendar'
import { importSourceIntoPack, registerSource } from '../ingest'
import { searchCourse } from '../search/course'
import type { PackStore } from '../store'
import type { CampusEvent, CampusProviding, SourceImporting, SourceSearching } from '../tools'

export function courseSearch(store: PackStore): SourceSearching {
  return { search: (query, limit, sourceIDs) => searchCourse(store.directory, query, { limit, sourceIDs }) }
}

/** Con la dirección o el tipo que no da la lectura (una página guardada como texto es «web»). */
function withOrigin(store: PackStore, meta: SourceMeta, url?: string, kind?: string): SourceMeta {
  if (!url && !kind) return meta
  const m: SourceMeta = { ...meta }
  if (url) m.url = url
  if (kind) m.kind = kind
  registerSource(store.directory, m, store)
  return m
}

export function packImporter(store: PackStore): SourceImporting {
  return {
    async importText(text, title, trust, opts = {}) {
      const r = await importSourceIntoPack(store.directory, { type: 'text', text, title }, { trust, note: opts.note, store, signal: opts.signal })
      return withOrigin(store, r.meta, opts.url, opts.kind)
    },
    async importFile(path, trust, opts = {}) {
      const r = await importSourceIntoPack(store.directory, { type: 'file', path, title: opts.title }, { trust, store, signal: opts.signal })
      return withOrigin(store, r.meta, opts.url)
    }
  }
}

const isExam = (e: CalendarEvent): boolean => e.kind === 'exam' || e.kind === 'quiz'

/** Las fechas de los próximos días (plataformas, cursos y propias) para `upcoming_dates`. */
export function calendarCampus(now: () => Date = () => new Date()): CampusProviding {
  return {
    async upcoming(days) {
      const from = now()
      const to = new Date(from.getTime() + days * 86_400_000)
      const snap = await calendarService().events(from, to)
      return snap.events.filter((e) => !e.task?.done).map((e): CampusEvent => {
        const c: CampusEvent = { title: e.title, start: e.start, kind: e.kind, isExam: isExam(e) }
        if (e.course) c.course = e.course
        if (e.platformCourseID !== undefined) c.courseID = e.platformCourseID
        if (e.notes) c.details = e.notes
        return c
      })
    }
  }
}
