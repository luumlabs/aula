// Lectura de una entrada en este proceso (archivo, dirección o texto → documento). La usan `readInput` cuando no hay
// lector aparte y el propio proceso de lectura (`ingest-worker`).
import type { IngestInput, SourceDocument } from '@shared/ingest'
import { checkCancelled } from './errors'
import type { IngestOptions } from './options'
import { documentFromText, readDocument, readWeb } from './pipeline'

export async function readInputHere(input: IngestInput, options: Partial<IngestOptions> = {}): Promise<SourceDocument> {
  switch (input.type) {
    case 'file': return readDocument(input.path, options)
    case 'url': return readWeb(input.url, options)
    case 'text':
      checkCancelled(options.signal)
      return documentFromText(input.text, input.title ?? '')
  }
}
