// Contrato IPC del dominio «automations»: automatizaciones, «Aula siempre activa» y la bandeja «Novedades».
// Fechas en ISO 8601. Los cambios llegan con 'automations.changed' (todo) y 'automations.inboxChanged' (lo no leído, para la
// barra lateral y la bandeja del sistema). Al tocar una notificación llega 'automations.open' con la novedad a enseñar.
import type {
  AutomationDraft, AutomationItemView, AutomationRun, AutomationsSnapshot, AutomationSchedule, InboxEntry, ISODate, ProactiveSettings
} from '../automations/types'
import type { SwiftInboxFilter } from '../automations/inbox'

declare module './contract' {
  interface RpcMethods {
    /** Todo lo que enseña la pantalla: automatizaciones, «Aula siempre activa», salud, presupuesto y lo próximo. */
    'automations.snapshot': { args: void; result: AutomationsSnapshot }
    /** La bandeja entera (la interfaz filtra y agrupa). `focus`: la novedad que pidió abrir una notificación. */
    'automations.inbox': { args: void; result: { entries: InboxEntry[]; unread: number; focus?: string } }
    /** Lo no leído (barra lateral). */
    'automations.inboxCount': { args: void; result: { unread: number } }
    'automations.markRead': { args: { ids: string[]; read?: boolean }; result: { changed: string[] } }
    /** Todo lo visible como leído (con un filtro, solo lo de ese filtro). */
    'automations.markAllRead': { args: { filter?: SwiftInboxFilter } | void; result: { changed: string[] } }
    /** Archivar (o sacar del archivo con `archived: false`). Archivar también la marca como leída. */
    'automations.archive': { args: { ids: string[]; archived?: boolean }; result: { changed: string[] } }
    /** «Despejar»: archiva lo ya leído. */
    'automations.archiveRead': { args: void; result: { changed: string[] } }
    /** Posponer hasta una fecha (`null` = deshacer). */
    'automations.snooze': { args: { ids: string[]; until: ISODate | null }; result: { changed: string[] } }
    /** El historial de una automatización (lo más reciente primero); sin `id`, lo último de todas. */
    'automations.runs': { args: { id?: string; limit?: number }; result: AutomationRun[] }
    /** Crea (sin `id`) o cambia una automatización del estudiante. */
    'automations.save': { args: { automation: AutomationDraft }; result: AutomationItemView }
    'automations.setEnabled': { args: { id: string; enabled: boolean }; result: AutomationItemView | null }
    /** Borra una automatización (y su historial); en una rutina, la apaga. */
    'automations.remove': { args: { id: string }; result: void }
    /** «Ejecutar ahora» (no espera al resultado: llega por 'automations.changed'). */
    'automations.runNow': { args: { id: string }; result: { started: boolean } }
    /** Cambia «Aula siempre activa» (rutinas, horas, silencio, avisos, estilo…). */
    'automations.setProactive': { args: { patch: Partial<ProactiveSettings> }; result: AutomationsSnapshot }
    /** Pausa todo hasta una fecha (`null` = reanudar). */
    'automations.pause': { args: { until: ISODate | null }; result: AutomationsSnapshot }
    /** La próxima vez de un horario (para el editor) en la zona del estudiante. */
    'automations.nextRun': { args: { schedule: AutomationSchedule }; result: { next: ISODate | null } }
    /** «Ahora no»: no volver a ofrecer preparar ese examen. */
    'automations.dismissOffer': { args: { eventID: string; entryID?: string }; result: void }
  }
  interface RpcEvents {
    'automations.changed': { reason: string }
    'automations.inboxChanged': { unread: number }
    /** Una notificación (o la bandeja del sistema) pide enseñar una novedad o una automatización. */
    'automations.open': { entryId?: string; automationId?: string; tab?: 'inbox' | 'automations' }
  }
}
export {}
