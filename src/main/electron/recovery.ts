// Si la interfaz se cae (falta de memoria, un fallo de la GPU con una herramienta 3D…), la ventana no se queda en blanco: se
// recarga sola, como mucho unas pocas veces seguidas (si se cae en bucle, mejor dejarlo como está que recargar sin fin). Los
// fallos del proceso de la GPU solo se apuntan: Chromium lo vuelve a lanzar y las herramientas 3D recuperan su contexto WebGL.
import { app, type BrowserWindow, type WebContents } from 'electron'
import { log } from '@main/services/log'

/** Cuántas recargas se permiten en la ventana de tiempo. */
const MAX_RELOADS = 3
const WINDOW_MS = 60_000

/** ¿Se recarga ahora? Lleva la cuenta de las recargas recientes (puro, para probarlo). */
export function shouldReload(history: number[], now: number, max = MAX_RELOADS, windowMs = WINDOW_MS): boolean {
  while (history.length && now - history[0] > windowMs) history.shift()
  if (history.length >= max) return false
  history.push(now)
  return true
}

function watch(contents: WebContents): void {
  const reloads: number[] = []
  contents.on('render-process-gone', (_e, details) => {
    log.warn(`[ventana] la interfaz se cerró (${details.reason}, código ${details.exitCode})`)
    if (details.reason === 'clean-exit' || contents.isDestroyed()) return
    if (!shouldReload(reloads, Date.now())) {
      log.error('[ventana] la interfaz se cae una y otra vez: no se recarga más')
      return
    }
    // un instante para que el sistema libere la memoria del proceso caído
    setTimeout(() => { if (!contents.isDestroyed()) contents.reload() }, 400)
  })
  contents.on('unresponsive', () => log.warn('[ventana] la interfaz no responde'))
  contents.on('responsive', () => log.info('[ventana] la interfaz vuelve a responder'))
}

/** Vigila cada ventana de la app (las del navegador de plataformas incluidas) y el proceso de la GPU. */
export function installRecovery(): void {
  app.on('browser-window-created', (_e, win: BrowserWindow) => watch(win.webContents))
  app.on('child-process-gone', (_e, details) => {
    if (details.type === 'GPU') log.warn(`[gpu] el proceso de la GPU se cerró (${details.reason}); Chromium lo vuelve a lanzar`)
  })
}
