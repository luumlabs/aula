// Estado de la pantalla «Novedades» (pestaña, vista, filtro, búsqueda, lo abierto y el editor). Otros sitios (Ajustes, una
// notificación) pueden abrir la pantalla en una pestaña con `openInboxTab`.
import { create } from 'zustand'
import type { AutomationDraft } from '@shared/automations'
import type { InboxFilter, InboxView } from '@shared/automations/inbox'
import { navigate } from '@renderer/app/router'

export type InboxTab = 'inbox' | 'automations'

interface InboxUI {
  tab: InboxTab
  view: InboxView
  filter: InboxFilter
  query: string
  byKind: boolean
  selected: string | null
  expanded: string | null
  /** El editor abierto (con lo que se está escribiendo) o `null`. */
  editing: AutomationDraft | null
  /** La automatización cuyo historial se ve. */
  history: string | null
  set: (p: Partial<Omit<InboxUI, 'set'>>) => void
}

export const useInboxUI = create<InboxUI>((set) => ({
  tab: 'inbox',
  view: 'open',
  filter: 'all',
  query: '',
  byKind: false,
  selected: null,
  expanded: null,
  editing: null,
  history: null,
  set: (p) => set(p)
}))

/** Abre «Novedades» en una pestaña (y, si se da, con una novedad abierta). */
export function openInboxTab(tab: InboxTab, entryId?: string): void {
  useInboxUI.getState().set({ tab, ...(entryId ? { selected: entryId, expanded: entryId, view: 'open', filter: 'all', query: '' } : {}) })
  navigate({ name: 'inbox' })
}
