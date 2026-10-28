// Estado del almacén de secretos para la interfaz (nunca valores): bloqueado si el llavero no deja leerlo.
import type { SecretsState } from '@shared/ipc/secrets'
import { secrets } from '@main/services/secrets'
import { FileSecretStore } from '@main/services/secrets-file'
import { log } from '@main/services/log'
import { emit, handle } from '../rpc'

function store(): FileSecretStore | null {
  const s = secrets()
  return s instanceof FileSecretStore ? s : null
}

export function register(): void {
  handle('secrets.status', (): SecretsState => store()?.status() ?? { locked: false })
  handle('secrets.retry', (): SecretsState => {
    const s = store()?.retry() ?? { locked: false }
    emit('secrets.changed', s)
    return s
  })
  handle('secrets.reset', (): SecretsState => {
    const st = store()
    if (!st) return { locked: false }
    const r = st.reset()
    if (r.movedTo) log.warn('[secretos] se empezó de cero (archivo anterior apartado)')
    const out: SecretsState = { ...r.status, ...(r.movedTo ? { movedTo: r.movedTo.split(/[\\/]/).pop() } : {}) }
    emit('secrets.changed', out)
    return out
  })
}
