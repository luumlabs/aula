// Actualizaciones de Aula: busca en segundo plano (al arrancar y cada 6 horas), descarga sola y se instala al reiniciar
// o al salir. Solo en la app instalada; en desarrollo el estado es 'unsupported'.

declare module './contract' {
  interface RpcMethods {
    'updates.state': { args: void; result: UpdateState }
    /** Busca ahora (también con «Actualizar sola» apagado: el estudiante lo pidió). */
    'updates.check': { args: void; result: UpdateState }
    /** Reinicia e instala la versión ya descargada. */
    'updates.install': { args: void; result: void }
    /** Abre en el navegador la página de descargas (cuando hay que instalar a mano). */
    'updates.openDownloadPage': { args: void; result: void }
  }
  interface RpcEvents {
    'updates.changed': UpdateState
  }
}

/**
 * idle → checking → upToDate | downloading → ready
 * available: hay versión nueva pero esta copia no puede instalarla sola (ver `blocked`; con 'failedBefore', `error` dice
 * por qué falló). La barra lateral lo avisa (como 'error' al descargar o instalar) y Ajustes explica qué hacer.
 */
export type UpdateStatus = 'idle' | 'checking' | 'upToDate' | 'available' | 'downloading' | 'ready' | 'error' | 'unsupported'

/** Por qué falló (la interfaz lo explica con sus palabras). */
export type UpdateErrorCode =
  | 'offline' // sin conexión, DNS, proxy, tiempo agotado
  | 'unavailable' // no hay ninguna versión publicada para este sistema (o el repositorio no es público)
  | 'corrupt' // la descarga no coincide con su SHA-512
  | 'signature' // la versión nueva no tiene una firma válida (o no es del mismo desarrollador)
  | 'permission' // no se puede escribir donde está instalada
  | 'disk' // sin espacio
  | 'install' // no se pudo colocar la versión nueva (se dejó la anterior)
  | 'system' // macOS: la versión nueva pide un macOS más nuevo que el de este Mac
  | 'unknown'

/** Por qué esta copia no se actualiza sola. */
export type UpdateBlock =
  | 'dev' // versión de desarrollo
  | 'package' // paquete del sistema (.deb): no se instala sola; se busca igual y se ofrece la descarga
  | 'translocated' // macOS: abierta desde Descargas o desde el .dmg, sin mover a Aplicaciones
  | 'readOnly' // la carpeta donde está no deja escribir
  | 'failedBefore' // esta misma versión ya no se pudo instalar: no se reintenta sola

export interface UpdateState {
  status: UpdateStatus
  /** Versión nueva (encontrada, al descargar o lista). */
  version?: string
  /** 0…1 mientras descarga (1 = comprobando la descarga). */
  progress?: number
  /** Si falló (también en 'available' con 'failedBefore': por qué falló esa versión). */
  error?: UpdateErrorCode
  /** En qué paso falló. */
  errorStage?: 'check' | 'download' | 'install'
  /** 'available' y 'unsupported': por qué no se instala sola. */
  blocked?: UpdateBlock
  /** Notas de la versión nueva (Markdown; puede traer una sección por idioma, ver release-notes.ts). */
  notes?: string
  /** Tras actualizarse: la versión de la que viene (para «Aula se actualizó»). */
  updatedFrom?: string
  checkedAt?: string
}
