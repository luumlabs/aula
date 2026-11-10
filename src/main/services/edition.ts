// Qué puede hacer esta edición de Aula. La de la Mac App Store vive en el sandbox de Apple: se actualiza desde la tienda,
// no instala ni lanza ejecutables externos y pide permiso antes de enviar nada a una IA.
// Es el ÚNICO sitio del proceso principal que mira `process.mas` (lo comprueba edition.test.ts): el resto pregunta por
// la capacidad, para que una función nueva no se quede fuera del límite por olvidar una comprobación suelta.

/** ¿Es la compilación de la Mac App Store? (`process.mas` solo existe en Electron; en las pruebas no está). */
export function isAppStore(): boolean {
  return (process as NodeJS.Process & { mas?: boolean }).mas === true
}

export const edition = {
  /** Busca e instala sus propias actualizaciones (GitHub). La de la tienda no: las gestiona la App Store. */
  get selfUpdates(): boolean { return !isAppStore() },
  /** Puede descargar y lanzar ejecutables externos: agentes de terminal, Codex, el motor local de Aula. */
  get externalTools(): boolean { return !isAppStore() },
  /** Pide permiso antes de enviar datos a un proveedor de IA y no sigue redirecciones con ellos. */
  get aiConsent(): boolean { return isAppStore() }
}
