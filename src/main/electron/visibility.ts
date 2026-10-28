// Cuándo se puede enseñar una ventana de Aula.
//   · AULA_HIDDEN al lanzar (pruebas, capturas, auditorías): NUNCA. Ni al activar la app (macOS emite `activate` al lanzarla
//     o al pulsar su icono del Dock), ni con una segunda instancia, el menú, una notificación o la bandeja; tampoco se
//     maximiza (maximizar enseña la ventana) ni pasa a pantalla completa (la de HTML, p. ej. «Presentar» en unas
//     diapositivas, también la enseñaría). En macOS, además, sin icono en el Dock, como una app LSUIElement.
//   · Abierta al iniciar sesión con «Aula siempre activa»: solo la PRIMERA ventana empieza escondida; después se enseña
//     cuando el estudiante la pide (Dock, bandeja, notificación…).
import type { App, BrowserWindow } from 'electron'

/** Se lee al cargar el módulo: es lo que pidió quien lanzó Aula, no algo que la app decida después. */
const alwaysHidden = !!process.env.AULA_HIDDEN
let firstHidden = alwaysHidden

/** ¿Lanzada con AULA_HIDDEN? Entonces ninguna ventana se enseña nunca. */
export function windowsAlwaysHidden(): boolean {
  return alwaysHidden
}

/** Abierta al iniciar sesión con el modo «siempre activa»: la primera ventana empieza escondida, en la bandeja. */
export function startHiddenAtLogin(): void {
  firstHidden = true
}

/** Para la ventana principal que se está creando: ¿se enseña al estar lista? (Consume el «empezar escondida».) */
export function showWhenReady(): boolean {
  const hidden = firstHidden
  firstHidden = alwaysHidden
  return !hidden
}

/** Enseña (y, si se pide, enfoca) una ventana. Con AULA_HIDDEN no hace nada y devuelve false. */
export function reveal(win: BrowserWindow | null | undefined, opts: { focus?: boolean } = {}): boolean {
  if (alwaysHidden || !win || win.isDestroyed()) return false
  if (win.isMinimized()) win.restore()
  win.show()
  if (opts.focus !== false) win.focus()
  return true
}

/** Con AULA_HIDDEN, ninguna ventana (la principal, el navegador de plataformas, la de imprimir…) puede ponerse a pantalla
 *  completa: entrar en ella la enseñaría en la pantalla de quien está trabajando. Sin AULA_HIDDEN no hace nada. */
export function guardHiddenWindows(app: Pick<App, 'on'>): void {
  if (!alwaysHidden) return
  app.on('browser-window-created', (_e, win) => keepOffScreen(win))
}

/** Para cada ventana nueva con AULA_HIDDEN: sin pantalla completa y, si algo la enseña, se vuelve a esconder. */
export function keepOffScreen(win: BrowserWindow): void {
  win.setFullScreenable(false)
  const back = (): void => {
    if (win.isDestroyed()) return
    if (win.isFullScreen()) win.setFullScreen(false)
    win.hide()
  }
  win.on('enter-full-screen', back)
  win.webContents.on('enter-html-full-screen', back)
  win.on('show', () => win.hide())
}
