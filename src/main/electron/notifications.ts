// Notificaciones del sistema (AulaNotifications.swift). Lo decide el motor (`AutomationNotice`: nivel, grupo, sonido, a qué
// entrada de «Novedades» pertenece); aquí solo se publica: título corto (la cosa), subtítulo con el curso o el tipo (macOS),
// cuerpo con qué pasó y qué hacer. Una por entrada (si se repite, se reemplaza) y, al leerla o archivarla en Aula, se quita.
// Lo pasivo no salta (queda en «Novedades» y en la bandeja), salvo lo que necesita al estudiante, que sale sin sonido. Con
// Aula delante, lo que no es urgente tampoco salta: ya se ve en la barra lateral.
import { app, BrowserWindow, Notification } from 'electron'
import { join } from 'node:path'
import { tr } from '@shared/ai/i18n'
import type { AutomationNotice } from '@shared/automations'
import type { StudyReminderNotice } from '@main/services/automations'
import { log } from '@main/services/log'
import { getMainWindow } from './window'
import { reveal } from './visibility'

export interface NoticeHandlers {
  /** Tocar la notificación (o «Abrir»): trae Aula con la novedad. */
  open(entryID: string | undefined): void
  snooze(entryID: string): void
  read(entryIDs: string[]): void
}

/** Las que siguen vivas (si no se guardan, el recolector se lleva el clic). */
const live = new Map<string, Notification>()

function iconPath(): string | undefined {
  return process.platform === 'darwin' ? undefined : join(__dirname, '../../resources/icon.png')
}

function appFocused(): boolean {
  const win = getMainWindow()
  return !!win && win.isVisible() && win.isFocused() && !win.isMinimized()
}

function remember(id: string, n: Notification): void {
  live.get(id)?.close()
  live.set(id, n)
  const forget = () => { if (live.get(id) === n) live.delete(id) }
  n.on('close', forget)
  n.on('failed', (_e, err) => { forget(); log.warn('Notificación', err) })
}

/** Trae la ventana principal al frente. */
export function focusMainWindow(): BrowserWindow | null {
  const win = getMainWindow()
  if (!win) return null
  if (reveal(win) && process.platform === 'darwin') app.focus({ steal: true })
  return win
}

/** Publica (o reemplaza) la notificación de una entrada o de un resumen de avisos. */
export function postAutomationNotice(n: AutomationNotice, h: NoticeHandlers): void {
  if (!Notification.isSupported()) return
  const urgent = n.level === 'timeSensitive' || n.priority === 2
  if (n.level === 'passive' && n.kind !== 'problem') return
  if (appFocused() && !urgent) return
  const id = n.kind === 'digest' ? 'aula.digest' : 'aula.n.' + (n.entryID ?? Math.random().toString(36).slice(2))
  const entries = n.entryIDs.length ? n.entryIDs : n.entryID ? [n.entryID] : []
  const mac = process.platform === 'darwin'
  const actions = mac && n.entryID && n.kind !== 'digest'
    ? [{ type: 'button' as const, text: tr('Posponer 1 h', 'Snooze 1 h') }, { type: 'button' as const, text: tr('Marcar como leído', 'Mark as read') }]
    : mac && n.kind === 'digest' ? [{ type: 'button' as const, text: tr('Marcar todo como leído', 'Mark all as read') }] : []
  const notif = new Notification({
    title: n.title,
    ...(mac && n.subtitle ? { subtitle: n.subtitle } : {}),
    body: !mac && n.subtitle ? `${n.subtitle} · ${n.body}` : n.body,
    silent: !n.sound || n.level === 'passive',
    urgency: n.level === 'timeSensitive' ? 'critical' : n.level === 'passive' ? 'low' : 'normal',
    timeoutType: n.level === 'timeSensitive' ? 'never' : 'default',
    ...(iconPath() ? { icon: iconPath() } : {}),
    ...(actions.length ? { actions } : {})
  })
  notif.on('click', () => {
    h.open(n.kind === 'digest' ? undefined : n.entryID)
    notif.close()
  })
  notif.on('action', (_e, index) => {
    if (n.kind === 'digest') h.read(entries)
    else if (n.entryID && index === 0) h.snooze(n.entryID)
    else if (n.entryID) h.read([n.entryID])
  })
  remember(id, notif)
  notif.show()
}

/** Un recordatorio de estudio («Hora de estudiar», «Mañana: examen de…», el aviso de un evento). */
export function postReminderNotice(r: StudyReminderNotice, open: (r: StudyReminderNotice) => void): void {
  if (!Notification.isSupported()) return
  const notif = new Notification({ title: r.title, body: r.body, silent: false, ...(iconPath() ? { icon: iconPath() } : {}) })
  notif.on('click', () => {
    open(r)
    notif.close()
  })
  remember(r.id, notif)
  notif.show()
}

/** Quita las notificaciones de entradas que ya se leyeron, archivaron o pospusieron. */
export function withdrawNotices(entryIDs: readonly string[]): void {
  for (const e of entryIDs) {
    const id = 'aula.n.' + e
    live.get(id)?.close()
    live.delete(id)
  }
}

/** Lo no leído de «Novedades» en el icono del Dock (macOS) o del lanzador (Linux). */
export function setUnreadBadge(count: number): void {
  try { app.setBadgeCount(Math.max(0, count)) } catch { /* sin insignia en este sistema */ }
}
