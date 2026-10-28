// Navegador de plataformas de Aula (Electron): sesiones persistentes por cuenta, cookies que sobreviven al reinicio, ventana
// de inicio de sesión, pestañas de lectura ocultas, descargas seguras y permisos. Punto de entrada: `platformBrowser()`.
export { PlatformBrowser, platformBrowser, installQuitHook } from './platform-browser'
export type { BrowseOptions, ReadOptions, PageReadingResult, ClickResult, ScreenshotResult, DownloadRequest } from './platform-browser'
export type { TabRef } from './pool'
export { partitionFor, platformSession, clearPlatformSession } from './sessions'
