// Contrato IPC del dominio «calendar»: el calendario de Aula (plataformas + exámenes de los cursos + eventos propios).
// Fechas en ISO 8601. Ids completos: `own:<id>`, `own:<id>#<clave>` (una repetición), `course:<curso>`, `platform:<cuenta>:<uid>`.
import type {
  CalendarChange, CalendarDraftInput, CalendarEditScope, CalendarEventView, CalendarExportOptions, CalendarImportResult, CalendarPatchInput,
  CalendarQuickAddResult, CalendarRefreshResult, CalendarReminderView, CalendarSnapshotView, CalendarSubscribeInput, CalendarSubscriptionView
} from '../calendar'

declare module './contract' {
  interface RpcMethods {
    /** Los eventos entre dos fechas, ordenados (en una repetición, `id` es la serie y `occurrenceKey` la repetición). */
    'calendar.list': { args: { from: string; to: string; refresh?: boolean }; result: CalendarEventView[] }
    /** Igual que `calendar.list` con el aviso de las plataformas que fallaron y cuándo se leyeron. */
    'calendar.snapshot': { args: { from: string; to: string; refresh?: boolean }; result: CalendarSnapshotView }
    /** Un evento por su id completo. */
    'calendar.get': { args: { id: string }; result: CalendarEventView | null }
    'calendar.search': { args: { query: string; from?: string; to?: string }; result: CalendarEventView[] }
    /** Exámenes y quizzes de los próximos `days` días (60 por defecto), del más cercano al más lejano. */
    'calendar.upcomingExams': { args: { days?: number }; result: CalendarEventView[] }
    /** Añade un evento propio. */
    'calendar.add': { args: CalendarDraftInput; result: CalendarEventView }
    /** Cambia un evento (propio: todo; de un curso: fecha, título, notas y lugar). En una repetición, `scope` (por defecto, solo esa). */
    'calendar.update': { args: { id: string; patch: CalendarPatchInput; scope?: CalendarEditScope }; result: CalendarEventView }
    /** Borra un evento propio (o la fecha del examen de un curso). En una repetición, `scope` (por defecto, solo esa). */
    'calendar.delete': { args: { id: string; scope?: CalendarEditScope }; result: void }
    /** «Añadir rápido»: entiende la frase; con `commit`, la guarda. `null` si la frase está vacía. */
    'calendar.quickAdd': { args: { text: string; commit?: boolean }; result: CalendarQuickAddResult | null }
    /** Marca o desmarca una tarea (`occurrence`: la clave de la repetición; `done`: el estado deseado, si no, se invierte). */
    'calendar.toggleTask': { args: { id: string; occurrence?: string; done?: boolean }; result: { done: boolean } }
    /** Vincula (o desvincula con `null`) un evento con el curso de Aula creado para él. */
    'calendar.link': { args: { eventID: string; packID: string | null }; result: void }
    /** Vuelve a leer los calendarios de las plataformas y las suscripciones. */
    'calendar.refreshFeeds': { args: void; result: CalendarRefreshResult }
    /** Los calendarios a los que te suscribiste (sin sus enlaces). */
    'calendar.subscriptions': { args: void; result: CalendarSubscriptionView[] }
    /** Se suscribe a un calendario .ics (webcal:// o https://): lo lee una vez y guarda el enlace cifrado. */
    'calendar.subscribe': { args: CalendarSubscribeInput; result: CalendarSubscriptionView }
    'calendar.renameSubscription': { args: { id: string; name: string }; result: CalendarSubscriptionView }
    /** Quita una suscripción (su enlace, su copia y sus eventos). */
    'calendar.unsubscribe': { args: { id: string }; result: void }
    /** Vuelve a leer una suscripción ahora. */
    'calendar.refreshSubscription': { args: { id: string }; result: CalendarSubscriptionView }
    /** Importa un archivo .ics (una vez) con el diálogo de abrir. `null` si se cancela. */
    'calendar.importICS': { args: void; result: CalendarImportResult | null }
    /** Exporta a .ics con el diálogo de guardar. */
    'calendar.exportICS': { args: CalendarExportOptions | void; result: { saved: boolean; path?: string } }
    /** Los avisos que tocan entre dos fechas (para programar notificaciones). */
    'calendar.reminders': { args: { from: string; to: string }; result: CalendarReminderView[] }
  }
  interface RpcEvents {
    'calendar.changed': CalendarChange
  }
}
export {}
