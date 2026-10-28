// IPC de la búsqueda en toda la biblioteca (paleta ⌘K). La lógica vive en src/main/services/search/library.ts.
import { handle } from '../rpc'
import { invalidArgs } from '@main/services/errors'
import { log } from '@main/services/log'
import { librarySearch } from '@main/services/search'
import { LIBRARY_SEARCH_MAX } from '@shared/ipc/search'

/** Tras arrancar, se indexa la biblioteca poco a poco para que la primera búsqueda ya sea rápida. */
const WARM_DELAY_MS = 8_000

export function register(): void {
  handle('search.query', (args) => {
    if (!args || typeof args !== 'object' || typeof args.q !== 'string') throw invalidArgs('Búsqueda no válida')
    const limit = args.limit === undefined ? undefined : Number(args.limit)
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > LIBRARY_SEARCH_MAX)) throw invalidArgs('Límite no válido')
    return librarySearch().query(args.q.slice(0, 200), limit === undefined ? {} : { limit })
  })
  const t = setTimeout(() => void librarySearch().warm().catch((err: unknown) => log.warn('search: no se pudo preparar la búsqueda', err)), WARM_DELAY_MS)
  t.unref?.()
}
