// Cómo se ejecuta Aula, para los servicios (que no importan Electron): lo fija src/main/index.ts al arrancar con
// `app.isPackaged`. Por defecto, lo seguro: como la app instalada, sin los atajos de desarrollo.
let packaged = true

export function setPackaged(value: boolean): void {
  packaged = value
}

export function isPackagedApp(): boolean {
  return packaged
}

/** Una variable de entorno de desarrollo o de pruebas (p. ej. la ruta de un script que se ejecuta): solo sin empaquetar.
 *  En la app instalada no cuenta (si no, cualquiera que pusiera la variable haría ejecutar a Aula otro programa). */
export function devOverride(name: string): string | undefined {
  if (packaged) return undefined
  const value = process.env[name]
  return value ? value : undefined
}
