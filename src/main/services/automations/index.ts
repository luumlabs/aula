// Automatizaciones, «Aula siempre activa», «Novedades» y recordatorios de estudio (sin `electron`).
//
//     configureAutomations({ platforms, notify, withdraw, chat })   // lo de Electron lo inyecta su manejador
//     const c = automationCenter(); c.start()                         // el centro de la carpeta de datos
//     bindPersistentSettings(c)                                       // settings.persistent ⇄ proactive.json
//     studyReminders().start()
//
// El chat (src/main/services/assistant) puede registrarse con `setInboxChatSink({ postSystemMessage })`: cada novedad deja
// entonces su mensaje en «Novedades de Aula». Sin él, el mensaje entero se guarda en la propia entrada de la bandeja.
import { readFileSync } from 'node:fs'
import { aiLocale } from '@shared/ai/i18n'
import { localTimeZone } from '@engine/calendar/time'
import type { AutomationNotice, ProactiveSettings, ProactiveStyle } from '@shared/automations'
import type { PersistentSettings } from '@shared/settings'
import { getSettings, onSettingsChange, updateSettings } from '../settings'
import { calendarService } from '../calendar'
import { getLibrary } from '../store'
import { summary } from '../study'
import { resolveActiveModel } from '../ai'
import { log } from '../log'
import { dataRoot, paths } from '../paths'
import { AutomationCenter } from './center'
import type { AutomationEnvironment, AutomationPlatforms, InboxChatSink } from './env'
import { StudyReminders, type StudyReminderNotice } from './reminders'
import { AutomationStore } from './store'

export * from './env'
export * from './store'
export * from './center'
export * from './attention'
export * from './reminders'
export { runAutomationCheck, AutomationRunError } from './runner'

/** Lo que pone el proceso principal de Electron (navegador, notificaciones, chat). */
export interface AutomationHooks {
  platforms?: () => AutomationPlatforms | null
  notify?: (n: AutomationNotice) => void
  withdraw?: (entryIDs: string[]) => void
  notifyReminder?: (n: StudyReminderNotice) => void
}

let hooks: AutomationHooks = {}
let chatSink: InboxChatSink | null = null

export function configureAutomations(h: AutomationHooks): void {
  hooks = { ...hooks, ...h }
}

/** El chat de Aula se registra aquí (o `null` para quitarlo). */
export function setInboxChatSink(sink: InboxChatSink | null): void {
  chatSink = sink
}

/** El entorno con los servicios de verdad. */
export function defaultEnvironment(): AutomationEnvironment {
  return {
    timeZone: () => localTimeZone(),
    events: async (from, to) => (await calendarService().events(from, to)).events,
    packs: () => { try { return getLibrary().listPacks() } catch { return [] } },
    packIDForEvent: (id) => { try { return calendarService().packID(id) } catch { return undefined } },
    studySummary: async () => { try { return await summary() } catch { return null } },
    model: async () => { try { return await resolveActiveModel() } catch { return null } },
    language: () => aiLocale(),
    platforms: () => hooks.platforms?.() ?? null,
    chat: () => chatSink,
    notify: (n) => hooks.notify?.(n),
    withdraw: (ids) => hooks.withdraw?.(ids)
  }
}

let center: AutomationCenter | null = null
let centerRoot: string | null = null

/** El centro de la carpeta de datos (uno por proceso). */
export function automationCenter(): AutomationCenter {
  const root = dataRoot()
  if (!center || centerRoot !== root) {
    center?.stop()
    center = new AutomationCenter({ store: new AutomationStore(root), env: defaultEnvironment() })
    centerRoot = root
  }
  return center
}

/** Sustituye el centro (pruebas). */
export function setAutomationCenter(c: AutomationCenter | null): void {
  center?.stop()
  center = c
  centerRoot = c ? dataRoot() : null
}

let reminders: StudyReminders | null = null

/** Los recordatorios de estudio de la carpeta de datos. */
export function studyReminders(): StudyReminders {
  if (!reminders) {
    reminders = new StudyReminders({
      store: new AutomationStore(dataRoot()),
      settings: () => getSettings().general,
      packs: () => { try { return getLibrary().listPacks() } catch { return [] } },
      studySummary: async () => { try { return await summary() } catch { return null } },
      calendarReminders: (from, to) => calendarService().pendingReminders(from, to),
      notify: (n) => hooks.notifyReminder?.(n),
      timeZone: () => localTimeZone()
    })
  }
  return reminders
}

// MARK: settings.persistent ⇄ proactive.json

const toProactiveStyle = (s: PersistentSettings['style']): ProactiveStyle => (s === 'quiet' ? 'discreet' : s)
const toSettingsStyle = (s: ProactiveStyle): PersistentSettings['style'] | null => (s === 'discreet' ? 'quiet' : s === 'custom' ? null : s)

/** Lo que dicen los ajustes (enabled, estilo, silencio) aplicado a «Aula siempre activa». */
export function proactivePatchFromSettings(s: PersistentSettings, p: ProactiveSettings): Partial<ProactiveSettings> {
  const patch: Partial<ProactiveSettings> = {}
  if (s.enabled !== p.enabled) patch.enabled = s.enabled
  const mine = toSettingsStyle(p.style)
  if (mine !== null && mine !== s.style) patch.style = toProactiveStyle(s.style)
  const quiet = s.quietHours ? { enabled: true, from: s.quietHours.from, to: s.quietHours.to } : { ...p.quiet, enabled: false }
  if (quiet.enabled !== p.quiet.enabled || quiet.from !== p.quiet.from || quiet.to !== p.quiet.to) patch.quiet = quiet
  return patch
}

/** Al revés: lo que hay que escribir en los ajustes (`null` = nada). */
export function settingsPatchFromProactive(p: ProactiveSettings, s: PersistentSettings): Partial<PersistentSettings> | null {
  const patch: Partial<PersistentSettings> = {}
  if (p.enabled !== s.enabled) patch.enabled = p.enabled
  const st = toSettingsStyle(p.style)
  if (st && st !== s.style) patch.style = st
  const qh = p.quiet.enabled ? { from: p.quiet.from, to: p.quiet.to } : null
  if (JSON.stringify(qh) !== JSON.stringify(s.quietHours)) patch.quietHours = qh
  return Object.keys(patch).length ? patch : null
}

/** ¿El settings.json guardado ya tiene la sección «persistent»? (si no, se respeta lo de la app Swift). */
function settingsFileHasPersistent(): boolean {
  try {
    const raw = JSON.parse(readFileSync(paths.settings(), 'utf8')) as Record<string, unknown>
    return typeof raw === 'object' && raw !== null && 'persistent' in raw
  } catch {
    return false
  }
}

/** Mantiene «Aula siempre activa» igual en Ajustes (settings.persistent) y en `proactive.json`. */
export function bindPersistentSettings(c: AutomationCenter): () => void {
  let syncing = false
  const fromSettings = async (s: PersistentSettings) => {
    const patch = proactivePatchFromSettings(s, c.proactiveSettings())
    if (!Object.keys(patch).length) return
    syncing = true
    try { await c.patchProactive(patch) } catch (err) { log.warn('Aula siempre activa: ajustes', err) } finally { syncing = false }
  }
  // primera vez con datos de la app Swift: si allí estaba encendida, se respeta
  if (!settingsFileHasPersistent() && c.proactiveSettings().enabled) {
    const p = c.proactiveSettings()
    updateSettings({ persistent: { enabled: true, ...(toSettingsStyle(p.style) ? { style: toSettingsStyle(p.style)! } : {}), quietHours: p.quiet.enabled ? { from: p.quiet.from, to: p.quiet.to } : null } })
  } else void fromSettings(getSettings().persistent)
  const off1 = onSettingsChange((next, prev) => {
    if (JSON.stringify(next.persistent) !== JSON.stringify(prev.persistent)) void fromSettings(next.persistent)
  })
  const off2 = c.onChange((reason) => {
    if (reason !== 'proactive' || syncing) return
    const patch = settingsPatchFromProactive(c.proactiveSettings(), getSettings().persistent)
    if (patch) updateSettings({ persistent: patch })
  })
  return () => { off1(); off2() }
}
