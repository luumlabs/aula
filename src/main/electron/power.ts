// Política de energía (lado del proceso principal): avisa a la interfaz de si la ventana se ve (activa, sin foco,
// minimizada, oculta), de si la pantalla está bloqueada y de si va con batería. La interfaz duerme lo ambiental cuando no
// se ve (design/ambient.ts): en macOS Chromium no marca la página como oculta al minimizar ni al esconderla en la bandeja.
import { app, powerMonitor, type BrowserWindow } from 'electron'
import type { PowerState, WindowPresence } from '@shared/ipc/power'
import { emit } from './rpc'

let watched: BrowserWindow | null = null
let locked = false
let battery = false
let last = ''
let monitorInstalled = false

export function presenceOf(win: BrowserWindow | null): WindowPresence {
  if (!win || win.isDestroyed()) return 'hidden'
  if (win.isMinimized()) return 'minimized'
  if (!win.isVisible()) return 'hidden'
  return win.isFocused() ? 'active' : 'inactive'
}

/** Capturas y vídeos (scripts/video graba con la ventana oculta y AULA_DEMO): sin política de energía. Nunca en la app instalada. */
function pinned(): boolean {
  return !app.isPackaged && (process.env.AULA_AMBIENT === 'run' || (!!process.env.AULA_HIDDEN && !!process.env.AULA_DEMO))
}

export function powerState(): PowerState {
  return { window: presenceOf(watched), locked, battery, ...(pinned() ? { pinned: true } : {}) }
}

/** Avisa solo si algo cambió. Los eventos de la ventana llegan antes de que su estado cambie del todo: se mira otra vez en un
 *  momento (sin coste: un temporizador corto que no se repite). */
function publish(): void {
  const s = powerState()
  const key = `${s.window}|${s.locked}|${s.battery}`
  if (key === last) return
  last = key
  emit('app.power', s)
}
function changed(): void {
  publish()
  setTimeout(publish, 120)
}

/** Sigue la ventana principal (una línea en createMainWindow). */
export function watchPower(win: BrowserWindow): void {
  watched = win
  last = ''
  win.on('show', changed)
  win.on('hide', changed)
  win.on('minimize', changed)
  win.on('restore', changed)
  win.on('focus', changed)
  win.on('blur', changed)
  // En macOS (Electron 44) win.hide()/show() —la bandeja, «Aula siempre activa» al cerrar— no emiten «hide»/«show», y sin
  // la app activa tampoco llegan focus/blur: además de los eventos, se mira una vez por segundo (unas llamadas nativas, nada)
  const poll = setInterval(publish, 1000)
  poll.unref?.()
  win.once('closed', () => {
    clearInterval(poll)
    if (watched === win) watched = null
  })
  installMonitor()
}

function installMonitor(): void {
  if (monitorInstalled) return
  monitorInstalled = true
  // Cmd+H / volver a la app (macOS) no siempre llegan como eventos de la ventana
  app.on('did-become-active', changed)
  app.on('did-resign-active', changed)
  try {
    battery = powerMonitor.isOnBatteryPower()
    const lock = (v: boolean) => () => {
      locked = v
      changed()
    }
    powerMonitor.on('lock-screen', lock(true))
    powerMonitor.on('unlock-screen', lock(false))
    powerMonitor.on('suspend', lock(true))
    powerMonitor.on('resume', lock(false))
    powerMonitor.on('user-did-resign-active', lock(true))
    powerMonitor.on('user-did-become-active', lock(false))
    const power = () => {
      battery = powerMonitor.isOnBatteryPower()
      changed()
    }
    powerMonitor.on('on-battery', power)
    powerMonitor.on('on-ac', power)
  } catch {
    /* sin powerMonitor (Linux sin D-Bus): solo la ventana */
  }
}
