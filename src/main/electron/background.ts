// «Aula siempre activa» en Electron: arranca el centro de automatizaciones y los recordatorios, y cuida el ciclo de vida.
//   · con el modo encendido, cerrar la ventana la esconde (Aula sigue en la bandeja haciendo lo programado); apagado, se cierra
//     como siempre;
//   · abrir al iniciar sesión (`app.setLoginItemSettings`), escondida si se abrió así;
//   · al despertar el ordenador o desbloquearlo: recupera lo perdido (con tope) y los recordatorios;
//   · notificaciones: tocar una trae Aula con la novedad; Windows necesita su AppUserModelId para mostrarlas.
// Lo único de esta parte que importa `electron`; la lógica vive en src/main/services/automations.
import { app, BrowserWindow, powerMonitor } from 'electron'
import { navigationPolicy } from '@engine/platforms'
import { tr } from '@shared/ai/i18n'
import { proactiveIsActive } from '@shared/automations'
import type { AppCommand } from '@shared/ipc'
import {
  automationCenter, bindPersistentSettings, configureAutomations, setInboxChatSink, studyReminders, type AutomationPlatforms, type StudyReminderNotice
} from '@main/services/automations'
import { postSystemMessage } from '@main/services/assistant'
import { seedDemoAutomations } from '@main/services/automations/demo'
import { AulaError } from '@main/services/errors'
import { getSettings, onSettingsChange } from '@main/services/settings'
import { onCalendarChange } from '@main/services/calendar'
import { onCourseChanged } from '@main/services/store'
import { log } from '@main/services/log'
import { platformBrowser } from './browser'
import { emit } from './rpc'
import { createMainWindow, getMainWindow } from './window'
import { startHiddenAtLogin } from './visibility'
import { focusMainWindow, postAutomationNotice, postReminderNotice, setUnreadBadge, withdrawNotices } from './notifications'
import { hideTray, showTray, updateTray } from './tray'

const APP_ID = 'com.luumlabs.aula'
let quitting = false
let started = false

/** ¿Se abrió sola al iniciar sesión? */
function launchedAtLogin(): boolean {
  if (process.argv.includes('--hidden')) return true
  try { return process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin === true } catch { return false }
}

/** La ventana principal al frente (la crea si se cerró) y, cuando haya cargado, el comando. */
function bringAula(command?: AppCommand, after?: () => void): void {
  const win = focusMainWindow() ?? createMainWindow()
  const send = () => {
    if (command) emit('app.command', { command })
    after?.()
  }
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(send, 400))
  else send()
}

/** Abre «Novedades» con una novedad (al tocar su notificación o la bandeja). */
export function openInbox(entryId?: string): void {
  const center = automationCenter()
  center.pendingFocus = entryId
  bringAula('goInbox', () => emit('automations.open', { ...(entryId ? { entryId } : {}), tab: 'inbox' }))
}

function openReminder(r: StudyReminderNotice): void {
  bringAula(r.target.kind === 'calendar' ? 'goCalendar' : 'goHome')
}

/** El navegador de plataformas en solo lectura para las revisiones (nunca pulsa, escribe, descarga ni inicia sesión). */
function platformAccess(): AutomationPlatforms | null {
  let b: ReturnType<typeof platformBrowser>
  try { b = platformBrowser() } catch { return null }
  const allowed = (url: string) => {
    const policy = navigationPolicy(url, b.accountForURL(url))
    if (policy.decision !== 'allow') throw new AulaError('blocked', policy.aiReason)
  }
  return {
    accounts: () => b.listAccounts().map((a) => ({ id: a.id, label: a.label, kind: a.kindName, url: a.baseURL })),
    readiness: () => (b.listAccounts().length ? null : 'no study platform is configured in Settings'),
    read: async (url, o) => {
      allowed(url)
      const r = await b.read(url, { tab: o.tab, offset: o.offset, maxCharacters: 12_000, signal: o.signal, timeoutMs: 45_000 })
      return { url: r.page.url, title: r.page.title, needsLogin: r.page.needsLogin, text: r.fenced, nextOffset: r.nextOffset }
    },
    links: async (url, o) => {
      allowed(url)
      const r = await b.links(url, { tab: o.tab, signal: o.signal, timeoutMs: 45_000 })
      return { url: r.page.url, title: r.page.title, needsLogin: r.page.needsLogin, text: r.fenced, nextOffset: null }
    },
    closeTab: (tab) => {
      for (const a of b.listAccounts()) { try { b.closeTab({ accountId: a.id, tab }) } catch { /* nada */ } }
      try { b.closeTab({ accountId: null, tab }) } catch { /* nada */ }
    }
  }
}

/** Con «Aula siempre activa», cerrar la ventana la esconde. */
function guardWindow(win: BrowserWindow): void {
  win.on('close', (e) => {
    if (quitting || win !== getMainWindow() || !getSettings().persistent.enabled) return
    e.preventDefault()
    win.hide()
  })
}

function applyLoginItem(openAtLogin: boolean): void {
  if (!app.isPackaged || process.platform === 'linux') return
  try { app.setLoginItemSettings({ openAtLogin, args: ['--hidden'] }) } catch (err) { log.warn('Abrir al iniciar sesión', err) }
}

let trayTimer: ReturnType<typeof setTimeout> | null = null

/** La bandeja y la insignia con lo no leído (agrupando los cambios seguidos). */
function refreshPresence(): void {
  if (trayTimer) return
  trayTimer = setTimeout(() => {
    trayTimer = null
    void (async () => {
      const center = automationCenter()
      const p = center.proactiveSettings()
      const unread = center.unread()
      setUnreadBadge(p.dockBadge ? unread : 0)
      if (!getSettings().persistent.enabled) { hideTray(); return }
      const active = proactiveIsActive(p)
      let status = active ? tr('Aula siempre activa', 'Aula always on') : tr('Aula siempre activa · en pausa', 'Aula always on · paused')
      if (active) {
        const next = (await center.items()).filter((i) => i.automation.enabled && i.nextRun).sort((a, b) => Date.parse(a.nextRun!) - Date.parse(b.nextRun!))[0]
        if (next?.nextRun) {
          const at = new Intl.DateTimeFormat(tr('es-ES', 'en-US'), { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(Date.parse(next.nextRun))
          status += ' · ' + tr(`próxima: ${at}`, `next: ${at}`)
        }
      }
      showTray({
        open: () => bringAula(),
        inbox: () => openInbox(),
        study: () => bringAula('studyNow'),
        togglePause: () => void center.pause(proactiveIsActive(center.proactiveSettings()) ? Date.now() + 3650 * 86_400_000 : null),
        quit: () => { quitting = true; app.quit() }
      }, { unread, paused: !active, status })
    })().catch((err) => log.warn('Bandeja', err))
  }, 250)
}

/** Arranca lo que Aula hace sola. Llamar tras registrar los manejadores del IPC y antes de crear la ventana. */
export function startBackground(): void {
  if (started) return
  started = true
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
  const settings = getSettings()
  // abierta al iniciar sesión con el modo encendido: empieza escondida, en la bandeja
  if (settings.persistent.enabled && launchedAtLogin()) startHiddenAtLogin()

  configureAutomations({
    platforms: platformAccess,
    notify: (n) => postAutomationNotice(n, {
      open: (entryId) => openInbox(entryId),
      snooze: (entryId) => { automationCenter().snooze([entryId], Date.now() + 3_600_000) },
      read: (ids) => { automationCenter().markRead(ids) }
    }),
    withdraw: (ids) => withdrawNotices(ids),
    notifyReminder: (r) => postReminderNotice(r, openReminder)
  })

  // cada novedad deja también su mensaje en el chat («Novedades de Aula» o la conversación del seguimiento)
  setInboxChatSink({ postSystemMessage: (threadId, message) => postSystemMessage(threadId, message) })

  const center = automationCenter()
  // capturas y desarrollo: una bandeja de ejemplo
  if (!app.isPackaged && process.env.AULA_SEED === 'demo') seedDemoAutomations(center)
  bindPersistentSettings(center)
  center.start()
  studyReminders().start()
  center.onChange(() => refreshPresence())
  refreshPresence()

  // cerrar la ventana con el modo encendido = esconderla
  const current = getMainWindow()
  if (current) guardWindow(current)
  app.on('browser-window-created', (_e, win) => setImmediate(() => { if (win === getMainWindow()) guardWindow(win) }))
  app.on('before-quit', () => { quitting = true })

  // al despertar el ordenador (o desbloquearlo): lo perdido, con tope, y los recordatorios
  const wake = () => {
    center.invalidateEvents()
    void center.tick()
    studyReminders().poke()
  }
  powerMonitor.on('resume', wake)
  powerMonitor.on('unlock-screen', wake)

  applyLoginItem(settings.persistent.openAtLogin)
  onSettingsChange((next, prev) => {
    if (next.persistent.openAtLogin !== prev.persistent.openAtLogin) applyLoginItem(next.persistent.openAtLogin)
    if (next.persistent.enabled !== prev.persistent.enabled) {
      refreshPresence()
      // apagado con la ventana escondida: que vuelva (si no, Aula seguiría abierta sin forma de verla)
      const win = getMainWindow()
      if (!next.persistent.enabled && win && !win.isVisible()) focusMainWindow()
    }
    if (next.general.reminders !== prev.general.reminders || next.general.reminderTime !== prev.general.reminderTime) studyReminders().poke()
    // el menú de la bandeja se rehace en el idioma nuevo (el idioma ya lo cambió installUILanguage, que escucha antes)
    if (next.general.language !== prev.general.language && next.persistent.enabled === prev.persistent.enabled) refreshPresence()
  })
  onCalendarChange(() => { center.invalidateEvents(); void center.tick(); studyReminders().poke() })
  onCourseChanged(() => studyReminders().poke())
}
