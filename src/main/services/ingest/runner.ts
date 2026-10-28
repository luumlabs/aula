// Lector aparte (enchufable): la capa de Electron instala uno que lee en un proceso de utilidad para no bloquear el
// proceso principal. Sin él, todo se lee aquí mismo. Guardar en el curso sigue siendo cosa del proceso principal.
import type { IngestInput, SourceDocument } from '@shared/ingest'
import type { IngestOptions } from './options'

export interface IngestRunner {
  /**
   * Lee la entrada y devuelve el documento (lo que haría `readInput` aquí). Debe respetar `signal`, informar por
   * `onProgress` y lanzar los mismos errores (`IngestError`, `CancelledError`…).
   */
  read(input: IngestInput, options: Partial<IngestOptions>): Promise<SourceDocument>
}

let current: IngestRunner | null = null

/** Instala (o quita, con `null`) el lector aparte. */
export function setIngestRunner(runner: IngestRunner | null): void {
  current = runner
}

export function ingestRunner(): IngestRunner | null {
  return current
}

/**
 * ¿Puede esta lectura ir al lector aparte? Un transporte HTTP o un motor de OCR propios (pruebas, red de Electron) son
 * objetos de este proceso y no cruzan a otro: esa lectura se hace aquí. El dibujante de páginas sí (se le pregunta).
 */
export function canDelegate(options: Partial<IngestOptions>): boolean {
  return options.transport === undefined && (options.ocr === undefined || options.ocr === false)
}
