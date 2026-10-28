// Proceso de lectura de materiales (PDF, Word, imágenes con OCR…). electron-vite lo empaqueta como `out/main/ingest-worker.js`
// y el proceso principal lo arranca con `utilityProcess.fork` (src/main/electron/ingest-host.ts): así leer un PDF enorme
// no bloquea la interfaz. Habla con el principal por `process.parentPort` (ver services/ingest/worker/protocol.ts).
// Nunca importa `electron`: dibujar páginas escaneadas se le pide al proceso principal.
import { forwardLogs, serveIngestWorker } from './services/ingest/worker/server'
import type { Endpoint, FromWorker } from './services/ingest/worker/protocol'

const parent = process.parentPort
if (!parent) {
  console.error('ingest-worker: se debe lanzar con utilityProcess.fork')
  process.exit(1)
}

const port: Endpoint<unknown, FromWorker> = {
  post: (message) => parent.postMessage(message),
  listen: (handler) => { parent.on('message', (event) => handler(event.data)) }
}

forwardLogs(port)
// Un fallo inesperado se registra; la lectura que lo causó responde con su error y el proceso sigue atendiendo
process.on('unhandledRejection', (reason) => {
  try { port.post({ type: 'log', level: 'error', text: `[ingest-worker] ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}` }) } catch { /* canal cerrado */ }
})
serveIngestWorker(port)
