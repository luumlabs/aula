// Menú nativo de la app: lo de siempre en cada sistema (Edición para copiar y pegar, Ventana, Ayuda) y los atajos de Aula
// (ir a cada pantalla, nuevo curso, ajustes, preguntar a Aula). Los comandos llegan a la interfaz como 'app.command'.
import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import type { AppCommand } from '@shared/ipc/contract'
import { getSettings, onSettingsChange } from '@main/services/settings'
import { paths } from '@main/services/paths'
import { emit } from './rpc'
import { getMainWindow } from './window'
import { reveal } from './visibility'
import { AULA_COPYRIGHT } from '@shared/legal'

type Lang = 'es' | 'en'

const TEXT = {
  es: {
    about: 'Acerca de Aula', settings: 'Ajustes…', hide: 'Ocultar Aula', hideOthers: 'Ocultar otros', showAll: 'Mostrar todo', quit: 'Salir de Aula',
    file: 'Archivo', newCourse: 'Nuevo curso con Aula…', importCourse: 'Importar curso…', close: 'Cerrar ventana',
    edit: 'Edición', undo: 'Deshacer', redo: 'Rehacer', cut: 'Cortar', copy: 'Copiar', paste: 'Pegar', pasteMatch: 'Pegar con el mismo estilo', del: 'Eliminar', selectAll: 'Seleccionar todo', find: 'Buscar en Aula…',
    view: 'Ver', sidebar: 'Mostrar u ocultar la barra lateral', zoomIn: 'Aumentar', zoomOut: 'Reducir', zoomReset: 'Tamaño real', fullscreen: 'Pantalla completa', reload: 'Recargar', devtools: 'Herramientas de desarrollo',
    go: 'Ir', home: 'Hoy', chat: 'Aula', calendar: 'Calendario', tools: 'Herramientas', documents: 'Documentos', inbox: 'Novedades', stats: 'Estadísticas', back: 'Atrás', forward: 'Adelante', ask: 'Preguntar a Aula',
    window: 'Ventana', minimize: 'Minimizar', zoom: 'Zoom', front: 'Traer todo al frente',
    help: 'Ayuda', report: 'Informar de un problema…', logs: 'Mostrar los registros', data: 'Mostrar la carpeta de datos',
    legal: 'Software libre con la licencia GNU AGPL v3 · Sin ninguna garantía'
  },
  en: {
    about: 'About Aula', settings: 'Settings…', hide: 'Hide Aula', hideOthers: 'Hide Others', showAll: 'Show All', quit: 'Quit Aula',
    file: 'File', newCourse: 'New Course with Aula…', importCourse: 'Import Course…', close: 'Close Window',
    edit: 'Edit', undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', pasteMatch: 'Paste and Match Style', del: 'Delete', selectAll: 'Select All', find: 'Search Aula…',
    view: 'View', sidebar: 'Show or Hide Sidebar', zoomIn: 'Zoom In', zoomOut: 'Zoom Out', zoomReset: 'Actual Size', fullscreen: 'Full Screen', reload: 'Reload', devtools: 'Developer Tools',
    go: 'Go', home: 'Today', chat: 'Aula', calendar: 'Calendar', tools: 'Tools', documents: 'Documents', inbox: 'Inbox', stats: 'Statistics', back: 'Back', forward: 'Forward', ask: 'Ask Aula',
    window: 'Window', minimize: 'Minimize', zoom: 'Zoom', front: 'Bring All to Front',
    help: 'Help', report: 'Report a Problem…', logs: 'Show Logs', data: 'Show Data Folder',
    legal: 'Free software under the GNU AGPL v3 · No warranty'
  }
} as const

const ISSUES_URL = 'https://github.com/luumlabs/aula/issues/new/choose'

/** Idioma del menú: el de los ajustes o, con «sistema», el del sistema si es español. */
export function menuLanguage(pref: string, locale: string): Lang {
  if (pref === 'es' || pref === 'en') return pref
  return locale.toLowerCase().startsWith('es') ? 'es' : 'en'
}

function send(command: AppCommand): void {
  reveal(getMainWindow(), { focus: false })
  emit('app.command', { command })
}

export function buildMenuTemplate(lang: Lang, platform: NodeJS.Platform, dev: boolean): MenuItemConstructorOptions[] {
  const t = TEXT[lang]
  const mac = platform === 'darwin'
  const cmd = (label: string, command: AppCommand, accelerator?: string): MenuItemConstructorOptions => ({ label, accelerator, click: () => send(command) })
  const appMenu: MenuItemConstructorOptions = {
    label: 'Aula',
    submenu: [
      { label: t.about, role: 'about' },
      { type: 'separator' },
      cmd(t.settings, 'settings', 'CmdOrCtrl+,'),
      { type: 'separator' },
      { label: t.hide, role: 'hide' },
      { label: t.hideOthers, role: 'hideOthers' },
      { label: t.showAll, role: 'unhide' },
      { type: 'separator' },
      { label: t.quit, role: 'quit' }
    ]
  }
  const file: MenuItemConstructorOptions = {
    label: t.file,
    submenu: [
      cmd(t.newCourse, 'newCourse', 'CmdOrCtrl+N'),
      cmd(t.importCourse, 'importCourse', 'CmdOrCtrl+O'),
      { type: 'separator' },
      ...(mac ? [{ label: t.close, role: 'close' } as MenuItemConstructorOptions] : [cmd(t.settings, 'settings', 'CmdOrCtrl+,'), { type: 'separator' } as MenuItemConstructorOptions, { label: t.quit, role: 'quit' } as MenuItemConstructorOptions])
    ]
  }
  const edit: MenuItemConstructorOptions = {
    label: t.edit,
    submenu: [
      { label: t.undo, role: 'undo' },
      { label: t.redo, role: 'redo' },
      { type: 'separator' },
      { label: t.cut, role: 'cut' },
      { label: t.copy, role: 'copy' },
      { label: t.paste, role: 'paste' },
      ...(mac ? [{ label: t.pasteMatch, role: 'pasteAndMatchStyle' } as MenuItemConstructorOptions] : []),
      { label: t.del, role: 'delete' },
      { label: t.selectAll, role: 'selectAll' },
      { type: 'separator' },
      cmd(t.find, 'search', 'CmdOrCtrl+K')
    ]
  }
  const view: MenuItemConstructorOptions = {
    label: t.view,
    submenu: [
      cmd(t.sidebar, 'toggleSidebar', mac ? 'Cmd+Ctrl+S' : 'Ctrl+\\'),
      { type: 'separator' },
      { label: t.zoomReset, role: 'resetZoom' },
      { label: t.zoomIn, role: 'zoomIn' },
      { label: t.zoomOut, role: 'zoomOut' },
      { type: 'separator' },
      { label: t.fullscreen, role: 'togglefullscreen' },
      ...(dev ? [{ type: 'separator' } as MenuItemConstructorOptions, { label: t.reload, role: 'reload' } as MenuItemConstructorOptions, { label: t.devtools, role: 'toggleDevTools' } as MenuItemConstructorOptions] : [])
    ]
  }
  const go: MenuItemConstructorOptions = {
    label: t.go,
    submenu: [
      // en el orden de la barra lateral
      cmd(t.home, 'goHome', 'CmdOrCtrl+1'),
      cmd(t.chat, 'goChat', 'CmdOrCtrl+2'),
      cmd(t.calendar, 'goCalendar', 'CmdOrCtrl+3'),
      cmd(t.stats, 'goStats', 'CmdOrCtrl+4'),
      cmd(t.tools, 'goTools', 'CmdOrCtrl+5'),
      cmd(t.documents, 'goDocuments', 'CmdOrCtrl+6'),
      cmd(t.inbox, 'goInbox', 'CmdOrCtrl+7'),
      { type: 'separator' },
      cmd(t.back, 'back', mac ? 'Cmd+[' : 'Alt+Left'),
      cmd(t.forward, 'forward', mac ? 'Cmd+]' : 'Alt+Right'),
      { type: 'separator' },
      cmd(t.ask, 'askAula', 'CmdOrCtrl+J')
    ]
  }
  const windowMenu: MenuItemConstructorOptions = {
    label: t.window,
    role: 'window',
    submenu: mac
      ? [{ label: t.minimize, role: 'minimize' }, { label: t.zoom, role: 'zoom' }, { type: 'separator' }, { label: t.front, role: 'front' }]
      : [{ label: t.minimize, role: 'minimize' }, { label: t.close, role: 'close' }]
  }
  const help: MenuItemConstructorOptions = {
    label: t.help,
    role: 'help',
    submenu: [
      { label: t.report, click: () => void shell.openExternal(ISSUES_URL) },
      { type: 'separator' },
      { label: t.logs, click: () => void shell.openPath(paths.logs()) },
      { label: t.data, click: () => void shell.openPath(paths.root()) }
    ]
  }
  return [...(mac ? [appMenu] : []), file, edit, view, go, windowMenu, help]
}

/** Pone el menú y lo rehace cuando cambia el idioma. */
export function installMenu(): void {
  let lang: Lang | null = null
  const apply = (pref: string) => {
    const next = menuLanguage(pref, app.getLocale())
    if (next === lang) return
    lang = next
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(next, process.platform, !app.isPackaged)))
    app.setAboutPanelOptions({ applicationName: 'Aula', applicationVersion: app.getVersion(), copyright: aboutCopyright(next) })
  }
  apply(getSettings().general.language)
  onSettingsChange((s) => apply(s.general.language))
}

/** El panel «Acerca de» de macOS: el aviso de copyright y de la licencia (AGPL v3, §0). */
export function aboutCopyright(lang: Lang): string {
  return `${AULA_COPYRIGHT}\n${TEXT[lang].legal}`
}
