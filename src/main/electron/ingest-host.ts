// Lectura de materiales en un proceso de utilidad (`out/main/ingest-worker.js`): el proceso principal no se bloquea
// mientras se lee un PDF de mil páginas o se hace OCR. Se arranca al primer uso, se cierra si no se usa, se vuelve a
// arrancar si se cae y se cierra al salir. Las páginas escaneadas las dibuja aquí `electronRasterizer` (ventana oculta).
import { app, utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import { engineLanguage } from '@engine/language'
import * as ingest from '@main/services/ingest'
import { configureOcr, ingestLanguage, ocrConfiguration, readInputHere, setIngestLanguage, setIngestRunner } from '@main/services/ingest'
import { IngestWorkerClient, type WorkerProcess } from '@main/services/ingest/worker/client'
import type { ToWorker } from '@main/services/ingest/worker/protocol'
import { log } from '@main/services/log'
import { paths } from '@main/services/paths'
import { getSettings, onSettingsChange } from '@main/services/settings'

let client: IngestWorkerClient | null = null

/**
 * Se lanza con su ruta DENTRO de `app.asar` aunque esté desempaquetado: los procesos de utilidad leen el asar (y Electron
 * redirige lo desempaquetado), y solo así encuentran `node_modules` (pdf.js, tesseract.js), que siguen en el asar.
 */
function workerScript(): string {
  // AULA_INGEST_WORKER (desarrollo, pruebas) nunca en la app instalada: sería ejecutar otro programa con los permisos de Aula
  return (!app.isPackaged && process.env.AULA_INGEST_WORKER) || join(__dirname, 'ingest-worker.js')
}

function fork(): WorkerProcess {
  const child: UtilityProcess = utilityProcess.fork(workerScript(), [], { serviceName: 'Aula Ingest', stdio: 'inherit' })
  return {
    post: (message: ToWorker) => child.postMessage(message),
    onMessage: (handler) => { child.on('message', handler) },
    onExit: (handler) => { child.on('exit', handler) },
    kill: () => { child.kill() }
  }
}

/** Los avisos, el progreso y los errores de la lectura, en el idioma de la interfaz (también los de este proceso). */
function syncLanguage(): void {
  try { setIngestLanguage(engineLanguage(getSettings().general.language, app.getLocale())) } catch { /* sin ajustes: español */ }
}

/** La caché de los datos de idioma de Tesseract, en la carpeta de datos (la comparten este proceso y el de lectura). */
function ensureOcrCache(): void {
  if (ocrConfiguration().cachePath) return
  try { configureOcr({ ...ocrConfiguration(), cachePath: join(paths.cache(), 'tesseract') }) } catch { /* sin carpeta de datos: la temporal */ }
}

/** Instala el lector aparte (tras `installRasterizer()`, que pone el dibujante de páginas por defecto). */
export function installIngestWorker(): void {
  if (client) return
  syncLanguage()
  ensureOcrCache()
  onSettingsChange((s, prev) => {
    if (s.general.language !== prev.general.language) syncLanguage()
  })
  const c = new IngestWorkerClient({
    spawn: fork,
    settings: () => ({ uiLanguage: ingestLanguage(), ocr: { ...ocrConfiguration() } }),
    concurrency: 2,
    fallback: readInputHere,
    log: (level, text) => log[level](text)
  })
  client = c
  setIngestRunner(c)
  app.on('will-quit', () => {
    setIngestRunner(null)
    c.dispose()
    client = null
  })
  // Desarrollo: las comprobaciones con Playwright (`app.evaluate`) llegan a la lectura por aquí
  if (!app.isPackaged && process.env.AULA_DEV_INGEST === '1') Object.assign(globalThis, { __aulaIngest: { ...ingest, client: c } })
}
