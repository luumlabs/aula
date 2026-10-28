// La bandeja del sistema (MenuBarPanel.swift, en sencillo): la marca de Aula (plantilla monocroma en macOS), lo no leído y un
// menú con «Abrir Aula», «Novedades (n)», «Estudiar ahora», «Pausar Aula siempre activa» y «Salir». Solo existe con
// «Aula siempre activa» encendida (es lo que deja a Aula trabajando con la ventana cerrada).
import { Menu, Tray, nativeImage } from 'electron'
import { join } from 'node:path'
import { tr } from '@shared/ai/i18n'

export interface TrayHandlers {
  open(): void
  inbox(): void
  study(): void
  togglePause(): void
  quit(): void
}

export interface TrayState {
  unread: number
  paused: boolean
  /** «Próxima: hoy a las 20:00» o lo que necesita al estudiante. */
  status?: string
}

let tray: Tray | null = null
let handlers: TrayHandlers | null = null
let last: TrayState = { unread: 0, paused: false }

function image(): Electron.NativeImage {
  const dir = join(__dirname, '../../resources/tray')
  if (process.platform === 'darwin') {
    const img = nativeImage.createFromPath(join(dir, 'trayTemplate.png'))
    img.setTemplateImage(true)
    return img
  }
  return nativeImage.createFromPath(join(dir, process.platform === 'win32' ? 'tray.png' : 'tray@2x.png'))
}

function menu(s: TrayState): Menu {
  const h = handlers!
  const items: Electron.MenuItemConstructorOptions[] = []
  if (s.status) items.push({ label: s.status, enabled: false }, { type: 'separator' })
  items.push(
    { label: tr('Abrir Aula', 'Open Aula'), click: () => h.open() },
    { label: s.unread > 0 ? tr(`Novedades (${s.unread})`, `Inbox (${s.unread})`) : tr('Novedades', 'Inbox'), click: () => h.inbox() },
    { label: tr('Estudiar ahora', 'Study now'), click: () => h.study() },
    { type: 'separator' },
    { label: s.paused ? tr('Reanudar Aula siempre activa', 'Resume Aula always on') : tr('Pausar Aula siempre activa', 'Pause Aula always on'), click: () => h.togglePause() },
    { type: 'separator' },
    { label: tr('Salir de Aula', 'Quit Aula'), role: undefined, click: () => h.quit() }
  )
  return Menu.buildFromTemplate(items)
}

/** Muestra la bandeja (si no está) con estas acciones. */
export function showTray(h: TrayHandlers, state: TrayState = last): void {
  handlers = h
  if (!tray) {
    tray = new Tray(image())
    tray.setToolTip('Aula')
    // en Windows y Linux un clic abre Aula; el menú, con el botón derecho
    if (process.platform !== 'darwin') tray.on('click', () => handlers?.open())
  }
  updateTray(state)
}

export function updateTray(state: TrayState): void {
  last = state
  if (!tray || !handlers) return
  tray.setContextMenu(menu(state))
  tray.setToolTip(state.unread > 0 ? tr(`Aula · ${state.unread} sin leer`, `Aula · ${state.unread} unread`) : 'Aula')
  if (process.platform === 'darwin') tray.setTitle(state.unread > 0 ? String(state.unread) : '', { fontType: 'monospacedDigit' })
}

export function hideTray(): void {
  tray?.destroy()
  tray = null
}

export function trayVisible(): boolean {
  return !!tray && !tray.isDestroyed()
}
