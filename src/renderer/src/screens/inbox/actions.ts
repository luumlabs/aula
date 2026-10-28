// Lo que hacen los botones de las novedades (las tarjetas que dejó Aula) y las operaciones de la bandeja, con aviso si fallan.
import i18n from '@renderer/i18n'
import { toast } from '@renderer/design'
import { api } from '@renderer/lib/api'
import { navigate } from '@renderer/app/router'
import type { AssistantCardAction } from '@shared/assistant/types'
import type { InboxEntry } from '@shared/automations'
import { useInboxUI } from './state'

function fail(e: unknown): void {
  toast.error(e instanceof Error ? e.message : String(e))
}

export const inboxOps = {
  markRead: (ids: string[], read = true) => void api.invoke('automations.markRead', { ids, read }).catch(fail),
  markAllRead: () => void api.invoke('automations.markAllRead').catch(fail),
  archive: (ids: string[], archived = true) => void api.invoke('automations.archive', { ids, archived }).catch(fail),
  archiveRead: () => void api.invoke('automations.archiveRead').catch(fail),
  snooze: (ids: string[], until: number | null) => void api.invoke('automations.snooze', { ids, until: until === null ? null : new Date(until).toISOString() }).catch(fail),
  runNow: async (id: string) => {
    try {
      const r = await api.invoke('automations.runNow', { id })
      if (r.started) toast.info(i18n.t('inbox:automations.started'))
    } catch (e) { fail(e) }
  },
  setEnabled: (id: string, enabled: boolean) => void api.invoke('automations.setEnabled', { id, enabled }).catch(fail),
  remove: (id: string) => void api.invoke('automations.remove', { id }).catch(fail)
}

/** Abre una automatización (pestaña «Automatizaciones», con su historial). */
export function openAutomation(id: string | undefined): void {
  useInboxUI.getState().set({ tab: 'automations', history: id ?? null })
  navigate({ name: 'inbox' })
}

/** «Responder»: la conversación del mensaje (si está en el chat) o una nueva sobre la novedad; en las dos, la caja ya trae
 * «Sobre “…”: » (si el hilo no existe, el chat empieza uno nuevo con ese texto: J2-5). */
export function replyTo(entry: InboxEntry, chatLinked: boolean): void {
  const prompt = i18n.t('inbox:detail.replyPrompt', { title: entry.title })
  navigate({ name: 'chat', ...(chatLinked && entry.threadID ? { conversation: entry.threadID } : {}), prompt })
}

/** Ejecuta el botón de una tarjeta. */
export function runCardAction(a: AssistantCardAction, entry: InboxEntry): void {
  const v = a.value
  switch (a.kind) {
    case 'ask':
      return navigate({ name: 'chat', ...(v ? { prompt: v } : {}) })
    case 'open': {
      const id = a.ref?.courseID ?? a.courseID
      if (!id) return
      return navigate({ name: 'course', id, ...(v === 'exam' || v === 'mistakes' ? { tab: v } : {}) })
    }
    case 'openURL':
      if (v && /^https?:\/\//i.test(v)) void api.invoke('app.openExternal', { url: v }).catch(fail)
      return
    case 'prepareCourse':
    case 'adjustCourse':
      return navigate({ name: 'create', prefill: { ...(v ? { eventId: v } : {}), fromPlatform: true } })
    case 'extendCourse':
      if (a.courseID) return navigate({ name: 'course', id: a.courseID })
      return
    case 'signIn':
      return navigate({ name: 'settings', section: 'platforms' })
    case 'runAutomation':
      if (v ?? entry.automationID) void inboxOps.runNow((v ?? entry.automationID)!)
      return
    case 'openAutomation':
      return openAutomation(v ?? entry.automationID)
    case 'pauseAutomation':
      if (v) inboxOps.setEnabled(v, false)
      return
    case 'cancelAutomation':
      if (v) inboxOps.remove(v)
      return
    case 'openToday':
      return navigate({ name: 'home' })
    case 'openCalendar':
      return navigate({ name: 'calendar' })
    case 'openSettings':
      if (v === 'automations') return openAutomation(undefined)
      return navigate({ name: 'settings', ...(v ? { section: v } : {}) })
    case 'neverForEvent':
      if (v) void api.invoke('automations.dismissOffer', { eventID: v, entryID: entry.id }).catch(fail)
      return
    case 'dismiss':
      inboxOps.markRead([entry.id])
      return
  }
}
